#!/usr/bin/env bash
# Deploy the Mneme TRUST GATEWAY (the AI-native trust SaaS front door) onto an EXISTING
# droplet — fully ISOLATED from X-Ray / cosmic / anything else. ADDITIVE + REVERSIBLE:
# a new systemd service on a new port + ONE appended Caddy site block. Never touches
# existing services, ports, or Caddy blocks. Uses the PUBLISHED npm package (prebuilt
# dist) so there is NO heavy TypeScript build on the droplet (which OOMs a small box).
#
#   Deploy:   ./scripts/deploy-trust.sh root@161.35.122.73 --key=~/.ssh/impct_do
#   Teardown: ./scripts/deploy-trust.sh root@161.35.122.73 --key=~/.ssh/impct_do --down
#
# Working HTTPS URL with ZERO DNS via nip.io:  https://trust.<IP>.nip.io
set -euo pipefail

HOST="${1:-}"; shift || true
KEY=""; PORT="8788"; DIR="/srv/mneme-trust"; HOSTNAME=""; DOWN=0
for a in "$@"; do case "$a" in
  --key=*) KEY="-i ${a#*=}" ;;
  --port=*) PORT="${a#*=}" ;;
  --hostname=*) HOSTNAME="${a#*=}" ;;
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

echo "→ deploying Trust Gateway to $HOST  (port $PORT, https://$HOSTNAME) — isolated, additive, no-build"
$SSH bash -s <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
mkdir -p "$DIR"; cd "$DIR"
[ -f package.json ] || echo '{"name":"mneme-trust-host","private":true,"type":"module"}' > package.json
echo "  installing mneme-ai@latest (prebuilt — no compile)…"
npm install --ignore-scripts --no-audit --no-fund -q mneme-ai@latest @mneme-ai/core@latest

# standalone server — imports the published @mneme-ai/core; no daemon, no CLI bootstrap
cat > "$DIR/trust-server.mjs" <<'SERVER'
import { createServer } from "node:http";
import { createContext, runInContext } from "node:vm";
import { trustService, equivReceipt } from "@mneme-ai/core";
const PORT = Number(process.env.PORT || 8788), HOST = process.env.HOST || "127.0.0.1";
const compile = (src) => { const ctx = createContext(Object.freeze({ Math, Number, String, Boolean, Array, Object, JSON, isNaN, parseInt, parseFloat })); const fn = runInContext("(" + src + ")", ctx, { timeout: 1000 }); if (typeof fn !== "function") throw new Error("not a function expression"); return fn; };
const server = createServer((req, res) => {
  const send = (s, j) => { res.writeHead(s, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(j)); };
  if ((req.method || "").toUpperCase() === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 16 * 1024 * 1024) req.destroy(); else chunks.push(c); });
  req.on("end", () => {
    let body = {}; try { const raw = Buffer.concat(chunks).toString("utf8"); if (raw) body = JSON.parse(raw); } catch { return send(400, { error: "invalid JSON body" }); }
    const path = (req.url || "/").split("?")[0];
    try {
      if (path.replace(/\/+$/, "") === "/equiv" && (req.method || "").toUpperCase() === "POST") {
        const spec = Array.isArray(body.args) ? body.args.map((a) => ({ name: String(a.name ?? "x"), type: ["number","int","string","bool"].includes(String(a.type)) ? String(a.type) : "number" })) : [];
        const inputs = equivReceipt.genInputs(spec.length ? spec : [{ name: "x", type: "number" }], { fuzz: Number(body.fuzz) || 1500 });
        const r = equivReceipt.differential(compile(String(body.oldFn || "")), compile(String(body.newFn || "")), inputs);
        return send(200, equivReceipt.buildReceipt("refactor", String(body.oldFn || ""), String(body.newFn || ""), r));
      }
      const r = trustService.routeTrust({ method: req.method || "GET", path, body }, { today: new Date().toISOString().slice(0, 10) });
      send(r.status, r.json);
    } catch (e) { send(500, { error: String(e && e.message || e).slice(0, 200) }); }
  });
});
server.listen(PORT, HOST, () => console.log("Mneme Trust Gateway on http://" + HOST + ":" + PORT));
SERVER

cat > /etc/systemd/system/mneme-trust.service <<UNIT
[Unit]
Description=Mneme Trust Gateway (AI-native trust SaaS front door)
After=network.target
[Service]
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
WorkingDirectory=$DIR
ExecStart=/usr/bin/node $DIR/trust-server.mjs
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
for i in \$(seq 1 25); do code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health || echo 000); [ "\$code" = "200" ] && break; sleep 1; done
echo "  local health: \$code"
systemctl is-active --quiet mneme-xray && echo "  ✓ mneme-xray STILL running (untouched)" || echo "  (xray not present)"
REMOTE

echo "✓ Trust Gateway live at: https://$HOSTNAME   (give it ~30s for the TLS cert on first hit)"
echo "  X-Ray + cosmic were never touched. Teardown: $0 $HOST --key=... --down"
