# 👥 People analytics — what GitHub cannot see

> *Six new commands that surface the patterns hiding underneath your contributors view.*

═══════════════════════════════════════════════════════════════════════════════

## The four dark corners

GitHub and GitLab show **explicit** collaboration: who committed, who reviewed, who replied. But team behavior runs on **implicit** signals their UI cannot capture:

| Dark corner | Why git platforms can't see it |
|---|---|
| 🧠 **Latent collaboration** — Alice edits X then Bob edits Y within 48h, again, again | No commit links them → they show up as strangers on the network graph |
| ⏳ **Knowledge atrophy** — Alice last touched auth.ts 18 months ago; her recall is decayed | "Last touched" is shallow timestamp; real knowledge has a half-life |
| 👑 **Cultural influence** — Alice's `Result<T,E>` pattern propagated to 47 files via 8 adopters | Contributors view counts commits, not pattern adoption |
| 📜 **Promise debt** — "I'll fix this later" from 6 months ago, was it kept? | Commit / PR text is free-form, never indexed for verification |

Mneme computes all four from the data already in your local git log + HTC compressed cache. **No data leaves the machine.** No LLM is needed for the math; LLMs only enrich plain-English narration.

═══════════════════════════════════════════════════════════════════════════════

## Six commands, one PDF

### 1. `mneme telepathy` — invisible teams

> *"Who pairs without realizing they pair?"*

Finds author pairs whose work is **behaviorally coupled** even though they never co-authored a commit. Alice edits `payments/`, then within 48h Bob edits `billing/` — repeated, rhythmic, statistically loud.

```bash
mneme telepathy                   # top 10 invisible pairs
mneme telepathy --window 72       # widen the window
mneme telepathy --author alice@   # pairs containing Alice
mneme telepathy --json            # machine-readable
```

**Sample output:**

```
📰 Telepathy · 3 invisible teams found
✦ Top latent pair
  alice@bank.com  ↔  bob@bank.com   score 2.4
    12 telepathic events · last seen 3 days ago
    most-shared topic: src/payments/ + src/billing/
```

**Use it when:** *Alice + Bob both quit next quarter — what's the blast radius? They might be a team you never knew you had.*

### 2. `mneme atrophy` — knowledge half-life clock

> *"Who still remembers what?"*

Models the Ebbinghaus forgetting curve over (author × file) pairs. Alice last touched `auth.ts` 18 months ago — her recall there has decayed to ~40%. Defaults to 180-day half-life; tunable.

```bash
mneme atrophy                     # repo-wide heatmap
mneme atrophy alice@bank.com      # one author's knowledge map
mneme atrophy --file src/auth.ts  # who still knows this file?
mneme atrophy --half-life 90      # tighter decay (active codebase)
```

**Sample output:**

```
✦ Repo knowledge heatmap — 8 critical files at risk
  files with a live expert:    94 / 289   (33% — someone still remembers)
  ghost code (deep history lost): 4         (≥2 historical touches, expert decayed)

⚠ Knowledge-risk files
  WARN  src/auth/jwt.ts        top knower 41% fresh — needs review
  WARN  src/billing/invoice.ts top knower 38% fresh — needs review
```

**Use it when:** *Before refactoring auth, who needs to re-read it? Before vacation handoff, what does Alice still own that no one else can pick up?*

### 3. `mneme nemesis` — engineering friction (with care)

> *"Where's the architectural friction in this team?"*

Pairs whose commits consistently rewrite or revert each other's. Three signals: explicit reverts, ≥50% line overlap rewrites, fix-keyword commits on the other person's recent file.

```bash
mneme nemesis                       # top 5 friction pairs
mneme nemesis --window 180          # last 6 months only
mneme nemesis --author dave@        # pairs containing Dave
```

**Defamation-safe by design.** Output explicitly labels findings as "engineering friction (style / architecture)" — never as personal conflict, hostility, or performance evidence. The `📘 How to read` block is mandatory and visible on every report.

**Use it when:** *Before forming a sub-team — don't put structural-disagreement pairs on the same surface.*

### 4. `mneme promise` — the commit-message debt ledger

> *"What did we promise to come back to and never did?"*

Scans every commit + PR body for promise patterns: `"I'll fix this"`, `"TODO: refactor"`, `"follow-up coming"`, `"will address in next sprint"`. Matches against subsequent commits. Anything unfulfilled past 90 days is `stale`.

