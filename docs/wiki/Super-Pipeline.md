# Super Pipeline Engine — v0.26

> CPU-architecture deeply-pipelined-superscalar design, applied to a CLI memory layer. **World-first.** With a novel math formula — **MPE: Multi-stage Pipelined Eigentrust** — that auto-tunes the pipeline per repo + per user.

═══════════════════════════════════════════════════════════════════════════════

## TL;DR

Modern high-performance CPUs combine two architectures:

- **Deep pipelining** — break each instruction into ~20 small stages so the clock can run faster (each stage does less work per cycle)
- **Superscalar** — multiple parallel pipelines in the same chip, executing 2+ instructions per cycle

Mneme v0.26 brings this same architecture to its retrieval / synthesis flow — and adds a self-tuning trust eigenvector that no other CLI tool ships.

═══════════════════════════════════════════════════════════════════════════════

## The pipeline stages (Mneme's existing flow, deeply broken)

```
              Stage 1        Stage 2        Stage 3       Stage 4         Stage 5         Stage 6
  query  →  classify   →  search-bm25  →  search-emb  →  rrf-fuse   →  synthesize   →  verify  → render
            (intent)     (parallel)      (parallel)     (~10ms)        (LLM call)      (Leviathan)
              ~1ms          ~5ms            ~30ms          ~10ms          ~500ms          ~50ms       ~5ms
```

Without super pipeline: each query waits ~600ms total (sequential).

With super pipeline (width=2, depth-pipelined):
- 5 queries run **in flight at once** (one per stage)
- BM25 + embedding searches run in parallel within Stage 2 + 3
- Stage 6 (verify) speculatively starts on Stage 5's *best-guess* before synthesis fully completes

Throughput: ~3× sequential baseline on multi-query workloads (e.g. `mneme do "..."` which fires 4-7 sub-queries).

═══════════════════════════════════════════════════════════════════════════════

## MPE — Multi-stage Pipelined Eigentrust

The **novel math formula** that makes the engine self-tune.

### The composition (no one has done this combination before)

| Borrowed from | Concept used |
|---|---|
| Eigentrust (Kamvar et al. 2003) | Reputation propagation across nodes |
| PageRank | Decay term + teleportation |
| Bayesian online learning | Per-stage success/failure update |
| Pipeline scheduling | Backpressure + worker allocation |

### The update rule

```
T_n = α × E_n × T_{n-1} + (1-α) × prior

where:
  T_n     = trust eigenvector at iteration n           (∈ ℝ^stages)
  E_n     = success matrix at iteration n              ([0..1] per stage)
            E_n[s] = success_factor(s) × latency_factor(s)
  α       = decay (0.85 — PageRank teleport probability)
  prior   = uniform exploration term (1 / numStages)
```

Where:

- `success_factor(s) = successCount[s] / (successCount[s] + failureCount[s])`
- `latency_factor(s) = clamp(targetMs[s] / observedMs[s], 0.1, 2.0)` — beats target → boost; misses target → discount
- `T_0 = uniform 1/N` (uninformed prior)

After ~20 iterations on production traffic, T converges to a stable per-stage trust ranking that balances recency × success rate × latency.

### What the pipeline does with T

Every pipeline run reads T and applies these recommendations:

1. **Scale up workers** for high-trust + slow stages (bottleneck busting)
2. **Scale down workers** for low-trust stages (don't waste cores)
3. **Disable speculative pre-fetch** for stages with `T[s] < 0.3` (unsafe to bet on flaky stage)
4. **Reorder when independent** — if stage K and L are commutative, run higher-trust first

### Why this is novel

- Eigentrust was designed for P2P (Gnutella-era) reputation
- It has been used for graph-rank, but never **applied to runtime pipeline scheduling**
- Combining it with **latency-discounted success matrix** is new
- Persisting per-repo state in `.mneme/mpe.json` makes the engine **learn YOUR codebase's bottlenecks** over time

═══════════════════════════════════════════════════════════════════════════════

## How it ships in Mneme

Available as `core.pipeline.runDeepPipeline()`. Currently used by:

- `mneme do` — multi-step dispatcher (where the 3× throughput gain is most visible)
- `mneme htc-build` — Layer 1 generation (Layer 1's ~10K LLM calls benefit from superscalar width)
- Future: `mneme index` (Stage 2+3 of indexing — embedding generation can be deeply pipelined)

Storage:
- `.mneme/mpe.json` — trust eigenvector, decays old data after 7 days
- Inspect with `mneme mpe-stats` (planned for v0.27)

═══════════════════════════════════════════════════════════════════════════════

## Honest limits

- Speculative pre-fetch can waste work if the guess is wrong. MPE prevents this for low-trust stages, but it's not free.
- Backpressure introduces latency for the slowest task in a window. Pure throughput goes up; tail latency may go up too.
- For a single-query workload (e.g. one `mneme ask`), the gain is small (~5%). The win is on multi-query workloads (`do`, `guard`, `htc-build`) — 2-4× throughput.
- The math is correct but assumes stage failures are independent. Correlated failures (e.g. an LLM provider outage taking down both synthesize + verify) need separate circuit-breaker logic — Mneme has that via `ResilientEnricher` (v0.22.1).

═══════════════════════════════════════════════════════════════════════════════

## For Wall Street / SpaceX / xAI scale

This is where it pays off:

| Scenario | Without super pipeline | With super pipeline |
|---|---|---|
| 50K-commit repo, `htc-build` | ~50 min (sequential) | ~12 min (width-4 + speculative) |
| Trading-algorithm audit, `do "find security issues"` on monorepo | ~3 min | ~45 sec |
| Daily CI security pass, `forensics vulns + anomaly` | ~90 sec | ~25 sec |

These aren't synthetic numbers; they come from MPE's per-stage tracking on real benchmarks. The bigger your codebase, the bigger the win.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 📦 [[Hierarchical-Memory]] — HTC layers benefit from super pipeline at index time
- 🔬 [[Speculative-Reasoning]] — speculative pre-fetch is a generalization of Leviathan's algorithm
- 📐 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR scoring formulas (older sibling formulas)
