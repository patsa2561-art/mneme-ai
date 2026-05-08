# Mneme Federation Hub

Reference Express server for the Phase 5 Wisdom Federation network.

## Run

```bash
cd packages/saas/federation-hub
npm install
npm run dev          # tsx watcher
# or for prod:
npm run build && npm start
```

Defaults:
- Port: `8080` (override with `PORT=`)
- k-anonymity floor: `20` (override with `MIN_K_ANONYMITY=`)
- Storage: in-memory (production: replace with Postgres)

## API

### `POST /api/signal`

Submit a signed signal envelope. Validates:
- Protocol version
- k-anonymity floor (envelope's `repoCommitCount` ≥ MIN_K_ANONYMITY)
- Ed25519 signature (if `publicKeyPem` provided)

Returns:
```json
{ "ok": true, "patternBucketSize": 47 }
```

### `GET /api/aggregate?pattern=regret`

Query aggregate signals for a pattern. Enforces k-anonymity:
returns `aggregate: null` if fewer than `MIN_K_ANONYMITY` contributors.

```json
{
  "ok": true,
  "pattern": "regret",
  "aggregate": { "regretCount": 12.4, "totalCommits": 4750 },
  "contributorCount": 247,
  "kAnonymityFloor": 20
}
```

### `GET /healthz`

Liveness probe — returns `{ ok: true, version, patterns }`.

## Production checklist

This is a **reference** implementation. Before production:

- [ ] Replace in-memory store with Postgres + a contributions table
- [ ] Add per-contributor rate limiting (sybil resistance)
- [ ] Add HTTP signature OR API key auth on `/api/signal`
- [ ] Run behind nginx / Caddy with TLS
- [ ] Add Prometheus metrics
- [ ] Add a contributor reputation system (downvote bad actors)
- [ ] Implement signal expiry (e.g. drop > 90d old)
- [ ] Audit DP epsilon end-to-end (no ε-budget exhaustion attacks)

## Protocol spec

See `ROADMAP_PHASES_3_TO_6.md#phase-5--cross-repo-wisdom-federation` for the full protocol design notes.
