# The Originals — five world-firsts shipped in v0.36

> Five capabilities that no maintained, open-source, local-first tool ships today.
> Each one runs deterministically by default (no LLM, no network) so the result is reproducible on every machine, in every CI, with no API key.

═══════════════════════════════════════════════════════════════════════════════

## At a glance

| Original | Command | What it answers |
|---|---|---|
| 1️⃣ Karma | `mneme karma` | Who personally owes the most unkept TODOs, age-weighted? |
| 2️⃣ Repo MRI | `mneme repo-mri` | What's *unusual* about this repo vs typical OSS, in one glance? |
| 3️⃣ Counterfactual Palimpsest | `mneme palimpsest --counterfactual` | What did this single line lock in downstream? |
| 4️⃣ Cognitive Twin | `mneme cognitive-twin <email>` | What does Alice's commit-message voice sound like — and how would she rephrase this? |
| 5️⃣ Dual Jury | `mneme conscience --dual-jury` | What's the strongest case *for* and *against* shipping this PR, from real history? |

═══════════════════════════════════════════════════════════════════════════════

## 1️⃣ Karma — TODO debt as a flow

```bash
mneme karma                        # leaderboard + repo-wide top files
mneme karma --author alice@x       # drill into one engineer
mneme karma --since "1 year ago"   # restrict the scan window
mneme karma --json                 # machine-readable
```

### What it does

Walks every commit's diff, extracts every `TODO|FIXME|XXX|HACK` marker added (a debit) and removed (a credit). Keeps an open-balance ledger per author, with each unkept TODO's weight compounding as `log10(1 + ageDays)` — sub-linear so a 1-year-old TODO is ~2.3× worse than a 1-week-old one, not 365× worse.

### Why nobody else ships it

Every static analyzer counts TODOs *at HEAD* ("you have 1,243 TODOs"). None tracks the **flow** — incurred minus settled, per author, with age weighting. The closest analog is the existing `mneme promise` command, but karma is per-author and ages debt explicitly.

### Sample output

```
⚖  Karma
  TODO/FIXME debt as an accumulating ledger — compounds with age

  events     116  (105 incurred · 11 settled)
  open debt  94 TODOs · weighted 23.6

  Most indebted (open TODOs, age-weighted)
  AUTHOR                          OPEN  WEIGHT  FLOW (in/out)
  Shinnapat Phunsriphatchalakul   94    23.6    105/11        ████████████

  Files with the most open debt
   31  packages/core/src/people/promise.test.ts
   17  packages/core/src/insights/ghost.ts
   ...

  Oldest unpaid TODO in the codebase
  ● 8c157b7  [3d old]  MEDITATIONS.md
      HACK: that started it all. Mneme reads the layers.
```

### Honest caveats

- **Heuristic.** Lines move, get reflowed, get partially edited. Mneme matches on `marker + filePath + content` (case-folded, whitespace-normalised) — close edits show as a settle + new incurrence rather than an edit-in-place.
- **Use for self-reflection or a starter conversation.** Never for performance review.

═══════════════════════════════════════════════════════════════════════════════

## 2️⃣ Repo MRI — the one-page diagnostic

```bash
mneme repo-mri                     # 20-axis health scan + z-scores
mneme mri                          # alias
mneme repo-mri --json              # machine-readable
```

### What it does

Computes 20 axes from git data alone — split across **People · Code · Process · Risk** — and z-scores each against canned medians for a typical OSS repo of similar size. Pulls the **three most-unusual axes** to the top so the answer to "what's weird about this repo" fits in one glance.

### The 20 axes

| Group | Axis | Direction |
|---|---|---|
| People | Active authors (90d) | lower = worse |
| People | Bus factor risk | higher = worse |
| People | Author concentration (Gini) | higher = worse |
| People | Karma open debt (TODOs) | higher = worse |
| People | Oldest unpaid TODO age | higher = worse |
| Code | Files in HEAD | higher = worse |
| Code | Lines of code | higher = worse |
| Code | Largest single file | higher = worse |
| Code | Test-file ratio | lower = worse |
| Code | Ghost files (>1y stale) | higher = worse |
| Code | Binary files % | higher = worse |
| Process | Conventional-commit rate | lower = worse |
| Process | Avg commit-subject length | lower = worse |
| Process | Files per commit (p95) | higher = worse |
| Process | Commits per active day | lower = worse |
| Process | Weekend commit % | higher = worse |
| Risk | Regret rate (rapid fix/revert) | higher = worse |
| Risk | Reverts | higher = worse |
| Risk | Largest single commit | higher = worse |
| Risk | Active span | lower = worse |

