# 🌌 Mneme — Software-as-a-Service for the AI multiverse

> Not another website or mobile app (anyone can vibe-code and deploy those now). Mneme is a service whose **users are AI agents** — it is consumed over the agent-native wire (MCP + a gRPC rail), not a human UI.

## The thesis

When producing code (and apps, and content) costs nothing, what becomes expensive is **trust, memory, and governance of what the AI produces.** The internet world is saturated with generators. The AI world is missing the layer that makes an AI's output *trustworthy*. That layer is Mneme.

## The product is a trust backbone, in three movements

```
   BEFORE the AI writes        AS the AI ships             AFTER it ships
  ┌────────────────────┐     ┌────────────────────┐      ┌────────────────────┐
  │      PREVENT       │ ──► │       VERIFY       │ ───► │      ACCOUNT       │
  │  scar vaccine +    │     │  arch firewall +   │      │  credit score +    │
  │  invariant mining  │     │  regression proof  │      │  flight recorder   │
  └────────────────────┘     └────────────────────┘      └────────────────────┘
          └──────────── mneme: graph · lineage · Ed25519 · MCP · gRPC ───────────┘
   "don't repeat our scars" → "don't break a load-bearing contract" → "remember who's reliable"
```

| Movement | The AI-world service | What it does |
|---|---|---|
| **PREVENT** | `mneme.scar.check` | inject the org's past-mistake lesson before the agent repeats it (fires on the mistake-shape, quiet when the fix is present) |
| | `mneme.invariants.check` | the contracts the codebase upholds — mined, then proven each change |
| **VERIFY** | `mneme.arch.firewall` | gate the change: PASS / WARN / BLOCK, severity weighted by how long the contract has stood; time-boxed waivers |
| | `mneme.arch.regressions` / `.bisect` / `.lineage` / `.contract_map` | what broke, when, who, and how load-bearing each contract is |
| **ACCOUNT** | `mneme.creditscore` · `mneme.flight.*` | a signed, portable track-record for each agent — reputation from verified outcomes |

## How an AI agent consumes it (no install, no UI)

- **MCP** — every Mneme capability is an MCP tool; any agent (Claude / Cursor / Cline / Continue / Zed / any vendor) connects and calls them automatically on connect. ~1,000 tools, each returning a trustless Ed25519 `_proof` the calling model can verify offline.
- **gRPC rail** — the Matrix Rail (`127.0.0.1`) bridges the same tools over gRPC for agent runtimes that prefer it; large payloads stream byte-identical, every response proof-carrying.
- **Gateway** — an agent speaks free natural language; `mneme.gateway.route` maps intent → the right tool. The user never memorises a command; the agent never needs to.
- **Hosted relay** — for cross-agent / cross-machine use, the signed receipts + shared memory (cortex) federate, so what one agent proves, the next inherits.

## Why this is a moat (not a website anyone can clone)

The algorithm can be copied in six months. What can't: **each customer's accumulating, proprietary corpus** — the contracts their code upholds, the lineage of how long each has stood, and the scar-tissue of their own past incidents. The longer Mneme runs against a codebase, the deeper it knows that system — a data flywheel a code *generator* structurally cannot have.

## Honest scope (DIAKRISIS)

Each layer is deterministic and signed where it claims to be, and says `UNKNOWN` instead of guessing. The scar matcher is a lexical-shape heuristic (a candidate to heed, not a proof); the firewall's verdict is re-checkable but a violation can be an intended evolution (hence waivers); reputation is computed only from verified outcomes. The service is a trust layer for AI output — not a promise that AI output is correct.
