# The Mneme Command Tour — every command, told as a story

> Mneme has **40+ commands**. Memorizing a list is exhausting.
> Reading them as workflows is not.
>
> This page walks you through every command in the order you'd actually reach for them, organized by the question you're trying to answer.

═══════════════════════════════════════════════════════════════════════════════

## Day 0 — *"How do I start?"*

```bash
mneme init               # detects best embedder for your hardware
mneme doctor             # same probe, runnable any time
mneme index              # build memory from git history (with secret redaction)
mneme status             # is the index up to date?
```

**Expected output of `mneme doctor`:**

```text
Environment probe
   hardware   16GB RAM · 8 cpus · linux/x64 (good)
   ollama     reachable · embed model pulled
   openai     no key

Recommendation  ollama  ★★★★☆
   Ollama is running and nomic-embed-text is pulled — local, free,
   high quality. No code or commit text leaves your machine.
```

═══════════════════════════════════════════════════════════════════════════════

## Day 1 — *"Why does this code exist?"*

The single most important command:

```bash
mneme ask "why does the webhook handler retry 3 times?"
```

**Output:**

```text
✦ Verdict
   The retry was added after a 2024-06 incident where Stripe's API briefly
   returned 502s and we lost charge events. 3 retries with exponential
   backoff was chosen to match Stripe's recommended client behavior.

◆ Citations
   a3f9b21  fix: retry stripe webhook on 502 (closes #482)
   2c4d8e0  pr#503: tune retry backoff to match upstream guidance

◇ Confidence: HIGH  (top hit ≫ next-2)
```

**For a specific file or line:**

```bash
mneme why src/payments/charge.ts:47
```

═══════════════════════════════════════════════════════════════════════════════

## Day 2 — *"Who knows this part of the code?"*

```bash
mneme who-knows stripe
```

**Output:**

```text
✦ Verdict
   Alice — 78% confidence. Backup: Bob (19%). Risk: Alice on parental leave
   from 2026-06-15 — make sure Bob is in any sync PRs until then.
```

**Related — fragility map:**

```bash
mneme bus-factor              # show files where one author owns ≥75%
mneme bus-factor --top 5      # only the top 5 risks
```

═══════════════════════════════════════════════════════════════════════════════

## Day 3 — *"What did we ship and immediately regret?"*

```bash
mneme regret --window-days 7
```

**Output:**

```text
✦ Summary
   12 regrets across 184 shipped commits  (rate: 6.5%)
   average days-to-fix: 1.8
   breakdown: revert: 3 · hotfix: 5 · fix: 4

◆ Recent regrets  (showing 3 of 12)
   REVERT    shipped 2025-04-12  → fixed in 0.3d
       7f4a821  add LRU cache to user lookups
       ↳ 9c3593c  revert "add LRU cache" — heap grew 8x
       lesson: an LRU eviction policy under heavy load causes thrash

   HOTFIX    shipped 2025-03-28  → fixed in 1.1d
       b933a2f  refactor session middleware
       ↳ 6e9a846  hotfix: session lookup race condition
```

═══════════════════════════════════════════════════════════════════════════════

## Day 4 — *"What is haunting my repo?"*  ✨ v0.11.0

```bash
mneme ghost --top 5
```

**Output:**

```text
👻  Ghost Code — what's haunting your repo
═══════════════════════════════════════════════════════════════
247 files analyzed  ·  5 ghosts surfaced  ·  avg ghostliness 31%

   src/exporter.ts
     ████████░░  87%   born and forgotten — 412d untouched
     2 commits · last: "scaffold csv exporter (TODO finish)"

   src/integrations/zendesk.ts
     ███████░░░  74%   one-shot file — added once, never revisited
     1 commits · 287d quiet · last: "stub zendesk webhook handler"
```

═══════════════════════════════════════════════════════════════════════════════

## Day 5 — *"Tell me the story of this file"*  ✨ v0.11.0

```bash
mneme time-machine src/auth/session.ts
```

**Output:**

```text
🕰  Time Machine — life of a file
═══════════════════════════════════════════════════════════════
src/auth/session.ts
57 commits across 412 days

✦ Health
   rewrite 18%  ·  firefight 12%  ·  polish/plateau 70%

◆ Epochs
   BIRTH      2024-03-12        born — "scaffold session middleware"
   REWRITE    2024-08-14 → 21   "switch from sessions to JWT after #482"
   FIREFIGHT  2024-08-22 → 25   "hotfix: token refresh race"
   PLATEAU    2024-08-26 → ...  quiet stretch — 218 days untouched
   EVOLUTION  2025-04-02 → now  "add MFA hooks to existing JWT flow"
```

**Sister command — narrative across the whole repo:**

```bash
mneme story stripe                  # how Stripe integration evolved
mneme decisions                     # auto-extracted ADRs
mneme paradox                       # find architectural flip-flops (A → B → A)
```

═══════════════════════════════════════════════════════════════════════════════

## Day 6 — *"Will this change be regretted?"*  ✨ v0.11.0

Before you write the code:

```bash
mneme premortem "add caching layer to api responses"
```

**Output:**

