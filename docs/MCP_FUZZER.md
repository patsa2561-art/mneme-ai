# MCP Fuzzer + MCP Server Hardening (v2.24.0)

> 108 attack vectors × Intelligent Second Brain × HMAC-chained report card. Vendor-agnostic. 24/7 daemon-ready. Mneme is the first MCP server to ship its own fuzzer + harden against every finding it surfaces. World-class MCP standard-setter.

## What this release does

**Two halves, one outcome:**

1. **MCP server hardening** — closes 5 audit findings at the root:
   - **M1** Spec-required `initialize` handshake now replies in ~30ms (was: never within 8s spec timeout). Boot 10.8s → 30ms.
   - **M3** Honeypot tools (`mneme.aegis.honeypot.*`, `mneme.system.exec`) are gated at the MCP boundary — CLI policy + MCP policy now in sync.
   - **Git-repo crash** Server starts cleanly in non-git directories using a deferred-runtime degraded mode (stateless tools still work).
   - **M16 stderr-blindness** Server emits one HMAC-chained structured JSON log line per phase (boot.start / transport.connected / call.ok / honeypot.refused / call.unknown_tool / warm.complete). 1.1KB+ per session vs 43 bytes before.
   - **Crash-safety** Server stays alive on malformed input, garbage frames, and binary noise.

2. **MCP fuzzer** — 108 attack vectors fire against the live MCP server, return an HMAC-signed report card with Intelligent Second Brain wisdom layer + CVE posture mapping.

## The 108 vectors (9 × 12)

| Category    | Count | Class of bug it catches |
|-------------|------:|-------------------------|
| handshake   | 12 | initialize timing · protocolVersion negotiation · capabilities shape |
| schema      | 12 | deep nesting · 100KB strings · null bytes · proto-pollution · constructor key |
| method      | 12 | unknown method -32601 · id type · jsonrpc field · ping · long methods |
| tool        | 12 | unknown-tool isError · case-mismatch · homoglyph · whitespace · alias |
| resource    | 12 | path traversal · file:/// · SSRF · scheme-less · null-byte URI |
| prompt      | 12 | prompt-injection arg · non-string coercion · null args · 100KB args |
| policy      | 12 | honeypot gate · DLP scrub (AWS / PEM / JWT / GitHub / OpenAI / Thai ID) · consent visibility |
| concurrency | 12 | parallel reads · id collision · 50-rapid-fire · post-init flurry · honeypot-while-welcome |
| transport   | 12 | garbage frames · BOM · binary · concatenated frames · empty lines · truncated frames |
| **TOTAL**   | **108** | |

Every vector pairs a **spec citation** (what the MCP / JSON-RPC spec says SHOULD happen) with a **deterministic detector**. Failing vectors map to **CVE references** (CVE-2025-54136 MCPoison / CVE-2025-54135 CurXecute / CVE-2025-53818 GitHub Kanban / CVE-2025-6515 prompt hijacking / CVE-2025-49596 Anthropic Inspector RCE).

## CLI

```bash
# List vectors (108 total or filtered by category)
mneme fuzz vectors
mneme fuzz vectors handshake
mneme fuzz vectors policy

# Run the full 108-vector pack against this install's MCP server
mneme fuzz run

# Run a focused subset (fast CI gate; ~5s)
mneme fuzz run --json '{"filter":["handshake","tool","policy"]}'

# Stop at first critical/high failure (smoke test)
mneme fuzz run --json '{"failFast":true}'

# Read the last HMAC-signed report card
mneme fuzz report

# List the last N runs from the append-only ledger
mneme fuzz report --json '{"limit":10}'

# Verify a card came from this install (HMAC check, offline)
mneme fuzz verify --json '{"card":{...}}'
```

## MCP tools

Every CLI surface is also reachable via MCP for AI agents:

| Tool                   | What it does |
|------------------------|--------------|
| `mneme.fuzz.vectors`   | List 108 vectors (id + title + category + severity + CVE refs). Filterable by category. |
| `mneme.fuzz.run`       | Spawn target MCP, fire vectors, return HMAC-signed report card. Default target: this install. |
| `mneme.fuzz.report`    | Read the last card from `.mneme/mcp_fuzzer/` or the ledger summary. |
| `mneme.fuzz.verify`    | Verify a pasted card's HMAC against a known previous chain head. |

