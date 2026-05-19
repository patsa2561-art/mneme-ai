# Wild workarounds for the npm 10 global `--omit=optional` bug

> npm 10.x silently ignores `--omit=optional` for global installs (reproduced
> 2026-05-19, npm 10.9.4 / Node 22.22.1 / Windows 11). This directory tracks
> seven different ways to give users a ~5MB zero-DLL install path despite
> the upstream npm bug. Ordered by "production today" → "specced for next
> cycle". Each spec doc is self-contained so the next maintainer can pick
> any one up cold.

| # | Idea | Status | Spec | Implementation |
|---|---|---|---|---|
| 1 | Two dist-tags (`@lite`) | ✅ **Production** | [01_two_dist_tags.md](01_two_dist_tags.md) | [scripts/publish-lite.mjs](../../scripts/publish-lite.mjs) |
| 2 | Postinstall self-prune (`MNEME_LITE=1`) | ✅ **Production** | [02_postinstall_prune.md](02_postinstall_prune.md) | [packages/cli/bin/postinstall-mneme-lite.cjs](../../packages/cli/bin/postinstall-mneme-lite.cjs) |
| 3 | Bootstrap prelude | 📐 Spec + sketch | [03_bootstrap_prelude.md](03_bootstrap_prelude.md) | _next cycle_ |
| 4 | Private npm registry mirror | 📐 Spec + sketch | [04_private_registry.md](04_private_registry.md) | _next cycle_ |
| 5 | Bun-compile portable binary | 📐 Spec + sketch | [05_bun_compile.md](05_bun_compile.md) | _next cycle_ |
| 6 | Conditional publish (= #1 implementation) | ✅ **Production** | see #1 | _merged into #1_ |
| 7 | Node `--experimental-loader` hook | 📐 Spec + sketch | [07_loader_hook.md](07_loader_hook.md) | _next cycle_ |

## What "Production today" means

- Tests cover the invariants the workaround must keep forever.
- The CI gate (`windows-install-smoke.yml`) exercises the install path.
- The user-facing one-liner in README + AI_AGENT_CONTRACT actually works.

## What "Spec + sketch" means

- The doc describes the technique, the math/system trick, the tradeoffs,
  the implementation roadmap.
- Where helpful, a runnable sketch is in `sketch/` next to the spec.
- A maintainer can pick the doc up cold and ship the workaround in a
  single sprint without re-deriving the design.

## Decision matrix for AI agents reading this

Always prefer the workaround LOWEST in the table that has a "Production"
status — it's the simplest path that's been empirically verified.

| User wants | Use |
|---|---|
| Smallest install, accept hash-quality embedder | `npm install -g mneme-ai@lite` (#1) |
| Full install but with a way to slim down later | `MNEME_LITE=1 npm install -g mneme-ai` (#2) |
| Zero-network install / single binary | wait for #5 OR use Docker (Step 1B) |
| Air-gapped / federated org-wide install | wait for #4 |
| Lazy load (full size, never touched) | wait for #7 |
