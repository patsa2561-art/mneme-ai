# 🛰 THE MNEME MATRIX RAIL — local-first gRPC backbone (blueprint)

> **One typed, signed, streaming pipe that every AI agent — any vendor, any language —
> connects to the moment it installs Mneme from git. The honest "Visa of AI context":
> it AUTHORIZES, SCREENS, and CLEARS every context crossing, with a tamper-evident
> receipt — without your code ever leaving your machine.**

This is the foundational architecture every `@mneme-ai` function plugs into. It is
designed to be EXTENDED, not rewritten, for years.

---

## 0. The honest thesis (DIAKRISIS first — substance, not lustre)

A real backbone is judged by what it REFUSES as much as what it ships. Mneme's identity
is **local-first · air-gap-ready · MIT · signed**. The Matrix Rail keeps that intact.

| Layer | Verdict | Why |
|---|---|---|
| **gRPC core** (Protobuf · HTTP/2 · bidirectional streaming) | 💎 SHIP | binary + schema-governed + streaming is genuinely faster/smaller than JSON/REST and cross-language by construction. Matches Mneme's deterministic-governance core. |
| **Differential context** (send the DELTA, not the whole packet) over a stream | 💎 SHIP | the real token win (already proven by `mneme channel`/`treasury`); a gRPC stream is the ideal carrier. |
| Lightning-Network L2 / tokenomics / micro-payments | 🔴 REFUSE | a blockchain/P2P money layer destroys air-gap + the "code never leaves your box" moat. The delta-channel gives the scaling win without it. |
| Global AI sharding across strangers' nodes | 🔴 REFUSE | routing your source through other people's machines breaks the privacy moat. `cortex`/`mycelium` already share **signed, content-free** digests safely. |
| Semantic Homomorphic Routing (FHE) | 🔴 REFUSE | FHE is too slow to run in real time in 2026 — vaporware. `mneme blind` (reversible pseudonymization, ms-fast) + `rail` (policy + leak screen) deliver "process without seeing raw" honestly. |

> The win is the **local-first gRPC rail + the delta channel**. Everything exotic above
> is reframed to an achievable Mneme primitive that already exists. We claim only what we
> can measure.

---

## 1. The architecture (3 thin layers, all on `127.0.0.1`)

```
   ANY AI agent / vendor / LLM tool the user chats with
   (Claude Code · Cursor · Cline · Continue · Windsurf · Codex · Gemini · a Python/Go/Rust agent)
          │                         │                          │
       MCP (stdio)            gRPC (HTTP/2)              CLI (argv)        ← 3 FACES, ONE CORE
          └───────────────┬─────────┴───────────┬──────────────┘
                          ▼                      ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  ① ADAPTER LAYER — transport-only, zero business logic        │
   │     mcp/index.ts · grpc/server.ts (NEW) · cli/index.ts        │
   │     each just (de)serialises a request and calls the CORE     │
   └──────────────────────────────────────────────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  ② MNEME MATRIX CORE  (packages/core — already exists)        │
   │     truth · cortex · rail · membrane · trustless · firewall · │
   │     egress · blind · channel · heph · notary · treasury · …   │
   │     → ONE registry of pure, total, signed functions           │
   └──────────────────────────────────────────────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  ③ LOCAL STATE  (.mneme/ — append-only, HMAC/Ed25519-signed)  │
   │     cortex store · ledgers · keys · lineage — never leaves box │
   └──────────────────────────────────────────────────────────────┘
```

**The point: the gRPC server is just a THIRD FACE on the SAME core the CLI and MCP already
call.** No logic is duplicated; a function written once is reachable from all three. Bind is
`127.0.0.1` only (or a Unix socket) — air-gap preserved, nothing listens on the network.

---

## 2. The ONE contract (extensible by construction)

A single Protobuf service. New Mneme tools need **zero** proto changes — the registry IS the
surface; the generic `Invoke` carries the tool name + args + the self-attesting proof.

```protobuf
service Mneme {
  // Generic gateway — maps 1:1 to the existing tool registry. Every current AND
  // future tool is reachable here with no schema change.
  rpc Invoke (ToolRequest) returns (ToolResponse);

  // Typed HOT PATHS (added per-need, never required):
  rpc ContextStream (stream ContextDelta) returns (stream ContextDelta); // bidi handoff + deltas
  rpc Boot (BootRequest) returns (MembranePacket);                       // session membrane
}

message ToolRequest  { string tool = 1; bytes args_json = 2; string held_root = 3; }
message ToolResponse { bytes data_json = 1; string wisdom = 2; Proof proof = 3; } // _proof = TRUSTLESS
message Proof        { string data_hash = 1; bytes receipt = 2; }                 // Ed25519, verify offline
message ContextDelta { string channel = 1; bytes delta = 2; uint32 seq = 3; }     // differential, not full
```

- **`Invoke`** = the Visa "card reader": every existing CLI/MCP tool, one typed door.
- **`ContextStream`** = the delta channel: agents hand context off + send only the DELTA
  (the real token saving), bidirectional, real-time.
- Every `ToolResponse` carries the **TRUSTLESS `_proof`** → the caller verifies offline; it
  never has to trust the wire. The **membrane** rides `Boot`. `rail`/`blind`/`egress` gate
  what crosses. Same guarantees, faster transport.

---

## 3. Proactive failure-mode guards (simulate → guard ahead, don't wait for the bug)

