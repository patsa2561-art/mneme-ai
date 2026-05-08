# Mneme — Compliance Documentation

*v1.11.0 · For security teams evaluating Mneme for regulated environments.*

This directory maps Mneme's security architecture to specific compliance frameworks. Each document is a control-by-control mapping showing what Mneme provides, what's the customer's responsibility, and where the boundary lies.

| Framework | File | Audience |
|---|---|---|
| **SOC 2 Type II** | [SOC2.md](./SOC2.md) | SaaS vendors going through SOC 2 audit |
| **PCI-DSS v4.0** | [PCI-DSS.md](./PCI-DSS.md) | Payment processors / fintech / banks |
| **GDPR** | [GDPR.md](./GDPR.md) | Companies serving EU users |
| **NIST 800-53** | [NIST-800-53.md](./NIST-800-53.md) | Federal contractors / FedRAMP |
| **Banking runbook** | [BANKING.md](./BANKING.md) | Banks / regulated financial institutions |

## Mneme's compliance posture (one-paragraph summary)

Mneme is an **opt-in security toolkit** that runs **inside the customer's environment**. There is no SaaS hub for source code, no telemetry, no auto-update. Cryptographic primitives are **FIPS-approved** (AES-256-GCM, HMAC-SHA-256, Ed25519, scrypt, SHA-256). All sensitive operations are **opt-in**: the vault, the audit log, federation, webhooks. Default behaviour is unchanged from prior versions. The compliance burden is split between (a) what Mneme provides cryptographically and (b) what the customer enforces operationally — each doc spells out the boundary.

## v1.11.0 security capabilities — quick reference

| Capability | Module | CLI | Compliance value |
|---|---|---|---|
| AES-256-GCM at-rest encryption | `core/security/vault` | (programmatic) | NIST SP 800-38D · FIPS 197 |
| HMAC-SHA-256 chained audit log | `core/security/audit-log` | `mneme audit-log enable/verify/rotate` | SOC2 CC7.2 · PCI-DSS 10.x |
| Atomic key rotation | `core/security/key-rotate` | `mneme key rotate --confirm` | SOC2 CC6.1 · PCI-DSS 3.6 |
| Prompt-injection scrubbing | `core/security/scrubber` | (programmatic) | OWASP LLM01 |
| Federation rate-limit + sybil resistance | `saas/federation-hub` | (deployed by hub operator) | DDoS resilience |
| WASM model checksum verification | `embeddings/checksum` | env var `MNEME_PINNED_MODEL_CHECKSUMS` | NIST 800-218 supply chain |
| FIPS 140 enforcement gate | `core/security/compliance` | `mneme --compliance fips140 …` | FIPS 140-3 |
| Daemon PID ownership check | `cli/commands/daemon` | (automatic) | NIST 800-53 AC-3 |
| Subprocess argv-only invocation | (project-wide) | (automatic) | OWASP A03 (injection) |
