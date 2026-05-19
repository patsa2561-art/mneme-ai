# #3 — Bootstrap Prelude (2KB stub + CDN-hosted runtime)

**Status:** 📐 Spec + executable sketch
**Sketch:** [`sketch/03_prelude/`](sketch/03_prelude/) *(when added — see below)*
**User command:** `npm install -g mneme-ai-prelude` (initial install) → `mneme welcome` triggers download

## The technique

What npm installs globally is a tiny launcher (~2KB) — no `@mneme-ai/*`,
no transformers, no sharp, no commander. On first invocation of any
`mneme <cmd>` command the launcher detects the missing runtime and:

1. Asks the user once: `Choose runtime: [L]ite (5MB) / [F]ull WASM (467MB)?`
2. Downloads the matching tarball from GitHub Releases CDN
3. Extracts to `~/.mneme-runtime/X.Y.Z-<flavor>/`
4. Drops a symlink `~/.mneme-runtime/active → X.Y.Z-<flavor>/`
5. Re-execs itself against the now-present runtime

Subsequent invocations skip the bootstrap (the symlink exists) and
proxy straight to the runtime binary. Upgrade flow is the same as
auto-update in Chrome/VS Code/Slack: the launcher polls a manifest
on the CDN, downloads the new flavor side-by-side, flips the symlink
atomically.

## Why this is the right long-term answer

- **npm sees a 2KB package** — there's nothing for the npm 10 bug to
  ignore, nothing for EBUSY to lock, nothing to download slowly.
- **Per-user runtime choice** — user picks lite vs full AFTER seeing
  bandwidth/quality tradeoff, not blind at `npm install` time.
- **Atomic update** — symlink flip is one syscall; rollback = flip back.
- **Offline-friendly** — once the runtime is on disk, no network needed
  for `mneme <cmd>` calls. npm install pain happens once.
- **CI-friendly** — set `MNEME_PRELUDE_FLAVOR=lite` to skip the prompt.

This is the install pattern Chrome, VS Code, Slack, Discord, Spotify,
Cypress, Playwright, and Tauri use. It's "boring correct" for
substantial desktop / CLI tooling. npm has never been the right home
for 467MB runtimes; this spec admits that and routes around it.

## Mechanics (the sketch)

`mneme-ai-prelude/package.json`:

```json
{
  "name": "mneme-ai-prelude",
  "version": "1.0.0",
  "bin": { "mneme": "./bin/prelude.js" },
  "dependencies": {},
  "engines": { "node": ">=18" }
}
```

`bin/prelude.js` (~150 lines, single file, no deps):

```js
#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path"); const os = require("node:os");
const https = require("node:https"); const child = require("node:child_process");
const crypto = require("node:crypto");

const RUNTIME_DIR = path.join(os.homedir(), ".mneme-runtime");
const ACTIVE = path.join(RUNTIME_DIR, "active");
const MANIFEST_URL = "https://github.com/patsa2561-art/mneme-ai/releases/download/runtime-manifest/manifest.json";

// 1. Already bootstrapped?
if (fs.existsSync(ACTIVE)) {
  const binPath = path.join(ACTIVE, "bin", "mneme.js");
  if (fs.existsSync(binPath)) {
    return require("node:child_process").spawn(process.execPath, [binPath, ...process.argv.slice(2)], { stdio: "inherit" })
      .on("exit", (code) => process.exit(code ?? 0));
  }
}

// 2. First run — fetch manifest + ask user.
const flavor = process.env.MNEME_PRELUDE_FLAVOR
  || (process.stdout.isTTY ? promptUser() : "lite"); // CI defaults to lite
const manifest = await fetchJson(MANIFEST_URL);
const tarballUrl = manifest.flavors[flavor].url;
const expectedSha = manifest.flavors[flavor].sha256;

// 3. Download + verify + extract.
const tmpTar = path.join(os.tmpdir(), `mneme-prelude-${Date.now()}.tgz`);
await download(tarballUrl, tmpTar);
verifySha256(tmpTar, expectedSha);
const target = path.join(RUNTIME_DIR, manifest.version + "-" + flavor);
extractTar(tmpTar, target);

// 4. Atomic symlink flip.
const tmpSymlink = ACTIVE + ".new";
fs.symlinkSync(target, tmpSymlink, "dir");
fs.renameSync(tmpSymlink, ACTIVE);

// 5. Re-exec.
return child.spawn(process.execPath, [path.join(ACTIVE, "bin", "mneme.js"), ...process.argv.slice(2)], { stdio: "inherit" })
  .on("exit", (code) => process.exit(code ?? 0));
```

