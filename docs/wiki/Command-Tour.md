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

### 🌟 Featured
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

## Day 4 — *"What is haunting my repo?"*
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

## Day 5 — *"Tell me the story of this file"*
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

## Day 6 — *"Will this change be regretted?"*
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

## Day 11 — *"Compliance + AI Session Audit"*

> **The day the AI commits start arriving — and you need the homework graded.**

```bash
# ─── vendor-neutral AI Session Audit ───────────────────────────────────
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

## 📖 Every command in plain English

> 💡 Each command supports `--help` for usage notes.<br/>
> 🎯 Read each row as: **"Use this when…"** — find your need in the right column, copy the command on the left.

### 🚀 Setup & maintenance — *one-time things*

| Command | Use this when… | Example |
|---|---|---|
| `init` | You just installed Mneme in a repo for the first time | `mneme init` |
| `doctor` | Something feels off — checks Ollama / OpenAI / hardware in 2 seconds | `mneme doctor` |
| `setup-free` | You want full Q&A but don't want to pay — 30-sec wizard for free Ollama / Groq / OpenRouter | `mneme setup-free` |
| `upgrade` | Update Mneme without npm cache headaches | `mneme upgrade` |
| `index` | Build (or refresh) the memory from git history — *secrets auto-redacted* | `mneme index` |
| `status` | Confirm the index is up to date with HEAD | `mneme status` |

### 🧠 Daily use — *the commands you'll reach for every day*

| Command | Use this when… | Example |
|---|---|---|
| `ask` | You want a cited answer about your own repo | `mneme ask "why does payment.ts use try/catch?"` |
| `why` | You want to know who wrote a line + why + similar commits | `mneme why src/auth.ts:47` |
| `do` | You'd rather describe the goal — Mneme picks the right command(s) for you | `mneme do "find security issues"` |
| `mcp` | Plug Mneme into Claude Code / Cursor / Codex / Continue as a tool | `mneme mcp` |
| `wisdom` | Want a short meditation from the Mneme manifesto | `mneme wisdom -n 5` |
| `manifesto` | Read the full canon — every meditation, in order | `mneme manifesto` |

### 📦 Memory compression — *fit your whole repo into one LLM prompt*

| Command | Use this when… | Example |
|---|---|---|
| `htc-build` | One-time: compress every commit + cluster + memoir into LLM-ready cache (~10× smaller) | `mneme htc-build` |
| `htc-stats` | Check coverage + how much you compressed (raw vs cached tokens) | `mneme htc-stats` |

### 🛡 AI Session Audit — *the trust certificate for every AI-driven commit*

> Vendor-neutral. Works with Claude Code · Cursor · Codex · Devin · Sweep · Aider · Copilot — any AI ending up in `git log`.

| Command | Use this when… | Example |
|---|---|---|
| `audit --baseline` | About to let an AI loose on your repo — snapshot behavior first | `mneme audit --baseline` |
| `audit --trace` | After AI worked — see what it did + which AI did it | `mneme audit --trace` |
| `audit --verify` | Check whether the AI's commit message matches the actual diff | `mneme audit --verify` |
| `audit --certify` | Final 5-axis pass/fail trust cert — CI-friendly exit code | `mneme audit --certify` |
| `audit --watch` | Continuous CI gate — re-runs every N seconds | `mneme audit --watch --interval 60` |
| `audit --report` | Markdown audit trail for compliance (SOX / SOC2) | `mneme audit --report --out audit.md` |

→ **[Full positioning + 5 axes + CI integration → AI-Session-Audit](AI-Session-Audit)**

### 🔒 Pre-commit safety — *catch problems before they're committed*

| Command | Use this when… | Example |
|---|---|---|
| `guard --install` | Install once → every `git commit` runs anomaly + vuln + secret-redaction checks (<300ms) | `mneme guard --install` |
| `guardian` | Run a 24/7 self-healing engine — diagnose weaknesses + auto-fix safe items | `mneme guardian --watch --apply` |
| `watch` | 24/7 daemon: re-index on commit, calibrate hourly, self-eval daily | `mneme watch` |

### 🔬 Forensics — *applied forensic science for code*

| Command | Use this when… | Example |
|---|---|---|
| `forensics match` | "Did Alice really write this commit?" — gives a likelihood ratio + verdict | `mneme forensics match HEAD alice@bank.com` |
| `forensics attribute` | "Who most-likely wrote this commit?" — ranks all candidates | `mneme forensics attribute` |
| `forensics vulns` | "What security holes are hiding in our history?" — CWE-aligned scan | `mneme forensics vulns` |
| `forensics anomaly` | "Is any commit suspicious?" — insider-threat / credential-compromise detector | `mneme forensics anomaly` |

### 💎 Insights & storytelling — *understand a repo at a glance*

| Command | Use this when… | Example |
|---|---|---|
| `time-machine <file>` | Want a file's life story as eras (birth → rewrite → firefight → plateau) | `mneme time-machine src/auth.ts` |
| `premortem` | Considering a change — predict regret risk grounded in your repo's failure history | `mneme premortem "swap event-bus library"` |
| `ghost` | Surface ghost code — half-finished features, stale TODOs, files born and forgotten | `mneme ghost` |
| `dna [author]` | Extract a contributor's portable fingerprint (style, hours, file affinity) | `mneme dna alice@bank.com` |
| `drift` | Visualize topical drift — features → refactors → firefights → polish over time | `mneme drift` |
| `chronicle` | Auto-generate a chaptered narrative documentary of the repo | `mneme chronicle` |
| `oracle` | Predict next-window co-edits + author collisions on the same file | `mneme oracle` |
| `constellation` | Graph view of the repo — files as stars, authors as orbitals, commits as edges | `mneme constellation` |
| `cluster` | Find topic islands — semantic clustering of commit messages | `mneme cluster` |
| `network` | Author network — who collaborates with whom (co-edit + co-time + co-topic) | `mneme network` |
| `manage` | Engineering management dashboard — health, succession, skill matrix, trajectory | `mneme manage` |
| `export-bundle` | One bundle: DNA + drift + chronicle + oracle + constellation + clusters + network + manage + ghost | `mneme export-bundle` |
| `who-knows <topic>` | Find the people most likely to know about a topic | `mneme who-knows "rate limiting"` |
| `decisions` | Auto-extract architectural decisions (ADRs) from commit history | `mneme decisions` |
| `stack-trace` | Paste an error / stack trace, get historical context for each frame | `mneme stack-trace` |
| `story <topic>` | Narrate the evolution of a topic across acts (with optional LLM polish) | `mneme story "rate-limiting"` |
| `dream` | Speculative ideas grounded in your codebase patterns | `mneme dream` |
| `chat` | Multi-turn conversational REPL over your repo's history | `mneme chat` |
| `regret` | Surface commits that were shipped and immediately fixed/reverted | `mneme regret` |
| `bus-factor` | Identify single-point-of-knowledge holders + pairing recommendations | `mneme bus-factor` |
| `paradox` | Detect architectural flip-flops — decisions reversed over time | `mneme paradox` |
| `commit-coach` | Pre-commit AI partner — message, reviewers, scope, past warnings | `mneme commit-coach` |
| `crystal-ball` | Predict CI / follow-up failure probability before you push | `mneme crystal-ball` |
| `genius <question>` | AI agent — plans + runs multi-step Mneme workflows for hard questions | `mneme genius "is auth getting safer or worse?"` |
| `teach <target>` | Explain a folder or file in plain language (layer classification + LLM summary) | `mneme teach src/auth/` |
| `entities` | Parse + embed every function / class / type in tracked TS/JS files | `mneme entities` |
| `clones` | Find semantic clones — functions doing the same thing with different names | `mneme clones` |
| `correlate` | Correlate incidents (PagerDuty / manual JSON) with commits | `mneme correlate incidents.json` |
| `palimpsest <target>` | Render the causal chain of a single line of code | `mneme palimpsest src/x.ts:42` |
| `blast <commit>` | Predict incidents likely to follow shipping a commit (blast radius) | `mneme blast HEAD` |

### 📊 Quant — *Wall-Street ideas applied to engineering data*

| Command | Use this when… | Example |
|---|---|---|
| `drawdown` | Find the worst losing streaks — periods of pure firefighting | `mneme drawdown` |
| `alpha` | Per-author "alpha" — Kelly-criterion allocation across tech-debt items | `mneme alpha` |
| `backtest` | Validate any binary predictor against historical outcomes | `mneme backtest` |
| `black-swan` | Tail-risk scan — rare but catastrophic file patterns | `mneme black-swan` |
| `insider-trading` | Authors who repeatedly fix bugs they introduced themselves | `mneme insider-trading` |
| `moneyball` | Undervalued contributors — high impact, low LOC volume | `mneme moneyball` |
| `greek` | Codebase Greeks (Δ Γ Θ) — sensitivity analysis across files | `mneme greek` |
| `correlation-matrix` | Hidden behavioral coupling between files (no static deps needed) | `mneme correlation-matrix` |
| `implied-volatility` | Project chaos predicted from commit-message tone | `mneme implied-volatility` |
| `tax-loss-harvest` | Dead-code candidates — delete to offset technical debt | `mneme tax-loss-harvest` |

### 📋 Compliance & Wisdom Mutant — *the engine that gets better with use*

| Command | Use this when… | Example |
|---|---|---|
| `ledger` | Tamper-evident audit log (SOX / SOC2) | `mneme ledger --since 2025-01-01` |
| `conscience [files]` | Review co-pilot — risk-score a PR against your repo's own history | `mneme conscience packages/payments` |
| `feedback <id> <vote>` | Tell Mneme an answer was helpful (`up`) or wrong (`down`) | `mneme feedback abc1234 up` |
| `calibrate` | Re-tune search knobs against accumulated feedback | `mneme calibrate` |
| `adapt` | Let Mneme inspect this repo and recommend the next 1–3 commands | `mneme adapt` |

### 🎨 Specialty (WILDs) — *niche, but each saves real time*

| Command | Use this when… | Example |
|---|---|---|
| `heal` | Synthesize WHY notes for commits with poor messages — turns bad history into searchable memory | `mneme heal` |
| `echo` | Find past incidents that resemble the current one | `mneme echo "production 500s spiked"` |
| `runaway` | Files that have grown silently across many commits — leak indicator | `mneme runaway` |
| `mirror` | Onboarding dossier — 5 PRs, 3 people, 2 incidents tailored to a topic | `mneme mirror "payments"` |
| `rumor` | Tribal phrases mentioned in commits but no doc explains | `mneme rumor` |
| `fossil` | Files deleted from HEAD but still alive in git history (ghost code) | `mneme fossil` |

### 🗂 Meta

| Command | Use this when… |
|---|---|
| `advanced` | List every command grouped by phase (the hidden ones too) |
| `--help` after any command | Show options + flags for that one command |

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Innovations]]** — the five world-first commands in depth
- **[[Commands-Tier-1]]** — full reference for the eight essentials
- **[[Commands-Tier-2-Quant]]** — Wall-Street-inspired quant commands
- **[[Recipes]]** — multi-command workflows for real engineering scenarios
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
