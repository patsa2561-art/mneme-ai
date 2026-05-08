# GDPR — Mneme Data Protection Posture

*General Data Protection Regulation · 2016/679 · v1.11.0*

## TL;DR

- **Default behaviour:** Mneme runs entirely on the customer's machine. No data leaves the system. No telemetry. No automatic uploads.
- **Federation is opt-in** and ships only **aggregated, k-anonymized, differentially-private** signals (ε ≤ 1.0, k ≥ 20).
- **PII inside commits, code, or PR text** that the customer indexes IS processed by Mneme on the customer's machine — but is never transmitted off-host without explicit opt-in to federation or a paid embedder.

## Article-by-article posture

### Art. 5 — Principles relating to processing of personal data

| Principle | Mneme implementation |
|---|---|
| Lawfulness, fairness, transparency | Customer is the controller; Mneme processes data on their behalf as a processor (when run locally) or a tool (no controller relationship). |
| Purpose limitation | Mneme uses indexed data only for retrieval/insights/audits per the documented commands. No secondary use. |
| Data minimisation | Default embedders process commit messages + PR/issue text only; source code is parsed locally for AST evidence but not transmitted. |
| Accuracy | Re-running `mneme index` re-syncs to ground truth (git history). No silent staleness. |
| Storage limitation | Customer controls retention via `.mneme/` directory lifecycle. `mneme audit-log rotate` is the documented archival flow. |
| Integrity & confidentiality | `core/security/vault` provides AES-256-GCM at-rest. `core/security/audit-log` provides HMAC-SHA-256 tamper-evidence. |
| Accountability | `mneme audit-log enable` produces a verifiable record of every mutating action. |

### Art. 17 — Right to erasure

The customer can satisfy erasure requests by:

1. Removing affected commits/PR text from the source git repo (data of record).
2. Running `rm -rf .mneme/` (deletes the entire local index).
3. Re-running `mneme index` (rebuilds from current git state).

Mneme stores no PII outside `.mneme/` in the repo working tree.

### Art. 25 — Data protection by design and by default

| Default | Mneme implementation |
|---|---|
| No outbound network calls | Default embedders (`hash`, `bundled` WASM) are 100% offline. |
| Offline-first | Air-gapped operation supported with no feature loss for the core memory layer. |
| Encryption at rest | Available via opt-in vault (see SECURITY.md). |
| Pseudonymisation | Federation envelopes use a contributor ID derived from a random Ed25519 keypair — not a user email. |

### Art. 32 — Security of processing

| Control | Mneme implementation |
|---|---|
| Encryption | AES-256-GCM (vault), HMAC-SHA-256 (audit log + webhooks), Ed25519 (federation, signed exports). All FIPS-approved. |
| Confidentiality, integrity, availability, resilience | Audit log chain provides integrity. Atomic temp+rename writes provide resilience. Daemon uses 0600-mode PID file owned by user. |
| Restoring availability after incident | `.mneme/` is reproducible from `git log`; re-run `mneme index`. |
| Regular testing of effectiveness | `mneme audit-log verify` + customer's own pen-test schedule. |

### Art. 33 — Notification of breach

Out of scope for Mneme as software. The customer is the controller and decides notification. Mneme's audit log helps reconstruct the breach timeline.

## Federation specifically

Federation is the only Mneme feature that transmits data off-host. Even then:

- **Aggregated only:** Pattern-level numeric signals (counts, rates), not raw text.
- **k-anonymity:** Signals are released only when ≥ k=20 contributors have submitted matching patterns. The hub re-verifies on receipt and on aggregate query.
- **Differential privacy:** ε ≤ 1.0 noise added before transmission. Re-checked on hub.
- **No identifiers:** Contributor ID is a random pseudonym; no email, no IP-based identification stored in the signal envelope.
- **Opt-in:** Federation requires `mneme federation join`; never auto-joined.
- **Right to leave:** `mneme federation leave` revokes contribution. Past aggregates are k-anonymous and cannot be reversed to the contributor.

## Customer responsibilities

- Determining whether their use of Mneme processes personal data and the lawful basis for it.
- DPIA where required.
- Subject access request workflows.
- Selecting embedders aligned with data residency requirements (e.g., not OpenAI for EU-only data).