### Why nobody else ships it

Dashboards show **raw** metrics. None normalize against a population so an outlier reads as an outlier without you having to calibrate by gut. Tools like Sourcegraph and Greptile surface metrics; only Mneme contextualizes them.

### Sample output

```
🩻  Repo MRI

  Three most-unusual axes vs typical OSS:
  ▲  Largest single file        │ +13.1σ │ outlier — likely the thing
  ▲  Bus factor risk            │ +3.8σ  │ outlier — likely the thing
  ▼  Commits per active day     │ -3.5σ  │ outlier — likely a strength

  Health summary: 14/20 axes within 1σ, 4 outliers
```

### Honest caveats

- **Reference medians are heuristic** — starting values, not a peer-reviewed corpus. Future versions can refine these from a public dataset.
- **Higher isn't always worse.** Read each caveat. A repo with low active-author count can be a healthy solo project.

═══════════════════════════════════════════════════════════════════════════════

## 3️⃣ Counterfactual Palimpsest — what did this line lock in?

```bash
mneme palimpsest packages/core/src/auth.ts:47 --counterfactual
mneme palimpsest <file>:<line> --counterfactual --json
```

### What it does

The default `mneme palimpsest <file>:<line>` walks **backward** through the causal chain (incidents → root-cause commits). The counterfactual variant walks **forward**: starting at the line, it finds every downstream commit that touched it (ground truth via `git log -L`), generates heuristic alt-history sketches (negate `===`, flip `return true/false`, invert `if` condition, swap comparison operators), and lists the files that reference the strongest identifier on the line.

### Why nobody else ships it

git blame shows you the past. git log shows you the history. Neither shows you what your **original choice locked in** — the cascade of downstream changes that depended on this line being what it is.

### Sample output

```
🌀  Counterfactual — packages/core/src/auth.ts:47

  Line at HEAD
  │   if (user.role === 'admin') {

  Origin
  ●  a1b2c3d  [2024-08-12]  Alice  feat: introduce admin gate

  Alternate-history sketches (speculative — heuristic inversions)
  ●  negate-equality (=== → !==)  (confidence 90%)
      → if (user.role !== 'admin') {
  ●  negate-if-condition          (confidence 70%)
      → if (!(user.role === 'admin')) {

  Downstream commits that touched this line
  ●  e5f6789  [2024-09-03]  Bob   fix: tighten admin check
      removed: -   if (user.role === 'admin') {
      added:   +   if (user.role === 'admin' && !user.frozen) {

  Files referencing the strongest identifier on this line
    packages/core/src/middleware/authn.ts
    packages/cli/src/commands/admin.ts
```

### Honest caveats

- **Origin + downstream are GROUND TRUTH** — exact git history.
- **Alt-history sketches are HEURISTIC** — pure-text inversions, no compiler. Use them to prompt "what would this break?" thinking; not as a guaranteed equivalence.

═══════════════════════════════════════════════════════════════════════════════

## 4️⃣ Cognitive Twin — the author-voice fingerprint

```bash
mneme cognitive-twin alice@x.com                       # full profile
mneme twin alice@x.com                                 # alias
mneme twin alice@x.com --rewrite "Reorganize auth"     # voice templater
mneme twin alice@x.com --json                          # machine-readable
```

### What it does

Computes a **stylometric fingerprint** of how a contributor writes commit messages — deterministically, no LLM. Surfaces:
- Subject length distribution (avg / p25 / p75)
- Conventional-commit usage % + top 5 prefixes
- Top 8 opening words (after any prefix)
- Top 12 recurring bigram phrases
- Em-dash / colon / paren-scope habits
- Lowercase preference %
- Body-bullet usage + avg body length
- A stable 8-char fingerprint hash

The optional `--rewrite "<subject>"` mode applies the author's three highest-signal habits (dominant prefix, lowercase preference, ending punctuation) to a generic subject so it reads in their voice — clearly marked **✱ shadow-opinion** with a confidence score.

### Why nobody else ships it

Commit-message linters check **format** (conventional-commit shape, max length). None model an individual author's **voice**. Cognitive Twin is the first per-author voice fingerprint that ships in a CLI.

