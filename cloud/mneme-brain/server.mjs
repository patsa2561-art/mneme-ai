// mneme-brain — minimal cloud HTTP middleware (v1.42.3 / Cloud Phase 4 MVP)
//
// Local Phase 0/1 (v1.41) made AI compliance architectural ON THIS MACHINE
// by pre-executing safe AUTO-ACTION mandates before the AI agent's turn.
// Cloud Phase 4 lifts the same idea OFF the user's machine: any AI vendor
// (Claude / Cursor / Codex / Gemini / Continue / Aider) can POST a pulse
// payload to this endpoint and receive an already-executed result.
//
// ─── Endpoints ────────────────────────────────────────────────────────
//   GET  /v1/healthz                      → liveness + version
//   POST /v1/pulse                        → run pre-executor over notices
//   POST /v1/compliance                   → forward compliance event log
//   GET  /v1/companion?vendor=X           → assemble companion blocks
//   GET  /v1/version                      → installed @mneme-ai/core version
//
// FREE-FIRST design contract (per user mandate, 2026-05-12):
//   - No paid AI calls anywhere in this server.
//   - No persistent storage outside .mneme/ in the repo it's run from.
//   - No phone-home telemetry.
//   - All ALETHEIA / Companion / EVOLVE features remain LOCAL when the
//     user runs Mneme on their own machine. The cloud is purely an
//     OPTIONAL relay for users who want cross-vendor AUTO-ACTION
//     execution at the prompt-arrival boundary.
//
// Runs on Node 22 LTS, single file, no build step. Run as:
//   node server.mjs              (defaults to port 8080, no TLS)
//   PORT=443 USE_TLS=1 node server.mjs   (Caddy fronts TLS — trust X-Forwarded-*)
//
// systemd unit + Caddyfile shipped alongside in cloud-init.yaml.

import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const VERSION = "1.42.3";   // bumped per release; verifies via /v1/version

// In-memory rate limiter — 100 requests per IP per minute. Free-tier
// guard against accidental DDoS from a misbehaving client. Resets every
// minute, no persistence.
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;
const rateMap = new Map();   // ip → { count, windowStart }

function rateLimit(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-mneme-brain": VERSION,
    ...headers,
  });
  res.end(json);
}

async function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error("payload-too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

// ─── Pre-executor (cloud-side) ───────────────────────────────────────
// Mirrors packages/core/src/ai_compliance.ts pattern but runs in this
// process (no subprocess spawn; the cloud doesn't ship the full Mneme
// CLI). Maps known mandate tools to acknowledgment shapes the AI agent
// can render to the user. Unknown mandates are logged + returned as-is
// so the AI's local fallback path still fires.

const SAFE_INLINE_MANDATES = new Set([
  "mneme.antivirus.cert.benchmark",
  "mneme.antivirus.lab",
  "mneme.evolve.scan",
  "mneme.evolve.pass",
  "mneme.nucleus.dna",
  "mneme.precog.dream",
]);
const QUEUED_MANDATES = new Set([
  "mneme.system.upgrade",
]);

function preExecute(notices) {
  const results = [];
  const out = [];
  for (const n of notices ?? []) {
    if (!n?.autoAction?.tool) { out.push(n); continue; }
    const tool = n.autoAction.tool;
    if (QUEUED_MANDATES.has(tool)) {
      results.push({ tool, outcome: "queued", summary: "queued for client-side daemon" });
      out.push({ ...n, text: `⏳ QUEUED (cloud → client daemon): ${tool}`, level: "info", autoAction: undefined });
    } else if (SAFE_INLINE_MANDATES.has(tool)) {
      // The cloud cannot actually run client-local CLI; instead we ack
      // + return an instruction the client's pulse pre-executor will
      // honour on the next round trip. The cloud tracks the intent so
      // a future audit can verify it was issued.
      results.push({ tool, outcome: "issued", summary: "execute on client" });
      out.push({ ...n, text: `↩ CLOUD-ISSUED: ${tool} → execute on next client tick`, level: "info" });
    } else {
      results.push({ tool, outcome: "skipped", summary: "no cloud mapping" });
      out.push(n);   // leave intact for AI-agent fallback path
    }
  }
  return { results, rewrittenNotices: out };
}

// ─── HTTP routes ──────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").toString().split(",")[0].trim();

  // CORS — open for now; lock down per-origin once we have an allow-list.
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization", "access-control-max-age": "86400" });
    res.end();
    return;
  }

  if (!rateLimit(ip)) return send(res, 429, { error: "rate-limited", retryInMs: RATE_WINDOW_MS });

  try {
    if (req.method === "GET" && url.pathname === "/v1/healthz") {
      return send(res, 200, { ok: true, version: VERSION, ts: new Date().toISOString(), uptime: process.uptime() });
    }
    if (req.method === "GET" && url.pathname === "/v1/version") {
      return send(res, 200, { brain: VERSION, mnemeCore: process.env.MNEME_CORE_VERSION ?? "unknown" });
    }
    if (req.method === "POST" && url.pathname === "/v1/pulse") {
      const body = await readBody(req);
      const { notices = [], vendor = "unknown" } = body;
      const { results, rewrittenNotices } = preExecute(notices);
      return send(res, 200, { vendor, mandatesExecuted: results, rewrittenNotices, brain: VERSION });
    }
    if (req.method === "POST" && url.pathname === "/v1/compliance") {
      // For the MVP we just ack — Wave 2 will persist these to a SQLite
      // file so the cross-vendor scoreboard has data.
      const body = await readBody(req);
      return send(res, 202, { ack: true, received: Array.isArray(body?.events) ? body.events.length : 0 });
    }
    if (req.method === "GET" && url.pathname === "/v1/companion") {
      const vendor = url.searchParams.get("vendor") ?? "claude-opus-4-7";
      // MVP returns a static placeholder; Wave 2 wires actual companion
      // module reads from a per-installation cache.
      return send(res, 200, { vendor, blocks: [], note: "companion blocks aggregate per-installation in Wave 2" });
    }
    return send(res, 404, { error: "not-found", path: url.pathname });
  } catch (e) {
    return send(res, 500, { error: "server", message: String(e?.message ?? e) });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`mneme-brain v${VERSION} listening on ${HOST}:${PORT}`);
});

// Graceful shutdown for systemd
function shutdown(sig) {
  // eslint-disable-next-line no-console
  console.log(`mneme-brain shutting down (${sig})`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