```bash
mneme promise                      # repo-wide ledger
mneme promise --status stale       # only stale ones
mneme promise --author bob@        # one person's promise debt
```

**Sample output:**

```
📜 47 open promises — 12 stale (oldest 14 months)
  WORST OFFENDER  bob@team.com   8 promises · 0 follow-ups in 6 months
  TOP STALE       d23f214 by alice@   "TODO: refactor parseAmount" (412d ago)
```

Honest framing: this is heuristic. *"I'll fix this"* might be irony; we mark high-confidence patterns only and label everything as a starting list, not a verdict.

**Use it when:** *Quarterly tech-debt review — turn invisible commit-message promises into a tracked list.*

### 5. `mneme influence` — cultural alphas (PageRank for code patterns)

> *"Whose code patterns are people copying?"*

Extracts function shapes (signature + first 3 lines normalized) from current HEAD. Finds the **originator** of each unique shape (earliest commit). For each later commit that introduces the shape in a different file, attributes adoption to that author. Runs PageRank on the directed `originator → adopter` graph.

```bash
mneme influence                    # ranked cultural alphas
mneme influence --author alice@    # her originated patterns + who adopted
mneme influence --pattern-min-uses 5  # only patterns adopted ≥5×
```

**Sample output:**

```
👑 Cultural alpha: alice@bank.com
   PageRank #1   ·   47 adoptions of her patterns by 8 others
   Top originated: Result<T,E>  (35 adoptions)
                  retryWithBackoff  (8 adoptions)
                  enrich(...)  (4 adoptions)
```

Volume-independent: a 5-commit pattern-setter outranks a 500-commit copy-paster. **TS/JS only in v1** — labeled with a HEADS UP if your repo has other languages.

**Use it when:** *Promotion review. Bob ships volume; Alice shapes how everyone writes. Different signals, both important.*

### 6. `mneme lineage <target>` — semantic ownership

> *"Whose interpretation of whose intent currently lives in this code?"*

`git blame` says who wrote line N. `mneme lineage` walks the commit chain forward, distributing **semantic ownership** based on intent continuity. A 5-line refactor that changed the entire model owns more semantically than a 500-line stylistic pass.

```bash
mneme lineage src/payments/checkout.ts
mneme lineage README.md --depth 30
mneme lineage packages/core/src/store/index.ts --json
```

**Sample output:**

```
🌳 src/payments/checkout.ts
   70% Alice (design)  +  20% Bob (refactor)  +  10% Carol (extension)
   Narrative: Alice's design as interpreted by Bob's refactor,
              then preserved through Carol's extension.

   Timeline:
     ● abc1234  Alice — first design                 100% Alice
     ● def5678  Bob — major rewrite (intent 0.40)    60% Alice + 40% Bob
     ● 9876fed  Carol — extension (intent 0.85)      ...
```

When HTC abstracts are not built, falls back to commit-message similarity (with a HEADS UP). For best results, run `mneme htc-build` first.

**Use it when:** *Before refactoring a critical function — who semantically owns it now? Don't assume `git blame`.*

═══════════════════════════════════════════════════════════════════════════════

## The flagship — `mneme nervous-system`

The PDF a CTO prints. Combines **passport** of top contributors + **telepathy** heatmap + **atrophy** heatmap + **influence** ladder + repo neuroanatomy + an honest limits panel.

→ **[Mneme Nervous System →](Mneme-Nervous-System)**

═══════════════════════════════════════════════════════════════════════════════

## Privacy posture

- **All data is computed locally.** Mneme reads your `.git/` directory + its own SQLite cache. Nothing is sent to any server.
- **`passport` opt-in friction:** `--include-friction` is default OFF. The nemesis section requires explicit opt-in.
- **No grading of humans.** These commands surface patterns. They are starting points for a conversation, not verdicts. Every output ships with an honest-limits panel explaining what the heuristic does and does not prove.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧬 [[Mneme-Nervous-System]] — the flagship PDF report
- 📚 [[Command-Tour]] — every command in plain English
- 🔬 [[Forensic-Code-Science]] — the same anomaly engine, applied to commits
- 📦 [[Hierarchical-Memory]] — the compressed cache that lineage reads
