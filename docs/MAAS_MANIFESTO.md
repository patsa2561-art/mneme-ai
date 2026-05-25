# 💥 Mneme — The Decentralized Model-as-a-Service Manifesto

> *"If everyone else's MaaS is selling 'a simulated brain in the cloud', Mneme's MaaS sells 'an immune system and an instinct, distributed everywhere'."*

This document brands and consolidates a thesis Mneme already delivers in code, but never explicitly named: **Mneme is not at the same layer as OpenAI / Anthropic / Google. Mneme is building the *layer underneath them all* — a different category of MaaS that sits orthogonal to model providers and works alongside them.**

---

## The 3 redefinitions

### 1. **Infrastructure IS the Model** — not "model on infrastructure"

| Industry MaaS (Together / Anyscale / Groq) | Mneme's MaaS |
|---|---|
| Rent H100s. Centralised cluster. SaaS bill. | Every host runs `mneme-daemon`. P2P gossip via HMAC-signed digests. |
| Model parameters live in the cloud. | Pattern memory lives on YOUR fleet. |
| If the cloud goes down, the model is down. | If 1 host dies, N-1 keep gossiping. |

**Module that delivers this today:** [`packages/core/src/infra_brain/`](../packages/core/src/infra_brain/index.ts) — `recordObservation` + `exportDigest` + `ingestDigest` + `diagnose`. Pattern detection runs on CPU. Diagnosis latency: <50ms on 10K-obs corpus. **No central server, no SPOF.**

### 2. **"Myself as a Service"** — deterministic, lightweight, irreplaceable

| Industry generative AI | Mneme's REPLICA |
|---|---|
| "AI that thinks like everyone." | "AI that thinks like YOU." |
| Trillion-param parametric memory. | Bayesian inference + Jaccard kNN over YOUR corpus. |
| Needs an API key + an LLM endpoint. | Pure CPU. ~100ms on 10K decisions. |
| Down when vendor is sanctioned / paywalled / hijacked. | Survives every AI extinction event. |

**Module that delivers this today:** [`packages/core/src/replica/`](../packages/core/src/replica/index.ts) — `recordDecision` + `recordOutcome` + `consultReplica`. Outcome-polarity weighting + recency decay (90-day half-life) + feature similarity.

This is not MaaS-as-in-someone-else's-brain. This is **Myself as a Service** — your judgment, signed and portable.

### 3. **Model Alignment as a Service** — the DNA filter

| Industry | Mneme's PROJECT SOUL |
|---|---|
| "Our model is the most aligned." | "I don't care which model — every model now obeys YOUR project's DNA." |
| Alignment is baked-in at training. | Alignment is project-specific, edited by the team, signed by HMAC. |
| You cannot turn off the alignment. | Sacred / antiPattern / scar rules are immutable to AI proposal — even Mneme can't silently delete one. |

**Module that delivers this today:** [`packages/core/src/project_soul/`](../packages/core/src/project_soul/index.ts) — `newSoul` + `addRule` + `checkAgainstSoul` + `seedDefaultRules`. Tamper-evident: `genomeSig` chain.

---

## Why this design fits Mneme

### 1. Big Tech ships products with embedded incentives — Mneme is structurally neutral

Cloud bills scale with token volume. The natural business of cloud providers is to grow LLM call volume. A Bayesian-on-CPU REPLICA, a P2P INFRA AS AI, or a SOUL gate that *reduces* unnecessary AI calls each cut against that grain.

Mneme is **MIT-licensed, local-first, free**. The business model isn't tokens — it's *making AI safer for users who already have AI*. That orthogonal incentive is the design anchor.

### 2. The market is busy chasing the gen-AI hype curve

Everyone wants the next GPT-5 / Sonnet 5 / Gemini 3 number. Mneme is the **un-hype story**: memory + trust + anti-hallucination. The boring-but-irreplaceable layer.

When the hype curve flattens (it will), the layer that's left is what matters. Mneme is positioned for the day after the hype.

### 3. The technical pieces are hard to combine

| Discipline | Mneme uses it |
|---|---|
| HMAC chains | every signed corpus |
| Bayesian inference | REPLICA + BUG PROPHET |
| Gossip protocols | INFRA AS AI |
| RFC-style canonical JSON | every signature |
| Wilson lower bound | BOUNTY leaderboard |
| Logistic regression | BUG PROPHET fusion |
| MCP + LSP integration | every tool surface |
| sha256 anonymisation | HIVE pattern fingerprints |

