# Innovations — Ten Things Only Mneme Does

> Other tools show diffs, blame, and search.
> Mneme answers questions about your repo's *past*, *present*, and *future*.

We surveyed the whole landscape — Gource, code_swarm, Hercules, Unblocked, HowYouCode, MergeBERT, GitHub's Network graph — before shipping these. **Every one of them occupies real whitespace.**

The first five (v0.11) tell you what *was*. The next five (v0.12 — *King of Git*) tell you who *is* and what's coming *next*.

═══════════════════════════════════════════════════════════════════════════════

# Part I — What was *(v0.11)*

## 1 · 🕰️  Time Machine — *narrate a file's life as eras*

```bash
mneme time-machine src/auth/session.ts
```

Groups commits into **epochs** — birth, rewrite, evolution, firefight, polish, plateau, twilight — each labeled with a one-line WHY pulled from the most informative commit of that era.

[See full output sample → top of this page in the wiki preview]

> **Unique because:** every other tool gives a flat list. Mneme gives a *story*.

---

## 2 · 🔮  Pre-mortem — *predict regret before you write the code*

```bash
mneme premortem "add caching layer to api responses"
```

Mines repo history for similar past attempts, walks forward looking for revert/hotfix/incident signals, returns regret probability and top 3 risks **with citations to the actual commits** that caused them.

> **Unique because:** generic AI tools give generic advice. Mneme cites the specific commits where that exact thing went wrong in *your* repo.

---

## 3 · 👻  Ghost Code — *surface what's haunting your repo*

```bash
mneme ghost --top 5
```

Combines staleness, low-touch ratio, and TODO density into a single **ghostliness score**. Detects half-finished features and stale TODOs that survived through every later edit.

> **Unique because:** the "haunted code" framing is new. No tool combines staleness + low-touch + TODO-density.

---

## 4 · 🪞  Doppelganger — *preserve knowledge when key people leave* *(roadmap)*

```bash
mneme channel @alice
```

Will analyze a contributor's commit patterns to learn their abstractions, naming, dependencies. When you ask *"how would Alice have done this?"*, Mneme channels their style. *(Stub planned for after Codebase DNA — DNA is the data layer Doppelganger will use.)*

---

## 5 · 📡  Echo — *catch the moment you're about to repeat a mistake* *(roadmap)*

```bash
mneme echo "rewriting auth"
```

Will detect when the current intent recurs of a past attempt and surface what happened the previous times. *(Pre-mortem ships a similar capability today; Echo is the recurrence-focused variant.)*

═══════════════════════════════════════════════════════════════════════════════

# Part II — Who is, and what's next *(v0.12 · King of Git)*

## 6 · 🧬  Codebase DNA — *exportable fingerprint of a contributor's style*

**Command:**
```bash
mneme dna alice@example.com
mneme dna alice@example.com --compare bob@example.com
mneme dna alice@example.com --output .mneme/dna/alice.json
```

**The problem it solves:** other tools show *snapshot* metrics. When a senior leaves, their judgment leaves with them. There's no portable artifact you can point at to say "this is how she works."

**What Mneme does:** extracts a stable fingerprint from commit *history* — style genome, message DNA, working hours, file affinity — packages it as JSON.

**Output:**

```text
🧬  Codebase DNA — alice@example.com
═══════════════════════════════════════════════════════════════
  847 commits  ·  2024-03-12 → 2026-05-05  ·  hash a3f9b21

  ✦ Style genome
    files/commit ........ 3
    test ratio .......... 67%
    issue refs .......... 78%
    conventional commits  92%

  ✦ Message DNA
    avg subject length .. 47 chars
    imperative ratio .... 94%
    body provided ....... 61%
    top verbs ........... add×312  fix×87  refactor×54  rename×31  remove×22

  ✦ Working hours (UTC)
    peak window ......... 14:00–18:00
    weekend ratio ....... 6%

  ✦ File affinity
    38%  src/payments
    21%  src/auth
    14%  src/api

  ✦ Compatibility vs bob@example.com
    overall ............. 74%
    style ............... 81%
    message ............. 79%
    hours ............... 65%
    files ............... 70%
```

**When to use it:**
- Onboarding — read a leaver's DNA before reading their old PRs
- Pair-programming setup — find your highest-compatibility partner
- Self-tracking — diff your own DNA hash quarter to quarter
- Pre-hire — compare candidate's open-source DNA to your team baseline

**Whitespace check:** HowYouCode is snapshot-only. Hercules tracks ownership but no fingerprint export. **Nobody ships portable, history-derived, comparable per-developer DNA.**

═══════════════════════════════════════════════════════════════════════════════

