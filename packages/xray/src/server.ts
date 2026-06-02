/**
 * Mneme X-Ray server — the "Lighthouse".
 *
 * A single, dependency-light node:http server that:
 *   POST /api/xray        { gitUrl }   → shallow-clone a PUBLIC repo, run the
 *                                        deterministic battery, enforce the
 *                                        raw-free gate, seal with NOTARY, return.
 *   POST /api/verify      { signed }   → verify a report's receipt offline.
 *   GET  /api/board                    → recent public X-Rays (the board).
 *   GET  /api/health                   → liveness.
 *   GET  /                             → the clean white UI.
 *
 * PRIVACY: only PUBLIC git URLs are accepted. Source is shallow-cloned to a
 * temp dir, analysed, and DELETED. The server stores only the raw-free report
 * (proven by xrayLeaksRaw before any persistence). Private repos are the
 * LOCAL-AGENT path (run `mneme-xray <path>` on your own machine) and are never
 * sent here.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdirSync, appendFileSync, readFileSync as rf } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildXRay } from "./engine.js";
import { sealXRay, verifyXRay } from "./sign.js";
import { xrayLeaksRaw } from "./privacy.js";
import { isAllowedPublicUrl } from "./clone.js";
import type { SignedXRay } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");
const DATA_DIR = process.env.XRAY_DATA_DIR || join(process.cwd(), ".xray-data");
const BOARD_FILE = join(DATA_DIR, "board.jsonl");
const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";

// crude per-IP rate limit: N requests / window
const RL_MAX = 20, RL_WINDOW_MS = 60_000;
const rl = new Map<string, { n: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || e.resetAt < now) { rl.set(ip, { n: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.n++;
  return e.n > RL_MAX;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "content-type": type === "application/json" ? "application/json; charset=utf-8" : type,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function recordBoard(signed: SignedXRay) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const r = signed.report;
    // board carries only the headline metrics — already raw-free
    appendFileSync(BOARD_FILE, JSON.stringify({
      at: r.generatedAt, repoName: r.subject.repoName, ref: r.subject.ref,
      grade: r.summary.grade, headline: r.summary.headline, fingerprint: r.fingerprint,
    }) + "\n");
  } catch { /* board is best-effort */ }
}

function readBoard(limit = 30): unknown[] {
  try {
    if (!existsSync(BOARD_FILE)) return [];
    const lines = rf(BOARD_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}

function serveStatic(res: ServerResponse, file: string) {
  const path = join(PUBLIC_DIR, file);
  if (!existsSync(path)) { send(res, 404, { error: "not found" }); return; }
  const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "text/plain";
  send(res, 200, readFileSync(path, "utf8"), type);
}

export function createXRayServer() {
  return createServer(async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") return send(res, 204, "");
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, ts: Date.now() });
    if (req.method === "GET" && url.pathname === "/api/board") return send(res, 200, { board: readBoard() });
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveStatic(res, "index.html");
    if (req.method === "GET" && url.pathname === "/favicon.svg") return serveStatic(res, "favicon.svg");

    if (req.method === "POST" && url.pathname === "/api/xray") {
      if (rateLimited(ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let body: { gitUrl?: string };
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const gitUrl = (body.gitUrl || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) {
        return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs (no credentials) are accepted. For private repos, run mneme-xray locally." });
      }
      try {
        const report = await buildXRay({ gitUrl });
        const leak = xrayLeaksRaw(report);
        if (leak.leaks) return send(res, 500, { error: "internal: report failed raw-free gate", reasons: leak.reasons });
        const signed = sealXRay(process.cwd(), report);
        recordBoard(signed);
        return send(res, 200, signed);
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/verify") {
      try {
        const signed = JSON.parse(await readBody(req)) as SignedXRay;
        return send(res, 200, verifyXRay(signed));
      } catch { return send(res, 400, { error: "invalid signed report" }); }
    }

    return send(res, 404, { error: "not found" });
  });
}

// run when invoked directly (npm run serve / node dist/server.js)
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const server = createXRayServer();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Mneme X-Ray server on http://${HOST}:${PORT}  (data: ${DATA_DIR})\n`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
