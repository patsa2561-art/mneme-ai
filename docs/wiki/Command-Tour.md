# 📚 The Mneme Command Tour — every command, told as a story

<div align="center">

<table>
<tr>
<td align="center" width="33%">

### 🚪 Browse by category
*Tier 1 · Forensics · Quant · Insights · Audit · MCP*<br/>
[Jump to at-a-glance reference ↓](#all-commands--at-a-glance-reference)

</td>
<td align="center" width="34%">

### 🗺 Browse by user journey
*Day 0 → Day 12 — what you'd reach for and when*<br/>
[Start at Day 0 ↓](#day-0--how-do-i-start)

</td>
<td align="center" width="33%">

### 🌟 Latest — v0.27
**`mneme audit`** — the AI-session trust certificate<br/>
[Jump to Day 11 ↓](#day-11--compliance--ai-session-audit)

</td>
</tr>
</table>

</div>

═══════════════════════════════════════════════════════════════════════════════

> Mneme has **50+ commands**. Memorizing a list is exhausting.
> Reading them as workflows is not.
>
> This page walks you through every command in the order you'd actually reach for them, organized by the question you're trying to answer. Every example is copy-paste ready.

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

## Day 11 — *"Compliance + AI Session Audit"*  ✨ v0.27

> **The day the AI commits start arriving — and you need the homework graded.**

```bash
# ─── v0.27 — vendor-neutral AI Session Audit ──────────────────────────
#  Works with Claude Code · Cursor · Codex · Devin · Sweep · Aider · Copilot
#  Every AI-driven commit gets a 5-axis trust certificate.

mneme audit --baseline                # snapshot behavior BEFORE letting an AI loose
#   → AI does its work →
mneme audit --trace                   # diff + AI vendor detection
mneme audit --verify                  # narrative vs reality (Leviathan-style)
mneme audit --certify                 # 5-axis pass/warn/fail · CI-friendly exit code
mneme audit --watch --interval 60     # continuous CI gate
mneme audit --report --out audit.md   # markdown audit trail (SOX / SOC2)

# ─── classic compliance primitives ─────────────────────────────────────
mneme ledger --since 2025-01-01       # tamper-evident audit log (SOX/SOC2)
mneme conscience packages/payments    # risk-score a PR against history
```

**The five axes `--certify` checks:** behavioral parity · API contract drift · test pass rate · perf regression · AI narrative match. Plus forensic axes (TIME / FILES / STYLE / SIZE).

→ **[Full positioning + 6 modes + CI integration → AI-Session-Audit](AI-Session-Audit)**

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

> 💡 Every command supports `--help` for usage notes. Copy-paste any cell from the tables below.

### 🟢 Tier 1 — Essentials *(always visible in `mneme --help`)*

| Command | Plain-English use | Example |
|---|---|---|
| `init` | First-time setup — picks the best embedder for your machine | `mneme init` |
| `doctor` | "Is everything ok?" — checks Ollama / OpenAI / hardware | `mneme doctor` |
| `index` | Build memory from your git history *(secrets auto-redacted)* | `mneme index` |
| `status` | Is the index up to date with HEAD? | `mneme status` |
| `ask` | Cited Q&A over your repo | `mneme ask "why does X exist?"` |
| `why` | Who wrote each line + why · semantically related commits | `mneme why src/auth.ts:47` |
| `do` | Smart dispatcher — describe what you want, Mneme picks tools | `mneme do "find security issues"` |
| `guard` | Pre-commit hook — block secrets + CWE patterns | `mneme guard --install` |
| **`audit`** ✨ v0.27 | **AI Session Audit — every AI commit gets a trust certificate** | `mneme audit --certify` |
| `mcp` | Run as MCP server (Claude Code / Cursor / Codex consume this) | `mneme mcp` |
| `wisdom` | Meditation from the manifesto | `mneme wisdom -n 5` |
| `setup-free` | 30-second wizard for free LLM provider | `mneme setup-free` |
| `upgrade` | Bulletproof self-update | `mneme upgrade` |
| `htc-build` | Compress every commit + cluster + memoir for LLM-ready cache | `mneme htc-build` |
| `htc-stats` | Show HTC compression coverage + ratio | `mneme htc-stats` |

### 🔬 Forensics — *applied forensic science for code*

| Command | Plain-English use | Example |
|---|---|---|
| `forensics match` | "Did Alice really write this commit?" *(Bayesian LR + ENFSI scale)* | `mneme forensics match HEAD alice@bank.com` |
| `forensics attribute` | "Who most-likely wrote this commit?" | `mneme forensics attribute` |
| `forensics vulns` | "What security holes are hiding in our history?" *(CWE-aligned)* | `mneme forensics vulns` |
| `forensics anomaly` | "Is any commit suspicious?" *(insider-threat / 4-axis baseline)* | `mneme forensics anomaly` |

### 💎 Insights — *world-firsts in this category*

| Command | Plain-English use |
|---|---|
| `who-knows <area>` | Bus-factor: who actually owns this code |
| `decisions` | Surface every architectural decision Mneme can detect |
| `story <topic>` | Narrative across all commits touching the topic |
| `dream <topic>` | Speculative ideas grounded in your patterns |
| `dna <commit>` | Author fingerprint for a specific commit |
| `drift` | Detect concept-drift between docs and code |
| `chronicle` | Long-form repo memoir (powered by HTC Layer 3) |
| `oracle` | Predict what will need refactoring next |
| `constellation` | Visualize the file-cluster graph |
| `ghost` ✨ | Recover knowledge from departed authors |
| `paradox` | Find self-contradictory commits |
| `regret` | Surface past patterns flagged as regrets |
| `bus-factor` | Quantify single-point-of-knowledge risk |
| `commit-coach` | AI commit-message coach |
| `crystal-ball` | Forecast incident likelihood |
| `time-machine` ✨ | Replay code state at any past date |
| `premortem` ✨ | Predict regret risk for a proposed change |
| `cluster` / `network` | Topic clustering + correlation graph |
| `manage` / `export-bundle` | Knowledge-pack export for onboarding |
| `stack-trace <error>` | Map a stack trace back through history |

### 📊 Quant — *Wall-Street-inspired engineering intelligence*

| Command | Plain-English use |
|---|---|
| `drawdown` | Repo-equivalent of max drawdown — biggest engineering setbacks |
| `alpha` | Per-author "alpha" vs the team baseline |
| `backtest` | Replay refactor decisions against the past |
| `black-swan` | Tail-risk scan — rare but catastrophic patterns |
| `insider-trading` | Suspicious-knowledge detection in commit timing |
| `moneyball` | Undervalued contributors (commits that paid off later) |
| `greek` | Risk Greeks (delta / gamma / theta / vega) for engineering |
| `correlation-matrix` | Which files / authors / topics co-move |
| `vix` | Volatility index of your repo's churn |
| `tax-loss-harvest` | Identify tech debt to amortize |

### 🛡 Compliance & Wisdom

| Command | Plain-English use |
|---|---|
| `ledger` | WILD #3 — tamper-evident audit log (SOX / SOC2) |
| `conscience <area>` | Risk-score a PR against history |
| `feedback / calibrate / adapt` | Wisdom Mutant Engine — Mneme gets better with usage |
| `heal / echo / runaway / mirror / rumor / fossil` | Specialty WILDs — niche but powerful |
| `manifesto` | The full canonical text |

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Innovations]]** — the five world-first commands in depth
- **[[Commands-Tier-1]]** — full reference for the eight essentials
- **[[Commands-Tier-2-Quant]]** — Wall-Street-inspired quant commands
- **[[Recipes]]** — multi-command workflows for real engineering scenarios
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