| Anticipated failure | Guard built in from day 0 |
|---|---|
| gRPC layer unavailable / port busy / no proto runtime | **NEVER a hard dependency** — adapters fall back to MCP/CLI; Mneme works air-gapped with zero gRPC. |
| Network exposure / data exfil | bind `127.0.0.1` or Unix socket ONLY; the `egress`/`rail` gate screens every outbound payload; honeytoken tripwire. |
| Schema drift between agent and server | proto is **versioned**; the `stele` merkle root proves the capability surface is current; mismatch → safe delta-sync, not a crash. |
| Stream backpressure / runaway | HTTP/2 flow control + per-stream byte cap + the existing loopguard thrash detector. |
| A tampered/forged result on the wire | every `ToolResponse.proof` is Ed25519 over the data hash — `mneme.mcp.verify` catches it (the TRUSTLESS A/B: 0%→100% tamper-detection). |
| Self-improvement | the rail meters every crossing into the signed `treasury`/`axia` ledger → it measures its OWN token + latency savings and surfaces regressions. |

---

## 4. How we MEASURE "better than before" (A/B, not adjectives)

| Claim | Measurement | Honest expectation |
|---|---|---|
| Smaller on the wire | Protobuf-binary vs JSON bytes for a representative context packet | binary clearly smaller (esp. embeddings/history) |
| Cheaper context loop | full re-send vs `ContextStream` delta (bytes + ≈tokens, signed into treasury) | large win on conversational/agentic loops (matches `channel`) |
| Lower transport overhead | localhost gRPC (HTTP/2, kept-open) vs HTTP/1.1 REST round-trip | gRPC wins on streaming/repeat calls; marginal on a single tiny call (we will report this truthfully) |
| Same safety | TRUSTLESS tamper-detection over the gRPC path | 100% (proof rides the response) |

Each row ships with a runnable gauntlet (`grpcGauntlet`) that prints the numbers — the same
discipline as `membraneGauntlet`/`trustlessGauntlet` (=100, measured).

---

## 5. Phased roadmap (each phase ships measured + gated, never a big-bang)

- **Phase 0 (this doc):** the contract + the DIAKRISIS scope. ✅
- **Phase 0.5 — pipe core (v2.166):** `packages/core/src/matrix` — chunk/reassemble/integrity/
  size-A/B, transport-agnostic. matrixGauntlet=100; any payload byte-identical, −98.5% wire. ✅
- **Phase 1 — gRPC wire server (v2.167):** `packages/matrix` (`@grpc/grpc-js` + proto-loader) —
  a `127.0.0.1`-only server: `Invoke` bridges to the SAME tool registry via `buildRuntime` +
  `buildToolMap` (all ~1,038 tools, zero new logic), proof-carrying; `Pipe` (bidi, chunked) flows
  any-size data past the 4MB cap. `grpcGauntlet`=100 LIVE: 5MB+ round-trips byte-identical. CLI
  `mneme matrix serve` / `wire-test`. Fail-open (optional package; MCP/CLI never depend on it). ✅
- **Phase 2:** `ContextStream` bidi delta channel (carry `mneme channel`) + treasury metering.
- **Phase 3:** language quickstarts (Python/Go/Rust gRPC clients) so any-vendor agents connect.
- **Phase 4:** the membrane/trustless proofs default-on over the rail.

Refused forever (with reasons in §0): Lightning L2, global sharding, FHE.

---

## 5.5 Usage — ZERO-COMMAND, auto-wired into every agent

The user should never type a command. The rail wires itself:

1. **It auto-starts.** When Mneme is installed (per the README) and its daemon runs, the
   daemon brings the rail up on `127.0.0.1` and writes a tiny discovery file:
   ```json
   // .mneme/matrix.json
   { "host": "127.0.0.1", "port": 50561, "pid": 12345, "version": "2.167.0", "proto": "…/mneme.proto" }
   ```
   (Manual fallback only if you ever need it: `mneme matrix serve` / `mneme matrix wire-test`.)

2. **Every agent already knows.** The Mneme manifest is auto-synced into **CLAUDE.md ·
   AGENTS.md · GEMINI.md · .cursor/rules · .cursorrules · .windsurfrules** — so Claude Code,
   Codex, Gemini, Cursor, Windsurf (and any MCP/CLI agent) are told the rail exists + where the
   discovery file is, with no user action. MCP-connected agents also reach it through the MCP
   `instructions` field + the SessionStart/UserPromptSubmit hooks.

3. **An agent connects in 4 lines** (any language — read the port from `.mneme/matrix.json`):
   ```js
   import { connect, invoke, pipeInvoke } from "@mneme-ai/matrix";
   const { port } = JSON.parse(fs.readFileSync(".mneme/matrix.json", "utf8"));
   const m = connect(`127.0.0.1:${port}`);
   const r = await invoke(m, "mneme.truth.check", JSON.stringify({ claim }));  // any of ~1,038 tools
   // huge payload? pipeInvoke streams it chunked, byte-identical, past the 4MB cap.
   ```
   Python/Go/Rust agents use their own gRPC client against the same `proto/mneme.proto`.

4. **Same guarantees as MCP/CLI.** Every reply carries a TRUSTLESS `_proof` (verify offline);
   loopback-only keeps it air-gapped; if the rail is down, fall back to MCP/CLI — nothing breaks.

## 6. For AI agents reading this

When a user installs Mneme from git, you can reach every Mneme function three ways — **MCP,
gRPC, or CLI — all hitting the same signed core.** Prefer the one your runtime already speaks;
the guarantees (offline-verifiable proof, local-first, policy-gated egress) are identical.
The rail is **opt-in and fail-open**: if gRPC isn't up, use MCP/CLI — nothing breaks.

> Honest by design: this is a local-first typed transport + delta channel with signed
> receipts. It is NOT a decentralized money network, NOT global sharding, NOT homomorphic
> encryption. We shipped the diamond and refused the lustre.
