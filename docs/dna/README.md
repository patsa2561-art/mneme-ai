# Mneme DNA — 16-strand code search engine

*The black-sheep moat. 8 algorithms + 8 math formulas no other code-search tool composes.*

## TL;DR for Anthropic engineers

We're not trying to beat Sourcegraph at general code search ($2.6B + 200 engineers).
We're building the **first code-search engine designed for AI-agent consumption**, with **16 algorithms+formulas that compose Mneme's existing atoms** (HMRA, Hebbian, atrophy, regret, Constitutional Gate, audit log, federation) in ways nobody else has the inputs to compute.

## Architecture (build order)

```
v1.13.0 → v1.14.0 → v1.15.0 → … → v1.20.0
   P1       P2-P3      P4         P10
   ↓        ↓          ↓          ↓
 Formulas  Echo +    Mutant    Ghost-Sniper
  (8)     Phantom    Index    Verifier
                    Evolution
```

## P1 — 8 math formulas (SHIPPED in v1.13.0+)

Pure functions. Deterministic. Every formula has a unit test for happy path + edge case + invariant.

| Code | Formula | What it computes |
|---|---|---|
| F1 | QRS | Quadratic form: ψ^T H ψ. Encodes cross-feature interactions linear scoring can't |
| F2 | HWC | cos(q,c) × log(1 + co-activation). Hebbian boost on cosine |
| F3 | ADB | R × (1 - A/100)^α. Stale code exponentially downranked |
| F4 | TBP | Local likelihood × Beta(α+1, β+1). Federation-prior Bayesian rerank |
| F5 | RED | min distance to nearest regret pattern. Penalty inversely proportional |
| F6 | TPS | R × exp(-(log_age_diff/σ)^2). Temporal phase resonance |
| F7 | CC | Wilson 95% LB × Hebbian strength. Calibrated final score |
| F8 | MF | Σ CTR/TTUR. Genetic-algorithm fitness for index strategies |

Source: [`packages/core/src/dna/formulas.ts`](../../packages/core/src/dna/formulas.ts)

## P2-P10 — 8 algorithms (ROADMAP)

Each phase = self-contained module + tests + integration with prior phase.

### P2 (2 wk): A4 Echo-Locator
SONAR for code. Per-file "echo signature" — vector of how strongly each known regret/decision pattern resonates. Query → echo profile → match by signature similarity.
- Atoms: regret extraction + Hebbian + embeddings
- Module: `core/dna/echo-locator.ts`

### P3 (2 wk): A2 Phantom-Path Search
"What it should be" search. Query "login validation" → also search for the canonical implementation pattern in this repo's history of successful changes.
- Atoms: regret + decision + Hebbian similarity
- Module: `core/dna/phantom-path.ts`

### P4 (1 wk): A6 Anti-Pattern Repulsion
Final-stage rerank. Multiplies relevance by F5 (RED) penalty. Files near regret patterns sink in ranking.
- Atoms: F5 + REI metric
- Module: `core/dna/repulsion.ts`

### P5 (2 wk): A1 Mutant Index Evolution
Genetic-algorithm loop on index strategies. Strategies that produce high F8 (MF) fitness reproduce; low-fitness strategies prune. Weekly tick.
- Atoms: F8 + audit log + click-through tracking
- Module: `core/dna/mutant-index.ts`

### P6 (2 wk): A3 Quantum Superposition Ranking
3-tensor (file × query × intent) decomposition. Same files appear in different ranks for different query intents.
- Atoms: F1 (QRS) + intent classifier + HMRA
- Module: `core/dna/quantum-rank.ts`

### P7 (2 wk): A5 Time-Travel Search
Index every commit's file states (delta-encoded). Query "where did we used to handle this" returns historical matches.
- Atoms: git history + content-defined chunking + F6 (TPS)
- Module: `core/dna/time-travel.ts`

### P8 (1 wk): A7 Tribal Voting Rerank
Federation envelope schema extension for code-pattern voting. Local rank boosted by cross-repo k-anonymous consensus.
- Atoms: F4 (TBP) + federation
- Module: `core/dna/tribal-voting.ts`

### P9 (2 wk): A8 Ghost-Sniper Verifier
**The strict-mode killer.** Pre-LLM gate: any LLM-proposed result must pass:
1. AST verify (file + symbol exist)
2. Semantic verify (embedding similarity ≥ threshold)
3. F7 (CC) ≥ 0.6 confidence

Otherwise → REJECT and replace with closest verified alternative. **0% hallucination guarantee.**

- Atoms: Constitutional Gate + audit log + F7 (CC) + verifier pipeline
- Module: `core/dna/ghost-sniper.ts`

### P10 (1 wk): Wire into MCP Dynamic + bench numbers
Replace v1.13.0 code-search primitive with super-search. Run AI-Memory-Bench with/without DNA enabled. Publish numbers.

## Why this moat is defensible

| What competitor would need | Why they don't have it |
|---|---|
| HMAC-chained audit log of AI tool calls | Sourcegraph/Cursor/Copilot don't ship this |
| Regret/decision extraction from git | Mneme-specific (v1.10.0) |
| Constitutional Gate at runtime | Mneme-only (v1.12.0) |
| Atrophy time-series per file | Mneme-only |
| Federation envelope protocol | Mneme-only (v1.7.0) |
| Reproducible AI-memory benchmark | Mneme-only (v1.12.0) |
| **All 6 above** in one tool | **Only Mneme** |

## Implementation discipline

- **Pure functions everywhere.** Formulas + algorithms = no I/O in math layer.
- **Determinism.** Same inputs → same outputs. Tests assert this.
- **Strict mode by default.** A8 returns 0 results rather than 1 hallucinated.
- **No code execution from packs/configs.** Pack format is data-only.
- **Audit log on every search.** Every query traceable, replayable.
- **Defensive caps.** All loops bounded (file count, recursion depth, regex DOS).
