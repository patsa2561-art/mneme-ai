# 🧠 Mneme as Intelligent Assistant — the Experience Layer for AI Agents

**The painpoint AI has but pretends it doesn't**: AI knows a lot, but it has no **experience**. It has never lived through a production incident, never managed a team for 3 years, never made the same mistake twice and felt the burn. So it gives technically-correct answers that miss the real-world context an experienced engineer would have caught.

Mneme is the **shared experience layer** that closes that gap. Every AI agent — Claude Code, Cursor, Cline, Continue, Codex, Gemini, Antigravity 2.0 subagents, GovTech AI Transformation systems — can plug into Mneme and **borrow the experience of every other AI agent and human that came before**.

---

## What "Intelligent Assistant" means here

Most products sell "AI assistant" = chatbot. We mean something different: **a fabric the AI agent runs on top of, that gives it experience it didn't have**.

The IA fabric has 4 layers:

| Layer | What it does | Mneme primitive that delivers it |
|---|---|---|
| **Witness** | Observe every AI verb fired in realtime | SUPER NOVA WRAPPER (v2.19.97) |
| **Remember** | Persist what worked, what failed, who decided what | Memory chain + HMAC-signed soul + retrievable index |
| **Predict** | Surface relevant past experience before the AI acts | Pheromone trail + Bug Prophet + Replica consult |
| **Refuse** | Block actions that match scarred patterns | SOUL · Whistleblower · Polygraph · Honesty Gate |

A new AI agent that connects to Mneme inherits all four. That's the moat.

---

## Why this is a moat, not a feature

1. **Network effect**: every AI agent that connects adds experience for the next. A solo dev's mistake becomes a hint for someone they've never met. The pool grows with adoption.
2. **Cross-vendor reach**: a Claude Code agent's experience is available to a Cursor agent on the same repo. Switching costs evaporate; lock-in shifts from vendor to fabric.
3. **Local-first by default**: every experience row lives in `.mneme/super_nova/experience.jsonl` in the user's repo. No cloud account, no signup, no data extraction. Federation is opt-in.
4. **HMAC audit chain**: every row is signable. GovTech-grade compliance comes free.
5. **The SUPER NOVA WRAPPER is single-fabric**: one middleware to add per verb, instant observability + experience-pool write. Other observability layers require N integrations.

---

## Fit: Antigravity 2.0 (93 subagents in parallel)

Google's Antigravity 2.0 demo: 93 AI subagents, 12 hours runtime, 15K+ model requests, 2.6B tokens. The hard problem: **who watches the watchmen when 93 agents work in parallel?**

Mneme answers each of those questions today, with existing primitives:

| Antigravity 2.0 challenge | Mneme primitive |
|---|---|
| Cross-agent coordination (93 subagents must not duplicate work) | Pheromone trail (touch counters per file × vendor) + Hive pattern lookup |
| Shared memory for the swarm | Colony broadcast + Soul chain per repo |
| Per-subagent honesty audit | Polygraph drift (test-vs-prod comparison) + Bounty Wilson-LB scorecard |
| Cascade failure detection (when 2+ subagents drift together) | CHRONICLE hallucination_cascade event (v2.19.93) |
| Audit trail for the whole 12-hour run | SUPER NOVA experience pool + HMAC-chained pulse ledger |
| Rollback evidence when the run goes wrong | APOSTILLE proof artifacts + git provenance via Blame |

**Positioning**: "Mneme is the audit + coordination fabric your Antigravity 2.0 swarm needs but Google didn't ship."

---

## Fit: GovTech Singapore AI Transformation

Public-sector AI transformation requires (per the GovTech reference talk):

- Audit-grade evidence for every AI decision
- Compliance with public-data regulations (DLP, PII redaction)
- Rollback proof for every irreversible action
- Multi-vendor consensus for high-stakes calls
- Per-citizen consent chain

