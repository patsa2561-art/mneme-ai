# The Holy Grails (v0.43)

> Three world-firsts that the v0.40-v0.42 architecture (Periodic Table → Compiler → Second Brain) made feasible.  Each is unique in the maintained-OSS-code-analysis space; each is *built on* primitives the periodic table catalogues, not bolted on next to them.

═══════════════════════════════════════════════════════════════════════════════

## 💓 `mneme heartbeat` — codebase as living being

```bash
mneme heartbeat                # take a pulse + compare to rolling baseline
mneme heartbeat --json         # for Slack / email / cron
```

Treats the repo as a patient under continuous observation. Each tick:

1. Takes a pulse (the 20-axis MRI snapshot from v0.36 `repo-mri`).
2. Compares against the rolling baseline (mean ± stdev from the last 7 days of pulses).
3. Emits any axis whose z-score exceeds 2σ as a "pulse anomaly".
4. Persists the snapshot for tomorrow's baseline.

**Why this is novel:** every existing health tool computes metrics REACTIVELY ("here's the state when you ran me"). Heartbeat computes them PROACTIVELY ("here's what changed since yesterday, and which change is statistically significant"). The persistence at `.mneme/heartbeat.json` (capped at 90 pulses) means the longer you run it, the more meaningful the baseline becomes.

**Cron pattern:**
```cron
0 9 * * *  cd /path/to/repo && mneme heartbeat --json | post-to-slack.sh
```

**Verdicts:**
- `ALL QUIET` — every axis within 1σ of its rolling mean
- `WATCHING` — at least one axis ≥ 1σ but none ≥ 2σ
- `ALARMING` — at least one axis ≥ 2σ from its rolling mean (exit code 1 — CI-friendly)

═══════════════════════════════════════════════════════════════════════════════

## ⏮ `mneme rewind <ref>` — time-travel debug

```bash
mneme rewind <hash>            # reconstruct the working context of a commit
mneme rewind HEAD~3            # ref forms accepted: hashes, tags, HEAD~N
mneme rewind <hash> --json
```

Materialises the "psychological snapshot" of what the author was likely working through when they made a single commit. Combines four signals:

1. **Cognitive-twin voice profile** of the author (already exists in v0.36).
2. **Surrounding commits** by the same author (5 before, 5 after) — was this part of a sustained push or a one-off?
3. **Time-of-day + day-of-week fingerprint** in the author's local TZ (extracted from the ISO offset).
4. **Subject + body tonality** (short imperative / long explanatory / sandwich-mode "WIP, fix attempt, trying to").

Plus: did the next commit on HEAD revert this one? Big blast radius vs surgical? Subject length deviation from the author's usual?

**Honest framing:** this is not "what Alice was thinking" (we can't know). It's "what an outside observer would reasonably infer about the working context". The output prefixes every speculative line with ✱ — facts (commit metadata, surrounding commits, tz offset) are not prefixed.

**Why this is novel:** git blame shows you *who*. git log shows you *what*. Neither tells you *what kind of work session it was*. Rewind composes the cognitive-twin voice (a v0.36 Original) with temporal signals to fill that gap.

═══════════════════════════════════════════════════════════════════════════════

## 🧬 `mneme dna-fold` — team-DNA emerges from individuals

```bash
mneme dna-fold                                 # top 8 contributors auto
mneme dna-fold --top 5
mneme dna-fold --email alice@x bob@y carol@z
mneme dna-fold --json
```

Per-person DNA already exists (`mneme dna`, `mneme cognitive-twin`). dna-fold computes the EMERGENT properties when you stack those individuals into a team:

| Verdict per feature | Meaning |
|---|---|
| **consensus** | low coefficient of variation — team aligned (everyone uses long subjects, etc.) |
| **polarised** | CV ≥ 0.6 with no single outlier — the team has split into camps |
| **outliered** | exactly one author ≥ 2σ from the mean — diversification, not necessarily a defect |

The features folded today: avg subject length, conv-commit usage %, lowercase content %, em-dash %, ends-with-period %, paren-scope %, body-bullet usage %, avg body lines.

**Why this is novel:** team-level voice analysis is something tools can do *on a team's writing*, but no maintained code-analysis tool computes the **fold** of per-author profiles into a team-shaped emergent DNA. The categorical verdict (consensus / polarised / outliered) is what makes it usable for retros + onboarding + hiring fit.

**Use cases:**
- **Onboarding** — "the team writes long bodies with bullet lists; match it"
- **Hiring fit** — candidates whose voice profile clashes with the team's consensus features may chafe
- **Retros** — "we've polarised on conv-commit usage" is a real conversation starter

═══════════════════════════════════════════════════════════════════════════════

## What was deferred (honest scope)

Originally proposed:

| Holy Grail | v0.43 | Reason for deferral |
|---|---|---|
| `mneme heartbeat` | ✅ shipped | — |
| `mneme rewind <commit>` | ✅ shipped | — |
| `mneme dna-fold` | ✅ shipped | — |
| `mneme adversarial-twin --evil` | deferred | Generates fake commits in team voice — needs careful UX (sandbox, opt-in) and a CTF runner. Lands in v0.44. |
| `mneme self-aware` | deferred | Mneme reads its own code, finds bugs in itself — needs a permission model so it doesn't auto-commit to its own repo. Lands in v0.44. |

═══════════════════════════════════════════════════════════════════════════════

## How they all stack on the v0.40-v0.42 work

```
heartbeat     ←  built on:   computeMri + persistent .mneme/heartbeat.json
                              → SECOND-BRAIN PATTERN (pulses-as-library)

rewind        ←  built on:   git.log (HPC v0.39) + twin.profile (v0.36 Originals)
                              → COMPOSITION PATTERN (chemistry metaphor)

dna-fold      ←  built on:   twin.profile × N authors  (parallel via concurrency.pmap)
                              → AGGREGATION PATTERN (atom × atom × atom = molecule)
```

Every Holy Grail composes pieces that were already in the periodic table. That's the proof the architecture works: new capabilities cost an order of magnitude less code to ship.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧪 [[Periodic-Table]] — the v0.40 catalog
- 🔧 [[Compose-And-Compiler]] — the v0.41 planner
- 🧠 [[Second-Brain]] — the v0.42 library + executor
- 💎 [[The-Frontier]] — the broader Mneme world-firsts
- 🆕 [[Originals]] — the v0.36 Originals (cognitive-twin lives here)
