# Mneme COSMIC LINK — self-hosted state server

Deploy in **5 minutes** on a free / $4-6/mo VPS (DigitalOcean, Hetzner, fly.io, Linode).

## What it is

A single-file Node HTTP server that holds the latest Mneme state for each session. Parent (your laptop) PUBLISHES; receiving AIs (or your own browser) READ.

- **Single file**, zero deps, ~400 LOC
- **In-memory store** (optional disk persist via `--persist`)
- **HMAC auth** on publish + revoke; reads are open
- **Auto-prune** sessions stale > 24 h
- **STALE BANNER** — if no publish > 30 min, served HTML page tells the AI honestly
- **Server-Sent Events** stream so live readers get push updates

## What happens when parent computer is OFF

| Scenario | COSMIC behavior |
|---|---|
| Parent ON, publishing every 5 min | Live state served; SSE clients get push |
| Parent OFFLINE 5 min | Last published snapshot still served |
| Parent OFFLINE 30+ min | Served HTML adds red banner: *"⚠ PARENT OFFLINE since X"* |
| Parent OFFLINE 24+ h | Session auto-evicted to free memory |
| Receiving AI fetches stale URL | Gets the snapshot; banner tells AI to warn the user |

## Deploy on DigitalOcean (5 min)

```bash
# 1. Create cheapest droplet (Ubuntu 22.04, $4/mo).
# 2. SSH in:
ssh root@<your-droplet-ip>

# 3. Install Node 22 + the cosmic script:
curl -fsSL https://deb.nodesource.com/setup_22.x | bash
apt-get install -y nodejs
mkdir -p /opt/mneme-cosmic
curl -o /opt/mneme-cosmic/mneme-cosmic.mjs https://raw.githubusercontent.com/patsa2561-art/mneme-ai/main/packages/core/cosmic-server/bin/mneme-cosmic.mjs

# 4. systemd unit:
cat >/etc/systemd/system/mneme-cosmic.service <<'EOF'
[Unit]
Description=Mneme COSMIC LINK
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mneme-cosmic
ExecStart=/usr/bin/node /opt/mneme-cosmic/mneme-cosmic.mjs --port 8081 --persist /opt/mneme-cosmic/state.json
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mneme-cosmic
systemctl status mneme-cosmic

# 5. (Optional) TLS via Caddy — automatic Let's Encrypt:
apt-get install -y caddy
cat >/etc/caddy/Caddyfile <<'EOF'
cosmic.your-domain.com {
  reverse_proxy localhost:8081
}
EOF
systemctl restart caddy
```

Done. Visit `https://cosmic.your-domain.com/healthz` — should return `{"ok":true,"sessions":0,"uptime":...}`.

## Deploy via Docker (alternative)

```dockerfile
# Dockerfile (in this directory)
FROM node:22-alpine
WORKDIR /app
COPY bin/mneme-cosmic.mjs ./
EXPOSE 8081
CMD ["node", "mneme-cosmic.mjs", "--port", "8081", "--persist", "/data/state.json"]
```

```bash
docker build -t mneme-cosmic .
docker run -d --name cosmic -p 8081:8081 -v cosmic_data:/data --restart unless-stopped mneme-cosmic
```

## CLI flags

| Flag | Default | Meaning |
|---|---|---|
| `--port` | 8081 | Listen port |
| `--host` | 0.0.0.0 | Bind address |
| `--persist <path>` | (none) | Write sessions to disk on every change |
| `--ghost` | false | Zero-log mode (no console, no persist) |
| `--max-bytes` | 262144 | Max body size per publish |
| `--max-sessions` | 10000 | LRU evict above this |
| `--stale-after-ms` | 1800000 | 30 min — STALE banner threshold |
| `--evict-after-ms` | 86400000 | 24 h — auto-evict |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/sessions/:token` | HMAC bearer | Publish state |
| `GET` | `/api/v1/sessions/:token.json` | open | Read state JSON |
| `GET` | `/sessions/:token` | open | Human HTML page |
| `GET` | `/sessions/:token/sse` | open | Server-Sent Events stream |
| `POST` | `/api/v1/sessions/:token/revoke` | HMAC bearer | Kill session |
| `GET` | `/healthz` | open | Health check |

## Use from Mneme

```ts
import { mintSession, publishToCosmic } from "@mneme-ai/core/cosmic";

const session = mintSession({ serverUrl: "https://cosmic.your-domain.com" });
console.log("public read URL:", session.publicUrl);
console.log("save the secret:", session.secret);

await publishToCosmic({
  session,
  state: { mnemeVersion: "2.11.0", lastCommit: "abc123" },
});
```

Or via MCP:

```
mneme.cosmic.mint({ serverUrl: "https://cosmic.your-domain.com" })
mneme.cosmic.publish({ session, state: { ... } })
```

Embed `session.publicUrl` in `mneme.handoff.fresh({ stargateUrl: session.publicUrl })` so the receiving AI's NEXUS-LOCK soul prompt carries the COSMIC link.

## Privacy + Security

- **State is open-read by design.** Anyone with the token URL can read. Never publish source code or secrets — only version + commit metadata.
- **Publish/revoke require HMAC.** Lost the secret? Mint a new session.
- **Sessions are ephemeral.** Auto-evicted after 24 h of no publish, or on user revoke.
- **TLS strongly recommended.** Use Caddy / nginx in front for HTTPS.
- **Ghost mode** (`--ghost`) suppresses all logs; in-memory only; no disk persist.

## What COSMIC does NOT do

- ❌ Real-time push to AIs that don't support SSE (Gemini Free, ChatGPT no-browse, Claude.ai mobile)
- ❌ Source code storage (intentional — out of scope)
- ❌ Authentication for receivers (the URL itself is the capability)
- ❌ Survive parent offline > 24 h (auto-evicted)

## Tier of compatibility per receiving AI

| Receiver | Can fetch the URL? | What it sees |
|---|---|---|
| ChatGPT (browse on) | ✅ | Live state JSON or HTML |
| Claude.ai web (with web access) | ✅ | Live state |
| Cursor / Copilot | ✅ | Via MCP — bypasses entirely |
| Perplexity | ✅ | Live state |
| Gemini Free mobile | ❌ no fetch | Sees URL in prompt but cannot follow it |
| Gemini paid | ⚠ depends on edition | Some can follow |
| Custom GPTs (with action) | ✅ + SSE possible | Best experience |