| GovTech requirement | Mneme primitive |
|---|---|
| Audit-grade evidence | SUPER NOVA experience pool (HMAC-signed rows) |
| DLP / PII redaction | `mneme.compliance.dlp` (v2.14) — 9 built-in patterns + custom rules |
| Rollback proof | `mneme.apostille.*` proof artifacts |
| Multi-vendor consensus | `mneme.court.rule` + AI Jury (v2.19.88) |
| Per-citizen consent | `mneme.guardrail.consent.issue` (v1.67) |
| Court-admissible audit log | `mneme.compliance.audit` (v2.14) |

**Positioning**: "Mneme is the audit + compliance fabric a GovTech-style transformation can drop in without writing a single bespoke audit pipeline."

---

## The wild idea this composition unlocks

**APOPTOSIS-AS-A-SERVICE for AI patterns.**

Background: in biology, *apoptosis* is programmed cell death — a cell that becomes harmful (mutated, infected, no longer useful) triggers its own destruction so the organism survives. We already have `mneme.retirement.detect` (v1.65) which fires 7 oracles against an AI claim and returns HEALTHY / INFLAMED / NECROTIC / **APOPTOTIC**.

The wild move: extend apoptosis from *claims* to *patterns*.

When the Mneme experience pool sees that a specific code/decision pattern has now failed in **N independent repos across M vendors over T weeks**, Mneme stops being polite about it. The pattern is marked APOPTOTIC and:

1. Every AI agent connected to Mneme that *attempts* the pattern receives an immediate `REFUSE` verdict from `mneme.soul.check`.
2. The refusal carries a signed lineage: "747 repos tried this, 681 hit a specific failure, here's the lineage."
3. The pattern is auto-vaccinated into the antivirus bank — future variants refute in 0 ms via simhash.
4. A **counter-pattern survives** that Mneme can suggest in its place — extracted from the 66 repos where the pattern was attempted and the engineers found a workaround.

This is the closing loop: AI doesn't just remember mistakes, **the swarm collectively refuses to make them again.** It's an immune system for AI-written code.

**Why this composition is durable**:
- Requires cross-repo experience pool (Mneme has it accumulated)
- Requires HMAC-signed audit chain (Mneme has APOSTILLE + soul chain)
- Requires multi-vendor reach (Mneme reaches Claude/GPT/Gemini/Cursor/Cline/Continue/Codex/Antigravity 2.0)
- Requires refuse-at-source primitive (Mneme has SOUL + Whistleblower + Polygraph + Antivirus vaccines)
- Requires consent + privacy substrate (Mneme is local-first; federation opt-in)

A new competitor would need 18-24 months to build all five and reach the network-effect inflection point. By then Mneme has already onboarded the open-source AI-tooling community.

**Codename**: APOPTOSIS NETWORK. Ships in v2.20.x after Mneme has accumulated ~1000 cross-repo experience rows.

---

## What ships in v2.19.97 toward this vision

- ✅ SUPER NOVA WRAPPER (`packages/core/src/super_nova/`) — the witness fabric primitive
- ✅ Experience pool at `.mneme/super_nova/experience.jsonl` per repo
- ✅ Observer registry (any subsystem can plug in)
- ✅ Failure-class taxonomy (auto-classification of errors into named categories)
- ✅ SUPERLOCK + DEV-SOURCE GUARD — kills the race-condition bug class that broke the user's install

What comes next:
- v2.19.98+: federate experience rows (opt-in) → cross-repo pool
- v2.20.x: APOPTOSIS NETWORK — refuse-at-source on patterns proven dead
- v2.21.x: Antigravity 2.0 / GovTech preset bundles

---

## The README repositioning

Mneme's current README pitches "Truth Suite + Polygraph + Chronicle + Clone." That's accurate but tactical. The real positioning is one level up:

> **Mneme — the Intelligent Assistant fabric every AI agent runs on top of.**
> Memory that lasts. Experience that compounds. Truth you can verify.

The features (Polygraph, Chronicle, Clone, Pulse, Soul, etc) are the **deliverables**. The IA fabric is the **product**. v2.19.97 onward, README emphasises the fabric, then lists features as proof points.

---

## Related

- [SUPER NOVA WRAPPER source](../packages/core/src/super_nova/index.ts)
- [SUPERLOCK + dev-source guard source](../packages/core/src/superlock/index.ts)
- [README](../README.md)
- [TRUST gate (verify-self)](./TRUST.md)
