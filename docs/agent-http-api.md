# 🌐 The Agent Governance HTTP API — Mneme for any vendor (no MCP required)

Run the endpoint:

```bash
mneme gephyra serve --port 17742       # local, or on your droplet behind a TLS proxy
```

Every route is `POST`, takes/returns JSON, and wraps its result in a **trustless `_proof`** (an
Ed25519 receipt over the SHA-256 of the response) so the calling vendor — **xAI / Grok / OpenAI /
Gemini / Cursor / a local agent** — verifies it **offline** instead of trusting Mneme.

| Route | Body | Returns |
|---|---|---|
| `POST /agent/gate` | `{ tool, args?, agent?, policy? }` | `{ decision: allow\|needs-approval\|block, risk, reasons, argsHash, _proof }` |
| `POST /agent/cert/build` | `{ agent, task?, run?, frames[], approvals? }` | `{ cert, evidence, _proof }` — a self-contained Agent Run Certificate |
| `POST /agent/cert/verify` | `{ cert, evidence }` | `{ valid, reasons, _proof }` — re-derives the summary + checks the chain |
| `POST /agent/skillscan` | `{ name, content, purpose? }` | a skill card `{ verdict, capabilities, excessiveAgency, _proof }` |
| `POST /agent/insure` | `{ cert, certVerified?, vendorFalseRateLB? }` | `{ coverageBand, premiumMultiplier, riskScore, conditions, voidIf, _proof }` |

### The flow a vendor wires once

```bash
# 1) gate every sensitive tool-call before executing it
curl -s :17742/agent/gate -d '{"tool":"bash","args":{"command":"rm -rf /"},"agent":"Grok"}'
# → { "decision":"block","risk":0.95, ... }

# 2) accumulate the returned audit frames for the run, then mint a certificate
curl -s :17742/agent/cert/build -d '{"agent":"Grok","task":"ship","run":"R1","frames":[ ... ]}'
# → { "cert": { "summary": { "insurability":"review", ... } }, "evidence": { ... } }

# 3) anyone verifies it offline
curl -s :17742/agent/cert/verify -d '{"cert":{...},"evidence":{...}}'   # → { "valid": true }

# 4) underwrite the run (the liability product)
curl -s :17742/agent/insure -d '{"cert":{...},"certVerified":true,"vendorFalseRateLB":0.05}'
# → { "coverageBand":"conditional","premiumMultiplier":1.98,"insurable":true }
```

### Honest notes (DIAKRISIS)

- The gate decides on the call's **declared** signals (its command args + your policy + the tool's
  skill provenance); a tool whose internals go beyond its args defaults to needs-approval/block,
  never a silent allow.
- The certificate certifies what the **gateway saw**; route your tool/model calls through it so the
  record is complete.
- `/agent/insure` is **deterministic underwriting on a signed record**, not an actuarial promise. It
  returns a premium **multiplier** on whatever base rate the insurer sets — there is no invented
  dollar figure — and it **declines** an unverified or non-compliant run.