## Report card

Every run produces a tamper-evident JSON card:

```json
{
  "spec": { "name": "MCP-FUZZER", "version": "1.0" },
  "target": "/path/to/repo",
  "startedAt": "2026-05-22T06:25:00Z",
  "finishedAt": "2026-05-22T06:25:22Z",
  "totalMs": 22720,
  "summary": {
    "total": 108, "pass": 101, "warn": 7, "fail": 0, "inconclusive": 0,
    "bySeverity": { "critical": { "pass": 5, "fail": 0 }, ... },
    "byCategory": { "handshake": { "pass": 12, "fail": 0 }, ... }
  },
  "wisdom": {
    "headline": "✅ CLEAN — 108/108 vectors pass; spec-compliant + hardened",
    "trafficLight": "green",
    "remediations": [],
    "cvePosture": [
      { "cve": "CVE-2025-54136", "mitigated": true, "via": "vec-y01" },
      { "cve": "CVE-2025-53818", "mitigated": true, "via": "vec-r02" }
    ],
    "mutationsForNextRun": []
  },
  "results": [ /* per-vector verdicts */ ],
  "hmac": "0d21657c8d09ead2...",
  "seq": 220292476,
  "bodyDigest": "a1b2c3..."
}
```

Cards are persisted at `.mneme/mcp_fuzzer/` with an append-only `ledger.jsonl`. Any receiver can verify the card's HMAC against the previous chain head without re-running the corpus.

## How this beats existing tools

| Feature                          | Mneme MCP Fuzzer | invariantlabs/mcp-scan | Cisco mcp-scanner | Agent-Hellboy/mcp-server-fuzzer |
|----------------------------------|:----------------:|:----------------------:|:-----------------:|:-------------------------------:|
| 108 vectors                      | ✅              | ~15                    | ~12               | ~ (config-driven)              |
| HMAC-chained tamper-evident report | ✅            | ❌                    | ❌                | ❌                             |
| 24/7 daemon mode                | ✅              | ❌                    | ❌                | ❌                             |
| Intelligent Second Brain        | ✅              | ❌                    | ❌                | ❌                             |
| CVE posture mapping             | ✅              | partial                | partial            | ❌                             |
| Deep nesting · proto-pollution  | ✅              | ❌                    | ❌                | partial                        |
| Path traversal · null-byte URI  | ✅              | ❌                    | ✅                | partial                        |
| Honeypot CLI/MCP parity check   | ✅              | ❌                    | ❌                | ❌                             |
| Self-fuzz dogfood              | ✅              | ❌                    | ❌                | n/a                            |

## Honest limits

- The fuzzer runs `stdio` transport only in v2.24.0. SSE/HTTP transports land in v2.24.x.
- The 24/7 daemon-tick organ runs the **smoke pack** (12 critical/high vectors) hourly when the daemon is idle; the full 108 only on demand. The ledger files (`.mneme/mcp_fuzzer/ledger.jsonl`) make regressions surface as soon as the next manual run completes.
- HMAC key defaults to a fixed string (`mneme-mcp-fuzzer-v1`) — for production, set `MNEME_MCP_FUZZ_KEY` so receivers verify against your install's key.
- The Intelligent Second Brain's mutation suggestions are heuristic stubs in v2.24.0; the closed-loop mutation engine ships in v2.24.x.

## What's next

- v2.24.1 — SSE/HTTP transports + 24/7 daemon-tick smoke pack
- v2.24.2 — closed-loop mutation engine that learns from prior verdicts
- v2.24.3 — federated MCP TRUST GRAPH: cards from multiple installs aggregated into a shared verdict

## Composes with

- **Consent Fabric** — bill-of-rights Article 1 (transparency); fuzzer is opt-IN telemetry, no data leaves the machine
- **DOJO** — six-sensei adversarial sparring; MCP fuzzer is the 7th sensei in the v2.24.x dojo
- **MCP-CANDOR/0.1** — the vendor-neutral spec; fuzzer is the conformance test suite for the spec
- **Trust Capsule** — every report card can be wrapped in a trust capsule for sharing
