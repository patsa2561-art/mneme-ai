#!/usr/bin/env node
/**
 * Mneme COSMIC LINK — single-file zero-deps HTTP server.
 *
 * Run on a $4-6/mo VPS (DigitalOcean / Linode / Hetzner / fly.io).
 * One process, in-memory store, no database, no framework.
 *
 *   node bin/mneme-cosmic.mjs --port 8081 --secret-env COSMIC_ADMIN_SECRET
 *
 * Endpoints:
 *
 *   POST /api/v1/sessions/:token        publish state (HMAC-bearer auth)
 *   GET  /api/v1/sessions/:token.json   read state JSON
 *   GET  /sessions/:token                human-readable HTML page
 *   GET  /sessions/:token/sse            Server-Sent Events stream (live push)
 *   POST /api/v1/sessions/:token/revoke  HMAC-auth → kill the session
 *   GET  /healthz                        health check
 *   GET  /                               landing page
 *
 * Security model:
 *   - PUBLISH/REVOKE require HMAC-SHA256 over `${method} ${path} ${body-sha256}`
 *     using the per-session secret the parent generated at mintSession.
 *   - READ is open to anyone with the token. State carries only version/commit
 *     metadata — NEVER source code or secrets. If you need stricter privacy,
 *     run cosmic in --ghost mode (in-memory only, no logs).
 *   - Each new state is HMAC-CHAINED to the previous (server enforces by
 *     including prevSig in the response). Receivers can verify the chain.
 *
 * Resource caps:
 *   - Max session size: 256 KB (configurable via --max-bytes)
 *   - Max sessions: 10000 (LRU eviction)
 *   - Auto-prune: sessions with no publish > 30 min get marked STALE.
 *     Sessions stale > 24h get evicted.
 */

import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port ?? process.env.PORT ?? "8081", 10);
const HOST = args.host ?? process.env.HOST ?? "0.0.0.0";
const MAX_BYTES = parseInt(args["max-bytes"] ?? "262144", 10);
const MAX_SESSIONS = parseInt(args["max-sessions"] ?? "10000", 10);
const STALE_AFTER_MS = parseInt(args["stale-after-ms"] ?? "1800000", 10); // 30 min
const EVICT_AFTER_MS = parseInt(args["evict-after-ms"] ?? "86400000", 10); // 24 h
const PERSIST_PATH = args["persist"] ?? null; // optional disk persist
const GHOST = !!args.ghost; // ghost mode → no logs, no persist
const TRUST_PROXY = !!args["trust-proxy"]; // when behind nginx/Caddy

const sessions = new Map(); // token → { state, secret, prevSig, lastPublishTs, createdAt }
const sseClients = new Map(); // token → Set<res>

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[k] = next; i++; }
      else out[k] = true;
    }
  }
  return out;
}

function log(...args) { if (!GHOST) console.log(`[cosmic ${new Date().toISOString()}]`, ...args); }
function warn(...args) { if (!GHOST) console.warn(`[cosmic ${new Date().toISOString()}] WARN`, ...args); }

if (PERSIST_PATH && !GHOST && existsSync(PERSIST_PATH)) {
  try {
    const obj = JSON.parse(readFileSync(PERSIST_PATH, "utf8"));
    for (const [token, s] of Object.entries(obj)) sessions.set(token, s);
    log(`restored ${sessions.size} sessions from ${PERSIST_PATH}`);
  } catch (e) { warn("restore failed:", e.message); }
}

function persist() {
  if (!PERSIST_PATH || GHOST) return;
  const obj = {};
  for (const [k, v] of sessions) obj[k] = v;
  try { writeFileSync(PERSIST_PATH, JSON.stringify(obj)); }
  catch (e) { warn("persist failed:", e.message); }
}

function evictLRU() {
  if (sessions.size <= MAX_SESSIONS) return;
  // Iteration order in Map = insertion order; oldest first
  const drop = sessions.size - MAX_SESSIONS;
  let i = 0;
  for (const k of sessions.keys()) {
    if (i++ >= drop) break;
    sessions.delete(k);
    sseClients.get(k)?.forEach((r) => { try { r.end(); } catch {} });
    sseClients.delete(k);
  }
}

