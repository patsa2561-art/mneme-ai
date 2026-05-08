# Mneme Dashboard (Phase 6 skeleton)

Multi-tenant Next.js dashboard for cross-org rollups across multiple
Mneme-instrumented repos. **Skeleton only in v1.7.0** — full pages land
in v1.8.0+.

## Architecture (v2.0+ target)

```
┌──────────────────────────────────────────────────────────┐
│  Next.js 14 (App Router) ─ Vercel-friendly              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Dashboards                                        │  │
│  │  • cross-repo atrophy heatmap                      │  │
│  │  • fleet-wide audit verdict timeline               │  │
│  │  • incident correlation graph                      │  │
│  │  • per-engineer passport (org-wide)                │  │
│  │  • compliance reports (EU AI Act / SOX / SOC2)     │  │
│  └────────────────────────────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────┴──────────────────────────────┐  │
│  │  API routes (server)                               │  │
│  │  POST /api/ingest    ← receives Mneme CLI uploads  │  │
│  │  GET  /api/atrophy   ← per-org rollup query        │  │
│  │  GET  /api/audit     ← fleet audit timeline query  │  │
│  └────────────────────────────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────┴──────────────────────────────┐  │
│  │  Postgres (multi-tenant, row-level security)      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Deploy

```bash
cd packages/saas/dashboard
npm install
cp .env.example .env       # set DATABASE_URL + AUTH_SECRET (when wired)
npm run dev                # http://localhost:3000

# Production deploy via Vercel:
vercel deploy --prod
```

## What's NOT yet implemented in v1.7.0

- Auth (WorkOS / Auth0 / Clerk integration)
- Postgres schema + migrations
- Live dashboard pages
- Mneme-CLI → SaaS upload protocol
- Billing (Stripe)
- On-call runbook

These land progressively in v1.8.0+ as the SaaS becomes a real product.

## Why a skeleton, not full impl

Shipping a SaaS requires infra setup outside the codebase: cloud accounts,
DNS, SSL, DB provisioning, on-call ops. v1.7.0 ships the architectural
seed; user can deploy + extend it as their needs develop.

Self-hosting Mneme + this dashboard = the **air-gapped Enterprise tier**
described in the (currently hidden) pricing doc.
