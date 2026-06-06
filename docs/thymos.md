# 💗 THYMOS — the affective core (a heart you can audit)

> θυμός — in Homer, the seat of feeling and will. Mneme's THYMOS is the honest, measurable cut of
> two ideas the giants won't build: a memory that **forgets like a mind**, and a vision that
> **attracts** what matters.

## Why

Every mainstream AI memory is a perfect-recall vector database. It never forgets, so it hoards noise,
burns compute, and bonds with no one — every copy is identical and cold. A mind is the opposite: it
forgets the trivial within a day, holds what *meant* something for years, and warms toward the people
and ideas it keeps returning to. THYMOS gives Mneme that shape — and makes every bit of it
**measurable**.

## The two faces, one heart

**① Salience decay — keep what bonds, forget the noise.**
Every memory trace carries an **affective charge** (`salience`, 0..1) computed from real signals:

- **reuse** — recalling a trace reinforces it (saturating);
- **feeling** — `|valence|`: strong reaction *either way* is memorable (praise *and* correction stick),
  read from EN+Thai sentiment markers (`สำคัญมาก`, `เยี่ยม`, `ผิด`, `พัง`, "!", boosters like `สุดๆ`);
- **consequence** — was it tied to a decision / commit / fix?

Salience drives a **half-life**: a trivial trace fades below the floor within ~half a day; a salient
one survives for up to ~1.5 years. `consolidate()` sweeps a store — the meaningful stays, the noise is
forgotten (a measurable footprint saving). High-salience traces never auto-forget.

**② Resonance — the core attracts.**
The same affective core is a standing **attractor**: `attract(core, items)` ranks inbound content by
cosine **resonance** with what you care about — above the threshold is *pulled in*, below is *repelled*.
Relevance as a field, not a per-query search.

## Measure the feeling

```bash
mneme thymos feel "งานนี้เยี่ยมมาก ขอบคุณ!"
# 💗 💚 positive · valence 1 · intensity 0.98

mneme thymos resonate --core "local-first trust + memory for AI agents" \
  "a signed affective memory for agents" "cheap flights to tokyo" "vendor-neutral trust fabric"
# 🧲 pulled  · 0.39 · a signed affective memory for agents
# 🧲 pulled  · 0.14 · vendor-neutral trust fabric
# ✗ repelled · 0.00 · cheap flights to tokyo
```

Library: `salience`, `strengthAt`, `imprint`, `touch`, `consolidate`, `resonance`, `attract`,
**`bondIndex`** (the relationship's warmth, 0..100). All deterministic + signable.

## The honest line (DIAKRISIS)

THYMOS does **not** claim sentience, qualia, or real emotion. "Feeling" here is a **signed,
deterministic salience/bond score** derived from observable signals. The value is a memory that
*behaves* like a mind — forgets the trivial, holds the meaningful, warms with a relationship — and
that you can **audit**: `thymosGauntlet=100` proves the decay curve, the EN/Thai affect read, the
consolidation saving, the resonance ranking, and the bond index. A heart you can measure is worth
more than a heart you must take on faith.