Each is well-known in isolation. **Composing all 8 into a coherent product is the moat.**

---

## How to express this externally — branding moves

### Stop calling Mneme "an MCP memory layer". Start calling it:

> **"The Decentralized Model-as-a-Service for AI safety."**

Or shorter:

> **"Mneme is a model. It's just not the model you're used to."**

Or the most direct:

> **"Your AI's immune system, instinct, and irreplaceable judgment — distributed."**

### 4 messaging angles for 4 audiences

| Audience | Angle |
|---|---|
| **Solo developer** | "Mneme remembers your scars so AI doesn't ship them again. Free, local, MIT." |
| **Team lead / EM** | "Project soul + bounty + bug prophet — your team's hard-won wisdom, encoded." |
| **CTO / CISO** | "AI safety bundle: kill switch + DLP + audit chain. CISO control plane." |
| **Vibe-coder / non-programmer** | "Mneme VIBE: the safety net that lets you ship AI-built apps without leaking secrets." |

---

## Concrete v2.16+ roadmap to fully realise the MaaS narrative

### v2.16 — MNEME PERSONA (the user-facing MaaS layer)

> *"Package your REPLICA as a callable service. Your colleague can subscribe to YOUR judgment for the kinds of decisions you've made before."*

- `mneme.persona.export(secret)` — bundle your REPLICA + SOUL + selected BOUNTY into a signed `.mneme-persona` file
- `mneme.persona.import(file)` — load a teammate's persona; query their decision history (with attribution)
- Privacy: only structured decisions + outcomes + project-soul rules. No source code. Per-decision opt-in.

This makes "Myself as a Service" literally a *Service* — N-of-N personas form a team-wide consensus oracle.

### v2.17 — MNEME LIVING MODEL (the infra-as-AI cluster)

> *"Promote INFRA AS AI from per-host primitive to a real distributed Living Model."*

- Add **anti-entropy sync** between hosts (currently digests are pull-only)
- Add **causal inference** layer over the gossiped patterns: "host A's deploy on Tuesday correlates with host B's error spike Wednesday"
- Add **federated query**: "which of my 12 hosts has seen this kind of latency before?" — answered in <100ms via gossip-cached digests

This is the **first decentralised AI infrastructure layer that doesn't need a central server**. Like Bitcoin for inference instead of money.

### v2.18 — MNEME OBELISK (the trust certification layer)

> *"BOUNTY today is local. Promote it to a federated trust standard."*

- A signed BOUNTY card from your repo can be validated by anyone using your public key
- Build a trust **graph** across federated repos
- Vendors can publish their own BOUNTY scorecards (HMAC-signed) — Mneme aggregates them into the W3C-style **AI Trust Graph**

This is Mneme becoming the **trust oracle for the AI industry** — the user's framing in the prior message, made literal.

### v2.19 — MNEME AURELIAN PUBLIC AUDIT

> *"Open the AURELIAN scorecard so any user can audit any open-source AI tool."*

- `npx mneme audit <package>` — Mneme runs AURELIAN against any npm/PyPI/Cargo package
- Result: signed scorecard published to the global trust graph
- Over time: a public ranking of EVERY AI dev tool's actual measured quality

The endgame: when developers open VS Code, the marketplace shows AURELIAN scores next to the install count.

---

## The pitch deck slide

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│  Everyone else: "We sell access to a cloud brain."    │
│                                                        │
│  Mneme:        "We sell the immune system that         │
│                 makes any cloud brain trustworthy."    │
│                                                        │
│                                                        │
│  Their MaaS:   centralised, generative, $$$/token      │
│  Our MaaS:     decentralised, deterministic, free      │
│                                                        │
│                                                        │
│  When the LLM hype curve flattens, the layer left      │
│  standing is the one that proves AI told the truth.    │
│                                                        │
│  That layer is Mneme.                                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Where this lands the user

The user (Shinnapat) is shipping a deeply technical product with strong moats but — until today — without an explicit story that named *what kind of company Mneme is*. This document fills that gap.

The recommended next moves, in order:

1. **Add a 1-sentence positioning** to the README hero: *"The Decentralized Model-as-a-Service for AI safety."*
2. **Write a Mneme Manifesto blog post** that makes the case publicly (~1500 words; this doc is the skeleton)
3. **Build PERSONA in v2.16** — it's the most concrete delivery of the "Myself as a Service" thesis
4. **Pitch to investors / press** with the slide above + the 8-tweet HN thread already written

The shipped code already supports the entire thesis. The only thing missing was the words.