## 7 · 📈  Commit Drift Tracker — *topical evolution over time*

**Command:**
```bash
mneme drift                    # quarterly buckets
mneme drift --granularity month
```

**The problem it solves:** commit-tone shifts gradually. By the time you notice "we've been firefighting for a year", the year is over.

**What Mneme does:** classifies every commit (feature / refactor / firefight / polish / docs / other) and plots the trajectory. Auto-detects burnout, recovery, rewrite clusters.

**Output:**

```text
📈  Commit Drift — topical evolution
═══════════════════════════════════════════════════════════════

  ◆ Trajectory  (quarter)

    2024-Q1   ████████░░   62 commits  FEATURE
    2024-Q2   ███████░░░   48 commits  FEATURE
    2024-Q3   ░░▓▓▓▓▓▓▓░   31 commits  FIREFIGHT  ⚠
    2024-Q4   ░░░▓▓▓▓▓▓▓   28 commits  FIREFIGHT
    2025-Q1   █▓▓▓▓░░░░░   42 commits  REFACTOR
    2025-Q2   ████████░░   58 commits  FEATURE

  ✦ Insights
    • 2024-Q2 → 2024-Q3   firefight ratio jumped 12% → 71% — burnout signal.
    • 2024-Q4 → 2025-Q1   recovery — fires fell 71% → 18%.
```

**When to use it:**
- Quarterly retros — show actual data instead of vibes
- Detecting burnout — early warning when fires creep up
- Capacity planning — distinguish fire seasons from feature seasons

**Whitespace check:** academic papers (arxiv 2110.00697) cluster commits semantically but stop at the paper. Nothing has been productized as a CLI. Mneme is first.

═══════════════════════════════════════════════════════════════════════════════

## 8 · 📖  Codebase Chronicles — *narrative documentary of your codebase*

**Command:**
```bash
mneme chronicle
mneme chronicle --output CHRONICLE.md
mneme chronicle --gap-days 60
```

**The problem it solves:** the codebase has a story but nobody has time to read 2,000 commits. Documentation describes the code; nothing describes its *journey*.

**What Mneme does:** detects natural epochs (split by long quiet gaps OR sudden churn shifts), names each chapter, identifies the protagonist (top contributor of that era), emits Markdown ready to convert to PDF or EPUB.

**Output:**

```text
📖  Chronicles of Your Codebase
═══════════════════════════════════════════════════════════════
  847 commits  ·  792 days  ·  6 chapters

  Chapter 1 · The Founding
    2024-03-12 → 2024-05-04  (53d, 87 commits)  protagonist: @alice
    subtitle: scaffold session middleware

  Chapter 2 · The Great Refactor
    2024-08-14 → 2024-10-22  (69d, 142 commits)  protagonist: @alice
    subtitle: switch from sessions to JWT after rate-limit incident #482

  Chapter 3 · The Reckoning
    2024-10-23 → 2024-11-30  (38d, 67 commits)  protagonist: @bob
    subtitle: hotfix: token refresh race condition

  ✓ Markdown chronicle written to CHRONICLE.md
```

`mneme chronicle --output CHRONICLE.md` writes the full narrative. Pipe through pandoc to get PDF / EPUB:

```bash
mneme chronicle --output CHRONICLE.md
pandoc CHRONICLE.md -o chronicle.pdf
pandoc CHRONICLE.md -o chronicle.epub
```

**When to use it:**
- Hire onboarding — give new joiners the "novel" of the codebase
- Project retrospectives — chapters serve as natural milestones
- Open-source storytelling — share `CHRONICLE.md` as part of release notes

**Whitespace check:** no tool generates novel-format codebase histories. Documentation tools describe code; Chronicle describes its *life*.

═══════════════════════════════════════════════════════════════════════════════

## 9 · 🔮  Co-edit Oracle — *predict next-window collisions*

**Command:**
```bash
mneme oracle                       # default 90-day window
mneme oracle --window-days 30 --top 10
```

**The problem it solves:** two engineers independently start touching the same file. They both finish their PRs Friday afternoon. Merge conflicts. Slack drama. The signal was visible in their recent commit pattern — nobody was watching.

**What Mneme does:** builds a recency-weighted author × file affinity matrix from the recent window, projects per-author probabilities for each file in the next window, and flags **predicted collisions** where two authors both have high probability for the same file.

**Output:**

```text
🔮  Oracle — predicted next-window co-edits
═══════════════════════════════════════════════════════════════
  283 commits in window

  ⚠ Predicted collisions

    src/auth/session.ts
      alice ⨯ bob   joint P = 56%
      last joint touch: 4d ago

    src/payments/charge.ts
      bob ⨯ charlie   joint P = 38%

  ◆ Top file predictions

    src/api/handler.ts
      alice                 67%
      bob                   23%
      charlie               10%
```