## What needs to exist on the server side

1. **GitHub Release `runtime-manifest`** (one tag, perpetually updated)
   containing `manifest.json`:
   ```json
   {
     "version": "2.19.69",
     "flavors": {
       "lite": { "url": "...mneme-runtime-2.19.69-lite.tgz", "sha256": "..." },
       "full": { "url": "...mneme-runtime-2.19.69-full.tgz", "sha256": "..." }
     }
   }
   ```
2. **Two tarballs per Mneme version** uploaded to a GitHub Release with
   tag `vX.Y.Z`:
   - `mneme-runtime-X.Y.Z-lite.tgz` (~5MB) — bin/ + dist/ + minimal node_modules
   - `mneme-runtime-X.Y.Z-full.tgz` (~155MB compressed) — same + transformers + sharp
3. **A CI step in `release.yml`** that builds both flavors via `npm pack`
   in a tmp tree (one with `optionalDependencies` stripped, one full)
   and uploads them.

## Math/system trick: signed manifest + tarball SHA-256

Every flavor entry carries a `sha256` field. The prelude verifies the
downloaded tarball matches BEFORE extracting. If the CDN serves a
corrupt or tampered tarball, the prelude aborts with a clear error
("integrity check failed for vX.Y.Z lite; expected SHA-256 abc..., got
def...; do not run, alert security@mneme.ai"). This is the same trust
model that Homebrew uses for casks and that `verdaccio` uses for
mirrored tarballs.

## Tradeoffs

- ✅ npm bug completely sidestepped (only 2KB on npm)
- ✅ Per-user runtime choice at first run
- ✅ Atomic updates via symlink flip
- ✅ Multi-flavor support (lite + full + future "gpu" / "wasm-only" / …)
- ❌ Initial first-run latency (~5-90s download depending on flavor)
- ❌ Needs server-side artifact pipeline (GitHub Releases works for free)
- ❌ Two install verbs to teach users: `npm install -g mneme-ai-prelude`
   followed by `mneme welcome` (vs. today's single-step)

## Roadmap to ship

| Sprint | Deliverable |
|---|---|
| 1 (1wk) | Stand up `mneme-ai-prelude` package + GitHub Release `runtime-manifest` |
| 2 (1wk) | CI: build + upload both flavors on every `vX.Y.Z` tag push |
| 3 (1wk) | Prelude `bin/prelude.js` with download + SHA verify + symlink flip |
| 4 (1wk) | Auto-update: prelude polls manifest, downloads new flavor side-by-side, flips |
| 5 (1wk) | Rollback CLI: `mneme switch-runtime <X.Y.Z>` |

Total: ~5 weeks for a solo dev. Halves with a teammate.

## Why this isn't shipped today

Three blocking pre-requisites for "no breakage":

1. The current `mneme-ai` package on npm is the user-facing entry point.
   Renaming to `mneme-ai-prelude` would break every existing install on
   the next upgrade. Migration path needed.
2. GitHub Releases storage has soft limits — we'd want to verify the
   total artifact size across many versions doesn't exceed quotas, OR
   move to a paid CDN.
3. The current 1-step install (`npm install -g mneme-ai && mneme init &&
   mneme mcp --install`) has muscle memory + AI agent contract entries.
   Adding the prelude step requires updating the contract + every AI
   tool's training data.

Hence: spec + sketch, not production. Schedule for v3.0 major bump.
