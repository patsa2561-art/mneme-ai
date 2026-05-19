# #2 — Postinstall self-prune (`MNEME_LITE=1`)

**Status:** ✅ Production as of v2.19.69
**Implementation:** [`packages/cli/bin/postinstall-mneme-lite.cjs`](../../packages/cli/bin/postinstall-mneme-lite.cjs)
**User command:** `MNEME_LITE=1 npm install -g mneme-ai`

## The technique

npm runs the package's `postinstall` script AFTER the dependency tree is
on disk. We hijack that hook to remove the optional-dep tree if the user
opted in via `MNEME_LITE=1`. npm still downloads 467MB, but ~462MB gets
deleted before npm hands control back to the user — final on-disk
footprint is ~5MB.

## Why this exists alongside #1

`#1` (the `@lite` dist-tag) is the better path for new installs: smaller
download, faster, no wasted bandwidth. But `#2` covers three cases `#1`
doesn't:

1. **AI agents that already typed `npm install -g mneme-ai`** can simply
   prepend `MNEME_LITE=1 ` without changing the dist-tag selector — works
   on a session that already started.
2. **CI pipelines that pin a specific version** (e.g. `mneme-ai@2.19.69`)
   skip dist-tag resolution; `MNEME_LITE=1` still applies.
3. **Corporate proxies that mirror only `latest`** don't see the `lite`
   tag at all; `MNEME_LITE=1` works against any mirror.

## Mechanics

The pruner reads `process.env.MNEME_LITE`. Truthy values are `"1"`,
`"true"`, `"yes"` (case-insensitive). Anything else is a no-op so the
default install UX stays pristine.

When triggered, it walks `<install-prefix>/.../mneme-ai/node_modules/` and
calls `fs.rmSync(target, { recursive: true, force: true })` on a
conservative allowlist:

```
@huggingface       ← the optional dep root
@img               ← sharp's native binary host (libvips-*.dll lives here)
sharp              ← the sharp wrapper
onnxruntime-common ← transitive runtime
onnxruntime-node   ← transitive runtime
onnxruntime-web    ← transitive runtime
```

Anything outside this list is left alone — we never touch `@mneme-ai/*`,
`commander`, `kleur`, or any other dep the Mneme runtime actually uses.

## Math/system trick: idempotent + non-fatal

The script's master invariant is "the install MUST NOT fail because of
this hook". Three safeguards enforce it:

1. **Master try/catch is absent BY DESIGN** — each prune is wrapped in
   its own try, but the script body has no `throw` statements at all
   (verified by a static-read regression test in
   [`postinstall_mneme_lite.test.ts`](../../packages/cli/tests/postinstall_mneme_lite.test.ts)).
2. **Every `process.exit(N)` is exit 0** — also pinned by the same
   regression test that greps the source for `process.exit(<n>)` and
   asserts `n === 0`.
3. **Re-running is a no-op** — `fs.rmSync(..., { force: true })`
   swallows ENOENT on dirs already pruned.

## Verified empirically (sandbox + real install)

```
# Sandbox: 6/6 invariants in packages/cli/tests/postinstall_mneme_lite.test.ts
1. no env var → no-op, silent
2. MNEME_LITE=1 + targets present → prune + log summary
3. MNEME_LITE=1 + targets absent → no-op, exit 0
4. truthy aliases (true / TRUE / yes / YES) all honoured
5. garbage value (e.g. "garbage") → no-op (treated as false)
6. source-grep: zero `throw`, every `process.exit` is exit 0

# Real install via the workspace tarballs:
MNEME_LITE=1 npm install -g mneme-ai
  → install completes (467MB download)
  → postinstall logs:
       [mneme-lite] MNEME_LITE=1 → pruned 6/6 optional-dep directories, 462.4MB freed.
       [mneme-lite] removed: @huggingface (78.2MB), @img (372.1MB), sharp (8.4MB),
                    onnxruntime-common (0.5MB), onnxruntime-node (2.9MB),
                    onnxruntime-web (0.3MB)
  → final on-disk: ~5.1MB
```

## Tradeoffs

- ✅ Works with ANY install method (`npm install -g`, `npm i`, local, pnpm, …)
- ✅ Works against any registry / corporate mirror that has `mneme-ai@X.Y.Z`
- ✅ Zero new packages to publish/maintain
- ❌ Still downloads 467MB (bandwidth pain, not disk pain)
- ❌ User must remember the env var (vs. #1 where `@lite` is part of the
  command itself)

## When to use #1 vs #2

| Constraint | Use |
|---|---|
| User typing the install command in a terminal | `#1` (`@lite` tag) |
| Existing CI script with `npm install -g mneme-ai@X.Y.Z` pinned | `#2` (env var) |
| Bandwidth matters more than disk | `#1` |
| Disk matters more than bandwidth | `#2` (or `#1`, both work) |
| Cannot modify the npm command but can set env | `#2` |
| Cannot set env but can change the npm command | `#1` |

## How `MNEME_LITE=1` interacts with the bin/mneme.js Phoenix bootstrap

The Phoenix P3 CLI bootstrap (`bin/mneme.js`) is unaffected — it still
extracts libvips DLLs to `%TEMP%` on every CLI invocation. In lite mode
the bootstrap finds no `@img/sharp-*` dir and exits silently (its
`findLibvipsDir` walk-up returns null, and the rest of the bootstrap
no-ops). No PATH mutation, no temp dirs created — the right behaviour
because there's nothing to extract.
