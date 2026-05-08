# Mneme SaaS v2 — Cross-Org Dashboard Architecture

> **Audience:** Engineering Lead · CTO · Cloud Infra Architect · Product Lead
> **One-line:** v2 architecture spec for the hosted dashboard that aggregates Mneme audit certificates across multiple repos / multiple orgs, with multi-tenant isolation, SSO, and per-tenant Ed25519 signing.

═══════════════════════════════════════════════════════════════════════════════

## Why v2 needs a SaaS layer

Today (v1.1):
- Mneme runs locally per-repo
- Each repo has its own `.mneme/audit-chain.json`
- Compliance verification is per-repo manual work

Limits at scale:
- A 200-repo org cannot answer "show me every AI commit certificate org-wide" in <30 minutes
- No cross-repo trends ("which team's AI use shows highest entropy?")
- No central key management (every repo carries its own HMAC key)
- No managed retention / archival

**v2 closes those gaps without breaking v1's local-first contract.** Local execution stays the default; SaaS aggregation is opt-in.

═══════════════════════════════════════════════════════════════════════════════

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      MNEME SAAS v2 (cloud)                           │
│                                                                      │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐       │
│  │  Web Frontend │  │  API Gateway │  │  Audit Cert Ingestor │       │
│  │  (Next.js +   │  │  (HTTPS +    │  │  (validates Ed25519  │       │
│  │   shadcn/ui)  │  │   SSO)       │  │   sig per cert)      │       │
│  └───────┬───────┘  └──────┬───────┘  └──────────┬───────────┘       │
│          │                 │                     │                   │
│  ┌───────┴─────────────────┴─────────────────────┴───────────┐       │
│  │                      Multi-Tenant Postgres                 │       │
│  │   - certs   (cert_id, tenant_id, org_id, repo, sig, ...)   │       │
│  │   - chains  (chain_root_per_repo)                          │       │
│  │   - tenants (tenant_id, sso_config, ed25519_pubkey, …)     │       │
│  │   - users   (user_id, tenant_id, role, …)                  │       │
│  │   Row-Level Security (Postgres RLS) on every query         │       │
│  └────────────────────────────────────────────────────────────┘       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Background Jobs (BullMQ)                                    │    │
│  │   - chain-verify    (verify every chain weekly)             │     │
│  │   - rollup-roller   (compute org-wide aggregates)           │     │
│  │   - alert-fanout    (Slack/email on new outlier)            │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ HTTPS + Ed25519-signed cert payload
                                  │
┌──────────────────────────────────────────────────────────────────────┐
│              Customer's environment (CI/CD or laptop)                │
│                                                                      │
│   mneme audit --certify --upload-to https://mneme.example.com         │
│   ↓                                                                  │
│   1. compose QSAC cert locally                                       │
│   2. sign with org Ed25519 private key (NEVER leaves customer)       │
│   3. POST signed cert to ingestor                                    │
│   4. Ingestor verifies sig with org PUBLIC key (one-time setup)      │
└──────────────────────────────────────────────────────────────────────┘
```

═══════════════════════════════════════════════════════════════════════════════

## Multi-tenancy model

**Three levels of isolation:**

1. **Tenant** — a customer org. Has its own subdomain (`acme.mneme.example.com`), SSO config, billing.
2. **Org** — a sub-grouping inside the tenant (e.g., "Engineering", "Data", "Security"). Optional.
3. **Repo** — the unit of audit-chain ownership. Every repo has its own chain.

**Postgres RLS policy** (illustrative):

```sql
ALTER TABLE certs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON certs
  FOR ALL
  USING (tenant_id = current_setting('mneme.current_tenant', true)::uuid);

-- API gateway sets the tenant via SET LOCAL on every request:
--   SET LOCAL "mneme.current_tenant" TO '<jwt-claim-tenant-id>';
```

Tenant data is never accessible across boundaries — at the database level, not just the application level.

═══════════════════════════════════════════════════════════════════════════════

## Per-tenant Ed25519 signing — the trust contract

**Critical:** the org's private key NEVER leaves customer infrastructure.

```
Customer onboards:
  1. mneme audit gen-keypair → kp.privateKeyPem + kp.publicKeyPem
  2. Store privateKeyPem in customer's secret manager (Vault / SSM / GCP Secret Manager)
  3. Upload publicKeyPem to Mneme SaaS — one-time, via console
  4. Mneme stores publicKeyPem under tenant_id