**When to use it:**
- Sprint kickoff — flag hot files before assignment
- Async-team coordination — surface invisible overlap weekly
- Pre-PR — check who else is likely to touch the same code

**Whitespace check:** Microsoft's MergeBERT research stopped at a paper. Mneme ships the productized version.

═══════════════════════════════════════════════════════════════════════════════

## 10 · 🌌  Codebase Constellation — *graph view of your codebase*

**Command:**
```bash
mneme constellation
mneme constellation --output graph.json
mneme constellation --json | jq '.fileEdges'
```

**The problem it solves:** the codebase has structure beyond the file tree — files that always commit together, authors who always touch certain regions, clusters that have nothing to do with each other. None of this is visible from `tree` or `git log`.

**What Mneme does:** extracts the underlying graph (files=stars, authors=orbitals, commits=edges), surfaces the brightest stars + closest orbitals + strongest co-edit edges, and emits JSON ready for visualization.

**Output:**

```text
🌌  Codebase Constellation — graph view of your repo
═══════════════════════════════════════════════════════════════
  247 file-stars  ·  8 orbitals  ·  142 co-edit edges  ·  6 clusters

  ◆ Brightest stars (most-touched files)
    ████████  src/payments/charge.ts  (87×)
    ███████░  src/auth/session.ts  (62×)
    ██████░░  src/api/handler.ts  (54×)
    ██████░░  src/db/migrations.ts  (51×)
    █████░░░  src/integrations/stripe.ts  (43×)

  ◆ Closest orbitals (most-active authors)
    ████████  alice  (412 commits)
    ██████░░  bob  (287 commits)
    ████░░░░  charlie  (148 commits)

  ◆ Strongest co-edit edges (files often committed together)
    34×  src/auth/session.ts ⟷ src/auth/jwt.ts
    28×  src/payments/charge.ts ⟷ src/payments/refund.ts
    21×  src/api/handler.ts ⟷ src/api/middleware.ts
```

**Roadmap:** `mneme constellation --serve` will launch a 3D WebGL viewer (think Google Earth × Git × Neural Network). v0.12 ships the data layer; v1.0 ships the renderer.

**When to use it:**
- Architecture review — find hidden coupling
- Onboarding — show newcomers the *real* dependency clusters
- Refactor planning — identify the bridge files that connect modules

**Whitespace check:** Gource is dead, 2.5D, post-hoc. 3ource (its three.js clone) was abandoned in 2014. No actively maintained browser-native real-time WebGL git viewer with author overlay exists.

═══════════════════════════════════════════════════════════════════════════════

## A typical Mneme session — using all 10

```bash
# Monday — onboarding to a new file
mneme time-machine src/auth/session.ts          # 1 — narrate file life
mneme dna alice@example.com                     # 6 — read the original author's DNA

# Tuesday — assigned to add caching
mneme premortem "add response cache to /orders" # 2 — predict regret
mneme oracle                                    # 9 — see who else is likely to touch it

# Wednesday — quarterly review
mneme drift                                     # 7 — show repo trajectory
mneme ghost --top 10                            # 3 — find dead code

# Thursday — architecture session
mneme constellation                             # 10 — see hidden coupling
mneme decisions                                 # surface ADRs

# Friday — release storytelling
mneme chronicle --output CHRONICLE.md           # 8 — generate the novel
pandoc CHRONICLE.md -o chronicle.pdf            # ship as PDF with the release
```

═══════════════════════════════════════════════════════════════════════════════

## Why these are unique — the table

| Capability | Mneme | git log | GitHub Insights | Gource | Hercules | Unblocked | MergeBERT |
|---|---|---|---|---|---|---|---|
| Narrate file life as eras | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Predict risk from your failure history | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | partial |
| Detect ghost code by score | ✅ | ❌ | ❌ | ❌ | partial | ❌ | ❌ |
| **Exportable developer DNA** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Topical drift over time** | ✅ | ❌ | partial | ❌ | partial | ❌ | ❌ |
| **Codebase chronicle** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Co-edit prediction** | ✅ | ❌ | ❌ | ❌ | ❌ | partial | research |
| **File-star + author-orbital graph** | ✅ data | ❌ | ❌ | viz only | ❌ | partial | ❌ |
| Local-first | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| MCP-callable | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Command-Tour]]** — every command, told as a workflow story
- **[[Commands-Tier-1]]** — the eight essential commands
- **[[Recipes]]** — multi-command workflows for real engineering scenarios
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
