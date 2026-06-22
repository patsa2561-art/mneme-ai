# 🎗️ VERICERT — the "Verified-by-Mneme" certificate for AI-worker output

> *Everyone builds the AI worker. Nobody certifies the work.* VERICERT is that missing layer.

## The problem (root cause)

The AI-worker wave — DeerFlow, Cursor, Devin, autonomous agent fleets — ships
real output: reports, code, dashboards, slides, summaries. But that output has
**no portable, verifiable proof it was checked.** A business can't hand an
AI-produced deliverable to a client, an auditor, or a regulator without
accountability. The bottleneck is shifting from *production* (AI does that now) to
**trust** — and that's a gap an AI-worker vendor structurally won't fill for
itself (it conflicts with their "just trust the agent" pitch).

## What VERICERT does

Feed it a deliverable. It:

1. **Splits** it into claims (abbreviation-guarded sentence split **+** a
   whole-document pass, so a fault that spans a sentence boundary — e.g. a
   citation torn from its "proves" — is still caught).
2. **Checks every claim** through the Hallucination-Protection Engine (HPE) nerve
   mesh: statistical fallacy ([Greenland 2016](https://doi.org/10.1007/s10654-016-0149-3)) ·
   self-contradiction · overconfidence · fabrication-risk · fabricated-citation ·
   impossible-value · prompt-injection · learned cases · external grounding/consensus.
3. **Emits a certificate** — `CERTIFIED` / `CONDITIONAL` / `REJECTED` — that is
   **tamper-evident** (the body binds to its `certId`) and **Ed25519-signed**, so
   anyone verifies it **offline** with the public key alone.

```bash
mneme certify "Because p > 0.05, the change has no effect. It always works and never fails."
#  🎗️ 🛑 REJECTED  (statistical-fallacy, self-contradiction)

cat report.md | mneme certify -            # certify a whole file → signed cert
mneme certify verify --cert cert.json --deliverable report.md   # verify offline
```

MCP: `mneme.vericert.certify { deliverable }` · `mneme.vericert.verify { cert, deliverable? }`

### The shareable badge

```bash
mneme certify report.md --badge verified.svg     # a "Verified by Mneme" stamp
```

A self-contained SVG (green=CERTIFIED, amber=CONDITIONAL, red=REJECTED) you embed
on a PR, a marketplace listing, or a report. It is **not** a vanity sticker: it
shows the real verdict + score **and** the `certId`, so a viewer verifies the
underlying signed cert offline — a green badge can't lie because the certId binds
the bytes. MCP `mneme.vericert.badge`.

## The guarantee (why anyone would pay)

A verifier you can't trust is worthless, so the bar is **never certify something
hallucinated**:

| Metric | Measured |
|---|---|
| **CERTIFIED-precision** | **1.0** — a deliverable with *any* known fault is never `CERTIFIED` (0 leaks) |
| Verdict accuracy | **≥ 98%** on a labeled corpus |
| Clean recall | ≥ 0.9 — well-calibrated work *does* pass (not everything rejected) |
| Tamper-evidence | altering the cert **or** swapping the deliverable is caught offline |

`vericertGauntlet = 100` (every property above is a falsifiable, re-runnable check).

## The honest ceiling (DIAKRISIS)

`CERTIFIED` means **no *known* fault in any checked claim, plus the engine's
measured precision** — **not** a proof the deliverable is 100% true. A novel
failure that no nerve models can still pass; that's why the verdict is "certified"
(the check happened + the bytes are bound), not "true". This is provenance +
integrity — exactly the property a certificate needs — measured, not asserted.
No quantum hype, no fabricated metric.

## The business case (picks-and-shovels)

Don't compete with the worker builders — **be the trust layer every worker passes
through.** A neutral, **local-first, signed, vendor-neutral** verifier of AI work:

- **Trust Gateway (B2B):** an AI-worker platform / agency wraps its output in a
  Verified-by-Mneme cert its clients trust — per-verification or subscription.
- **Verified vertical:** an AI worker whose output is *certified* in a field where
  being wrong is expensive (research · medical · legal · finance) — "ours is
  verified; theirs hallucinate."

It composes the whole verification stack (truth-gate · SDC · STATGUARD · HPE) +
NOTARY signing — and it's **auto-wired into every agent** that installs Mneme
(MCP + Matrix gRPC + the `mneme.morph` front door).

> Honest note: this is positioning + technology, not a guaranteed revenue machine
> — durable because trust is a recurring need, not a viral spike.
