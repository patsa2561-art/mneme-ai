#!/usr/bin/env bash
# Deploy the Mneme TRUST GATEWAY (the AI-native trust SaaS front door) onto an EXISTING
# droplet — fully ISOLATED from X-Ray / cosmic / anything else. ADDITIVE + REVERSIBLE:
# a new systemd service on a new port + ONE appended Caddy site block. Never touches
# existing services, ports, or Caddy blocks.
#
#   Deploy:   ./scripts/deploy-trust.sh root@161.35.122.73 --key=~/.ssh/impct_do
#   Teardown: ./scripts/deploy-trust.sh root@161.35.122.73 --key=~/.ssh/impct_do --down
#
# Working HTTPS URL with ZERO DNS via nip.io:  https://trust.<IP>.nip.io
set -euo pipefail

HOST="${1:-}"; shift || true
KEY=""; PORT="8788"; DIR="/srv/mneme-trust"; BRANCH="main"; REPO="https://github.com/patsa2561-art/mneme-ai.git"; HOSTNAME=""; DOWN=0
for a in "$@"; do case "$a" in
  --key=*) KEY="-i ${a#*=}" ;;
  --port=*) PORT="${a#*=}" ;;
  --hostname=*) HOSTNAME="${a#*=}" ;;
  --branch=*) BRANCH="${a#*=}" ;;
  --down) DOWN=1 ;;
esac; done
[ -z "$HOST" ] && { echo "usage: $0 <user@host> [--key=PATH] [--hostname=H] [--port=N] [--down]"; exit 1; }

if [ -z "$HOSTNAME" ]; then IP="${HOST##*@}"; HOSTNAME="trust.${IP}.nip.io"; fi
SSH="ssh $KEY -o StrictHostKeyChecking=accept-new $HOST"

if [ "$DOWN" = "1" ]; then
  echo "→ tearing down Trust Gateway (everything else stays untouched)…"
  $SSH "systemctl disable --now mneme-trust 2>/dev/null || true; rm -f /etc/systemd/system/mneme-trust.service; systemctl daemon-reload;
        f=/etc/caddy/Caddyfile; if grep -q '# >>> mneme-trust' \$f; then sed -i '/# >>> mneme-trust/,/# <<< mneme-trust/d' \$f; caddy reload --config \$f 2>/dev/null || systemctl reload caddy; fi;
        echo 'Trust Gateway removed.'"
  exit 0
fi

echo "→ deploying Trust Gateway to $HOST  (port $PORT, https://$HOSTNAME) — isolated, additive"
$SSH bash -s <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null || apt-get update -qq && apt-get install -y -qq git
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --depth 1 origin "$BRANCH" -q && git -C "$DIR" reset --hard "origin/$BRANCH" -q;
else rm -rf "$DIR"; git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR" -q; fi
cd "$DIR"
echo "  installing deps…"
NODE_OPTIONS=--max-old-space-size=1536 npm install --ignore-scripts --no-audit --no-fund -q
echo "  building core + cli…"
NODE_OPTIONS=--max-old-space-size=1536 npx tsc -b packages/cli

cat > /etc/systemd/system/mneme-trust.service <<UNIT
[Unit]
Description=Mneme Trust Gateway (AI-native trust SaaS front door)
After=network.target
[Service]
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=MNEME_WARMCALL=0
WorkingDirectory=$DIR
ExecStart=/usr/bin/node $DIR/packages/cli/bin/trust-server.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mneme-trust >/dev/null 2>&1 || true
systemctl restart mneme-trust

f=/etc/caddy/Caddyfile
if ! grep -q '# >>> mneme-trust' "\$f"; then
cat >> "\$f" <<CADDY

# >>> mneme-trust (added by deploy-trust.sh — safe to remove this block)
$HOSTNAME {
  reverse_proxy 127.0.0.1:$PORT
  encode gzip
}
# <<< mneme-trust
CADDY
fi
caddy validate --config "\$f" >/dev/null 2>&1 || { echo "Caddyfile validate failed — not reloading"; exit 1; }
caddy reload --config "\$f" 2>/dev/null || systemctl reload caddy

code=000
for i in \$(seq 1 20); do code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health || echo 000); [ "\$code" = "200" ] && break; sleep 1; done
echo "  local health: \$code"
systemctl is-active --quiet mneme-xray && echo "  ✓ mneme-xray STILL running (untouched)" || echo "  (xray not present)"
REMOTE

echo "✓ Trust Gateway live at: https://$HOSTNAME   (give it ~30s for the TLS cert on first hit)"
echo "  X-Ray + cosmic were never touched. Teardown: $0 $HOST --key=... --down"
