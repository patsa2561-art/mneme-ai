# 💰 Pay-per-Token-Saved — Mneme's value-based business model

> The honest version. Every number here is **measured** and **signed**, not a marketing estimate. Mneme charges for value it can *prove* it delivered.

## The problem it prices against

A company running AI coding agents pays the model vendor **per token**. The expensive part isn't the answer — it's the **loop**: an agent re-feeds the model a 2 KB error log + a full diff on every retry, burns hundreds of "thinking" tokens chasing a hallucinated bug, and repeats approaches a past session already proved are dead ends. That waste scales with usage and lands on the API bill.

## What Mneme does (the deterministic, local, measurable process)

Mneme runs **locally** and does the cheap deterministic work *before* the tokens leave your machine:

| Organ | What it cuts | How it's measured |
|---|---|---|
| **DISTILL** | a verbose `{error log + diff}` → the minimal causal **brief** (failure line + changed `file:line` + the known fix) | exact char reduction + a labeled ≈chars/4 token estimate, **per call** |
| **LOOPGUARD** | a detected **thrash** (same failure repeated) — stop retrying, surface the known recovery | objective: same failure-signature ≥N with no success between |
| **NKL** | a **proven dead-end** approach — don't re-walk a trap a past session proved | derived from the absorb ledger; advisory |
| **ACGV verify** | a **hallucination** refuted before it's relayed (tokens not spent on a wrong answer) | a signed verdict (IMPOSSIBLE_REFUTE / BLACK_HOLE / …) |

Each reduction is a measured `(tokensBefore → tokensAfter)` delta. The **Token Treasury** accumulates them into a **signed, append-only ledger**:

```bash
mneme savings                       # measured input tokens saved + per-source breakdown
mneme savings --price-per-1k 0.003  # …as USD at YOUR vendor's input price
```

```
💰 Token Treasury — 405 input tokens saved across 2 events (−91.2%)
   444 → 39 tokens (≈chars/4 estimate)
     distill   405 saved · 2 events
   ≈ $0.001 saved at $0.003/1k input tokens (your supplied price)
   ✓ signed (verify offline with the NOTARY public key)
```

**It fills itself.** `mneme distill` records each reduction automatically — you never log anything. (MCP: `mneme.treasury.report`.)

## Why the number is trustworthy (the honesty contract)

- **Measured, not estimated wisdom.** The ledger stores only the before/after deltas the producing organ actually computed. There is no "wisdom score".
- **The token figure is a *labeled* ≈chars/4 estimate** — a documented heuristic, not a vendor BPE tokenizer. The **ratio** is robust; the absolute is an honest estimate. The **USD** uses a price *you* supply for *your* vendor — Mneme never invents a price.
- **Input-context only.** Mneme measures the input tokens it deterministically removed. It makes **no** claim about the model's internal chain-of-thought.
- **Signed + falsifiable.** The aggregate report carries a NOTARY (Ed25519) receipt; the ledger is append-only. A buyer's finance team can audit the saving offline — the whole point of value-based pricing is that the value is *checkable*.
- **The math is a monoid** (order-independent, batch-safe), proven over a **1,000,000-case** discrete-math sweep in CI (`probe.treasury.monoid_million_case`), so the totals are correct regardless of how events are batched.

## The pricing tiers

| Tier | Who | Price |
|---|---|---|
| **Free (local)** | individual devs | $0 — all local organs + the savings ledger |
| **Pro / Team** | teams who want the federation + dashboards | flat per-seat **or** a small % of *measured, signed* tokens saved — you pick |
| **Enterprise** | orgs running agents at scale | **value-based**: a share of the signed `mneme savings` your fleet actually banked, audited from the ledger |

The enterprise model is the differentiator: **Mneme only earns when it provably saved you money.** The more heavily you run agents, the more it saves, the more it earns — aligned incentives, with a signed ledger as the invoice's source of truth.

— the engine: [`docs/COGNITIVE-LAYER.md`](COGNITIVE-LAYER.md) · every release: [`../CHANGELOG.md`](../CHANGELOG.md)