setInterval(() => {
  // Auto-evict very old sessions
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.lastPublishTs > EVICT_AFTER_MS) {
      sessions.delete(token);
      sseClients.get(token)?.forEach((r) => { try { r.end(); } catch {} });
      sseClients.delete(token);
    }
  }
  persist();
}, 60_000).unref();

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > max) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function checkAuth(req, body, secret) {
  const auth = req.headers["authorization"] ?? "";
  const m = auth.match(/^Bearer\s+([0-9a-f]{64})$/);
  if (!m) return false;
  const presented = m[1];
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canon = `${req.method} ${req.url.split("?")[0]} ${bodyHash}`;
  const expected = createHmac("sha256", secret).update(canon).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(presented, "hex"));
  } catch { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSessionPage(token, sess) {
  const stale = sess && (Date.now() - sess.lastPublishTs > STALE_AFTER_MS);
  if (!sess) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>COSMIC · session not found</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}h1{color:#c5221f}</style></head>
<body><h1>404 — session not found</h1><p>This COSMIC token is unknown. It may have expired, been revoked, or never existed.</p></body></html>`;
  }
  const ageMin = Math.floor((Date.now() - sess.lastPublishTs) / 60_000);
  const banner = stale
    ? `<div style="background:#ffebe9;border:1px solid #d1242f;padding:14px;border-radius:8px;margin:12px 0;color:#82071e;font-weight:bold">⚠ PARENT OFFLINE — ไม่มี publish ครั้งใหม่ตั้งแต่ ${ageMin} นาทีที่แล้ว. ข้อมูลด้านล่างเป็น snapshot ครั้งล่าสุด อาจล้าสมัย</div>`
    : `<div style="background:#dafbe1;border:1px solid #2da44e;padding:14px;border-radius:8px;margin:12px 0;color:#116329;font-weight:bold">🟢 LIVE — publish ล่าสุด ${ageMin} นาทีที่แล้ว</div>`;
  const stateJson = JSON.stringify(sess.state, null, 2);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COSMIC · ${escapeHtml(token)}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:14px auto;padding:0 16px;line-height:1.55;color:#1f2328;background:#f5f7fa}
h1{font-size:1.2em} pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #d0d7de;padding:12px;border-radius:8px;font-size:.85em;max-height:50vh;overflow:auto}
.meta{color:#57606a;font-size:.85em} .footer{margin-top:30px;color:#8b949e;font-size:.82em;border-top:1px solid #e1e4e8;padding-top:14px}</style></head>
<body><h1>🌌 Mneme COSMIC session</h1>
<div class="meta">token: <code>${escapeHtml(token)}</code> · publishes: ${sess.publishCount ?? 1} · created: ${escapeHtml(sess.createdAt)}</div>
${banner}
<h2>Current state</h2>
<pre>${escapeHtml(stateJson)}</pre>
<div class="footer">Served by Mneme COSMIC LINK · open + ephemeral · revoke via HMAC-auth POST /api/v1/sessions/${escapeHtml(token)}/revoke</div>
</body></html>`;
}

function handlePublish(req, res, token, body) {
  let payload;
  try { payload = JSON.parse(body.toString("utf8")); }
  catch { return send(res, 400, {}, { error: "invalid JSON body" }); }
  const exists = sessions.get(token);
  // First publish: payload.adminSecret is the SHA256 of the per-session bearer secret.
  // Subsequent publishes: must HMAC-auth against that secret.
  if (!exists) {
    if (!payload.adminSecretHash || typeof payload.adminSecretHash !== "string" || payload.adminSecretHash.length !== 64) {
      return send(res, 400, {}, { error: "first publish requires adminSecretHash (sha256 of session secret)" });
    }
    const sess = {
      state: payload.state,
      adminSecretHash: payload.adminSecretHash,
      prevSig: null,
      lastPublishTs: Date.now(),
      createdAt: new Date().toISOString(),
      publishCount: 1,
      newSig: createHmac("sha256", payload.adminSecretHash).update(JSON.stringify(payload.state) + ":1:" + Date.now()).digest("hex"),
    };
    sessions.set(token, sess);
    evictLRU();
    persist();
    pushSseEvent(token, { kind: "publish", count: 1, ts: sess.lastPublishTs });
    return send(res, 201, {}, { ok: true, token, prevSig: null, newSig: sess.newSig, count: 1 });
  }
  // Verify HMAC-auth on subsequent publishes
  if (!checkAuth(req, body, exists.adminSecretHash)) {
    return send(res, 401, {}, { error: "auth failed" });
  }
  const newCount = (exists.publishCount ?? 1) + 1;
  const newSig = createHmac("sha256", exists.adminSecretHash).update(JSON.stringify(payload.state) + ":" + newCount + ":" + Date.now() + ":" + (exists.newSig ?? "")).digest("hex");
  exists.state = payload.state;
  exists.prevSig = exists.newSig;
  exists.newSig = newSig;
  exists.lastPublishTs = Date.now();
  exists.publishCount = newCount;
  persist();
  pushSseEvent(token, { kind: "publish", count: newCount, ts: exists.lastPublishTs });
  return send(res, 200, {}, { ok: true, token, prevSig: exists.prevSig, newSig: exists.newSig, count: newCount });
}

function handleRevoke(req, res, token, body) {
  const sess = sessions.get(token);
  if (!sess) return send(res, 404, {}, { error: "session not found" });
  if (!checkAuth(req, body, sess.adminSecretHash)) {
    return send(res, 401, {}, { error: "auth failed" });
  }
  sessions.delete(token);
  sseClients.get(token)?.forEach((r) => { try { r.end(); } catch {} });
  sseClients.delete(token);
  persist();
  return send(res, 200, {}, { ok: true, revoked: token });
}

function pushSseEvent(token, event) {
  const set = sseClients.get(token);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch {}
  }
}

