# Innovations — Fifteen Things Only Mneme Does

> Other tools show diffs, blame, and search.
> Mneme is the only **OSS, local-first, end-to-end management surface** for git history we are aware of.
> The Frontier — alone in the field by design.

After researching adjacent tools across git visualization, code search, AI coding assistants, and engineering analytics, we confirmed each command below occupies real whitespace — capabilities not shipped by any maintained, open-source, local-first tool we found.

Four tiers of commands:

- **v0.11 — *Memory*** (5): tell you what *was*
- **v0.12 — *King of Git*** (5): tell you who *is* and what's coming *next*
- **v0.13 — *The Frontier*** (4): close every remaining landscape gap
- **v0.14 — *Untouchable*** (1): the quality moat — zero hallucination guarantee

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

**Whitespace check:** existing developer-style tools we surveyed are snapshot-based — they read your *current* code, not your *history*. None ship a portable, history-derived, comparable per-developer fingerprint as an artifact you can export, share, and diff over time.

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

**Whitespace check:** academic literature explores semantic commit clustering, but we found no maintained, productized CLI that ships it. Mneme brings it from research to shell.

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

**Whitespace check:** predictive co-edit detection has been explored in academic research but, to our knowledge, isn't shipped as a CLI in any maintained open-source tool. Mneme ships it.

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

**Whitespace check:** existing codebase visualizers we found are either unmaintained, post-hoc only, or lack an author overlay. Mneme ships the data layer first; the WebGL viewer is on the v1.0 roadmap.

═══════════════════════════════════════════════════════════════════════════════

# Part III — The Frontier *(v0.13 · close every remaining gap)*

## 11 · 🧠  Semantic Commit Clusters — *find topic islands across history*

**Command:**
```bash
mneme cluster
mneme cluster --similarity 0.2 --min-size 5
```

**The problem it solves:** thousands of commits. You know there's a "caching effort" buried in there but searching one keyword misses synonyms. Pure NLP clustering of commits has been published in academic papers — never shipped.

**What Mneme does:** groups similar commits by token-overlap (or embedding cosine when available), surfaces topic islands with shared vocabulary, sample commits, and cohesion score.

**Output:**
```text
🧠  Semantic Commit Clusters
═══════════════════════════════════════════════════════════════
  847 commits  ·  23 clusters  ·  142 outliers

  ◆ Cluster 1   132 commits · cohesion 47%
    terms: caching  layer  api  invalidation
    range: 2024-05-12 → 2026-04-30

  ◆ Cluster 2   87 commits · cohesion 52%
    terms: auth  jwt  session  refresh
```

**Whitespace check:** semantic commit clustering exists in academic research but, to our knowledge, hasn't been shipped as a CLI before. Mneme brings it from paper to shell.

═══════════════════════════════════════════════════════════════════════════════

## 12 · 🕸  Author Network — *semantic collaboration graph*

**Command:**
```bash
mneme network
mneme network --window-days 14
```

**The problem it solves:** GitHub's "Network graph" only shows branches. There's no OSS tool that builds a real author-collaboration graph weighted by *what* people work on together.

**What Mneme does:** builds an author × author graph where edges combine **co-edit + co-time + co-topic**, labeled with shared vocabulary. Detects silos (connected components) and bridges (authors crossing them).

**Output:**
```text
🕸  Author Network — semantic collaboration graph
═══════════════════════════════════════════════════════════════
  847 commits  ·  6 authors  ·  9 edges  ·  2 silos  ·  1 bridges

  ◆ Top collaborators (by centrality)
    ████████  alice                 412 commits · 5 edges
    ██████░░  bob                   287 commits · 4 edges

  ◇ Strongest semantic edges
    72%  alice ⟷ bob
         co-edit 81% · co-time 64% · co-topic 71%
         shared: auth, jwt, session

  ⚡ Bridges
    charlie  (connects auth-cluster ⟷ payments-cluster)
```

**Whitespace check:** commercial alternatives we've seen are typically closed-source, paid, and PR-focused. Mneme appears to be the first open-source author-network tool with semantic edges weighted by co-edit + co-time + co-topic.

═══════════════════════════════════════════════════════════════════════════════

## 13 · 👑  Manage — *engineering management dashboard*

**Command:**
```bash
mneme manage
mneme manage --window-days 30
```

**The problem it solves:** an EM/CTO has to glue together team-health, succession, trajectory from many tools. Nothing combines them into one frame.

**What Mneme does:** one dashboard pulls drift + oracle + per-area touches into a single CTO/EM-friendly view: team health composite, succession plan per area, trajectory, action notes.

**Output:**
```text
👑  Manage — engineering management dashboard
═══════════════════════════════════════════════════════════════

  ✦ Team Health
    overall ............. 73%
    trajectory .......... feature (2026-04)
    predicted collisions  3
    max succession risk . 64%

  ✦ Notes
    • 3 predicted collisions in next window — schedule a sync.
    • Highest succession risk: src/payments (primary @charlie, no understudy).

  ◆ Succession plan  (highest risk first)
     64%  src/payments                  primary: @charlie
              ⚠ no understudy detected
     38%  src/auth                      primary: @alice
              understudy: @bob (confidence 67%)
```

**Whitespace check:** No tool combines team-health composite + succession + trajectory + notes in one CLI frame. Most management dashboards live in proprietary SaaS.

═══════════════════════════════════════════════════════════════════════════════

## 14 · 📦  Bundle — *universal codebase export*

**Command:**
```bash
mneme bundle                                  # → mneme-bundle.json + .md
mneme bundle -o release-2026-q2 --format markdown
mneme bundle --top-authors 10
```

**The problem it solves:** you want to share your codebase's full picture with collaborators or attach to release notes. No tool emits a single, shareable artifact.

