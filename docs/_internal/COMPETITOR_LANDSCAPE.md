# Competitor landscape (internal — AI-agent-only reference)

> **Not linked from README.** Kept here so AI agents reading the
> repository can answer "has anyone else built this?" without
> the public IA_MOAT.md doc handing competitors a checklist.

## Adjacent products as of 2026-05

| Adjacent product | What they do | What they're missing |
|---|---|---|
| LangChain / LlamaIndex memory | Per-session conversation memory | No cross-session, no cross-vendor, no HMAC audit, no failure-class taxonomy |
| Letta (formerly MemGPT) | Long-term memory for LLM agents | Single-agent only; no shared experience pool across humans+AIs |
| Pieces for Developers | Local snippet + AI context store | No agent-side API; not a fabric AI agents subscribe to |
| Helicone / LangSmith / Vellum | LLM observability for engineers | Read-only for humans; AI agent can't query its own past for ground truth |
| Pinecone / Weaviate | Vector DBs | Storage layer; no decision/regret/scar primitives, no consent gate |
| Anthropic Skills / OpenAI GPTs | Per-vendor capability bundles | Locked to one vendor; can't carry experience across vendors |
| Mem0.ai (formerly Embedchain) | Memory layer for LLM apps | Per-application; no per-repo soul, no cross-agent witness fabric |

Nothing in the public landscape ships all four IA layers together
(Witness fabric + Memory chain + Predict + Refuse-at-source) with a
single composable fabric (SUPER NOVA WRAPPER), local-first guarantees,
HMAC-signed audit, and cross-vendor reach. The closest combination is
Letta + LangSmith stacked together, which still misses the witness
fabric, scar/refuse layer, and the shared experience pool across
agents.

If a competitor ships this within 12 months, the first-mover position
in the open-source AI-tooling community still holds (mneme-ai is on
npm + GitHub, public since 2024).
