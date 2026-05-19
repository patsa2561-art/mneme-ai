# #1 — Two dist-tags (`mneme-ai@lite`)

**Status:** ✅ Production as of v2.19.69
**Implementation:** [`scripts/publish-lite.mjs`](../../scripts/publish-lite.mjs)
**User command:** `npm install -g mneme-ai@lite`

## The technique

npm dist-tags decouple a friendly name (`latest`, `next`, `beta`, **`lite`**)
from a specific semver. We publish the SAME five packages twice per release:

| Tarball | Version | dist-tag | optionalDependencies |
|---|---|---|---|
| Default | `X.Y.Z` | `latest` | present (transformers) |
| **Lite** | `X.Y.Z-lite` | `lite` | **stripped to `{}`** |

`X.Y.Z-lite` is a valid semver prerelease form (RFC-2119 + semver.org §9),
so npm respects it natively — no monkey-patching.

## What gets mutated for the lite variant

Each package's `package.json` is copied into a tmp staging dir + rewritten:

1. `version` ← `X.Y.Z-lite`
2. `optionalDependencies` ← deleted entirely (only `@mneme-ai/embeddings`
   has any — the field is dropped from the others as a no-op)
3. internal `@mneme-ai/*` deps → repointed at `X.Y.Z-lite` siblings so
   the install tree resolves consistently
4. `description` ← appended " — LITE variant (no bundled WASM embedder,
   no native deps)." so npmjs.com makes the variant obvious

What stays IDENTICAL across both flavours:

- `dist/` output (compiled JS)
- `bin/` scripts (CLI entry + Phoenix P3 bootstrap + postinstall pruner)
- `README.md` (single source of truth)

## Math/system trick

The npm 10 `--omit=optional` bug is "the flag has zero effect on global
installs but is honoured locally". The semver dist-tag mechanism is the
ONE escape that exists in stock npm without server-side hacks:

```
client request: `npm install -g mneme-ai@lite`
  → npm hits the registry: `GET /-/package/mneme-ai/dist-tags`
  → registry returns: { latest: "X.Y.Z", lite: "X.Y.Z-lite" }
  → npm resolves "@lite" → "X.Y.Z-lite"
  → tarball at https://registry.npmjs.org/mneme-ai/-/mneme-ai-X.Y.Z-lite.tgz
  → manifest has optionalDependencies: undefined
  → npm SKIPS the optional tree (because there is none to skip)
  → install completes in ~65MB
```

## Why this works where `--omit=optional` doesn't

The `--omit=optional` flag is a CLIENT-SIDE filter applied AFTER the
manifest is fetched. The npm 10 global-install bug is that the filter
isn't applied in that code path. We sidestep the filter entirely by
shipping a manifest that has no optional deps to filter.

## Verified empirically (v2.19.69-lite, Windows 11 / Node 22.22.1 / npm 10.9.4, 2026-05-19)

```
npm install -g mneme-ai@lite
  → 64.7MB on-disk verified by walking node_modules
  → 6.2s elapsed (vs ~60s for the full @latest install)
  → no @huggingface/transformers, no @img/sharp-*, no sharp, no onnxruntime-*
  → mneme --version exits 0 with "2.19.69-lite"
  → mneme welcome --json '{}' returns valid JSON
  → mneme verify "smoke claim" returns proper MIXED verdict (lite runtime works)
  → embedder chain falls back to hash (no bundled WASM in this flavor)
```

The 64.7MB number reflects ALL transitive deps the runtime needs (commander, kleur,
@mneme-ai/{core,correlator,mcp}, typescript at dev-dep level, @modelcontextprotocol,
zod, protobufjs, hono, tar) — only the native-DLL-pulling subtree (transformers + sharp +
libvips + onnxruntime-*) is gone. Compared to the 467MB full install: **7.2× smaller**.

## Tradeoffs

- ✅ Install size 467MB → 65MB (7.2× smaller)
- ✅ Install time 60-90s → 5-10s
- ✅ EBUSY risk structurally zero (no native DLLs)
- ❌ Bundled WASM embedder unavailable (★★★ tier missing from the chain)
- ❌ Adds 5 extra publishes per release (~30s extra CI time)
- ❌ npmjs.com browsing shows TWO version trains; mitigated by the
  description suffix that flags the variant

## How to ship a new lite release

Just run `node scripts/publish-lite.mjs` right after `publish-all.mjs`:

```bash
node scripts/release.mjs X.Y.Z
npm run build
git push origin HEAD && git push origin vX.Y.Z
node scripts/publish-all.mjs    # publishes the default 5
node scripts/publish-lite.mjs   # publishes the lite 5 (this script)
```

The release ritual + CI gate run both in sequence.