Customer uses CI:
  $ mneme audit --certify --hmac-key-file /secrets/ed25519.pem \
                          --upload-to https://acme.mneme.example.com
  ↓
  1. Cert composed locally
  2. Cert canonicalised + signed with private key (in customer env)
  3. HTTP POST to ingestor with signed cert payload
  4. Ingestor verifies signature using stored publicKeyPem
  5. If valid → store cert in DB under tenant_id
  6. If invalid → reject (signal of tampered or stale cert)
```

**Compliance value:** even Mneme staff cannot forge a customer's certificate. Customer keeps the keys; Mneme only verifies.

═══════════════════════════════════════════════════════════════════════════════

## Cross-org rollups — the user-facing value

### Dashboard page 1: org overview

```
Acme Corp · Engineering · Q3 2026

  Certificates issued        12,847
  Pass / Warn / Fail         91% / 7% / 2%
  Verifier disagreement      4.3% (above 0.15 JSD)
  Chains verified            247 / 247 ✓
  EU AI Act compliance       READY  ✓

  Top concerns this week:
    • repo `payments-api` — 12 certs with confidence < 70%
    • repo `auth-service` — verifier-disagreement spike (3 incidents)
    • commit `a3f2b8` (alice@acme) — narrative contradicted by api-drift axis
```

### Dashboard page 2: drill-down per repo

Per-repo view shows the same `mneme audit --explain` output but rendered in HTML — clickable axes, expandable verifiers, downloadable PDF for auditor delivery.

### Dashboard page 3: compliance pack export

One-click "EU AI Act compliance bundle":
- All certs in date range as JSON
- Chain verification report
- Public key + verification CLI (so auditor can re-verify offline)
- Downloadable PDF summary

═══════════════════════════════════════════════════════════════════════════════

## Data model — Postgres schema

```sql
CREATE TABLE tenants (
  tenant_id          UUID PRIMARY KEY,
  name               TEXT NOT NULL,
  sso_config_jsonb   JSONB,                 -- OIDC / SAML metadata
  ed25519_public_pem TEXT NOT NULL,         -- one-time-uploaded key
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan               TEXT NOT NULL DEFAULT 'starter',
  retention_days     INT NOT NULL DEFAULT 90
);

CREATE TABLE orgs (
  org_id     UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(tenant_id),
  name       TEXT NOT NULL
);

CREATE TABLE repos (
  repo_id     UUID PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES orgs(org_id),
  tenant_id   UUID NOT NULL REFERENCES tenants(tenant_id),  -- denormalised for RLS
  url         TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE certs (
  cert_id      UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id),
  repo_id      UUID NOT NULL REFERENCES repos(repo_id),
  commit_hash  TEXT NOT NULL,
  chain_index  INT  NOT NULL,
  prev_hash    TEXT NOT NULL,
  cert_hash    TEXT NOT NULL,
  signature    TEXT NOT NULL,
  payload      JSONB NOT NULL,           -- the full QSAC cert
  issued_at    TIMESTAMPTZ NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, chain_index)
);

