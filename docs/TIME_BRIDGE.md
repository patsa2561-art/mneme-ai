# 🕰 Time Bridge

**Past-you annotates the future; future-you's AI listens automatically.**

The temporal layer every AI agent should run on top of. Without it, AI silently regresses constraints your past self fought hard to make — *"the new code is cleaner so let me remove that guard"* — and you find the regression in production six months later. With it, the AI refuses to bypass past decisions and writes a signed override note when it disagrees.

---

## Why it exists

Every other AI memory layer remembers WHAT happened. Time Bridge remembers WHY + makes the reasoning **structurally unavoidable** when it's relevant:

- `git blame` tells you WHO changed code; not WHY
- ADRs are human-written; rarely read by AI
- Letta / Mem0 remember within a session; not "past-self speaks forward in time"
- LangChain memory is per-conversation; not per-codebase across years

Time Bridge fills the gap with seven composable innovations + an AUTO-corpus property that makes the moat compound the longer you use it.

---

## The seven innovations

| # | Innovation | What it does |
|---|---|---|
| 1 | **Future-Readable Provenance (FRP)** | Decisions carry future-applicability hints — not "I decided X" but "if you touch this in 6 months and {condition}, here's why X mattered." |
| 2 | **Drift-Aware Surface (DAS)** | When past reasoning surfaces, the surface mechanism quantifies how the codebase has drifted since then. Stale constraints get downgraded automatically. |
| 3 | **Constraint Resurrection** | When AI today is about to attempt a pattern past-self refused, Resurrection structurally requires a signed override note. AI cannot silently regress. |
| 4 | **Echo-Chamber Killer** | Today's plan contradicts past-self? Both viewpoints surface; present-self must sign a reversal note for future-self to read. Structured dialogue across time. |
| 5 | **Spotlight Auto-Tuning** | Relevance scoring adapts to which past warnings the user actually heeded vs ignored. The bridge LEARNS what's signal vs noise per user. |
| 6 | **Wake-Word Predicates** | Past-you can leave a wake condition — "wake me when {date} reached" / "when this file is touched" — that fires automatically when the predicate matches. |
| 7 | **Generational Constraint Tree** | Decisions visible as a tree of overrides. AI reads the full evolution of a judgment, not just its current value. |

---

## Quick start

### One-time setup (per repo)

```bash
mneme time-bridge auto-on --author <your-id>
```

This installs a SUPER NOVA observer. Every noteworthy Mneme verb you fire from now on auto-inscribes a row. The corpus grows as a side-effect — no manual effort.

### Record a constraint when it matters

```bash
mneme time-bridge inscribe \
  --author me \
  --kind constraint \
  --headline "never auto-merge bypass polygraph" \
  --reasoning "we had a regression in 2024 when an auto-merge skipped polygraph; the regressed code shipped for 3 days before anyone noticed" \
  --applies-when "any auto-merge / merge-on-green attempt" \
  --keywords "auto-merge,merge-on-green,bypass" \
  --tags "ci,polygraph"
```

Kinds available: `decision` · `refusal` · `constraint` · `warning` · `annotation`.

### Surface past reasoning before an edit

```bash
mneme time-bridge surface --text "I'll enable auto-merge for trusted PRs"
```

Returns ranked matches with drift score + the reasons each one matched. AI agents call this **before every non-trivial edit** to read past constraints as ambient context.

### Block contradictions before they ship

```bash
mneme time-bridge resurrect --plan "enable auto-merge for trusted PRs on green CI"
```

If the plan contradicts a stored constraint (kind = `constraint` or `refusal` with score ≥ 0.5), Resurrection **exits with code 2** and prints the required override text. The AI cannot proceed until it writes a signed override note explaining the reversal.

### Add a wake-word predicate

When inscribing, you can attach a wake predicate that fires automatically:

- `date-reached` — fires when a specific ISO date passes
- `file-touched` — fires when any file matching the pattern is touched
- `symbol-mentioned` — fires when a named symbol appears
- `external` — caller fires it manually with the recorded id

```bash
# Daemon (or CLI on demand) checks predicates:
mneme time-bridge fire-watchers --file src/auth.ts
```

Fired predicates surface their inscriptions into the next pulse with high relevance — the AI sees past-you's wake message in its context window the moment it matters.

### Walk the generational tree

```bash
mneme time-bridge tree --root ins_<id>
```

Shows the full lineage of overrides for a constraint — every override + its reasoning. The AI sees the WHY chain, not just the current value.

---

## Don't memorize the verbs

The AI agent in your editor reads the manifest and recognises natural-language intent. Things you can say instead of typing verbs:

- *"What did past-me decide about auth?"* / *"ดูที่ผมเคยตัดสินใจเรื่อง auth"* → fires `surface`
- *"Check if this contradicts anything I've decided before"* → fires `resurrect`
- *"Remember this for future-me — never auto-merge without polygraph"* → fires `inscribe`
- *"Wake me when anyone touches the auth module"* → fires `inscribe --wakes ...`

---

## How auto-inscription works (the moat)

When `mneme time-bridge auto-on` is active, SUPER NOVA's observer hooks every fire of these Mneme verbs and inscribes a row automatically:

- `mneme.swarm.*`
- `mneme.govtech.*`
- `mneme.cert.mint`
- `mneme.chronicle.*`
- `mneme.apostille.mint`
- `mneme.guardrail.consent.*`
- `mneme.intern.start | graduate`
- `mneme.dream.run`

No manual `inscribe` call. The corpus grows every day you use Mneme. **The API is open; the corpus accumulates with time of use — compounding becomes the durable signal.**

---

## Format longevity commitment

`FORMAT_VERSION = 1`. The on-disk shape of an `Inscription` is committed to remain backwards-compatible for **20+ years**. New fields will be additive; nothing will be removed. Old inscriptions from 2026 will read in 2046.

This is the moat AI vendors cannot match — they pivot too fast.

---

## Storage layout

```
.mneme/time_bridge/
├── inscriptions.jsonl     # the corpus (HMAC-signed)
├── watchers.jsonl         # pending wake predicates  (subset of inscriptions)
├── surfaces.jsonl         # audit log of what was surfaced when
├── overrides.jsonl        # signed reversal notes
├── tuning.json            # per-inscription heeded/ignored counts
└── time_bridge.key        # local HMAC secret (gitignored by default)
```

---

## CLI reference

```
mneme time-bridge auto-on        --author <id>
mneme time-bridge inscribe       --author <id> --kind <k> --headline <text> --reasoning <text> --applies-when <text>
                                 [--files <list>] [--keywords <list>] [--symbols <list>] [--tags <list>] [--parent <id>]
mneme time-bridge surface        [--file <path>] [--text <text>] [--tags <list>] [--threshold <n>] [--top-k <n>]
mneme time-bridge resurrect      --plan <text> [--file <path>]
mneme time-bridge fire-watchers  [--file <path>]
mneme time-bridge tree           --root <inscription-id>
```

All verbs support `--json` for machine-readable output.

---

## Related

- [IA fabric moat doc](./IA_MOAT.md)
- [Digital Talent moats](./DIGITAL_TALENT.md)
- [README](../README.md)
