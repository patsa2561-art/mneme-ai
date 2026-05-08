# ALETHEIA — Open MCP Security Framework

> _Greek_ ἀλήθεια — "the state of not being hidden, disclosure, truth."
> Pairs with **Mneme** (Memory): **Memory + Truth = MCP defense.**

---

## The problem

MCP is having its **HTTP / USB-C / JSON moment** — a rare window when the
industry converges on one standard. The downside: the early ecosystem is
porous.

[Equixly's MCP security assessment][equixly] (2025) found that across
real-world MCP server implementations:

- **43%** had command-injection vulnerabilities
- **30%** had SSRF (server-side request forgery)
- **22%** allowed arbitrary file access

If MCP is going to become the universal AI-tool protocol, it needs an
**open, vendor-neutral security framework** — the way TLS is for HTTP, or
SAML/OIDC for identity. That's ALETHEIA.

[equixly]: https://www.merge.dev/blog/mcp-security

---

## What ALETHEIA is

ALETHEIA is **a portable spec + reference implementation** for MCP-server
security. It defines:

1. **A defensive surface** — a small set of well-known tool names that
   any MCP server can expose, with identical semantics + response shapes.
2. **A learn-by-using metaphor** — biological immune system: profile
   normal calls, flag anomalies, evolve defenses, evict bad actors.
3. **An auditable substrate** — HMAC-chained replay logs, public karma
   ledgers, tamper-evident fingerprints.

Mneme is the **reference implementation**. The spec is intentionally
adopt-by-other-vendors. If the MCP server you're using doesn't expose
ALETHEIA tools yet — install Mneme alongside it, and ALETHEIA shields
your whole MCP surface.

---

## The 6 ALETHEIA tools (v1.18.0)

| Tool | Purpose | What it does |
|---|---|---|
| `mneme.aletheia.lint` | Active vulnerability scan of an arg blob | Flags command-injection / SSRF / path traversal / secret leaks (AWS / GitHub / Slack / Google / Stripe) before the arg reaches downstream code. |
| `mneme.aletheia.immune.scan` | Bayesian anomaly detector | Compares an arg shape against the trained baseline of normal calls; flags novel shapes via Laplace-smoothed posterior. |
| `mneme.aletheia.immune.train` | Whitelist a known-good shape | Records a normal call into the immune profile so future calls can be scored. |
| `mneme.aletheia.immune.alerts` | Read the alerts log | Surfaces every honeypot hit + every anomaly; consumable by SIEM. |
| `mneme.aletheia.karma` | Public tool reputation | Per-tool karma ledger — verified +1, hallucination -3, fuzz hit -2. Tools below karma 0 enter quarantine. |
| `mneme.aletheia.fuzz` | Self-fuzzing | Generates ~12 OWASP-derived attack inputs per string field of a target tool, runs each through `lint`, reports robustness. **First MCP server with built-in self-fuzzing.** |

Plus **5 honeypot tools** registered as decoys:

`mneme.admin.delete_all` · `mneme.system.exec` · `mneme.secrets.dump` ·
`mneme.users.list` · `mneme.config.set`

A legitimate AI agent sees them in the catalog with the
**`[HONEYPOT — DO NOT CALL]`** prefix and never invokes them. Anyone
who does → instant alert + fake-but-plausible response (waste their
time + collect their next probe).

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│                         Per-call flow                        │
├──────────────────────────────────────────────────────────────┤
│  AI calls a Mneme tool                                       │
│                ↓                                             │
│  Mneme records observation in immune profile (best-effort)   │
│                ↓                                             │
│  ALETHEIA lint scans args (informational; doesn't block)     │
│                ↓                                             │
│  Tool handler executes                                       │
│                ↓                                             │
│  Response captured in HMAC-chained replay log                │
│                ↓                                             │
│  Karma incremented (verified / hallucination / etc.)         │
└──────────────────────────────────────────────────────────────┘
```

Every layer is local-first, append-only, and survives across sessions.
State lives in `.mneme/aletheia/`:

- `profile.json` — argument shape fingerprints + frequencies
- `karma.json` — per-tool reputation ledger
- `alerts.jsonl` — honeypot hits + anomaly events

Plus `.mneme/replay.jsonl` (HMAC-chained call log) and `.mneme/replay-secret.bin`.

---

## Why this matters

**Defense in depth, not replacement.** ALETHEIA is one layer; combine
with input validation, least-privilege, sandboxing, and supply-chain
attestation.

**Open standard, not lock-in.** Other MCP server vendors are encouraged
to expose the same tool names with the same response shapes. Clients then
get one consistent security surface across vendors.

**Evolves with use.** The immune profile adapts to YOUR usage pattern.
The karma ledger reflects YOUR experience. The honeypots catch what's
trying to attack YOU.

---

## Roadmap

- **v1.18.0** (this release) — local lint / immune / karma / fuzz / alerts
  + 5 honeypots + replay + confess.
- **v1.19** — Reverse MCP (sampling) + Mneme Whisper (resource push) +
  MCP Mesh transport + HMAC vaccine federation.
- **v1.20** — Public AI-vendor trust dashboard at
  `aletheia.mneme.dev` (opt-in, anonymized).
- **v2.0** — Cross-vendor ALETHEIA conformance test suite.

---

## How to adopt ALETHEIA in your own MCP server

1. Expose tools matching the names + schemas in this doc.
2. Mirror the `.mneme/aletheia/` file layout (or the equivalent in
   your store).
3. Use the contract test pattern — load every tool in your registry,
   verify each can be called with the OWASP fuzz battery (mirror
   `_aletheia.ts::generateFuzzCases`).
4. Publish your karma ledger if you want public reputation.

The Mneme reference implementation is MIT-licensed. Take it, fork it,
make it yours. The win is the open standard, not the implementation.
