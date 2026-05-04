<div align="center">

# Wild Ideas

*Fifteen things nobody else is doing. Some are shipped. Some are sketches.*

```
   The world's best devtools were never on the roadmap.
   They were obvious in retrospect.
```

</div>

---

This file is a working notebook. Some ideas are already in `main`; some are weeks away; some may never ship. The point is to keep the *bar* visible: Mneme is not a "memory layer for AI assistants" — it is the thing that turns git history into **the central nervous system of an engineering organization**.

The number after each idea is its scoping pessimism: 1 = ships next sprint, 5 = a research project.

---

## Status snapshot (v0.5.0)

| # | Command | Status |
|---|---|---|
| 1 | `mneme heal` | ✅ shipped (v0.4) |
| 2 | `mneme echo` | ✅ shipped (v0.5) |
| 3 | `mneme ledger` | ✅ shipped (v0.5) — hash-chained audit log |
| 4 | `mneme oracle` | 🚧 design only |
| 5 | `mneme palimpsest` | ✅ shipped (v0.5) |
| 6 | `mneme conscience` | ✅ shipped (v0.6) |
| 7 | `mneme prophecy` | 🔬 research |
| 8 | `mneme constellation` | 🔬 research (needs hosted) |
| 9 | `mneme genome` | 🚧 design only |
| 10 | `mneme fossil` | ✅ shipped (v0.5) |
| 11 | `mneme dialogue` | 🚧 design only |
| 12 | `mneme rumor` | ✅ shipped (v0.5) |
| 13 | `mneme mirror` | ✅ shipped (v0.5) |
| 14 | `mneme runaway` | ✅ shipped (v0.5) |
| 15 | `mneme tribute` | 🚧 design only |

**Nine of fifteen ideas are now real working CLI commands.** The four marked 🚧 print thoughtful design pages when invoked — not lorem-ipsum stubs. Two are research-grade (need ML models or hosted infrastructure). Plus two bonus ideas shipped beyond the original list: ⭐ `mneme teach` and ⭐ `mneme adapt` (the mutant detector).

---

## 1. `mneme heal` — turn garbage commits into queryable memory ✅ **shipped**

The single most-stated weakness of any "git memory" tool is *"my commit messages are bad."* `mneme heal` reads the actual diff and asks an LLM (Ollama by default — local + free) to synthesize a 2-4 sentence WHY. Originals are never modified. Synthesized notes are stored separately, marked as such, and searched alongside real context.

**The reframe:** *"Bad commit messages? We synthesize the missing memory from the diff."* Weakness becomes a feature in the demo.

Pessimism: ✅ already in v0.4.0.

---

## 2. `mneme echo` — "this incident looks like one from 14 months ago" — 2

When a new incident lands in Sentry, Mneme searches the historical incident corpus + their resolution commits. *"INC-9421 today is 92 % similar to INC-2024-08, which was resolved by PR #482."*

Saves the postmortem. Beats every on-call's first hour of forensics. Sells itself to fintech.

---

## 3. `mneme ledger` — audit-grade provenance for regulated industries — 2

Banks, exchanges, hospitals — anyone regulated — need to prove *"who changed what, why, who approved it, what ticket it linked to, what test passed."* Mneme already has all of this. `mneme ledger --since 2025-01-01 --format sox` exports a tamper-evident audit log.

This is the feature that makes financial institutions buy the team plan. Not because they need AI memory. Because they need compliance.

---

## 4. `mneme oracle` — historical risk analysis on a snippet — 3

Paste any function or commit diff. Mneme finds:
1. Past incidents in this codebase rooted in similar patterns
2. Past commits whose diff fingerprint matches and what *they* triggered
3. A risk score for shipping this exact change

> *"This `db.query(${user_input})` pattern caused SQLi-2023-04. Three other PRs that shipped this pattern were reverted within 24h."*

Security ROI in one screen.

---

## 5. `mneme palimpsest` — the causal chain of a single line — 3

Hover any line of code. Mneme renders the full ancestry:

```
line 47 of payment.ts:
  added by    a1b2c3d   PR #482  fix Stripe BigInt
  prompted by INC-1287  webhook 500
  caused by   PR #98 (introduce idempotency) bug
  reverted by PR #142 (rollback after another regression)
  approved by alice + bob + claudia
  reviewed in 2024-08-14 release planning
```

The most beautiful demo Mneme can give. Insanely shareable.

---

## 6. `mneme conscience` — review co-pilot from history — 2

