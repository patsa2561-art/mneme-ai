# Novel Algorithms — the Math behind Mneme's Retrieval

> Mneme's retrieval doesn't rely on embeddings alone. It composes **four novel scoring layers** on top of BM25 + cosine, each with a closed-form formula, each independently testable.
>
> This page documents the math. Every formula is implemented in [`packages/core/src/retrieve/novel-scoring.ts`](https://github.com/patsa2561-art/mneme-ai/blob/main/packages/core/src/retrieve/novel-scoring.ts) and covered by tests.

═══════════════════════════════════════════════════════════════════════════════

## Why these formulas exist

Pure embedding similarity is **time-blind**, **regret-blind**, **author-blind**, and **causally-blind**. A 5-year-old commit and yesterday's commit get the same score if their text is similar. A bug fix and a feature commit get the same score even though the bug fix carries more *engineered wisdom*. Three answers from the same author get the same score even when surfacing the second-most-knowledgeable person would help the user more.

Mneme's four layers correct each blind spot, in order:

| # | Algorithm | What it corrects |
|---|---|---|
| 1 | **TDWE** | Time-blindness — recent matters more |
| 2 | **RACB** | Regret-blindness — fixes carry more lessons |
| 3 | **CGAR** | Causal-blindness — walk the narrative, not the bag |
| 4 | **ADS** | Monoculture — diversify across authors |

Each layer is a *post-processor* over the base score. Order matters: TDWE first (cheap), then RACB (boost), then CGAR (graph propagation), finally ADS (re-rank). The implementation exposes each as a pure function, so you can pick-and-choose or compose them all via `applyNovelScoring()`.

═══════════════════════════════════════════════════════════════════════════════

## 1. TDWE — *Time-Decay Weighted Embedding*

> *"Yesterday's wisdom matters more than last decade's."*

### Formula

```
w(c)              = exp(−λ × age_days / half_life)
adjusted_score(c) = base_score(c) × w(c)
```

Defaults:
- `half_life = 365` days
- `λ = ln(2)` so that age = half_life gives weight 0.5

### Behavior

| age (days) | weight |
|---|---|
| 0 | 1.000 |
| 30 | 0.945 |
| 90 | 0.844 |
| 365 (1 half-life) | 0.500 |
| 730 (2 half-lives) | 0.250 |
| 1825 (5 years) | 0.031 |

### When to use it

Almost always. Recent commits are nearly always more relevant; if they aren't, your repo has unusual longevity (mature OSS libraries, long-lived APIs) and you should raise `half_life` to e.g. 1825 days.

### When NOT to use it

When chasing historical-archaeology questions ("when did this pattern first appear?"). Pass `tdwe: false` to disable.

═══════════════════════════════════════════════════════════════════════════════

## 2. RACB — *Regret-Aware Chunk Boosting*

> *"The bug fix carries more wisdom than the feature."*

### Formula

```
boost(c) = 1 + ln(1 + days_to_followup × severity)
final    = base × min(maxBoost, boost)
```

Severity map (default):
| Regret kind | severity |
|---|---|
| `revert` | 3 |
| `hotfix` | 2 |
| `fix` | 1 |
| `sameFiles` | 0.5 |
| `none` | 0 |

`maxBoost = 2.5` by default — chunks from highly-regretted commits get up to 2.5× boost.

### Why logarithmic

A 1-day-to-fix is *very* informative — the team noticed something was wrong fast.
A 30-day-to-fix is *more* informative (deeper bug) but not 30× more. Logarithmic growth captures **diminishing returns on age**.

### Why this beats embedding-only

Imagine a query: *"why does the auth flow have this catch RangeError?"*

- Embedding-only: returns the `auth.ts` chunk and a few near-duplicate chunks.
- RACB: returns the **fix commit** that introduced the catch (severity=1, days_to_followup=2, boost=1.69) and the **revert** that triggered it (severity=3, days_to_followup=1, boost=2.39) **first**, even when their base scores are slightly lower.

The user reads the *causes*, not the *current state*. That's wisdom.

═══════════════════════════════════════════════════════════════════════════════

## 3. ADS — *Author Diversity Score re-ranking*

> *"Don't return three answers from the same person."*

### Formula

For each result at position `i`:
```
sameAuthorAbove(i) = count(j < i where author(j) == author(i))
penalty(i)         = α × (sameAuthorAbove(i) / total)
final(i)           = base(i) × (1 − penalty(i))
```

Then **re-sort** by `final`. `α = 0.4` by default.

### Behavior

Suppose Alice has three commits ranked 1, 2, 3 (scores 0.50, 0.49, 0.48), and Bob has one commit ranked 4 (score 0.40). Total = 4.

| pos | author | base | penalty | final |
|---|---|---|---|---|
| 1 | Alice | 0.50 | 0.0 | 0.500 |
| 2 | Alice | 0.49 | 0.10 (1/4 × 0.4) | 0.441 |
| 3 | Alice | 0.48 | 0.20 (2/4 × 0.4) | 0.384 |
| 4 | Bob | 0.40 | 0.0 | 0.400 |

After sort: Alice₁ → **Alice₂** → **Bob** → Alice₃. Bob rises above Alice₃ because his perspective is genuinely different.

### Why this matters

When one engineer dominates a topic, retrieval becomes monocultural. The user often asks because they *want a second opinion*. ADS surfaces it.

═══════════════════════════════════════════════════════════════════════════════

## 4. CGAR — *Causal Graph Augmented Retrieval (light)*

> *"Walk the narrative, not just the bag of chunks."*

### How it works

1. Build a **directed graph** over indexed commits where edges represent causal references:
   - PR/issue references: `#482`, `PR #482`, `pull request 482`
   - Direct commit hash references in subject/body: `abc1234`
   - Revert markers: `Revert "..." Reverts commit abc1234`

2. From each search result, BFS up to `maxHops = 2` and collect reachable commits.

3. Boost reachable results:
```
boost = initial × decay^(hops − 1)
final = base × boost
```
Defaults: `initial = 1.3`, `decay = 0.85`. So:
- 1 hop away → boost 1.30
- 2 hops away → boost 1.105

### Why this beats embedding-only

Embeddings see *text similarity*. CGAR sees *causation*. If commit B was triggered by commit A (via "fixes #N" or "follow-up to A"), and the query matches A, then B is **structurally relevant** even if its text is different.

The user looking at a `catch RangeError` ten months later wants to find the **incident report** and the **root-cause commit** — both linked causally to the retrieved fix, but textually unrelated.

### Limits of "light"

The full CGAR vision walks 5+ hops, weights edges by reference confidence, and integrates incident data. v0.16 ships the 2-hop light version; v0.17 will incorporate `correlate` adapter output.

═══════════════════════════════════════════════════════════════════════════════

## Ensemble — `applyNovelScoring(results, ensemble)`

The four layers compose:

```
TDWE  →  RACB  →  CGAR  →  ADS
(time)  (wisdom)  (causal)  (diversity)
```

Order is intentional:

1. **TDWE first** — cheap, makes downstream calculations time-aware.
2. **RACB next** — boost regretted commits before causal walking, so causal graph propagates the wisdom signal.
3. **CGAR third** — propagate scores through the narrative.
4. **ADS last** — diversify the *final* ranking after all signals are integrated.

Disable any layer via `false` in the options object:

```ts
applyNovelScoring(results, {
  tdwe: { halfLifeDays: 730 },        // tune
  racb: { signals, opts: { maxBoost: 3 } },
  cgar: { commits, opts: { maxHops: 3 } },
  ads: false,                          // skip
});
```

═══════════════════════════════════════════════════════════════════════════════

## Why these are world-firsts

We surveyed adjacent retrieval tools — none compose all four signals. Most use:
- Pure cosine similarity *(time-blind, regret-blind)*
- BM25 + reranker *(no temporal model)*
- Hybrid retrieval *(no regret signal)*

To our knowledge, **no shipped retrieval system for git history** combines:
- Closed-form time decay
- Regret-derived semantic boost
- Causal graph propagation
- Author-diversity re-ranking

This is the new moat.

═══════════════════════════════════════════════════════════════════════════════

## See also

- 🛡 [[Guardian]] — the 24/7 self-healing engine that uses these formulas under the hood
- 📊 [[Innovations]] — the 15+ commands powered by these algorithms
- 🏗 [ARCHITECTURE.md](https://github.com/patsa2561-art/mneme-ai/blob/main/ARCHITECTURE.md) — full system architecture
