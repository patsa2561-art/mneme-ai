# #7 — Node `--experimental-loader` hook (lazy-load native deps)

**Status:** 📐 Spec + sketch
**User command:** `node --experimental-loader mneme-ai/loader.mjs $(which mneme) <cmd>`

## The technique

Register a Node ESM loader hook that intercepts `import('sharp')` and
`import('@huggingface/transformers')`. The hook returns a lazy stub
that throws "not installed in this runtime" if the user ever actually
calls those modules.

Net result: even with the full 467MB tree on disk, the native binaries
are NEVER loaded into the process. `LoadLibrary` is never called.
Windows never holds a DLL handle. EBUSY-on-install is structurally
extinct from the loader side.

```
process boot
  ├─ --experimental-loader mneme-ai/loader.mjs
  ├─ loader.mjs registers resolve() + load() hooks
  │
  ├─ user code: import('sharp')
  ├─ Node calls loader.resolve('sharp', ...)
  ├─ loader returns { url: 'mneme-stub:sharp', shortCircuit: true }
  ├─ Node calls loader.load('mneme-stub:sharp', ...)
  └─ loader returns: 'export default new Proxy({}, { get: () => { throw ... } })'

No sharp .node binary loaded. No libvips DLL touched. Disk file is
untouched even though present.
```

## Why this is genuinely "smartass" engineering

- **Touches no filesystem state** — the 467MB tree stays on disk; Node's
  loader just redirects the in-memory resolution.
- **Cross-platform identical** — works the same on Windows / macOS /
  Linux because it operates at Node's resolver layer, above the OS.
- **Opt-in / opt-out at process boot** — same binary can run lite or
  full depending on the `--experimental-loader` flag.
- **Composable with the other workarounds** — loader hook + dist-tag
  flavor + postinstall prune are orthogonal; user can layer.

## Mechanics (the sketch)

`packages/cli/loader.mjs`:

```js
const BLOCKED = new Set([
  "sharp",
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-web",
  "onnxruntime-common",
]);

export function resolve(specifier, context, nextResolve) {
  // Bare specifier or scoped — exact match against blocklist.
  const key = specifier.startsWith("@") ? specifier : specifier.split("/")[0];
  if (BLOCKED.has(key)) {
    return { url: "mneme-stub:" + key, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (!url.startsWith("mneme-stub:")) return nextLoad(url, context);
  const name = url.slice("mneme-stub:".length);
  // Return ESM source that exports a throwing proxy for any property access.
  const source = `
    const handler = {
      get(_, prop) {
        throw new Error(
          'mneme-loader: ${name} access blocked by --experimental-loader; ' +
          'install via \`npm install -g mneme-ai\` (full flavor) or unset MNEME_LOADER_BLOCK'
        );
      },
      apply() { return new Proxy({}, handler); }
    };
    const stub = new Proxy({}, handler);
    export default stub;
    export const pipeline = () => { throw new Error('mneme-loader: pipeline blocked'); };
    export const env = {};
  `;
  return { format: "module", shortCircuit: true, source };
}
```

User invocation:

```bash
# Lite mode (block native deps even if installed)
node --experimental-loader mneme-ai/loader.mjs $(which mneme) verify "claim"

# Or via env var (Mneme's bin shim can read this and re-exec with --loader)
MNEME_LOADER=lite mneme verify "claim"
```

## Math/system trick: identity-substitution at the module-resolver level

Node's loader API (`resolve` + `load`) is the same primitive ts-node /
ts-jest / vitest / esbuild-register use to compile TypeScript on the
fly. It's a standard customization point — not a hack, but a designed
extension.

The "stub returns Proxy" pattern means:
  - any property access (`sharp.resize`, `transformers.pipeline`) throws
    with an actionable message
  - the throw is LAZY — modules that import sharp but never call it
    work fine (e.g. `import sharp from 'sharp'; if (process.env.X) sharp.resize(...);`)
  - the embedder fallback chain in @mneme-ai/embeddings catches the
    throw via its existing try/catch and moves on to hash

## Why this is risky (and hence "spec only")

1. **Experimental flag** — `--experimental-loader` is being replaced by
   `--import` + `register()` in Node 22+. Loader hook spec is stable
   but the flag's name + ergonomics keep changing.
2. **Process-tree contamination** — if Mneme launches a child process
   (via `spawn`), the child inherits `--experimental-loader` IFF we
   pass it through. Forgetting this means inconsistent behavior between
   parent + child.
3. **Worker threads** — loader hooks don't propagate to worker_threads
   by default; have to register per-worker.
4. **AI agent UX** — telling an AI agent to use
   `node --experimental-loader mneme-ai/loader.mjs $(which mneme) ...`
   is unwieldy compared to the other six workarounds.

## Tradeoffs

- ✅ Zero filesystem mutation (467MB tree intact + ignored)
- ✅ Cross-platform identical
- ✅ Composable with other workarounds
- ✅ Per-invocation flavor selection
- ❌ Node loader API is "experimental" (stable but the flag changes)
- ❌ Worker threads need separate registration
- ❌ Long bash one-liner is hostile to AI agents

## Roadmap to ship

| Sprint | Deliverable |
|---|---|
| 1 (1wk) | `loader.mjs` + 4 invariants pinned by tests (block sharp, allow others, throw on access, work in workers) |
| 2 (1wk) | bin shim re-exec with `--experimental-loader` when MNEME_LOADER=lite |
| 3 (1wk) | Worker-thread propagation (`register()` API) |
| 4 (1wk) | Document the long-form invocation + the env-var shortcut |

Total: ~4 weeks for a solo dev.

## Why this isn't shipped today

`--experimental-loader` is in the middle of being phased out. Node 22
prefers `node --import @mneme-ai/cli/register` style (via the new
`register()` API). Whichever we ship today gets DEPRECATED by Node 24.

Better to wait until Node has settled the loader API surface (likely
Node 24 LTS in October 2026) and ship one stable implementation.

This is the most ESOTERIC workaround in the seven. Of genuine engineering
beauty, but practically: the dist-tag (#1) and postinstall prune (#2)
already cover 99% of the user pain at 1% of the maintenance burden.
