# 🧬 The Mneme Nervous System

> *The single PDF a CTO prints, frames, and pins above their desk.*

═══════════════════════════════════════════════════════════════════════════════

## What it is

`mneme nervous-system` produces **one report** that combines everything Mneme knows about your team's invisible patterns:

- **Top-N passports** — engineer dossiers (DNA + expertise + telepathic teammates + influence + atrophy) for the people who matter most.
- **Telepathy heatmap** — author × author matrix shaded by latent-collaboration strength. Find the teams nobody documented.
- **Atrophy heatmap** — top critical files × who still remembers them. Color = freshness; gaps = ghost code.
- **Influence ladder** — PageRank of cultural alphas with their pattern-spread evidence.
- **Repo neuroanatomy** — codebase clustered into "lobes" (auth · billing · ingest · platform · …) with each lobe's top knower, atrophy state, and influence concentration.
- **Honest limits panel** — every claim's caveat in one final page. King-of-king ≠ infallible.

═══════════════════════════════════════════════════════════════════════════════

## Run it

```bash
# Terminal summary (always works, no extra deps)
mneme nervous-system

# Beautiful self-contained HTML (works in every browser; print-to-PDF if you want)
mneme nervous-system --html .mneme/nervous.html

# Pro PDF (requires puppeteer-core)
mneme nervous-system --pdf .mneme/nervous.pdf
```

Common flags:

```bash
--top-people <n>     # contributors to feature in passports (default 5)
--top-files <n>      # critical files to analyze in atrophy heatmap (default 30)
--json               # machine-readable; pipe into your own tooling
```

═══════════════════════════════════════════════════════════════════════════════

## What the HTML looks like

A multi-page report styled for **A4 print**. Every page has the μνήμη wordmark + page number + generation date. CSS Grid layout, system-font stack (renders identically on every OS), inline SVG charts (no external JavaScript), purple + green palette.

**Cover page**

> *The Nervous System of `<repo-name>`*<br/>
> Four hero metrics with sparklines: total commits indexed · cultural alphas detected · invisible teams · critical files at knowledge risk

**Section 1 — Cultural alphas**

PageRank ladder. For each top-N alpha:
- Their PageRank score (volume-independent)
- Originated patterns + adoption count
- Sparkline of their adoption trajectory over time
- Top 3 patterns with adopter list

**Section 2 — Invisible teams (telepathy)**

Heatmap matrix: rows + columns = top-N contributors, cells shaded by telepathy score. Below the matrix, an annotated list of the top 5 pairs with one-sentence narrative for each: *"Alice + Bob — 12 events in 6 months · most-shared topic: payments + billing"*.

**Section 3 — Knowledge atrophy heatmap**

Top 30 critical files (ranked by total touches × recency) × top-N authors. Each cell shaded by knowledge_score (0..1 scale). Two callouts: **at-risk files** (high importance × no live expert) and **ghost code** (≥2 historical touches, all decayed).

**Section 4 — Engineer passports**

One mini-passport per top-N contributor. Each passport includes:
- DNA fingerprint (commit hours · file affinity · style markers)
- Expertise map (top 12 files they currently know best)
- Latent collaborators (their telepathic teammates)
- Cultural footprint (PageRank + originated patterns)
- Promise ledger (open / kept / stale counts)
- Voice fingerprint (top 10 phrases vs team baseline)
- Atrophy clock (top 5 domains they used to know)

**Section 5 — Repo neuroanatomy**

The codebase split into "brain lobes" (clusters by directory or HTC topic). For each lobe: top knower · atrophy state · cultural concentration · representative recent commit.

**Section 6 — Honest limits**

What this report can and cannot tell you. Examples:
- *"Influence is TS/JS only — non-TS/JS files weren't analyzed."*
- *"Telepathy needs ≥2 distinct authors to find pairs."*
- *"Atrophy uses a single half-life (default 180 days); active codebases may want shorter."*
- *"This report is a starting list, not a verdict. Findings are heuristic."*

═══════════════════════════════════════════════════════════════════════════════

## When to use it

| Scenario | What the report tells you |
|---|---|
| 🌍 **Quarterly board meeting** | One PDF that shows team health beyond commit count |
| 🚪 **Senior engineer just resigned** | Atrophy heatmap → "what knowledge is at risk?" |
| 🔄 **Reorganizing teams** | Telepathy + nemesis → "which pairs to keep / split" |
| 🎓 **Promotion review** | Influence + DNA + voice → cultural impact alongside volume |
| 📦 **Acquihire / due diligence** | Passports of the top-5 contributors of the target repo |
| 🛠 **Pre-refactor planning** | Atrophy of the target file → who to invite to the design review |
| 📋 **Sox / SOC2 compliance prep** | PDF artifact + ledger of all knowledge holders |

═══════════════════════════════════════════════════════════════════════════════

## PDF rendering — how the optional path works

**HTML always works.** `--html <path>` writes a self-contained `.html` file (every CSS rule inline, every image as base64 SVG). Open it in any browser; it renders identically on macOS, Windows, Linux. Print-to-PDF works in every browser without extra software.

**PDF is opt-in.** `--pdf <path>` lazy-loads `puppeteer-core` and headless Chromium. If puppeteer-core is not installed, you get a friendly message:

```
PDF output requires puppeteer-core. Install with:
  npm install -g puppeteer-core

Or open the HTML in your browser and print-to-PDF (works in every browser).
HTML report has been written to: .mneme/nervous.html
```

The HTML is always written first. The PDF step is genuinely optional — you don't need it.

═══════════════════════════════════════════════════════════════════════════════

## Privacy posture

- **All data is local.** Mneme reads your `.git/` + SQLite cache. Nothing is sent to any server.
- **`--include-friction` opt-in.** Default OFF. Nemesis section never appears unless you explicitly opt in. When on, the section header explicitly labels findings as "engineering friction (style / architecture)" — not personal conflict, hostility, or performance.
- **No grading of humans.** These reports surface patterns. They are starting points for a conversation, not verdicts.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 👥 [[People-Analytics]] — the six commands `nervous-system` composes
- 📚 [[Command-Tour]] — every Mneme command in plain English
- 🔬 [[Forensic-Code-Science]] — the same forensic engine on individual commits
- 📰 [[Speculative-Reasoning]] — Leviathan verifier behind lineage's intent-continuity
- 📦 [[Hierarchical-Memory]] — the HTC cache that lineage reads
