# Mneme — Banking & Financial Services Runbook

*v1.11.0 · Operational hardening guide for banks, fintech, and regulated financial institutions.*

This is the **end-to-end deployment runbook** for using Mneme inside a regulated financial institution. It assumes a multi-developer environment, an internal CI/CD pipeline, and that the institution is subject to one or more of: SOX, GLBA, NYDFS Cybersecurity Regulation (Part 500), FFIEC IT Handbook, MAS TRM, FCA SYSC.

## Threat model

Banking environments care about three things Mneme could plausibly affect:

1. **Source code integrity** — could Mneme corrupt or alter the code we ship?
2. **Sensitive data leakage** — could Mneme exfiltrate PCI/PII/MNPI from indexed repos?
3. **Audit trail integrity** — can we prove what Mneme did and when, in a way that survives a forensic investigation?

The hardening below addresses each.

## Pre-deployment checklist

- [ ] Mneme version pinned to a specific release in package.json (no `^` or `~` ranges).
- [ ] Internal npm registry mirror configured (if institution policy requires).
- [ ] FIPS-validated OpenSSL build of Node confirmed.
- [ ] Internal key vault integration tested for `MNEME_AUDIT_SECRET`.
- [ ] Logging/SIEM ingestion path for `mneme audit-log show --json` confirmed.
- [ ] `MNEME_PINNED_MODEL_CHECKSUMS` populated from internal model audit.
- [ ] Federation explicitly disabled (default); document confirming this in change-control system.

## Deployment configuration

### Environment variables (per-developer or per-build agent)

```bash
# REQUIRED — FIPS mode (operator must configure FIPS-validated OpenSSL upstream)
export OPENSSL_FIPS=1

# REQUIRED — audit secret from internal key vault (AWS KMS, HashiCorp Vault, etc.)
export MNEME_AUDIT_SECRET="$(retrieve-from-internal-vault audit-key)"

# REQUIRED — pin bundled embedder model checksums after security team review
export MNEME_PINNED_MODEL_CHECKSUMS='{"<path>":"<sha256>"}'

# OPTIONAL — explicit cache dir under audited path
export TRANSFORMERS_CACHE=/opt/mneme/models
```

### Initialization

```bash
# Verify FIPS posture before doing anything
mneme --compliance fips140 status

# Initialize repo + enable audit log + record initialization in audit chain
mneme init
mneme --compliance fips140 audit-log enable

# First index — captures baseline
mneme --compliance fips140 index
```

### Daily operations (developer workstation)

```bash
# Standard workflow with compliance flag
mneme --compliance fips140 ask "where do we validate ACH routing numbers"
mneme --compliance fips140 audit                  # AI session audit
```

### CI gate (every PR + hourly cron)

```bash
# Audit chain integrity — exit 1 on tamper
mneme --compliance fips140 audit-log verify

# Forensics — block PR if new CWE patterns introduced
mneme --compliance fips140 forensics --vulns --strict

# Deps audit — flag new transitive dependencies
mneme deps-audit --json | <internal-policy-engine>
```

### Quarterly key rotation (compliance requirement)

```bash
# Dry-run first
mneme --compliance fips140 key rotate

# Confirm + rotate (atomic re-sign of entire audit chain)
mneme --compliance fips140 key rotate --confirm

# Update upstream key vault
update-internal-vault audit-key "$(cat .mneme/audit-log.secret)"

# Verify the rotation succeeded
mneme --compliance fips140 audit-log verify
```

### Forensic incident response

If a tamper is suspected:

```bash
# 1. Snapshot the current state (preserves evidence)
cp -a .mneme/audit.log .mneme/audit.log.incident-$(date +%Y%m%dT%H%M%SZ)

# 2. Verify
mneme --compliance fips140 audit-log verify --json > /tmp/verify-result.json
# brokenAtIndex + brokenReason in the output identifies the first tampered entry

# 3. Show the tampered range
mneme audit-log show --limit 10 --json > /tmp/tail.json

# 4. Cross-reference with git log around the same timestamp
git log --since="$(jq -r '.[0].ts' /tmp/tail.json)" --pretty=format:"%H %ai %an %s"
```

The HMAC chain guarantees that if `verify` reports OK, no entry has been altered or deleted (assuming the secret remained confidential). Combined with key vault audit logs of `MNEME_AUDIT_SECRET` access, this gives a defensible chain-of-custody.

## Sensitive-data leakage controls

- **Default embedders are 100% offline.** `hash` (deterministic) and `bundled` (local WASM) never call out.
- **Source code never leaves host** — even with paid embedders enabled, only commit messages + PR/issue text are sent. Full file contents are never transmitted.
- **Federation is OFF by default.** Banks should keep it that way unless the federation hub is internally hosted under the bank's authorisation boundary.
- **MCP/AI tool integration:** AI clients (Claude Code, Cursor, ChatGPT) consume Mneme via MCP. Mneme does NOT proxy data to the AI; the AI client makes its own outbound calls. Bank policy on which AI clients are permitted applies separately.

## Source code integrity controls

- **Mneme does not modify git history.** Originals (commits, PRs, issues, files) are read-only inputs.
- **Subprocess hardening (v1.11.0):** all internal subprocess invocations use argv-only form. No `shell: true`. MCP-supplied args are validated against shell metacharacters.
- **Deterministic mode:** pass `--no-llm` to disable every LLM-touching code path. Useful for audit-period freeze windows.

## Audit attestation language for examiners

> "We use Mneme v1.11.0 in `--compliance fips140` mode. All cryptographic operations rely on FIPS 140-3 approved primitives (AES-256-GCM, HMAC-SHA-256, Ed25519, scrypt). The audit log uses an HMAC-SHA-256 chain for tamper detection (NIST SP 800-107 §5.3 equivalent). Secret rotation is manual, quarterly, and atomically re-signs the entire chain. We have not enabled any outbound federation features. The embedder model is pinned by SHA-256 checksum and verified at runtime."

## Known limitations (be honest with examiners)

- Mneme is **not** itself FIPS 140-3 validated; it depends on the OS-provided FIPS-validated OpenSSL via Node.
- The audit secret is generated by `crypto.randomBytes`, which inherits entropy quality from the OS RNG.
- Time stamps in audit entries use the system clock (no Trusted Timestamp Authority integration in v1.11.0; on the roadmap).
- The HMAC chain detects modification but does not prevent it — physical disk access plus secret access can rewrite history. Mitigation: store rotated logs in WORM storage (immutable S3 bucket, AWS Glacier with vault lock).