```text
🔮  Pre-mortem — what your repo's history says about this
═══════════════════════════════════════════════════════════════
intent:  add caching layer to api responses

✦ Verdict
   risk: VERY HIGH  (P(regret) = 78%)
   7 of 9 similar past attempts ended badly.

◆ Top risks
   • cache invalidation regression (3× before)
       b2e1f04  fix: stale cache served to logged-in users
   • memory leak (2× before)
       7f4a821  revert "add LRU cache" — heap grew 8x in 2 hours
```

**At commit time — pre-commit AI partner:**

```bash
mneme commit-coach --stdin < .git/COMMIT_EDITMSG
mneme crystal-ball --stdin           # predict CI failure probability
```

═══════════════════════════════════════════════════════════════════════════════

## Day 7 — *"Did this incident happen before?"*

```bash
mneme echo --query "stripe webhook 502s"
mneme stack-trace --from error.log    # historical context per frame
```

**Output of `echo`:**

```text
📡  Past incidents resembling this one
   2024-06-14  3a8f1e0  stripe webhook returning 502 on charge.succeeded
   2024-09-22  c4e7b20  stripe API hiccup — 9 events lost in retry queue

   Pattern: this has happened before during AWS us-east outages.
```

═══════════════════════════════════════════════════════════════════════════════

## Day 8 — *"What should we cleanup before the refactor?"*

```bash
mneme tax-loss-harvest         # dead-code deletion candidates
mneme runaway                  # files growing silently
mneme fossil                   # files deleted from HEAD but alive in history
```

═══════════════════════════════════════════════════════════════════════════════

## Day 9 — *"Quant intelligence for engineering"*

The Sprint 5 Wall-Street-inspired commands:

| Command | What it tells you |
|---|---|
| `mneme drawdown` | Worst losing streaks — periods of pure firefighting |
| `mneme alpha --items F` | Kelly-criterion allocation across tech-debt items |
| `mneme backtest --samples F` | Validate any predictor against historical outcomes |
| `mneme black-swan` | Rare-but-catastrophic file patterns |
| `mneme insider-trading` | Authors who fix bugs they introduced |
| `mneme moneyball` | Undervalued contributors (high ROI, low LOC) |
| `mneme greek` | Δ knowledge loss · Γ risk acceleration · Θ file decay |
| `mneme correlation-matrix` | Hidden behavioral coupling between files |
| `mneme implied-volatility` | Chaos predicted from commit message tone |

See **[[Commands-Tier-2-Quant]]** for full reference.

═══════════════════════════════════════════════════════════════════════════════

## Day 10 — *"Knowledge transfer + onboarding"*

```bash
mneme mirror                            # onboarding dossier
mneme teach packages/auth               # explain a folder in plain language
mneme rumor                             # tribal phrases mentioned but never documented
mneme genius "how does our auth work?"  # multi-step LLM agent
```

═══════════════════════════════════════════════════════════════════════════════

## Day 11 — *"Compliance + audit"*

```bash
mneme ledger --since 2025-01-01       # tamper-evident audit log (SOX/SOC2)
mneme conscience packages/payments    # risk-score a PR against history
```

═══════════════════════════════════════════════════════════════════════════════

## Day 12 — *"Self-improvement engine"*

The Wisdom Mutant Engine — Mneme gets better with every query:

```bash
mneme feedback <query-id> up           # explicit feedback
mneme feedback <query-id> down
mneme calibrate                        # re-tune search knobs
mneme adapt                            # recommend the next 1-3 commands
```

═══════════════════════════════════════════════════════════════════════════════

## Day ∞ — *"Everything else"*

```bash
mneme dream                            # speculative ideas grounded in your patterns
mneme chat                             # multi-turn REPL over history
mneme heal                             # synthesize WHY notes for poor commits
mneme clones                           # near-duplicate functions
mneme entities                         # parse + embed every symbol
mneme palimpsest src/x.ts:42           # causal chain of a single line
mneme blast <commit>                   # predict incidents that may follow

mneme wisdom -n 5                      # a meditation from the manifesto
mneme manifesto                        # the full canon
```

═══════════════════════════════════════════════════════════════════════════════

## All commands — at-a-glance reference

### Tier 1 — Essentials (always visible)
`init` · `doctor` · `index` · `status` · `ask` · `why` · `mcp` · `wisdom`

### Insights — the killer commands
`who-knows` · `decisions` · `stack-trace` · `story` · `dream` · `chat` · `regret` · `bus-factor` · `paradox` · `commit-coach` · `crystal-ball` · **`time-machine`** ✨ · **`premortem`** ✨ · **`ghost`** ✨

### Phase 2-3 — Semantic + correlation
`entities` · `clones` · `correlate` · `blast` · `palimpsest` · `conscience`

### Sprint 5 — Quant
`drawdown` · `alpha` · `backtest` · `black-swan` · `insider-trading` · `moneyball` · `greek` · `correlation-matrix` · `implied-volatility` · `tax-loss-harvest`

### Wisdom Mutant Engine
`feedback` · `calibrate` · `adapt` · `teach` · `genius`

### WILD
`heal` · `echo` · `runaway` · `mirror` · `rumor` · `fossil` · `ledger`

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Innovations]]** — the five world-first commands in depth
- **[[Commands-Tier-1]]** — full reference for the eight essentials
- **[[Commands-Tier-2-Quant]]** — Wall-Street-inspired quant commands
- **[[Recipes]]** — multi-command workflows for real engineering scenarios
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
