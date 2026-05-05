# Tier 2 — Quant (Wall Street meets Git)

The killer differentiator. Ten commands that apply quantitative-finance formulas to your codebase. Time series of commits = price ticks. Author churn = volume. Bug-fix periods = drawdowns. Same math, new domain.

All commands run on the indexed memory; no LLM calls, no network. See `mneme advanced` for the full list.

═══════════════════════════════════════════════════════════════════════════════

## `mneme drawdown` — worst losing streaks

Finds stretches of bug-fix-only commits with no feature progress — pure firefighting periods.

```bash
mneme drawdown
mneme drawdown --min-length 5
mneme drawdown --json
```

Tier classification: critical / severe / moderate / minor (by length × duration).

Use for: retrospectives, postmortems, "where did our Q3 go?"

═══════════════════════════════════════════════════════════════════════════════

## `mneme alpha` — Kelly criterion for technical debt

Each TD item has (expected payoff, variance). Kelly tells you what % of dev-days to allocate. Uses fractional Kelly (×0.25) by default to limit blow-up risk — same lever Edward Thorp used to win Wall Street.

```bash
# items.json: [{"id":"x","name":"Refactor PaymentAdapter","edge":0.18,"variance":0.02,"effortDays":9}, ...]
mneme alpha --items items.json --budget-days 25
mneme alpha --items items.json --budget-days 25 --multiplier 0.5    # more aggressive
```

Output: ranked allocation with `outsized` / `core` / `small` / `skip` tiers and concrete dev-day numbers.

═══════════════════════════════════════════════════════════════════════════════

## `mneme backtest` — validate any predictor against history

Every prediction Mneme makes ("this is risky") should be validatable. Backtest computes precision, recall, F1, lift over baseline, plus a verdict label.

```bash
# samples.json: [{"id":"...","predicted":true,"actual":false}, ...]
mneme backtest --samples samples.json
```

Verdicts: `strong-edge` / `real-edge` / `weak` / `no-edge`. The conclusion text is plain-English: *"strong edge — precision 67%, recall 67%, 2.4× over random. Trust this predictor."*

Sells the system to enterprise/regulated buyers as **evidence-based**, not vibes.

═══════════════════════════════════════════════════════════════════════════════

## `mneme black-swan` — Taleb's tail risk applied to git

Files touched 3 times in 2 years that caused 40% of all P0 incidents. They LOOK stable. They are tail risk.

```bash
mneme black-swan
mneme black-swan --top 5
```

Tiers: `deceptive-calm` / `elevated` / `watch` / `background`.

Recommendations are concrete: *"Mandatory pair-program + canary deploy. This file LOOKS stable but its track record is catastrophic."*

Requires incidents to be indexed (`mneme correlate --source manual`).

═══════════════════════════════════════════════════════════════════════════════

## `mneme insider-trading` — fix-your-own-bugs detector

Authors who repeatedly introduce AND fix the same bugs in the same files. Reveals deepest domain knowledge + execution gap simultaneously.

```bash
mneme insider-trading
mneme insider-trading --window-days 30 --min-patterns 3
```

Per-author profile includes: pattern count, affected files, sample commits, and a **concrete pairing recommendation** (the author who has touched the same files without insider patterns).

Manager dream tool. Surfaces uncomfortable truths from data, not opinion.

═══════════════════════════════════════════════════════════════════════════════

## `mneme moneyball` — undervalued contributors

Billy Beane found undervalued players. Apply to engineering: contributors with low LOC count but high downstream impact — their commits unblock everyone else.

```bash
mneme moneyball
mneme moneyball --top 10
```

Per-commit ROI metric: `log(downstream_commits) × distinct_collaborators / commit_count`. Tiers: `moneyball` / `balanced` / `loud` / `passive`.

Anti-promotion-by-LOC tool. Surfaces the quiet contributors who matter.

═══════════════════════════════════════════════════════════════════════════════

## `mneme greek` — Δ Γ Θ sensitivity analysis

Wall Street uses "the Greeks" to measure portfolio sensitivity. Apply to a codebase:

- **Δ DELTA** — sensitivity to top contributor. *"If alice quits, 47% of payment knowledge is lost."*
- **Γ GAMMA** — acceleration of risk. *"PR rate +50% → bug rate +120% (super-linear)."*
- **Θ THETA** — time decay. *"Untouched files lose 2% test coverage per quarter."*

```bash
mneme greek
mneme greek --json
```

Composite report. All three Greeks computed and rendered with plain-English interpretations.

═══════════════════════════════════════════════════════════════════════════════

## `mneme correlation-matrix` — hidden behavioral coupling

Static analysis catches imports. This catches BEHAVIORAL coupling: "every time file X is touched, file Y has a fix within 7 days, even though they don't import each other."

```bash
mneme correlation-matrix
mneme correlation-matrix --top 10 --min-lift 2
```

Per pair: Jaccard similarity + Lift over random baseline. Tiers: `tight` / `strong` / `moderate` / `weak`.

Reveals hidden dependencies that import graphs miss: shared mutable state, undocumented order-of-operations, accidental contracts.

═══════════════════════════════════════════════════════════════════════════════

## `mneme implied-volatility` — chaos predicted from commit message TONE

Wall Street's IV measures expected volatility BEFORE realized vol shows up in price. We do the same with git: tone signals (exclamation density, all-caps, emoji, friction words like "ARGH", hedging like "kinda", "should work?") predict bug-rate spikes BEFORE the bugs land.

```bash
mneme implied-volatility
```

Output:
- IV index 0-100
- 12-week history with bar chart
- Trend label: rising / falling / flat
- Plain-English interpretation

Almost-zero precedent in dev tools. Pure linguistic feature engineering on git.

═══════════════════════════════════════════════════════════════════════════════

## `mneme tax-loss-harvest` — dead-code deletion candidates

In finance, you sell losing positions to offset gains elsewhere. In a codebase, deleting dead code reduces cognitive surface area, freeing up budget to absorb new debt.

```bash
mneme tax-loss-harvest
mneme tax-loss-harvest --min-stale-days 365 --top 10
```

Scoring per file: `staleness × (1 / commits) × (1 - risk)`. Risk grows with past incidents on the file. Tiers: `safe` / `low-risk` / `moderate` / `risky`.

Output includes estimated lines saved + net-of-risk savings — paradoxical "subtraction = growth" framing.

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[Recipes](Recipes)** — combining these for retros, audits, hiring, layoffs
- **[Commands-Tier-1](Commands-Tier-1)** — the 8 essentials
- **[Commands-Tier-2-Insights](Commands-Tier-2-Insights)** — who-knows, decisions, story, dream, chat
- **[Privacy and Security](Privacy-and-Security)** — what these analyses send / don't send
