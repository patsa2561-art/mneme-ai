#!/usr/bin/env bash
# Deploy the Mneme X-Ray server onto an EXISTING droplet — fully ISOLATED from
# whatever else runs there (e.g. the cosmic-link server on :8081). Everything is
# ADDITIVE and REVERSIBLE: a new systemd service on a new port + ONE appended
# Caddy site block. It never touches existing services, ports, or Caddy blocks.
#
#   Deploy:   ./scripts/deploy-xray.sh root@161.35.122.73 --key=~/.ssh/impct_do
#   Teardown: ./scripts/deploy-xray.sh root@161.35.122.73 --key=~/.ssh/impct_do --down
#
# Defaults give a working HTTPS URL with ZERO DNS setup via nip.io:
#   https://xray.<IP>.nip.io
set -euo pipefail

HOST="${1:-}"; shift || true
KEY=""; PORT="8787"; DIR="/srv/mneme-xray"; DATA="/srv/mneme-xray-data"
BRANCH="main"; REPO="https://github.com/patsa2561-art/mneme-ai.git"; HOSTNAME=""; DOWN=0
for a in "$@"; do case "$a" in
  --key=*) KEY="-i ${a#*=}" ;;
  --port=*) PORT="${a#*=}" ;;
  --hostname=*) HOSTNAME="${a#*=}" ;;
  --branch=*) BRANCH="${a#*=}" ;;
  --down) DOWN=1 ;;
esac; done
[ -z "$HOST" ] && { echo "usage: $0 <user@host> [--key=PATH] [--hostname=H] [--port=N] [--down]"; exit 1; }

# derive default hostname xray.<ip>.nip.io from host (works with no DNS)
if [ -z "$HOSTNAME" ]; then IP="${HOST##*@}"; HOSTNAME="xray.${IP}.nip.io"; fi
SSH="ssh $KEY -o StrictHostKeyChecking=accept-new $HOST"

if [ "$DOWN" = "1" ]; then
  echo "→ tearing down X-Ray (cosmic + Caddy core stay untouched)…"
  $SSH "systemctl disable --now mneme-xray 2>/dev/null || true; rm -f /etc/systemd/system/mneme-xray.service; systemctl daemon-reload;
        f=/etc/caddy/Caddyfile; if grep -q '# >>> mneme-xray' \$f; then sed -i '/# >>> mneme-xray/,/# <<< mneme-xray/d' \$f; caddy reload --config \$f 2>/dev/null || systemctl reload caddy; fi;
        echo 'X-Ray removed.'"
  exit 0
fi

echo "→ deploying X-Ray to $HOST  (port $PORT, https://$HOSTNAME) — isolated, additive"
$SSH bash -s <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null || apt-get update -qq && apt-get install -y -qq git
# clone or update (own dir; never touches existing services)
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --depth 1 origin "$BRANCH" -q && git -C "$DIR" reset --hard "origin/$BRANCH" -q;
else rm -rf "$DIR"; git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR" -q; fi
cd "$DIR"
echo "  installing deps (this can take a minute)…"
NODE_OPTIONS=--max-old-space-size=1536 npm install --ignore-scripts --no-audit --no-fund -q
echo "  building core + xray…"
NODE_OPTIONS=--max-old-space-size=1536 npx tsc -b packages/xray
mkdir -p "$DATA"

# systemd service — own service, binds localhost only (Caddy fronts it)
cat > /etc/systemd/system/mneme-xray.service <<UNIT
[Unit]
Description=Mneme X-Ray server
After=network.target
[Service]
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=XRAY_DATA_DIR=$DATA
WorkingDirectory=$DIR
ExecStart=/usr/bin/node $DIR/packages/xray/dist/server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now mneme-xray

# Caddy — APPEND one sentinel-wrapped block (idempotent); never edits existing blocks
f=/etc/caddy/Caddyfile
if ! grep -q '# >>> mneme-xray' "\$f"; then
cat >> "\$f" <<CADDY

# >>> mneme-xray (added by deploy-xray.sh — safe to remove this block)
$HOSTNAME {
  reverse_proxy 127.0.0.1:$PORT
  encode gzip
}
# <<< mneme-xray
CADDY
fi
caddy validate --config "\$f" >/dev/null 2>&1 || { echo "Caddyfile validate failed — not reloading"; exit 1; }
caddy reload --config "\$f" 2>/dev/null || systemctl reload caddy

sleep 2
code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/health || echo 000)
echo "  local health: \$code"
systemctl is-active --quiet mneme-cosmic && echo "  ✓ mneme-cosmic STILL running (untouched)" || echo "  (cosmic not present)"
REMOTE

echo "✓ X-Ray live at: https://$HOSTNAME   (give it ~30s for the TLS cert on first hit)"
echo "  cosmic on :8081 was never touched. Teardown anytime: $0 $HOST --key=... --down"