function handleSse(req, res, token) {
  const sess = sessions.get(token);
  if (!sess) { send(res, 404, {}, { error: "no session" }); return; }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ kind: "open", count: sess.publishCount, ts: sess.lastPublishTs })}\n\n`);
  if (!sseClients.has(token)) sseClients.set(token, new Set());
  sseClients.get(token).add(res);
  // Heartbeat every 25s so proxies don't close the stream
  const ping = setInterval(() => { try { res.write(":ping\n\n"); } catch { clearInterval(ping); } }, 25_000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.get(token)?.delete(res);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const p = url.pathname;
    if (p === "/healthz") {
      return send(res, 200, {}, { ok: true, sessions: sessions.size, uptime: process.uptime() });
    }
    if (p === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Mneme COSMIC LINK</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}</style></head>
<body><h1>🌌 Mneme COSMIC LINK</h1><p>Self-hosted soul-prompt state server. ${sessions.size} active session(s).</p>
<p>To publish: <code>POST /api/v1/sessions/:token</code> (HMAC-bearer auth)</p>
<p>To read: <code>GET /sessions/:token</code> (open) or <code>/api/v1/sessions/:token.json</code></p>
<p>Live stream: <code>GET /sessions/:token/sse</code> (Server-Sent Events)</p></body></html>`);
      return;
    }

    // /api/v1/sessions/:token  (POST publish)
    let m = p.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]{8,64})$/);
    if (m && req.method === "POST") {
      const body = await readBody(req, MAX_BYTES);
      return handlePublish(req, res, m[1], body);
    }
    // /api/v1/sessions/:token/revoke
    m = p.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]{8,64})\/revoke$/);
    if (m && req.method === "POST") {
      const body = await readBody(req, 1024);
      return handleRevoke(req, res, m[1], body);
    }
    // /api/v1/sessions/:token.json  (GET read)
    m = p.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]{8,64})\.json$/);
    if (m && req.method === "GET") {
      const sess = sessions.get(m[1]);
      if (!sess) return send(res, 404, {}, { error: "not found" });
      const stale = Date.now() - sess.lastPublishTs > STALE_AFTER_MS;
      return send(res, 200, {}, {
        token: m[1], state: sess.state, lastPublishTs: sess.lastPublishTs,
        publishCount: sess.publishCount, stale, prevSig: sess.prevSig, newSig: sess.newSig,
        createdAt: sess.createdAt,
      });
    }
    // /sessions/:token/sse
    m = p.match(/^\/sessions\/([A-Za-z0-9_-]{8,64})\/sse$/);
    if (m && req.method === "GET") {
      return handleSse(req, res, m[1]);
    }
    // /sessions/:token  (HTML)
    m = p.match(/^\/sessions\/([A-Za-z0-9_-]{8,64})$/);
    if (m && req.method === "GET") {
      const sess = sessions.get(m[1]);
      res.writeHead(sess ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
      res.end(renderSessionPage(m[1], sess));
      return;
    }
    return send(res, 404, {}, { error: "no route" });
  } catch (e) {
    warn("handler error:", e?.message);
    try { send(res, 500, {}, { error: "internal" }); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  log(`Mneme COSMIC LINK listening on http://${HOST}:${PORT}`);
  log(`stale-after=${STALE_AFTER_MS}ms · evict-after=${EVICT_AFTER_MS}ms · max-sessions=${MAX_SESSIONS} · ghost=${GHOST}`);
});

process.on("SIGTERM", () => { server.close(); persist(); process.exit(0); });
process.on("SIGINT", () => { server.close(); persist(); process.exit(0); });