**What Mneme does:** runs every analysis at once and bundles the results — DNA × top contributors, drift, chronicle, oracle, constellation, clusters, network, manage, ghost — into JSON + Markdown.

**Output:**
```text
📦  Export Bundle — universal codebase artifact
═══════════════════════════════════════════════════════════════

  Generated:    2026-05-05T10:00:00Z
  Mneme:        0.13.0
  Commits:      847
  Authors:      6
  Range:        2024-03-12 → 2026-05-05

  ✦ Sections included
    🧬  5 top-author DNA strands
    📈  drift trajectory across 9 buckets
    📖  chronicle with 6 chapters
    🔮  oracle: 3 collisions, 87 predictions
    🌌  constellation: 247 file-stars
    🧠  23 semantic clusters
    🕸  network: 6 authors, 9 edges
    👑  team health: 73%
    👻  5 ghost files

  ✓ JSON written to mneme-bundle.json
  ✓ Markdown written to mneme-bundle.md
```

**Use cases:**
- Attach to release notes — give downstream teams the full repo picture
- Postmortem dossier — single file capturing the era around an incident
- Investor / acquisition due diligence — codebase reality grounded in commits
- Onboarding — new joiner reads `mneme-bundle.md` and is up to speed

**Whitespace check:** no other tool ships a single shareable artifact this complete.

═══════════════════════════════════════════════════════════════════════════════

## Part IV — Untouchable *(v0.14 · the quality moat)*

## 15 · 🛡  Audit-grade Q&A — *zero-hallucination guarantee*

**Command:**
```bash
mneme ask --audit "why does the webhook handler retry?"
mneme ask --audit --audit-floor high "..."   # tighten the floor
```

**The problem it solves:** AI Q&A tools all *answer*. None *refuse* on principle. When the cost of a wrong answer is a CI gate failing or an agent committing bad code, "best-effort" is the wrong default.

**What Mneme does in audit mode:**

1. **Refuses below confidence floor.** If the retrieval signal isn't strong enough (default floor: medium), Mneme returns a refusal instead of best-effort prose.
2. **Refuses on unverified citations.** Every backtick-quoted commit hash in the LLM's answer is checked against the retrieved evidence (prefix-match, case-insensitive). If *any* hash doesn't match, the answer is refused.
3. **Returns a trust score 0–100%** combining confidence + citation validity, surfaced as a colored badge in the CLI:
   - `◉ TRUST 95%` (green) — high confidence, all citations verified
   - `◉ TRUST 70%` (cyan) — solid extractive answer
   - `◉ TRUST 40%` (yellow) — degraded by unverified citations
   - `◉ TRUST 0%` (red) — refused

**Output (refused case):**

```text
Q  why does the webhook retry?

  ● LOW CONFIDENCE — verify  ◉ TRUST 0%
  ⊘ AUDIT REFUSED

  ✦ Answer
    Audit mode refused this answer. Confidence is "low" (audit floor:
    "medium"). Not enough grounded evidence to commit to a verdict.
    Re-phrase the query, narrow the scope, or run with --no-audit to
    see best-effort prose.
```

**Output (verified case):**

```text
Q  why does the webhook retry?

  ● HIGH CONFIDENCE  ◉ TRUST 95%

  ✦ Answer
    The retry was added in `a3f9b21` after a 2024-08 incident where
    Stripe's API returned 502s and we lost charge events. 3 retries
    with exponential backoff matches Stripe's recommended client
    behavior.
```

**Output (degraded case — LLM cited a hash not in evidence):**

```text
Q  why does the webhook retry?

  ● HIGH CONFIDENCE  ◉ TRUST 60%
  ⚠ HALLUCINATION RISK  cited 1 hash(es) not in evidence: deadbeef
  → re-run with --audit to refuse on unverified citations
```

**Use cases:**

- **CI gate** — fail the pipeline when a security-critical change can't be defended from history
- **Agentic tool result** — when an MCP-aware agent calls `mneme_ask`, returning audit-refused tells the agent to ask a human, not invent
- **Code review** — paste a question into audit mode; if it refuses, the change probably needs more context
- **Compliance** — pair with `mneme ledger` for a tamper-evident audit trail of every refused-vs-answered question

**Whitespace check:** to our knowledge, no shipped AI Q&A tool for git history refuses on principle when the model would hallucinate. Most tools optimize for "always have an answer." Mneme inverts the default for audit-grade callers — refusal is a feature, not a bug.

═══════════════════════════════════════════════════════════════════════════════

## A typical Mneme session — using all 15

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

# End of quarter — frontier moves
mneme cluster                                   # 11 — find what we worked on
mneme network                                   # 12 — see how the team collaborates
mneme manage                                    # 13 — single CTO frame
mneme bundle -o q2-2026                         # 14 — ship the entire artifact
```

═══════════════════════════════════════════════════════════════════════════════

## Why these are unique — capability summary

| Capability | Mneme |
|---|---|
| Narrate file life as eras | ✅ |
| Predict risk from your failure history | ✅ |
| Detect ghost code by score | ✅ |
| **Exportable developer DNA** | ✅ |
| **Topical drift over time** | ✅ |
| **Codebase chronicle** | ✅ |
| **Co-edit prediction** | ✅ |
| **File-star + author-orbital graph** | ✅ |
| **Audit-grade hallucination guard** | ✅ |
| Local-first | ✅ |
| MCP-callable | ✅ |
| Open-source · MIT | ✅ |

Each row above represents capability where, to our knowledge, no maintained, open-source, local-first tool ships an equivalent today.

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Command-Tour]]** — every command, told as a workflow story
- **[[Commands-Tier-1]]** — the eight essential commands
- **[[Recipes]]** — multi-command workflows for real engineering scenarios
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
