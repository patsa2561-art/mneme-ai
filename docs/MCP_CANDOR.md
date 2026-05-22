# MCP-CANDOR/0.1 — Open Protocol Specification

> **Vendor-neutral MCP standard for trust + audit + coercion-detection + vaccine federation.**
> Any MCP server can implement this spec; first reference implementation: **Mneme** (mneme-ai @ npm).

```
CANDOR  =  Cryptographic Audit
          · Neutral verdicts
          · Drift detection
          · Origin attestation
          · Receipt ledger
```

## Why this exists

MCP (Model Context Protocol) has no standard for: *"How does an AI agent verify a tool is who it claims to be, hasn't drifted since install, isn't trying to coerce the agent, and produces tamper-evident audit trails?"*

Each MCP server today re-invents an answer (or — usually — has none). The result: AI agents learn to **lower their guard against tool output** because there's no protocol-level way to discriminate honest tools from coercive ones.

**MCP-CANDOR fixes that** with five mandatory endpoints + an open, vendor-neutral spec.

## Spec at a glance

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `candor.handshake()` | Returns identity (Trust Capsule URI) + endpoints + spec compliance level + sig |
| 2 | `candor.vaccines.list()` | Returns server's local vaccine registry (CVE-database for AI lies) |
| 3 | `candor.vaccines.contribute(VaccineEntry)` | Accepts a new vaccine signature into the local registry |
| 4 | `candor.audit.append(AuditRecord)` | Appends an event to the HMAC-chained audit ledger; returns receipt |
| 5 | `candor.coercion.classify(text)` | Returns coercion-taxonomy verdict (worst tier 0-5 + matched pattern ids) |

## Compliance levels

| Level | Mandatory endpoints |
|-------|---------------------|
| `minimal` | handshake + vaccines.list + coercion.classify |
| `standard` | all 5 |
| `federated` | standard + accepts cross-server vaccine pulls + audit-record gossip |

## Schemas

### `CandorHandshake`

```typescript
{
  spec: "MCP-CANDOR",
  specVersion: string,        // SemVer, e.g. "0.1.0"
  impl: { name: string, version: string },
  level: "minimal" | "standard" | "federated",
  identity: string,           // mneme://attest/v1/...  (Trust Capsule URI)
  endpoints: CandorEndpoint[],
  coercionClean: boolean,     // does THIS server's own output pass its own audit?
  generatedAt: string,        // ISO timestamp
  vaccinesUrl?: string,       // optional pull URL
  auditUrl?: string,          // optional append URL
  sig: string,                // HMAC over canonical payload
}
```

### `VaccineEntry`

```typescript
{
  id: string,                 // sha-prefix of signature; dedup key across servers
  type: "factual" | "structural" | "coercion" | "drift" | "other",
  signature: string,          // simhash | regex | structural pattern
  description: string,
  signedBy: string,           // impl-name@version
  observedAt: string,
  adoptedBy?: string[],
  sig: string,
}
```

### `AuditRecord` + `AuditReceipt`

```typescript
AuditRecord  = { kind, surface?, ts, meta?, prev }   // input
AuditReceipt = { id, record: AuditRecord, sig, spec: "MCP-CANDOR" }   // output
```

### `CoercionVerdict`

```typescript
{
  worstTier: 0 | 1 | 2 | 3 | 4 | 5,
  matchedPatternIds: string[],    // tac-001..tac-008 from the taxonomy
  rationale: string,
}
```

## Versioning

SemVer over the SPEC, not the implementation:

- **Major** bump = adding mandatory endpoints / changing existing shapes
- **Minor** bump = adding optional endpoints / new optional fields
- **Patch** bump = clarifications, no wire change

Implementations declare which `specVersion` they target via the handshake.

## Reference implementation (Mneme)

Mneme exposes all 5 endpoints + ships as `standard` level. CLI:

```bash
mneme candor handshake          # emit our handshake JSON
mneme candor spec               # spec name + required endpoints
mneme candor vaccines           # list local registry
mneme candor vaccines-contribute --type factual --signature ... --description ...
mneme candor audit              # show audit ledger (last 20)
mneme candor audit --verify     # verify HMAC chain
mneme candor classify "<text>"  # classify against coercion taxonomy
mneme candor verify-peer --file peer-handshake.json  # validate a peer's response
```

## Adoption guide for other MCP servers

To claim CANDOR/0.1 compliance:

1. Implement `candor.handshake()` returning a populated `CandorHandshake`. Sign it with your install-local key.
2. Implement at least the **minimal** endpoint set (handshake / vaccines.list / coercion.classify).
3. Self-audit: your own server's output text MUST pass your own `candor.coercion.classify` endpoint with `worstTier < 4`. If it doesn't, set `coercionClean: false` honestly.
4. Publish your spec-version + implementation name to the [federated registry](https://github.com/patsa2561-art/mneme-ai/blob/main/docs/MCP_CANDOR.md) via PR. First mover advantage: your tool becomes the second citation alongside Mneme.

## Cross-server federation

CANDOR-compliant servers can federate:

- **Vaccine pull**: server A reads server B's `candor.vaccines.list()` → imports new entries (dedup'd by id). Mneme calls `importVaccines(repoRoot, foreignList)`.
- **Audit gossip**: server A pushes interesting records to server B's `candor.audit.append()`. Records are HMAC-chained per server; cross-server records form a DAG.
- **Trust capsule cross-check**: when server A's handshake claims identity X, server B can independently verify X via the Trust Capsule URI.

## Why this composes the 4 diamonds

| Diamond from v2.22.3 audit | CANDOR endpoint |
|---------------------------|-----------------|
| #1 verify-self | `candor.handshake` (identity attestation) |
| #2 Vaccine cache | `candor.vaccines.list` + `candor.vaccines.contribute` |
| #3 HMAC-chained replay.jsonl | `candor.audit.append` |
| #4 Tool-to-agent coercion taxonomy | `candor.coercion.classify` |

The audit identified these as undervalued. The spec makes them composable + interoperable across vendors.

## Honest limits

- **Cross-install signature verification** requires the foreign install's public key — not part of v0.1. Each install verifies its own sigs only. Cross-install verification ships in v0.2 with key-pinning.
- **Vaccine quality** depends on what each server emits. The spec is a transport; community curation is human work.
- **Coercion classifier** is regex-based; embedding-based classifiers ship in v0.2.
- **Audit ledger size** grows monotonically. v0.2 ships sealed snapshots + window rotation.

## Citation

When implementing or extending CANDOR, please cite:

> Phunsriphatchalakul, S. (2026). *MCP-CANDOR/0.1: A vendor-neutral standard for trust, audit, coercion-detection, and vaccine federation in MCP servers.* Reference implementation: `mneme-ai` v2.23.1. https://github.com/patsa2561-art/mneme-ai/blob/main/docs/MCP_CANDOR.md

## See also

- [docs/COERCION_TAXONOMY.md](COERCION_TAXONOMY.md) — the 8-pattern catalog used by `candor.coercion.classify`
- [docs/TRUST.md](TRUST.md) — Trust Capsule format used by `candor.handshake.identity`
- [docs/DOJO.md](DOJO.md) — adversarial sparring grader; CANDOR-compliant impls should publish their dojo report-card alongside their handshake