### Sample output

```
🪞  Cognitive Twin — Alice
  stylometric profile (heuristic, no LLM) · 200 commits · fingerprint a4974f70

  Subject length
  avg / p25 / p75    50 chars  ·  35 - 70 (mid-50%)

  Conventional-commit usage
  conv-commit %      80%
  top prefixes:
    feat       100×  (50%)
    fix        40×   (20%)
    docs       20×   (10%)

  Opening words (after any prefix)
  add (60)  ·  refactor (12)  ·  use (8)  ·  drop (6)  ·  rewrite (4)

  Style markers
  em-dash subjects     20%
  ends with period     0%
  paren scope (foo:):  30%
  lowercase content    90%

  Rewrite in voice (✱ shadow-opinion · confidence 78%)
  input:     Reorganize the auth module
  rewritten: feat: reorganize the auth module
  rules:     prepend prefix 'feat:', lowercase first word after prefix
```

### Honest caveats

- **Strictly a profile of habits**, not opinions. The `--rewrite` output is template assembly, **NOT** the author's real position on the change.
- **Use for onboarding** ("match the team's voice"), **continuity** ("what would Alice prefer here?"), and **self-reflection**. Do **NOT** impersonate. Do **NOT** use for performance review.

═══════════════════════════════════════════════════════════════════════════════

## 5️⃣ Dual Jury — adversarial review from real history

```bash
mneme conscience --dual-jury packages/auth.ts packages/middleware/jwt.ts
mneme conscience --dual-jury --diff-file pr-482.diff
git diff main | mneme conscience --dual-jury --stdin
```

### What it does

Takes a set of files about to change and produces **two** arguments pulled from your repo's real history:
- ✗ **Prosecution** — the top 3 precedents where similar changes (same files) caused tracked incidents.
- ✓ **Defense** — the top 3 precedents where the same files shipped clean, no incidents traced back.
- ⚖ **Verdict** — weighted score → `BLOCK` (>0.4) · `CAUTION` (-0.1..0.4) · `CLEAR` (<-0.1).

The verdict is heuristic; **you** are the final judge.

### Why nobody else ships it

Code-review tools give a **single risk score**. Dual Jury surfaces the **strongest counter-argument** explicitly, so the human reviewer can weigh both sides instead of accepting one number. Every precedent shown is a real commit hash that actually shipped.

### Sample output

```
⚖  Conscience — dual jury  (2 files changing)
  Two arguments from your repo's REAL history. The verdict is yours.

  ✗ Prosecution  — precedents where similar changes caused incidents

    ●  a1b2c3d  [2024-08-12]
        feat: tighten admin gate
        → 1 incident followed: INC-1287
        overlap 100% · risk 0.78

  ✓ Defense  — precedents where the same files shipped without incident

    ●  aec5f5c  [2026-05-06]
        feat(v0.18.0): unified UI primitives
        → shipped clean — no incidents traced back
        overlap 100%

  ⚖  Verdict  [CAUTION]
    prosecution strength: 1 case · defense strength: 3 cases · weighted score: -0.10
```

### Honest caveats

- **Prosecution and defense are pulled from REAL history** — every precedent shown actually shipped.
- **Verdict is heuristic.** `CLEAR ≠ safe`; `BLOCK ≠ veto`. Use this as the strongest counter-argument check, not a gate.

═══════════════════════════════════════════════════════════════════════════════

## How they fit together

The Originals ship as five separate commands on purpose — each one answers a *different* fragility-shaped question that no other tool answers today:

- **Karma** — fragility from unkept promises (per author, age-compounded)
- **Repo MRI** — fragility from population outliers (your repo vs everyone else)
- **Counterfactual Palimpsest** — fragility from a single line's downstream lock-in
- **Cognitive Twin** — fragility from a contributor's voice going unrecognised (continuity / handoff / onboarding)
- **Dual Jury** — fragility from one-sided risk scoring (the strongest counter-argument is missing)

═══════════════════════════════════════════════════════════════════════════════

## Related

- 💎 [[The-Frontier]] — the complete table of 28 world-firsts
- 🌟 [[Innovations]] — deep-dive every Mneme command with output samples
- 📐 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR scoring math
- 🧠 [[People-Analytics]] — atrophy / influence / nemesis / bus-factor
- 🛡 [[AI-Session-Audit]] — the existing forensic audit that the Originals build alongside
