#!/usr/bin/env bash
# Mneme COSMIC LINK — one-shot deploy script.
#
# Run on a fresh Ubuntu 22.04+ droplet as root.
# Auto-detects which TLS strategy to use based on what you supply.
#
# USAGE:
#
#   # Easiest (no domain): uses sslip.io magic DNS + Let's Encrypt
#   curl -fsSL https://raw.githubusercontent.com/patsa2561-art/mneme-ai/main/packages/core/cosmic-server/bin/deploy-cosmic.sh | bash
#
#   # With your own domain (Cloudflare optional):
#   curl -fsSL https://raw.githubusercontent.com/patsa2561-art/mneme-ai/main/packages/core/cosmic-server/bin/deploy-cosmic.sh \
#     | DOMAIN=cosmic.example.com bash
#
#   # No public access — local-only + cloudflared tunnel:
#   curl -fsSL .../deploy-cosmic.sh | TUNNEL=1 bash
#
#   # Customize:
#   PORT=8081 DOMAIN=cosmic.your-domain.com bash deploy-cosmic.sh
#
set -euo pipefail

PORT="${PORT:-8081}"
DOMAIN="${DOMAIN:-}"
TUNNEL="${TUNNEL:-0}"
GHOST="${GHOST:-0}"
INSTALL_DIR="/opt/mneme-cosmic"
COSMIC_URL="https://raw.githubusercontent.com/patsa2561-art/mneme-ai/main/packages/core/cosmic-server/bin/mneme-cosmic.mjs"

say() { printf "\033[1;36m[cosmic-deploy]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[cosmic-deploy WARN]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[cosmic-deploy FATAL]\033[0m %s\n" "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "run as root (sudo bash deploy-cosmic.sh)"
command -v apt-get >/dev/null || die "this script needs apt-get (Ubuntu/Debian)"

# 1. Detect public IP (used for sslip.io fallback)
say "detecting public IP..."
PUBLIC_IP="$(curl -fsSL https://ifconfig.me 2>/dev/null || curl -fsSL https://icanhazip.com 2>/dev/null || true)"
[[ -n "$PUBLIC_IP" ]] || die "could not detect public IP"
say "public IP: $PUBLIC_IP"

# 2. Decide hostname
if [[ "$TUNNEL" == "1" ]]; then
  HOSTNAME="(tunnel — assigned by cloudflared)"
elif [[ -n "$DOMAIN" ]]; then
  HOSTNAME="$DOMAIN"
  say "using your domain: $HOSTNAME"
else
  HOSTNAME="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"
  say "no DOMAIN provided — using sslip.io magic DNS: $HOSTNAME"
fi

# 3. Install Node 22 (idempotent)
if ! command -v node >/dev/null || [[ "$(node -p 'parseInt(process.versions.node)')" -lt 20 ]]; then
  say "installing Node 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash >/dev/null
  apt-get install -y nodejs >/dev/null
fi
say "node version: $(node -v)"

# 4. Install COSMIC server script
say "installing cosmic server to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$COSMIC_URL" -o "$INSTALL_DIR/mneme-cosmic.mjs"
chmod +x "$INSTALL_DIR/mneme-cosmic.mjs"

# 5. systemd unit
say "writing systemd unit..."
GHOST_FLAG=""
[[ "$GHOST" == "1" ]] && GHOST_FLAG="--ghost"
cat >/etc/systemd/system/mneme-cosmic.service <<EOF
[Unit]
Description=Mneme COSMIC LINK state server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/mneme-cosmic.mjs --port $PORT --persist $INSTALL_DIR/state.json $GHOST_FLAG
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mneme-cosmic >/dev/null
systemctl restart mneme-cosmic
sleep 2
systemctl is-active --quiet mneme-cosmic || die "mneme-cosmic failed to start; check journalctl -u mneme-cosmic"
say "mneme-cosmic systemd unit running"

# 6. TLS strategy
if [[ "$TUNNEL" == "1" ]]; then
  # Cloudflared tunnel (free, no domain needed)
  say "installing cloudflared..."
  if ! command -v cloudflared >/dev/null; then
    curl -fsSL "https://pkg.cloudflare.com/cloudflare-main.gpg" | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" >/etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq
    apt-get install -y cloudflared >/dev/null
  fi
  cat >/etc/systemd/system/mneme-cosmic-tunnel.service <<EOF
[Unit]
Description=Cloudflared quick tunnel for Mneme COSMIC
After=mneme-cosmic.service

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:$PORT
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now mneme-cosmic-tunnel
  sleep 8
  TUNNEL_URL="$(journalctl -u mneme-cosmic-tunnel -n 200 --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)"
  if [[ -n "$TUNNEL_URL" ]]; then
    say "✓ cloudflared tunnel: $TUNNEL_URL"
    PUBLIC_BASE_URL="$TUNNEL_URL"
  else
    warn "tunnel URL not yet visible — check 'journalctl -u mneme-cosmic-tunnel -f' in a few seconds"
    PUBLIC_BASE_URL="(pending in journalctl)"
  fi
else
  # Caddy + Let's Encrypt (works with sslip.io OR your domain)
  say "installing Caddy + auto-TLS for $HOSTNAME ..."
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y caddy >/dev/null
  fi
  cat >/etc/caddy/Caddyfile <<EOF
$HOSTNAME {
  reverse_proxy 127.0.0.1:$PORT
  encode gzip
}
EOF
  systemctl restart caddy
  sleep 4
  PUBLIC_BASE_URL="https://$HOSTNAME"
  if curl -fsSL --max-time 10 "$PUBLIC_BASE_URL/healthz" >/dev/null 2>&1; then
    say "✓ Caddy + TLS healthy at $PUBLIC_BASE_URL"
  else
    warn "Caddy is up but $PUBLIC_BASE_URL/healthz did not respond yet — Let's Encrypt cert may still be issuing (~30s)"
  fi
fi

# 7. UFW (best-effort)
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  if [[ "$TUNNEL" != "1" ]]; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi
  ufw --force enable >/dev/null 2>&1 || true
fi

# 8. Print summary
echo
echo "========================================================"
echo "  ✓ Mneme COSMIC LINK deployed"
echo "========================================================"
echo "  Server URL:      $PUBLIC_BASE_URL"
echo "  Health check:    $PUBLIC_BASE_URL/healthz"
echo "  Landing page:    $PUBLIC_BASE_URL/"
echo "  Logs:            journalctl -u mneme-cosmic -f"
[[ "$TUNNEL" == "1" ]] && echo "  Tunnel logs:     journalctl -u mneme-cosmic-tunnel -f"
echo
echo "  Use from Mneme:"
echo "    AI agent → mneme.cosmic.mint({serverUrl:\"$PUBLIC_BASE_URL\"})"
echo
echo "  Restart:         systemctl restart mneme-cosmic"
echo "  Stop:            systemctl stop mneme-cosmic"
echo "  Disable:         systemctl disable --now mneme-cosmic"
echo "========================================================"
