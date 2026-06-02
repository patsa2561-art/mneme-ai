# @mneme-ai/xray — Repo X-Ray

A **signed, raw-free, deterministic X-Ray of any repo.** Paste a public git URL (or point the CLI at a local path) and get a graded report: dependency mortality, secret leaks, bus factor, vitality, and complexity hotspots.

Three guarantees, by construction:

1. **Accurate.** Every number comes from a deterministic `@mneme-ai/core` analyzer (git history · AST outline · npm registry metadata · regex secret scan). **No LLM guesses anything** — the same repo at the same commit always produces the same report.
2. **Private.** Public repos are shallow-cloned to a temp dir, analysed, and **deleted**. The report is **raw-free** — it carries only metrics, counts, line numbers, symbol names, and hashes, never a line of source. `xrayLeaksRaw()` proves it (gauntlet-enforced). Private repos never leave your machine: run the CLI locally.
3. **Verifiable.** The whole report is sealed with an **Ed25519 NOTARY receipt** any third party verifies **offline** with the embedded public key — no Mneme instance, no network, no shared secret.

## CLI

```bash
mneme-xray .                                   # local repo (nothing uploaded)
mneme-xray https://github.com/owner/repo       # public repo
mneme-xray https://github.com/owner/repo --json
```

## Server (the "Lighthouse")

```bash
npm run -w @mneme-ai/xray serve                # http://0.0.0.0:8787
```

| Endpoint | |
|---|---|
| `POST /api/xray` `{gitUrl}` | clone public repo → battery → raw-free gate → NOTARY seal → report |
| `POST /api/verify` `{signed}` | verify a report's receipt offline |
| `GET /api/board` | recent public X-Rays |
| `GET /api/health` | liveness |
| `GET /` | the clean white UI |

Env: `PORT` (8787) · `HOST` (0.0.0.0) · `XRAY_DATA_DIR` (./.xray-data).

## Deploy 24/7 on DigitalOcean

**App Platform:** `doctl apps create --spec packages/xray/.do/app.yaml` (auto-deploys on push to `main`).

**Droplet (durable board):**
```bash
docker build -f packages/xray/Dockerfile -t mneme-xray .
docker run -d --restart=always -p 80:8787 -v /srv/xray-data:/data mneme-xray
```

## Architecture — Lighthouse + Reactor

```
[ your machine: code ]  --mneme-xray ./path-->  raw-free signed report   (private repos: never leaves)
[ public git URL ]      --POST /api/xray----->  Lighthouse (DigitalOcean): clone → analyse → delete → sign
```

The server (Lighthouse) only ever holds raw-free, signed reports. The accurate engine (Reactor) runs the same `@mneme-ai/core` functions whether local or in the cloud.
