# ⚡ Why Mneme exists

> *A short funeral, then a resurrection. Read carefully — these 3 minutes will save you 6 months.*

## 📜 The Funeral of a Lost Decision

```
 ╔═══════════════════════════════════════════════════════════════════════╗
 ║                                                                       ║
 ║    IN MEMORIAM                                                        ║
 ║    ─────────────                                                      ║
 ║                                                                       ║
 ║    Decision #a3f9b21  ·  born 2024-03-14  ·  died 2025-09-07          ║
 ║                                                                       ║
 ║    "Apple Sign-In sometimes returns clock-skewed iat values.          ║
 ║     Tolerate ±5min on JWT verification or production breaks           ║
 ║     during DST transitions in EU regions."                            ║
 ║                                                                       ║
 ║                            — committed by Sirichot, peer-reviewed     ║
 ║                              by 2 humans, mentioned in incident-      ║
 ║                              postmortem #IR-2024-088                  ║
 ║                                                                       ║
 ║    SURVIVED BY: 18 months of green production traffic                 ║
 ║                                                                       ║
 ║    CAUSE OF DEATH: A new dev opened auth.ts in 2025-09-07,            ║
 ║                   their AI assistant said:                            ║
 ║                                                                       ║
 ║                      "This 5-minute tolerance looks too               ║
 ║                       loose. JWTs should be strict.                   ║
 ║                       Let me tighten this for you."                   ║
 ║                                                                       ║
 ║    ATTENDED BY: every customer in the EU at 02:00 UTC                 ║
 ║                  on the next DST transition.                          ║
 ║                                                                       ║
 ║    REPOSE: rolled back at 03:47 UTC after 4,802 failed logins.        ║
 ║                                                                       ║
 ╚═══════════════════════════════════════════════════════════════════════╝

                 The decision didn't die because it was wrong.
                 It died because nobody — neither human nor AI —
                 remembered WHY it was made.
```

## ⚡ Then Mneme arrived

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                                                                     │
 │   👤 dev (2026)                  🤖 their AI                        │
 │     "Tighten this JWT     ──►   reads file,  ──►   🧠 mneme         │
 │      verification."              about to act        ╭─────────╮    │
 │                                       │              │ a3f9b21!│    │
 │                                       │              │ DST!    │    │
 │                                       ▼              │ IR-088! │    │
 │                              "Wait — Mneme says     │ 4,802 fails│  │
 │                               this exact change      ╰────┬────╯    │
 │                               broke prod last year.       │         │
 │                               See commit a3f9b21."  ◄─────┘         │
 │                                       │                             │
 │                                       ▼                             │
 │                              👤 dev: "...thanks. Skipping."         │
 │                                                                     │
 └─────────────────────────────────────────────────────────────────────┘

           The decision lived because Mneme remembered for everyone.
```

## 🧬 The hypothesis Mneme is built on

> Every codebase has a graveyard of decisions like commit a3f9b21.
> Every AI assistant is **brilliant but amnesiac** — it never attended any of those funerals.
> Without memory, AI plausibly suggests resurrecting bugs that were already buried.
>
> **Mneme is the antibody. Memory + awareness + provenance.** Bolted on top of any AI tool, it makes that AI remember every funeral so the team never holds the same one twice.

## What Mneme is

A self-improving memory + awareness layer for AI coding. It sits ON TOP of any model + any MCP client, gives the AI persistent context across sessions, pushes relevant state when something needs attention, and audits every AI action with a signable record.

```
                  ┌─ L8  Governance   audit · constitution · court
                  ├─ L7  Wisdom       regret · evolve · provenance
   Mneme ────────┼─ L6  Awareness    pulse · hooks · push
                  ├─ L5  Intent       HyDE · DNA search · smart_do
                  └─ L4  Memory       lineage · atrophy · PRECOG · genome
                  ─── (above is where Mneme lives) ───
                     L0 – L3          silicon · model · inference · MCP
```

📚 Read first: [Mneme OS AI Layer Model](OS_AI_LAYER.md) — a 9-layer textbook for AI tooling. Mneme is the open reference implementation for layers L4 → L8.

## What we focus on (4 things, only)

| | |
|---|---|
| 🧠 **Memory that survives sessions** | Lineage / atrophy / chromosomes — your AI keeps context between turns, days, vendors. |
| 📡 **Awareness that reaches you** | Pulse + hooks + multi-channel notifier — relevant state shows up unprompted. |
| 🧬 **Wisdom that compounds** | EVOLVE closed loop — Mneme reads its own bug reports, writes verified `.patch` files (HMAC-signed), self-improves. |
| 🛡 **Governance you can audit** | ALETHEIA spec + HMAC-chained provenance + Court verdicts — every AI action signable, replayable, refutable. |

## What's coming next

| | |
|---|---|
| **Genome Pool** | Opt-in cross-user wisdom sharing — every install makes the global brain smarter (PII-scrubbed). |
| **STIGMERGY HIVE** | Emergent dev-collaboration mapping from git traces alone. |
| **Mnemiosphere** | Public AI-trust globe — anonymized verdict counts, vendor-neutral reputation. |
| **Truth Bonds** | Cryptographic reputation staking for AI vendors — economic accountability for hallucination. |

---

← [Back to README](../README.md) · [What you get](WHAT_YOU_GET.md) · [The moat](README_FULL.md#-combined-moat--the-inevitable-flywheel)
