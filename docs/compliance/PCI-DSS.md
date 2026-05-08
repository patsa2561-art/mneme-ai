# PCI-DSS v4.0 — Mneme Control Mapping

*Payment Card Industry Data Security Standard · v4.0 · v1.11.0*

This document maps Mneme's v1.11.0 security capabilities to the PCI-DSS v4.0 requirements relevant to a developer toolchain.

## Important boundary statement

**Mneme is NOT in the cardholder data environment (CDE).** It indexes git commits, code, and metadata. It is a developer productivity tool, not a payment processor. The relevant PCI-DSS requirements are those that apply to the *toolchain* used by developers who write code that touches the CDE — not to the CDE itself.

That said, several PCI-DSS controls do touch toolchain hygiene; this is where Mneme's v1.11.0 hardening contributes.

## Mapping

### Requirement 3 — Protect stored account data

PCI-DSS distinguishes "stored account data" (cardholder data) from generic at-rest sensitive data. Mneme **MUST NOT** be used to store cardholder data, but customers who index repositories that *might* contain cardholder data fragments (e.g., test fixtures, scrubbed test data) should:

| Sub-req | Mneme implementation |
|---|---|
| 3.5 — Strong cryptography for at-rest | `core/security/vault` provides AES-256-GCM. Refuses passphrases <12 chars. Nonce per-encrypt; auth tag enforced. |
| 3.6 — Cryptographic key management | `mneme key rotate --confirm` atomically rotates the HMAC secret. Old log archived for evidence. |
| 3.7 — Strong cryptography for keys themselves | Audit secret is 256-bit (32 bytes hex) generated via `crypto.randomBytes`. Key file written mode 0600. |

### Requirement 6 — Secure software development

| Sub-req | Mneme implementation |
|---|---|
| 6.2.4 — Address common coding vulnerabilities | All subprocess invocations use argv-only form (no `shell: true`); `mcp/_runtime` rejects shell metacharacters in MCP-supplied args. |
| 6.3.3 — Software inventory | `mneme deps-audit` enumerates dependencies. `mneme periodic-table` cross-references CVE patterns. |

### Requirement 8 — Identify users and authenticate access

| Sub-req | Mneme implementation |
|---|---|
| 8.2.1 — Strong authentication factors | Mneme inherits OS user identity. Daemon PID file is owned by the user that started it; cross-user access refused. |
| 8.3.5 — Cryptographic protection of credentials | Audit secret stored mode 0600, can be sourced from `MNEME_AUDIT_SECRET` env var (read from upstream key vault). |

### Requirement 10 — Log and monitor all access

This is where Mneme contributes most directly to PCI-DSS posture.

| Sub-req | Mneme implementation |
|---|---|
| 10.2 — Implement audit logs | `mneme audit-log enable` — HMAC-SHA-256 chained log of every state-changing action (`init`, `index`, `vault-encrypt`, `key-rotate`, `webhook-add`, `federation-join`, etc.). |
| 10.3 — Capture required event data | Each entry: `ts`, `actor`, `action`, `target`, `details`, `prevHmac`, `hmac`. |
| 10.5 — Log file integrity | HMAC chain detects any modification — `mneme audit-log verify` returns exit 1 on tamper. PCI-DSS 10.5 requires an integrity-monitoring file system; Mneme's chain is a self-contained equivalent for the audit log itself. |
| 10.6 — Daily log review | `mneme audit-log show --limit 100 --json` for ingestion into the customer's SIEM. |
| 10.7 — Audit log retention | Customer-driven via `mneme audit-log rotate` + standard backup tools. |

### Requirement 11 — Test security of systems and networks regularly

| Sub-req | Mneme implementation |
|---|---|
| 11.5.2 — File integrity monitoring | `mneme audit-log verify` is a CI-friendly file-integrity check on the audit log itself. Run hourly via cron / nightly via CI. |

### Requirement 12 — Information security policy

Out of scope for Mneme — these are organizational controls.

## Recommended PCI-DSS deployment configuration

```bash
# Enforce FIPS-approved algorithms only
export OPENSSL_FIPS=1   # operator must configure FIPS-validated OpenSSL

# Enforce checksum pinning of bundled model
export MNEME_PINNED_MODEL_CHECKSUMS='{"Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx":"<sha256>"}'

# Audit secret from key vault
export MNEME_AUDIT_SECRET=$(retrieve-from-vault audit-key)

# Boot Mneme in compliance mode
mneme --compliance fips140 audit-log enable
mneme --compliance fips140 audit-log verify    # nightly CI gate
```
