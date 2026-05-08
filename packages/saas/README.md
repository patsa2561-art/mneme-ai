# @mneme-ai/saas — deployable SaaS skeleton (v1.7.0)

This package is a **deployable starter** for the Mneme SaaS dashboard
(Phase 6 of the v1.x roadmap). It is NOT published to npm — it ships as
source in the monorepo so contributors can deploy it on their own infra.

## What's inside

```
packages/saas/
├── README.md                      ← this file
├── federation-hub/                ← reference Phase 5 hub server (Express)
│   ├── package.json
│   ├── server.ts                  ← validates Ed25519-signed signal envelopes
│   └── README.md
└── dashboard/                     ← Phase 6 multi-tenant Next.js dashboard
    ├── package.json
    ├── next.config.js
    ├── pages/
    └── README.md
```

## Why "skeleton" not "fully shipped"

A SaaS dashboard needs:
- Cloud account (Vercel / AWS / Fly.io)
- Postgres database
- Auth provider (WorkOS / Auth0 / Clerk)
- DNS + SSL
- Billing integration (Stripe)
- Live ops + on-call

**None of this can be shipped via npm publish or git push.** It requires
infrastructure setup that is necessarily user-specific. v1.7.0 ships the
CODE that's ready to deploy — actual deployment is the user's call.

For solo devs / small teams who want the cross-org dashboard but can't
self-host: the public-hosted Mneme SaaS is on the roadmap as a v2.0+
managed offering.

## Federation Hub — quick deploy

```bash
cd packages/saas/federation-hub
npm install
npm run start    # listens on :8080 by default
```

It accepts signed signal envelopes via:

```
POST /api/signal     → submit a signed signal envelope
GET  /api/aggregate  → query aggregates (k-anonymity ≥20 enforced)
GET  /healthz        → liveness probe
```

See `federation-hub/README.md` for the protocol spec + deploy notes.

## Dashboard — quick deploy

```bash
cd packages/saas/dashboard
npm install
cp .env.example .env       # set DATABASE_URL + AUTH_SECRET
npm run dev                # http://localhost:3000
```

Production deploy via Vercel:

```bash
vercel deploy --prod
```

See `dashboard/README.md` for the architecture + deploy notes.

## Roadmap

- **v1.7.0** (this release) — federation-hub functional skeleton + dashboard scaffold
- **v1.8.0** — dashboard pages: cross-repo atrophy heatmap, fleet-wide audit verdicts, incident correlation
- **v1.9.0** — billing + multi-tenant auth + production hardening
- **v2.0.0** — public hosted SaaS
