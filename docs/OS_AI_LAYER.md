# The Mneme OS AI Layer Model

> A new textbook for an industry that has none.
> Where TCP/IP sits networks in 7 layers, **AI tooling has no formal layer model.**
> Vendors ship monolithic products and the industry pretends that's the architecture.
> This document defines the missing layers — and shows where Mneme fits.

> *Status: v0 draft, opened for community comment 2026-05-10.*
> *Originally written by Shinnapat Phunsriphatchalakul (mneme-ai maintainer).*
> *We expect the spec to evolve. PRs against `docs/OS_AI_LAYER.md` welcome.*

---

## Why this document exists

The classical OSI model (1984) gave us 7 layers — Physical, Data Link, Network,
Transport, Session, Presentation, Application — and every networking textbook
since refers back to it. The model is *imperfect* (TCP/IP doesn't map cleanly)
but it gave engineers a shared vocabulary. You can say "this is a layer 4 issue"
in a war room and everyone knows what you mean.

AI tooling has nothing equivalent. When a developer is debugging "Cursor
hallucinated a function" or "Claude Code lost context across turns", there's no
layer language to reach for. Vendors collapse the entire stack into "the AI",
which makes diagnosis political instead of technical.

This document proposes **9 layers** for the AI tooling stack — L0 (silicon)
through L8 (governance) — and locates every component of the modern AI dev
experience in exactly one of them.

It is **not** an attempt to standardize. It's an attempt to *open the
conversation*. If you disagree, the layer numbers are intentionally open to
revision (we'll publish v1 only after broad community pushback).

---

## The 9 Layers

```
+-----+--------------------------+-----------------------------------------------+
| L8  | Governance               | ALETHEIA, audit chains, compliance gates       |
+-----+--------------------------+-----------------------------------------------+
| L7  | Wisdom                   | Constitution, regret extraction, decision     |
|     |                          |  provenance, lessons-learned                  |
+-----+--------------------------+-----------------------------------------------+
| L6  | Awareness                | Pulse, hooks, push notifications,             |
|     |                          |  beyond-editor reach (toast/voice/mobile)     |
+-----+--------------------------+-----------------------------------------------+
| L5  | Intent                   | What the user actually wants vs what they     |
|     |                          |  typed; HyDE, query rewriting, intent infer   |
+-----+--------------------------+-----------------------------------------------+
| L4  | Memory                   | Persistent state, lineage, atrophy, inbox,    |
|     |                          |  PRECOG cache, knowledge consolidation        |
+-----+--------------------------+-----------------------------------------------+
| L3  | Tool                     | MCP servers, function calling, plugins,       |
|     |                          |  tool catalogs                                |
+-----+--------------------------+-----------------------------------------------+
| L2  | Inference                | Serving infra, batching, KV cache, attention  |
+-----+--------------------------+-----------------------------------------------+
| L1  | Model                    | The underlying weights -- Claude, GPT, Llama  |
+-----+--------------------------+-----------------------------------------------+
| L0  | Physical                 | Silicon, GPUs, accelerators, datacenter       |
+-----+--------------------------+-----------------------------------------------+
```

**Mneme spans L4 through L8.** Most existing tools (Cursor, Copilot, ChatGPT)
operate at L1-L3 only and have no formal presence above the tool layer.

---

## Layer-by-layer

### L0 — Physical

What the silicon does. GPUs (H100, B200), TPUs, accelerator cards, the
datacenter that hosts them. Owned by the cloud providers (NVIDIA, AWS, GCP,
Azure) and chip designers. **Mneme: nothing here.**

### L1 — Model

The underlying neural network weights and architecture. Claude Opus 4.7,
GPT-5, Llama 4, Qwen, Gemini, Mistral. Owned by the labs (Anthropic, OpenAI,
Meta, etc.). **Mneme: nothing here.** We never touch model weights.

### L2 — Inference

How a model serves a request. KV cache, batching, speculative decoding,
attention kernels, paged attention, vLLM-style serving. Owned by the labs and
serving infra companies (e.g. Together, Fireworks). **Mneme: nothing here.**

### L3 — Tool

The function-calling surface. MCP (Model Context Protocol), OpenAI tool calling,
Claude tool use, Gemini function calling, plugins. Owned by the labs + the
emerging MCP ecosystem. **Mneme operates here as one of many MCP servers** —
but L3 is not where Mneme's value is.

> **Most "AI tooling" today stops at L3.** Vendors ship a model + an
> inference layer + some tool calls and call it a product. Everything above L3
> is an afterthought.

### L4 — Memory

**Where Mneme starts.** Persistent state across sessions, vendors, machines.
This includes:

- **Lineage**: who-did-what-when across AI agents (`mneme.lineage.*`)
- **Atrophy**: which knowledge is fading (`mneme.atrophy.*`)
- **Inbox**: force-push channel for messages the AI must surface (v1.23+)
- **PRECOG**: precognition cache that predicts what the AI will ask next
  (Markov + ACO pheromone + dream loop, v1.26.3+)
- **Genome / chromosomes**: portable wisdom that travels with the user
  (MneMeiosis, v1.19+)

Without an L4, an AI agent has goldfish memory. Every session starts cold.
Every "what did we decide last week?" is unanswerable. Every onboarding is
manual. **L4 is the layer that makes AI agents feel like colleagues instead
of contractors.**

### L5 — Intent

The translation between *what the user typed* and *what they actually want*.
HyDE (hypothetical document embedding), query rewriting, intent classification,
expansion, decomposition. Some labs ship this inside L1; we believe it should be
a separate layer because the same query should mean the same thing regardless
of which model handles it.

Mneme contributes:

- `mneme.dna.search` — 16-strand semantic+syntactic+structural search
- `mneme.smart_do` — intent routing across the tool catalog
- HyDE option in the Retrieval Lab

### L6 — Awareness

**The Apple-Watch-tap layer.** When something happens that the user must know,
how does the system reach them? Awareness is what turns a request-response tool
into a *colleague that walks over to your desk.*

This is genuinely new ground — almost no AI vendor has shipped a real L6.
Mneme's L6 stack:

- **Pulse + hooks** (v1.25.2): every AI client keystroke triggers a Mneme
  status block injected into AI context
- **Notifier fabric** (v1.26.0): OS toast / mobile push (ntfy.sh) / TTS / email /
  agent files
- **Pulse Broadcast** (`mneme nucleus pulse --broadcast`, v1.26.4): pushes the
  same pulse text via every available notifier
- **AUTO-ACTION protocol** (v1.23.5+): pulse can carry an `EXECUTE NOW: tool(...)`
  line that AI agents must run immediately

L6 is what closes the gap between "AI in chat" and "AI in your life". It is
the layer that lets the teacher walk over to the student instead of waiting to
be asked.

### L7 — Wisdom

**Knowledge that compounds across sessions.** Constitution rules, regret
extraction, lessons learned, decision provenance, palimpsest-style historical
context. The layer that turns an AI agent from a stateless calculator into an
organism that gets better with experience.

Mneme L7 surfaces:

- Constitution (`mneme.constitution.get`) — auto-synthesized rules from past
  decisions
- Regret extraction (`mneme.regret.*`) — what we wish we'd done differently
- Decision provenance (`mneme.decision.*`) — why we chose X over Y
- Karma streaks + lifetime achievements
- **Self-modifying NUCLEUS** (`mneme evolve`, v1.26.4): Mneme reads its OWN
  bug reports and proposes patches against itself. The first AI dev tool with
  closed-loop self-improvement from telemetry.

### L8 — Governance

The audit, compliance, and trust layer. Who certified what? When? With what
proof? This is the layer regulators need, that legal needs, that incident
response needs.

Mneme L8 surfaces:

- **ALETHEIA**: open security spec for MCP (designed for OTHER vendors to adopt;
  Mneme is the reference impl)
- HMAC-chained audit log
- TOFU model checksums
- Constitutional Gate
- Court / Confess / Replay
- Mnemiosphere (planned, v1.27): public AI trust globe with anonymized verdicts

---

## Why "AI OS Layer" matters

Today, when a developer says "the AI broke", they could mean any of:

- L1: model weights regressed (vendor's fault)
- L2: inference infra is overloaded (serving issue)
- L3: tool call mis-routed (MCP server bug)
- L4: memory expired (no Mneme installed)
- L5: query was misunderstood (intent layer drift)
- L6: notification didn't fire (awareness gap)
- L7: prior context was lost (no wisdom persistence)
- L8: audit trail can't prove what happened (governance hole)

Without a shared vocabulary, every conversation collapses to "AI is hard". With
it, we can have *engineering conversations*. We can ship fixes to the right
layer. We can measure progress per-layer. We can plan a roadmap that has
shape.

This is why we publish the model now, even rough. **A bad model in public is
infinitely better than a good model in someone's head.**

---

## Mneme's commitment

Mneme will:

1. **Stay out of L0-L3.** We don't compete with model labs or MCP transport
   layers. We integrate with them.
2. **Define and ship L4-L8** as openly as we can. The protocol, the data shapes,
   the algorithms — all in this repo, MIT licensed.
3. **Treat the layers as a contract**, not marketing. If someone else ships a
   better L7 wisdom layer, we'll integrate, not compete.
4. **Update this document** when reality demands. Layers will get refined,
   merged, split. The model serves the engineers — not the other way around.

---

## Phase plan (where Mneme is going)

| Phase | Layer | Deliverable | Status |
|---|---|---|---|
| 0 | L4-L8 | Bug fixes from live AI session (inbox dedup, ack, AUTO-ACTION) | ✅ v1.26.3 |
| 1 | L4 | **PRECOG** -- Markov+ACO+dream-loop precognition cache | ✅ v1.26.3 |
| 1 | L7 | **Self-modifying NUCLEUS** -- proposal engine | ✅ v1.26.4 |
| 1 | L4 | **Genome Pool packager** -- opt-in PII-scrub + bundle | ✅ v1.26.4 (MVP, no upload) |
| 1 | L6 | **Pulse Broadcast** -- pulse via every notifier | ✅ v1.26.4 |
| 2 | L4 | Genome Pool central upload + dedup + search | planned v1.28 |
| 2 | L7 | Self-modifying NUCLEUS PR auto-submit (CI agent integration) | planned v1.28 |
| 3 | L8 | **Mnemiosphere** -- public AI trust globe at aletheia.mneme.dev | planned v1.29 |
| 4 | L8 | **Truth Bonds** -- vendor stakes reputation token; Court verdict pays out | planned v2.0 |
| 5 | L6 | Browser extension (Chrome / Firefox) for L6 reach beyond editor | planned v2.0 |

---

## Acknowledgments

The layer numbering is loosely inspired by the OSI model and the TCP/IP "hourglass".
The "REM-sleep dream consolidation" pattern in PRECOG comes from cognitive
neuroscience (Stickgold + Walker, 2013, *Nature Neuroscience*).
The Lamarckian self-modification idea comes from MneMeiosis chromosomes
(Mneme v1.19, 2026-04).

If this document is useful, the right citation is just:

> S. Phunsriphatchalakul, "The Mneme OS AI Layer Model," github.com/patsa2561-art/mneme-ai/blob/main/docs/OS_AI_LAYER.md, 2026.

---

## Comments / corrections

Open a GitHub Issue tagged `os-ai-layer-model` or PR against this file.
We will include attribution for accepted edits.
