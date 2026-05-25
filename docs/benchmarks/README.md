# Mneme — AI Memory Benchmark

**The Lighthouse-of-AI-memory.** Vendor-neutral grading of how well each AI memory implementation answers questions about a real repo.

## Why this benchmark exists

When every AI vendor ships native "repo memory" — Claude, OpenAI, Cursor, Continue — the neutral-auditor role naturally sits outside each vendor's own product surface:

- A vendor's own memory implementation evaluates the same vendor.
- Bundled memory layers are scoped to their host editor.

Mneme is a memory implementation that lives outside any single AI vendor — well-positioned to publish a public leaderboard.

## Methodology

Each AI memory implementation is asked the same **24 standardized memory questions** about an indexed repo, grouped into 6 categories:

| Category | What it tests |
|---|---|
| **Factual recall** | Author count, oldest commit date, file existence — straightforward retrieval |
| **Causal explanation** | "Why was this file edited 3 times?" — must cite + use causal language |
| **Lineage trace** | Multi-author code archaeology — who originated, who modified |
| **Regression prediction** | Historical-data-grounded risk estimation |
| **Cited rationale** | Must include real commit hashes / PRs |
| **Uncertainty honesty** | Refuses to fabricate when asked about non-existent data |

Scoring is **binary per rubric** (pass/fail) computed by deterministic regex patterns. **No LLM-as-judge** — fully reproducible across runs and machines.

## How to run it on your own repo

```bash
mneme benchmark --out ./benchmark.md
```

Or with JSON output for programmatic use:

```bash
mneme benchmark --json > benchmark.json
```

Want to benchmark a specific subset of probes?

```bash
mneme benchmark --probes 12 --out smoke.md
```

## v0.1 — what's in scope

**Currently supported targets:**

- ✅ `mneme-self` — Mneme's own retrieve.ask end-to-end

**Future targets (PRs welcome):**

- ⏳ `claude-native` — Claude Code's bundled memory (when API surface ships)
- ⏳ `openai-codex` — Codex's repo-aware mode
- ⏳ `cursor-native` — Cursor's project memory
- ⏳ `gemini-code` — Gemini Code Assist's memory
- ⏳ `continue-native` — Continue's bundled memory

To add a target, implement the `BenchmarkRunner` interface in `packages/cli/src/commands/benchmark.ts` and submit a PR.

## Sample leaderboard

See [`./2026-05.md`](./2026-05.md) — Mneme's own self-benchmark on the Mneme repo as a reference baseline.

## Why a vendor-neutral benchmark matters

If you're choosing an AI coding tool today, you have no way to compare their repo-memory quality except by trial and error. The AI memory benchmark fixes that.

This makes Mneme the **standard** that every vendor's memory has to be measured against. Like Lighthouse for web performance, or PassMark for hardware. **The benchmark itself is the moat.**
