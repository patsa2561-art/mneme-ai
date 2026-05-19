# #4 — Private npm registry mirror

**Status:** 📐 Spec + sketch
**User command:** add `@mneme-ai:registry=http://localhost:9999/` to `.npmrc`, then `npm install -g mneme-ai`

## The technique

Mneme runs a tiny HTTP server on localhost that speaks the npm registry
protocol. The user's `.npmrc` (or env var) routes `@mneme-ai/*` requests
to that server. The server intercepts the manifest fetch, decides the
flavor based on env / config, and returns a manifest with
`optionalDependencies` stripped (or full, as configured).

Every other npm request (`react`, `express`, `chokidar`, etc.) is
proxy-passed transparently to `registry.npmjs.org`.

```
npm install -g mneme-ai
    │
    ├─→ GET http://localhost:9999/mneme-ai
    │   ┌── server reads MNEME_FLAVOR env / config
    │   ├── fetches the real manifest from npmjs.org
    │   ├── if flavor=lite: strips optionalDependencies, rewrites
    │   │   internal @mneme-ai/* deps to a synthesised "lite" version
    │   └── returns the mutated manifest to npm
    │
    ├─→ npm picks the resolved tarball URL from the (mutated) manifest
    │
    └─→ tarball requests:
        ├── @mneme-ai/* tarballs → server forwards npmjs.org tarball untouched
        └── @huggingface/transformers tarball → never requested
            (it's no longer in the dependency tree)
```

## Why this is genuinely wild

- **Reverses the power relationship**: npm is the application, Mneme is
  the infrastructure layer. npm asks Mneme for permission to install
  things. No other npm package does this.
- **Future-proofs against npm bugs**: any future npm regression in
  `--omit=` handling, dist-tag resolution, or peer-dep resolution is
  also routed-around as long as the protocol layer is owned.
- **Composable with vaccines + federation**: the same server can refuse
  to serve known-malicious packages (vaccine catalog), preferred
  versions for compliance (e.g. PCI-required pins), or DP-aggregated
  wisdom signals (federation). The mirror becomes an org-wide policy
  enforcement point.
- **Air-gap ready**: drop the same server inside a corporate firewall
  with a pre-populated tarball cache → no internet access required.

## Mechanics (the sketch)

The npm registry protocol the server must implement is small:

| HTTP | Path | Purpose |
|---|---|---|
| GET | `/<pkg>` | Return manifest (JSON, all versions) |
| GET | `/<pkg>/<version>` | Return manifest for one version |
| GET | `/-/package/<pkg>/dist-tags` | Return dist-tags (`latest`, `lite`, …) |
| GET | `/<pkg>/-/<tarball>` | Return the tarball binary |

A ~200-line Node HTTP server covers all four:

```js
import http from "node:http";
import https from "node:https";

const UPSTREAM = "https://registry.npmjs.org";
const FLAVOR = process.env.MNEME_FLAVOR || "lite"; // lite | full

const server = http.createServer(async (req, res) => {
  const upstreamUrl = UPSTREAM + req.url;
  const upstream = await fetch(upstreamUrl); // node 18+ has fetch
  const ct = upstream.headers.get("content-type") || "application/json";
  // Tarball requests pass straight through.
  if (req.url.includes("/-/") && req.url.endsWith(".tgz")) {
    res.setHeader("content-type", "application/octet-stream");
    return upstream.body.pipe(res);
  }
  const body = await upstream.json();
  // Manifest mutation — strip optionalDependencies for the "@mneme-ai/embeddings" package
  // when FLAVOR=lite.
  if (FLAVOR === "lite" && body.name === "@mneme-ai/embeddings") {
    for (const v of Object.keys(body.versions || {})) {
      delete body.versions[v].optionalDependencies;
    }
  }
  res.setHeader("content-type", ct);
  res.end(JSON.stringify(body));
});

server.listen(9999, "127.0.0.1");
```

User configures:

```ini
# ~/.npmrc
@mneme-ai:registry=http://localhost:9999/
mneme-ai:registry=http://localhost:9999/
```

Then `npm install -g mneme-ai` hits the local server first.

## Math/system trick: scope-targeted registry override

npm supports per-scope registry pinning (`@scope:registry=URL`). This is
a public API — designed for private registries like Verdaccio, Sonatype
Nexus, Artifactory. We're using the same mechanism for a totally
different purpose: per-install flavor selection.

The user's `.npmrc` change is reversible (single line). The server
listens only on `127.0.0.1` (never exposed to network). Mneme's
existing replay-log + HMAC chain can sign every served manifest, so
the user has a tamper-evident record of which flavor was served when.

## Tradeoffs

- ✅ Future-proof against ALL npm dependency-resolution bugs
- ✅ Composable with vaccines + federation + compliance pins
- ✅ Air-gap ready out of the box
- ✅ No new packages on npm to maintain
- ❌ User must edit `.npmrc` (one-time, reversible — but a step)
- ❌ User must run `mneme registry start` once before `npm install -g`
- ❌ Chicken-and-egg: how does the user install the registry server on a
   fresh machine? (Workaround: bootstrap via `npx mneme-ai-registry`,
   which is a different small package, or fold into Bootstrap Prelude #3)
- ❌ Implementing the full registry protocol means handling edge cases
   npm exercises: package-lock generation, peer-dep resolution, etc.

## Roadmap to ship

| Sprint | Deliverable |
|---|---|
| 1 (1wk) | `mneme registry start/stop/status` CLI subcommand + 200-line Node server |
| 2 (1wk) | Manifest mutation logic for all 5 packages (not just embeddings) |
| 3 (1wk) | Tarball-passthrough caching for offline use |
| 4 (1wk) | Auto-edit `.npmrc` via `mneme registry attach` (opt-in) |
| 5 (1wk) | Replay-log integration (HMAC-sign every served manifest) |
| 6 (1wk) | Federation hook (vaccine catalog enforcement at install time) |

Total: ~6 weeks for a solo dev.

## Why this isn't shipped today

This is the BOLDEST of the seven workarounds — it requires Mneme to
own a protocol-layer concern that no AI tool today owns. The payoff is
huge (becomes infrastructure) but the maintenance burden is also large
(npm protocol changes occasionally; we'd need to keep up).

Defer until: Mneme has clear adoption (> 1000 weekly installs), an
identified compliance/airgap user (which would fund the work), and the
seven simpler workarounds have proven the user problem is well-defined.
