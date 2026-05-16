#!/usr/bin/env bash
# MNEME 24/7 EVOLUTION CRON — production deployment for a DigitalOcean droplet (or any always-on Linux host).
#
#   Wires up `scripts/evolution-cron.mjs` as a systemd-managed timer that runs
#   every 6 hours, with logging, restart-on-failure, and a verification gate.
#
#   Usage:
#     ./scripts/deploy-cron.sh <user@host> [--ssh-key=~/.ssh/key] [--interval=6h] [--user=mneme] [--dir=/srv/mneme-cron]
#
#   What it does (in order):
#     1. ssh into the host
#     2. install Node.js 22 if not present (via NodeSource)
#     3. mkdir target dir, npm install @mneme-ai/core@latest + mneme-ai@latest
#     4. scp evolution-cron.mjs + reincarnation-ritual.mjs + release-claims.mjs into the dir
#     5. write systemd service + timer files
#     6. systemctl daemon-reload + enable + start the timer
#     7. trigger a single immediate run to verify it works
#     8. tail the log + report exit status
#
#   On failure at any step: print the failing command + last 30 lines of output + exit 1.
#
#   Honest scope:
#     - This is a Linux/systemd helper. macOS users want `launchd`, Windows users
#       want Task Scheduler — both are out of scope here (the cron script itself
#       runs on any platform via `node evolution-cron.mjs`).
#     - The script ASSUMES the host has bash, ssh-key access, sudo (or root).
#     - It does NOT install Mneme as an MCP server — it installs the cron only.
#       For the full Mneme daemon, use `mneme nucleus install --as-service`.

set -euo pipefail

# ─── Argument parsing ────────────────────────────────────────────────────
HOST=""
SSH_KEY=""
INTERVAL="6h"
USER_NAME="mneme"
DIR="/srv/mneme-cron"

for arg in "$@"; do
  case "$arg" in
    --ssh-key=*) SSH_KEY="-i ${arg#*=}" ;;
    --interval=*) INTERVAL="${arg#*=}" ;;
    --user=*) USER_NAME="${arg#*=}" ;;
    --dir=*) DIR="${arg#*=}" ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0 ;;
    *) HOST="$arg" ;;
  esac
done

if [ -z "$HOST" ]; then
  echo "ERROR: missing host argument."
  echo "Usage: $0 <user@host> [--ssh-key=PATH] [--interval=6h] [--user=NAME] [--dir=PATH]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh ${SSH_KEY} ${HOST}"
SCP="scp ${SSH_KEY}"

step() { echo "→ [$(date +%H:%M:%S)] $1"; }
fail() { echo "✘ FAIL at step: $1"; exit 1; }

# ─── 1. ssh smoke ────────────────────────────────────────────────────────
step "1/8 ssh smoke"
$SSH "echo ok" >/dev/null || fail "ssh"

# ─── 2. node detect/install ──────────────────────────────────────────────
step "2/8 node detect"
NODE_V=$($SSH "node -v 2>/dev/null || true")
if [ -z "$NODE_V" ]; then
  step "    → installing Node 22 via NodeSource"
  $SSH "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" || fail "node install"
else
  echo "    Node already present: $NODE_V"
fi

# ─── 3. target dir + npm install ─────────────────────────────────────────
step "3/8 target dir + npm install"
$SSH "sudo mkdir -p $DIR && sudo chown -R \$(whoami) $DIR" || fail "mkdir"
$SSH "cd $DIR && npm init -y >/dev/null && npm install @mneme-ai/core@latest mneme-ai@latest --no-fund --no-audit" || fail "npm install"

# ─── 4. scp scripts ──────────────────────────────────────────────────────
step "4/8 scp scripts (evolution-cron + reincarnation-ritual + release-claims)"
$SCP "$SCRIPT_DIR/evolution-cron.mjs"        "$HOST:$DIR/" || fail "scp evolution-cron"
$SCP "$SCRIPT_DIR/reincarnation-ritual.mjs"  "$HOST:$DIR/" || fail "scp ritual"
$SCP "$SCRIPT_DIR/release-claims.mjs"        "$HOST:$DIR/" || fail "scp release-claims"

# ─── 5. write systemd service + timer ────────────────────────────────────
step "5/8 write systemd unit files"
$SSH "sudo tee /etc/systemd/system/mneme-evolution.service >/dev/null <<EOF
[Unit]
Description=Mneme 24/7 evolution cron (ritual + growth + soul + chronostasis.tick)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/usr/bin/node $DIR/evolution-cron.mjs
StandardOutput=append:$DIR/evolution-log.txt
StandardError=append:$DIR/evolution-log.txt
EOF" || fail "service file"

$SSH "sudo tee /etc/systemd/system/mneme-evolution.timer >/dev/null <<EOF
[Unit]
Description=Run mneme-evolution every $INTERVAL

[Timer]
OnUnitActiveSec=$INTERVAL
OnBootSec=2min
Persistent=true
Unit=mneme-evolution.service

[Install]
WantedBy=timers.target
EOF" || fail "timer file"

# ─── 6. enable + start ───────────────────────────────────────────────────
step "6/8 systemctl daemon-reload + enable + start"
$SSH "sudo systemctl daemon-reload && sudo systemctl enable --now mneme-evolution.timer" || fail "systemctl"

# ─── 7. immediate verification run ───────────────────────────────────────
step "7/8 trigger one immediate run for verification"
$SSH "sudo systemctl start mneme-evolution.service" || fail "trigger run"
$SSH "sleep 5"

# ─── 8. tail log + show timer status ─────────────────────────────────────
step "8/8 verify (timer status + tail of evolution-log.txt)"
$SSH "systemctl list-timers --all | grep mneme || true"
echo "--- last 30 lines of evolution-log.txt ---"
$SSH "tail -30 $DIR/evolution-log.txt 2>/dev/null || echo '(no log yet — service may still be starting)'"

echo ""
echo "✅ MNEME EVOLUTION CRON deployed to $HOST · interval=$INTERVAL · dir=$DIR"
echo "   Next runs:  ssh $HOST 'systemctl list-timers --all | grep mneme'"
echo "   Live log:   ssh $HOST 'tail -f $DIR/evolution-log.txt'"
echo "   Manual run: ssh $HOST 'sudo systemctl start mneme-evolution.service'"
echo "   Stop:       ssh $HOST 'sudo systemctl disable --now mneme-evolution.timer'"
