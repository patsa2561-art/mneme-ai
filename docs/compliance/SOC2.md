# SOC 2 — Mneme Control Mapping

*Trust Services Criteria · 2017 (revised 2022) · v1.11.0*

This document maps Mneme's v1.11.0 security capabilities to the relevant SOC 2 Trust Services Criteria. It is intended to support a customer's own SOC 2 audit — Mneme itself is not a SaaS service and does not undergo SOC 2 audit, but its features can be wired into a customer's control environment.

## Scope

- **Mneme is software the customer runs.** No data leaves the customer environment by default.
- **The vault, audit log, and federation are opt-in.** Customers who don't enable them get no compliance lift from them.

## Mapping

### CC6.1 — Logical access controls

| Control objective | Mneme implementation |
|---|---|
| Enforce least privilege | `.mneme/audit-log.secret` written with mode `0600`. PID file written with mode `0600`. |
| Cryptographic key management | `mneme key rotate --confirm` atomically re-signs the audit chain under a fresh secret. Old log archived; never destroyed. |
| Authentication of users | Out of scope — Mneme uses the OS user identity. PID file ownership check refuses cross-user access. |

### CC6.6 — Encryption at rest

| Control objective | Mneme implementation |
|---|---|
| Encrypt sensitive data at rest | `core/security/vault` provides AES-256-GCM (FIPS 197) with scrypt KDF (SP 800-132). Opt-in via programmatic `vault.encrypt()`. |
| Approved algorithms | Only FIPS-approved primitives. See `mneme --compliance fips140` for runtime enforcement. |

### CC6.7 — Encryption in transit

| Control objective | Mneme implementation |
|---|---|
| Encrypt data in transit | Federation hub assumes a TLS-terminating reverse proxy (documented in `packages/saas/federation-hub/server.ts`). All federation envelopes are independently signed (Ed25519, FIPS 186-5). |

### CC7.1 — Detection of vulnerabilities

| Control objective | Mneme implementation |
|---|---|
| Vulnerability scanning | `mneme forensics --vulns` flags AST-evidenced CWE patterns. |
| Supply chain integrity | `MNEME_PINNED_MODEL_CHECKSUMS` env var enables SHA-256 verification of bundled WASM model files. |
| Dependency hygiene | `mneme deps-audit` enumerates third-party deps and their versions. |

### CC7.2 — System monitoring (security event logs)

| Control objective | Mneme implementation |
|---|---|
| Append-only logging of state-changing events | `mneme audit-log enable` activates HMAC-SHA-256 chained logging of every mutating action. |
| Tamper detection | `mneme audit-log verify` re-walks the chain; non-zero exit on any tamper. CI-friendly. |
| Log integrity | Each entry is HMAC'd with the previous entry's HMAC included as input → modification of any entry breaks every subsequent entry. |
| Log retention | `mneme audit-log rotate` archives the current log (never deletes); rotation event itself is the first entry of the new chain. |

### CC8.1 — Change management

| Control objective | Mneme implementation |
|---|---|
| Authorized change approval | All Mneme commits are signed; npm publishes use provenance. The customer's CI is responsible for gate enforcement. |
| Production change traceability | Audit log entries record `actor`, `action`, `target`, `details`, and a chained HMAC. |

## Customer responsibilities (not provided by Mneme)

- Operating-system hardening (file system permissions, mount options).
- TLS termination for any deployed federation hub.
- Backup of `.mneme/` directory (if compliance requires log retention beyond rotation).
- Secret management (where `MNEME_AUDIT_SECRET` lives — Mneme reads from env var or file mode 0600, but customer is responsible for upstream key vault integration).
- SOC 2 audit itself.