CREATE INDEX certs_tenant_issued ON certs (tenant_id, issued_at DESC);
CREATE INDEX certs_overall_verdict ON certs ((payload->'overall'->>'collapsed'));
```

**Indexes** picked for the dashboard's two hot queries:
1. "Show this tenant's last N certs" → `(tenant_id, issued_at DESC)`
2. "Show this tenant's outliers by verdict" → `(payload->>'collapsed')` partial index

═══════════════════════════════════════════════════════════════════════════════

## Stack choice + rationale

| Component | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 15 + shadcn/ui | Fast iteration, server components for the dashboard tables |
| API | Fastify (Node 22) | Same lang as existing Mneme; ~30k req/s per box |
| DB | Postgres 16 | RLS for cleanest multi-tenancy; JSONB for cert payload |
| Background jobs | BullMQ + Redis | For chain-verify cron + alert fanout |
| SSO | WorkOS or Auth0 | OIDC + SAML out of the box; saves 6 weeks of identity work |
| Hosting | Render / Fly.io / AWS Fargate | Stateless API + managed Postgres + Redis = simplest ops |
| Observability | Datadog or Grafana Cloud | App + DB metrics + alerting |
| TLS | Caddy or Cloudflare | Automatic LE certs |

**No proprietary infra.** Everything either OSS or commodity SaaS. Customer can self-host the entire stack from a single Helm chart if they want.

═══════════════════════════════════════════════════════════════════════════════

## Pricing model — initial proposal

| Tier | Repos | Certs/month | Retention | SSO | Price/mo |
|---|---|---|---|---|---|
| **Free** | 3 | 1,000 | 30 days | ❌ | $0 |
| **Starter** | 25 | 25,000 | 90 days | ❌ | $99 |
| **Team** | 100 | 200,000 | 1 year | ✅ | $499 |
| **Enterprise** | unlimited | unlimited | 7 years | ✅ + SAML | custom |

**Plus:** $20/seat/month for the Mneme CLI Pro features (the v1.1 Ed25519 keypair workflow + LLM-as-judge against a paid LLM provider).

**Conservative TAM:**
- 2,000 paying teams × $499/mo × 12 = **$12M ARR** at saturation of the mid-market
- Add Enterprise: 50 customers × $50K/yr = **$2.5M ARR**
- Total realistic Year-3 ARR: **$15M**

═══════════════════════════════════════════════════════════════════════════════

## Roadmap to v2.0

**Phase 1 — MVP (8 weeks, 1 backend + 1 frontend dev)**
- Multi-tenant DB + RLS
- Cert ingestor (sig verify + insert)
- Dashboard pages 1-2 (overview + per-repo)
- SSO via WorkOS
- Free + Starter tiers live

**Phase 2 — Compliance pack (4 weeks)**
- Compliance bundle export (PDF + JSON + offline verify CLI)
- Chain-verify cron (background)
- Alerting (Slack + email + webhook)
- Team tier live

**Phase 3 — Enterprise (6 weeks)**
- SAML SSO
- HSM-backed key signing option
- Custom retention + audit logs of dashboard access
- SOC 2 Type 1 prep
- Enterprise tier live

**Total to MVP: ~8 weeks · Total to Enterprise: ~18 weeks**

═══════════════════════════════════════════════════════════════════════════════

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Customer reluctance to upload certs to SaaS | Local-first stays the default; SaaS is **opt-in**. Self-hostable stack. |
| Compliance auditors demand customer-controlled keys | Solved — Ed25519 design has the private key NEVER leave customer infra |
| Chain divergence / replay attacks | Server validates `prev_hash` against latest cert per repo; rejects out-of-order |
| Cost-of-running for free tier | Free tier capped at 1k certs/mo (~50 repos × 20 commits). Marginal cost ~$0.10/tenant/mo. |
| Vendor lock-in concern | Full data export at every tier; chain is portable JSON; offline verifier CLI ships in Mneme open source |
| EU data residency | Multi-region Postgres (eu-west, us-east) selectable per tenant at signup |

═══════════════════════════════════════════════════════════════════════════════

## What we're asking for

If you're **building this together** as a partnership, we'd discuss:

1. Whether your platform takes the white-label SaaS or builds against the open-source SDK
2. Engineering staffing — Mneme team takes the backend; partner team takes the auth+billing+UX shell
3. Joint enterprise sales motion targeting the EU AI Act window

If you're **acquiring** the technology, we'd discuss:

1. IP scope (open-source `mneme-ai` package + private SaaS extensions + roadmap)
2. Team retention (1-2 founding engineers + 1 product person for 12-24 months)
3. Integration timeline into your existing platform

═══════════════════════════════════════════════════════════════════════════════

## References

- v1.1 architecture: [docs/wiki/QSAC.md](../wiki/QSAC.md)
- Periodic Table: [docs/wiki/Periodic-Table.md](../wiki/Periodic-Table.md)
- v1.1 release notes: [CHANGELOG.md](../../CHANGELOG.md#110--2026-05-09)
- Partnership pitch: [docs/sales/01-PARTNERSHIP-PITCH.md](./01-PARTNERSHIP-PITCH.md)
- EU AI Act compliance pitch: [docs/sales/02-EU-AI-ACT-COMPLIANCE.md](./02-EU-AI-ACT-COMPLIANCE.md)
