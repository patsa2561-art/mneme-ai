# 📜 Mneme Chronicle

**Agent-Based Modeling with drift-guarded time-dilation. The world's first working ABM runtime that auto-recalibrates agents before the simulation collapses.**

[🇹🇭 ภาษาไทย ↗](./QUICKSTART-th.md#-chronicle-คืออะไร)

---

## What is Chronicle?

Imagine you press fast-forward on 100 little people for a year. Some go bankrupt. Some turn into someone they weren't — a frugal grandma starts buying Lambos in month 7; a low-risk trader bot panic-sells in month 9.

Chronicle is the **CCTV + black-box recorder** of that simulation. It detects out-of-character drift, pulls the agent back toward their birth certificate (gently), and writes the full story in a tamper-proof diary you can read like a report.

Academic Agent-Based Modeling has talked about this for 20 years; nobody shipped a working tool. Chronicle composes primitives Mneme already has (polygraph lenses for drift detection, HMAC-chained ledgers, multi-vendor consensus) into one runtime.

---

## When you'd want this

| You are… | What you'd say to your AI |
|---|---|
| 🎮 A game dev | *"Run my 20 NPCs for 6 months — which one breaks character first?"* |
| 📈 A trading-bot dev | *"Backtest 5 personality types for 2 years — who panic-sells under stress?"* |
| 🧪 Wiring multi-AI systems | *"Stress-test my CrewAI agents for 1 simulated week — will they echo-chamber each other?"* |
| 🏫 Writing a research paper | *"100 agents, 5-year ABM, give me an HMAC-signed event log for peer review."* |
| 💼 A founder | *"100 users with different willingness-to-pay — how does MRR drift over 12 months?"* |

Not doing any of these? **You probably won't need this**, and that's fine. Chronicle ships in the same npm package as your daily Polygraph dots. Pay $0 extra, get it the day you need it.

---

## Quick start

### 1. Write `agents.json`

```json
[
  { "name": "Frugal Grandma",   "personality": { "spending": 0.1, "risk": 0.15, "optimism": 0.5, "agreeableness": 0.6, "energy": 0.7 }, "initialBudget": 1000, "goals": ["save for retirement"] },
  { "name": "Spender Teen",     "personality": { "spending": 0.9, "risk": 0.6,  "optimism": 0.85,"agreeableness": 0.5, "energy": 0.65},"initialBudget": 1000, "goals": ["enjoy life"] },
  { "name": "Risk-Taker Bro",   "personality": { "spending": 0.5, "risk": 0.95, "optimism": 0.7, "agreeableness": 0.4, "energy": 0.8 }, "initialBudget": 1000, "goals": ["10x my money"] }
]
```

### 2. Run the simulation

```bash
mneme abm genesis --config agents.json     # HMAC-signed birth certs
mneme abm simulate --ticks 360             # fast-forward 1 year (30 ticks ≈ 1 month)
mneme abm chronicle                        # final report
```

### 3. Read the report

```
📜 MNEME CHRONICLE — final report

  ticks ran:     360  (1y0m0d)
  agents:        3  (alive=1, died=2)
  anchors fired: 4    ← interventions pulled agents back

  per-agent:
    ✓ Frugal Grandma   budget=  420  drift=0.18  anchors=2  reds=3
    ✗ Spender Teen     budget=-1012  drift=0.10  anchors=0  reds=0   (bankrupt month 7)
    ✗ Risk-Taker Bro   budget=-1146  drift=0.32  anchors=2  reds=11  (bankrupt month 9)

  📖 narrative:
  Spender Teen went bankrupt at month 7 — staying in character but
  outspending income. Risk-Taker Bro drifted hardest (0.32 from birth
  cert) — 11 panic decisions; anchors recalibrated him twice but
  collapse won. Frugal Grandma survived because her drift triggered
  the guardian early.
```

---

## Don't memorize the verbs

You don't have to type `mneme abm` commands. The AI agent in your editor reads Mneme's rules and recognises natural-language asks:

> *"Run my 20 NPCs for 6 months — which one breaks character first?"*
> *"simulate 100 traders for 1 year"*
> *"ABM ดริฟต์"*
> *"fast-forward this population by N months"*
> → fires `genesis → simulate → chronicle` for you, then explains the report in plain English.

---

## The 5 pillars

| Pillar | What it does |
|---|---|
| **GENESIS** | HMAC-signed birth certificate with a 5-axis personality vector (`spending` · `risk` · `optimism` · `agreeableness` · `energy`, each ∈ [0,1]) + budget + goals. The cert is the immutable anchor. |
| **TICK** | Template-driven decision engine (no LLM call — pure JS, deterministic). Each agent makes ONE decision per tick weighted by their CURRENT personality + a small drift inducer (6% splurge / 4% panic-sell). |
| **DRIFT DETECTOR** | Every decision runs through Polygraph lenses against the birth cert. Out-of-character actions → RED verdict + axis-mismatch reason. |
| **ANCHOR POINT** | Every N ticks (default 30 — "monthly"), if max-axis drift > threshold (default 0.30), AUTO-RECALIBRATE: blend currentPersonality 30% / birthCert 70%. HMAC-signed intervention recorded. |
| **CHRONICLE** | Final HMAC-witnessed report: per-agent drift score, anchor count, hallucination cascades (2+ agents drifting together), plain-English narrative. |

---

## Why this is research-grade

- **HMAC-signed audit trail.** Every birth cert + intervention is signed; reviewers can't claim you faked results. `.mneme/abm/events.jsonl` is tamper-evident.
- **Ollama-free.** No LLM call during simulation. Decisions are pure JS — cheap, fast, reproducible.
- **Reset + replay.** `mneme abm reset` wipes the local state for a clean re-run.

---

## CLI reference

```
mneme abm genesis  --config agents.json [--anchor-every N] [--drift-threshold 0.0..1.0]
mneme abm simulate [--ticks N]              # default 30
mneme abm tick                              # single-step
mneme abm chronicle                         # final report + narrative
mneme abm reset                             # wipe .mneme/abm/
```

Add `--json` to any verb for machine-readable output.

---

## Related

- [Mneme README](../README.md)
- [Quickstart (EN)](./QUICKSTART.md) · [Quickstart (TH)](./QUICKSTART-th.md)
- [Polygraph guide](./POLYGRAPH.md) — the drift detector that scores every Chronicle decision