When reviewing a PR, Mneme finds the historically *most-similar* PRs to it and reports their fate.

> *"This PR changes 4 of the same files as PR #98 (reverted within 48 h after INC-1287). 87 % file overlap. Recommend caution."*

Becomes a GitHub Action check. Becomes a Cursor side-panel. Becomes the thing senior engineers wish they had.

---

## 7. `mneme prophecy` — predict which PRs will cause incidents — 4

Train a small model on the org's own (PR, incident-within-48h) pairs. Score every new PR. Block merge or warn reviewers when the score is high.

This is the closest Mneme will ever get to "AI for engineering." Not generic — specific to *your* codebase's failure modes.

---

## 8. `mneme constellation` — anonymized cross-org benchmarks — 4

Opt-in: each org sends *anonymized fingerprints* (no code, just structural shape — entity counts, history depth, churn rate). The constellation gives every member percentile rankings:

> *"Your codebase is in the 73rd percentile for stability, 12th for documentation depth."*

The more orgs join, the more valuable the benchmark — a network effect that's hard to replicate.

---

## 9. `mneme genome` — codebase fingerprint + ancestry — 4

A cryptographic signature derived from code + history. Detect forks, plagiarism, abandoned ancestor branches.

> *"This proprietary repo shares 87 % genome with public repo `acme/foo`. Likely forked at commit a1b2c3d on 2023-09-12."*

License violation detection. Acquisition due diligence. M&A research tool.

---

## 10. `mneme fossil` — recover meaning from deleted code — 3

Code that was deleted is gone from HEAD but lives in git history. Mneme reconstructs what each deleted block was *doing* and *why*.

> *"This module was deleted 2 years ago. Its purpose was X. The code that replaced it (Y) is missing capability Z. You may want this."*

Saves teams from re-implementing things they already had and threw away.

---

## 11. `mneme dialogue` — conversational memory over your repo — 2

Persistent multi-turn chat. State across queries.

```
> what broke last quarter?
   3 incidents: INC-1287, INC-2025-04, GH-Actions-failure-03

> show me the rollbacks
   2 reverts: PR #501, PR #523. Both within 36 h of incident.

> who reviewed those?
   alice@ approved both. consider asking her about Q4 patterns.
```

Just a thin wrapper over MCP, but the UX is what makes it usable.

---

## 12. `mneme rumor` — gossip detection — 2

Reads commit + PR text for *tribal knowledge that should be docs*.

> *"12 PRs mention 'the Stripe weirdness' but no doc explains it. Suggest: create `docs/stripe-quirks.md`."*

Fights the bus factor at its source. Combine with `mneme heal` and the org's institutional memory becomes self-organizing.

---

## 13. `mneme mirror` — onboarding dossier — 1

For a new engineer:

```
> mneme mirror --for-role backend-engineer

  5 PRs to read first  (highest impact + best explained)
  3 people to talk to  (highest knowledge concentration)
  2 incidents to know about (most-cited in code comments)
  10-line system summary (synthesized from architecture docs)
```

Beats traditional onboarding wikis because it self-updates.

---

## 14. `mneme runaway` — detect runaway abstractions — 2

Tracks complexity per entity over commits. Surfaces functions that grew quietly out of control.

> *"`PaymentService.charge()` has gained 5 parameters and 200 lines over 18 months across 14 commits. It is now in the 99th percentile of file-local complexity. Consider redesigning."*

Becomes the monthly engineering-leadership report nobody had to write.

---

## 15. `mneme tribute` — "your codebase as a movie" — 3

A 60-second auto-generated montage of a codebase's life.

```
   [d3 animation]
   • initial commit (lone dot)
   • module emerges       (cluster)
   • first incident       (red flash)
   • redesign             (cluster reorganizes)
   • bus-factor moment    (single contributor leaves)
   • current state        (full graph)
```

Designed to be shared on Twitter when an engineer leaves a codebase, when a project crosses 5 years, when a startup gets acquired. Free marketing for Mneme; emotional value for the team.

---

## How to read this file

These are not promises. Some will be wrong-headed. Some will be obvious six months from now.

What matters is the *direction*: Mneme is not a "fancy git log." It is a substrate that turns codebases into legible objects. Every idea here is downstream of that single bet.

If one of these ideas hits and you want to build it — open an issue, pick a number, start drafting. The contracts in `@mneme-ai/core` are designed so the next 14 features can plug in without breaking the first.

```bash
mneme wisdom
# → today's meditation, in case you need a reminder why we're doing any of this
```
