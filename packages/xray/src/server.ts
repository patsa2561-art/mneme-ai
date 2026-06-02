/**
 * Mneme X-Ray server — the "Lighthouse".
 *
 * A single, dependency-light node:http server that:
 *   POST /api/xray        { gitUrl }   → shallow-clone a PUBLIC repo, run the
 *                                        deterministic battery, enforce the
 *                                        raw-free gate, seal with NOTARY, return.
 *   POST /api/verify      { signed }   → verify a report's receipt offline.
 *   POST /api/ingest      { signed }   → THE BRIDGE: a local agent publishes a
 *                                        report it built on a PRIVATE repo. The
 *                                        server verifies the Ed25519 receipt +
 *                                        raw-free gate and files it under the
 *                                        caller's profile — WITHOUT ever seeing
 *                                        the source (it was analysed locally).
 *   GET  /api/profile/:id              → a profile's reports (raw-free).
 *   GET  /api/report/:fingerprint      → a stored full signed report (deep-view).
 *   GET  /api/board                    → recent public X-Rays (the board).
 *   GET  /api/health                   → liveness.
 *   GET  /                             → the clean white UI.
 *
 * PRIVACY: PUBLIC git URLs are shallow-cloned, analysed, and DELETED. PRIVATE
 * repos never touch this server — the local agent (`mneme-xray <path> --publish`)
 * analyses them on the user's machine and POSTs only the signed, raw-free
 * report. Every persisted report passes xrayLeaksRaw first.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync as rf } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildXRay } from "./engine.js";
import { sealXRay, verifyXRay } from "./sign.js";
import { xrayLeaksRaw } from "./privacy.js";
import { isAllowedPublicUrl } from "./clone.js";
import type { SignedXRay, XRayReport } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");
// lazy so XRAY_DATA_DIR can be set per-process (incl. tests) before first use
const dataDir = () => process.env.XRAY_DATA_DIR || join(process.cwd(), ".xray-data");
const BOARD_FILE = () => join(dataDir(), "board.jsonl");
const REPORTS_DIR = () => join(dataDir(), "reports");
const PROFILES_DIR = () => join(dataDir(), "profiles");
const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";

/** Profile id is the hash of the caller's token (an API key they choose). The
 *  raw token is never stored — only its hash names the profile dir. */
function profileIdFromToken(token: string): string {
  return createHash("sha256").update("mneme-xray-profile:" + token).digest("hex").slice(0, 16);
}
function bearer(req: IncomingMessage): string | null {
  const h = (req.headers.authorization || "").trim();
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}
const FP_RE = /^[a-f0-9]{16,64}$/;

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
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
    const r = signed.report;
    // board carries only the headline metrics — already raw-free
    appendFileSync(BOARD_FILE(), JSON.stringify({
      at: r.generatedAt, repoName: r.subject.repoName, ref: r.subject.ref,
      grade: r.summary.grade, headline: r.summary.headline, fingerprint: r.fingerprint,
    }) + "\n");
  } catch { /* board is best-effort */ }
}

function readBoard(limit = 30): unknown[] {
  try {
    if (!existsSync(BOARD_FILE())) return [];
    const lines = rf(BOARD_FILE(), "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}

function summaryOf(r: XRayReport, visibility: "public" | "private") {
  return {
    at: r.generatedAt, repoName: r.subject.repoName, ref: r.subject.kind === "git-url" ? r.subject.ref : "private",
    grade: r.summary.grade, headline: r.summary.headline, fingerprint: r.fingerprint, visibility,
  };
}

/** Persist the full signed report by fingerprint (idempotent) for deep-view. */
function saveReport(signed: SignedXRay) {
  try {
    if (!existsSync(REPORTS_DIR())) mkdirSync(REPORTS_DIR(), { recursive: true });
    if (FP_RE.test(signed.report.fingerprint)) {
      writeFileSync(join(REPORTS_DIR(), signed.report.fingerprint + ".json"), JSON.stringify(signed));
    }
  } catch { /* best-effort */ }
}
function getReport(fingerprint: string): SignedXRay | null {
  try {
    if (!FP_RE.test(fingerprint)) return null;
    const p = join(REPORTS_DIR(), fingerprint + ".json");
    return existsSync(p) ? (JSON.parse(rf(p, "utf8")) as SignedXRay) : null;
  } catch { return null; }
}
function recordProfile(profileId: string, r: XRayReport, visibility: "public" | "private") {
  try {
    if (!existsSync(PROFILES_DIR())) mkdirSync(PROFILES_DIR(), { recursive: true });
    appendFileSync(join(PROFILES_DIR(), profileId + ".jsonl"), JSON.stringify(summaryOf(r, visibility)) + "\n");
  } catch { /* best-effort */ }
}
function listProfile(profileId: string, limit = 100): unknown[] {
  try {
    const p = join(PROFILES_DIR(), profileId + ".jsonl");
    if (!existsSync(p)) return [];
    // de-dup by fingerprint, newest wins
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const l of rf(p, "utf8").trim().split("\n").filter(Boolean).reverse()) {
      const row = JSON.parse(l) as Record<string, unknown>;
      const fp = String(row.fingerprint);
      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
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

    // deep-view: fetch a stored full signed report by fingerprint
    if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
      const fp = decodeURIComponent(url.pathname.slice("/api/report/".length));
      const signed = getReport(fp);
      return signed ? send(res, 200, signed) : send(res, 404, { error: "report not found" });
    }

    // a profile's reports (raw-free summaries). id is the profile hash, not the token.
    if (req.method === "GET" && url.pathname.startsWith("/api/profile/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/profile/".length));
      if (!/^[a-f0-9]{8,32}$/.test(id)) return send(res, 400, { error: "bad profile id" });
      return send(res, 200, { profileId: id, reports: listProfile(id) });
    }

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
        saveReport(signed);
        // if the caller is signed in (sent a token), also file it under their profile
        const tok = bearer(req);
        if (tok) recordProfile(profileIdFromToken(tok), report, "public");
        return send(res, 200, signed);
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      }
    }

    // THE BRIDGE — a local agent publishes a report it built on a PRIVATE repo.
    // The server NEVER sees the source: it only verifies the signature + raw-free
    // gate and files the report under the caller's profile.
    if (req.method === "POST" && url.pathname === "/api/ingest") {
      const tok = bearer(req);
      if (!tok) return send(res, 401, { error: "missing bearer token (your X-Ray key)" });
      if (rateLimited("ingest:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let signed: SignedXRay;
      try { signed = JSON.parse(await readBody(req, 2 * 1024 * 1024)) as SignedXRay; }
      catch { return send(res, 400, { error: "invalid signed report" }); }
      if (!signed?.report || !signed.receipt) return send(res, 400, { error: "expected { report, receipt }" });
      // 1) the report a local agent sends must itself be raw-free
      const leak = xrayLeaksRaw(signed.report);
      if (leak.leaks) return send(res, 422, { error: "report is not raw-free — refused", reasons: leak.reasons });
      // 2) the Ed25519 receipt must verify offline
      const v = verifyXRay(signed);
      if (!v.valid) return send(res, 422, { error: "signature does not verify: " + v.reason });
      const visibility = signed.report.subject.kind === "git-url" ? "public" : "private";
      saveReport(signed);
      recordProfile(profileIdFromToken(tok), signed.report, visibility);
      if (visibility === "public") recordBoard(signed);
      return send(res, 200, { ok: true, profileId: profileIdFromToken(tok), fingerprint: signed.report.fingerprint });
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
    process.stdout.write(`Mneme X-Ray server on http://${HOST}:${PORT}  (data: ${dataDir()})\n`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
