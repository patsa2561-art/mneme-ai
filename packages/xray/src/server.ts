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
import { isAllowedPublicUrl, shallowClone } from "./clone.js";
import { listRemoteBranches } from "./track.js";
import { TrackerHub, verifyWebhookSig } from "./tracker_server.js";
import { buildContextPack } from "./pack.js";
import { CosmicMonitor, cosmicBadgeSvg, signCosmicStatus } from "./cosmic.js";
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
/**
 * Recover the caller's token from the Authorization header.
 *
 * An HTTP header value MUST be ISO-8859-1, but a user's key may be any Unicode
 * (Thai, emoji, …). The client therefore wraps non-ASCII keys in an ASCII-safe
 * envelope `b64:<base64url-of-utf8>`; we transparently unwrap it back to the
 * EXACT original token, so the profile id is identical to the raw key — no
 * existing report orphans. A legacy bare ASCII token (no prefix) still works.
 * This makes the "non ISO-8859-1 header" crash class structurally impossible.
 */
function bearer(req: IncomingMessage): string | null {
  const h = (req.headers.authorization || "").trim();
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  let tok = h.slice(7).trim();
  if (tok.startsWith("b64:")) {
    try {
      const b64 = tok.slice(4).replace(/-/g, "+").replace(/_/g, "/");
      tok = Buffer.from(b64, "base64").toString("utf8");
    } catch { return null; }
  }
  return tok || null;
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

function readBoardRows(): Array<Record<string, unknown>> {
  try {
    if (!existsSync(BOARD_FILE())) return [];
    return rf(BOARD_FILE(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch { return []; }
}
function readProfileRows(profileId: string): Array<Record<string, unknown>> {
  try {
    const p = join(PROFILES_DIR(), profileId + ".jsonl");
    if (!existsSync(p)) return [];
    return rf(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch { return []; }
}

function summaryOf(r: XRayReport, visibility: "public" | "private") {
  return {
    at: r.generatedAt, repoName: r.subject.repoName, ref: r.subject.kind === "git-url" ? r.subject.ref : "private",
    grade: r.summary.grade, headline: r.summary.headline, fingerprint: r.fingerprint, visibility,
  };
}

interface ReportMeta { visibility: "public" | "private"; profileId: string }

/** Persist the full signed report + a tiny meta sidecar (visibility/owner) for
 *  access control. Idempotent by fingerprint. */
function saveReport(signed: SignedXRay, visibility: "public" | "private" = "public", profileId = "") {
  try {
    if (!existsSync(REPORTS_DIR())) mkdirSync(REPORTS_DIR(), { recursive: true });
    const fp = signed.report.fingerprint;
    if (!FP_RE.test(fp)) return;
    writeFileSync(join(REPORTS_DIR(), fp + ".json"), JSON.stringify(signed));
    writeFileSync(join(REPORTS_DIR(), fp + ".meta.json"), JSON.stringify({ visibility, profileId } satisfies ReportMeta));
  } catch { /* best-effort */ }
}
function getReport(fingerprint: string): SignedXRay | null {
  try {
    if (!FP_RE.test(fingerprint)) return null;
    const p = join(REPORTS_DIR(), fingerprint + ".json");
    return existsSync(p) ? (JSON.parse(rf(p, "utf8")) as SignedXRay) : null;
  } catch { return null; }
}
function getReportMeta(fingerprint: string): ReportMeta | null {
  try {
    if (!FP_RE.test(fingerprint)) return null;
    const p = join(REPORTS_DIR(), fingerprint + ".meta.json");
    return existsSync(p) ? (JSON.parse(rf(p, "utf8")) as ReportMeta) : null;
  } catch { return null; }
}

/** Group raw scan-event rows by repo → first-seen + last-seen + scan count +
 *  the latest grade/fingerprint. Newest activity first. Powers the listview. */
function aggregateByRepo(rows: Array<Record<string, unknown>>) {
  const map = new Map<string, { repoName: string; ref: string; firstAt: string; lastAt: string; count: number; grade: string; fingerprint: string; visibility: string }>();
  for (const r of rows) {
    const key = String(r.repoName || r.ref || r.fingerprint);
    const at = String(r.at || "");
    const e = map.get(key);
    if (!e) {
      map.set(key, { repoName: String(r.repoName || ""), ref: String(r.ref || ""), firstAt: at, lastAt: at, count: 1, grade: String(r.grade || "?"), fingerprint: String(r.fingerprint || ""), visibility: String(r.visibility || "public") });
    } else {
      e.count++;
      if (at < e.firstAt) e.firstAt = at;
      if (at >= e.lastAt) { e.lastAt = at; e.grade = String(r.grade || e.grade); e.fingerprint = String(r.fingerprint || e.fingerprint); }
    }
  }
  return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

function page<T>(items: T[], offset: number, limit: number) {
  const o = Math.max(0, offset | 0), l = Math.min(100, Math.max(1, limit | 0));
  return { items: items.slice(o, o + l), total: items.length, offset: o, limit: l };
}
function recordProfile(profileId: string, r: XRayReport, visibility: "public" | "private") {
  try {
    if (!existsSync(PROFILES_DIR())) mkdirSync(PROFILES_DIR(), { recursive: true });
    appendFileSync(join(PROFILES_DIR(), profileId + ".jsonl"), JSON.stringify(summaryOf(r, visibility)) + "\n");
  } catch { /* best-effort */ }
}
function serveStatic(res: ServerResponse, file: string) {
  const path = join(PUBLIC_DIR, file);
  if (!existsSync(path)) { send(res, 404, { error: "not found" }); return; }
  const type = file.endsWith(".html") ? "text/html; charset=utf-8"
    : file.endsWith(".svg") ? "image/svg+xml"
    : file.endsWith(".js") ? "text/javascript; charset=utf-8"
    : "text/plain";
  send(res, 200, readFileSync(path, "utf8"), type);
}

// ---- the growth engine: shareable badges + social cards + permalinks ----
const GRADE_COLOR: Record<string, string> = { A: "#16a34a", B: "#65a30d", C: "#d97706", D: "#ea580c", F: "#dc2626" };
const xesc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Rasterise an SVG to PNG (X/Twitter don't render SVG og:image). Fail-safe:
 *  returns null if the optional rasteriser isn't available, so callers fall
 *  back to serving the SVG and the server never breaks. */
async function renderPng(svg: string): Promise<Buffer | null> {
  try {
    const mod = (await import("@resvg/resvg-js")) as { Resvg: new (s: string, o?: unknown) => { render: () => { asPng: () => Buffer } } };
    return new mod.Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  } catch {
    return null;
  }
}

function sendSvg(res: ServerResponse, svg: string, maxAgeSec = 300) {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": `public, max-age=${maxAgeSec}`,
    "access-control-allow-origin": "*",
  });
  res.end(svg);
}

/** shields-style flat badge: "mneme x-ray | <grade>". */
function badgeSvg(grade: string): string {
  const color = GRADE_COLOR[grade] || "#6b7280";
  const label = "mneme x-ray", val = grade || "?";
  const lw = 78, vw = 26, w = lw + vw, h = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${label}: ${val}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="${h}" fill="#0a0a0a"/><rect x="${lw}" width="${vw}" height="${h}" fill="${color}"/><rect width="${w}" height="${h}" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14" font-weight="bold">${val}</text></g></svg>`;
}

/** 1200×630 social card for og:image (white, one big grade). NOTE: some platforms
 *  (notably X/Twitter) do not render SVG og:image; Discord/Slack/LinkedIn do. A PNG
 *  rasteriser is the future upgrade. */
function socialCardSvg(r: XRayReport): string {
  const color = GRADE_COLOR[r.summary.grade] || "#6b7280";
  const bullets = (r.summary.bullets || []).slice(0, 5);
  const lines = bullets.map((b, i) => `<text x="90" y="${330 + i * 46}" font-size="26" fill="#374151">${xesc(b.replace(/[^\x20-\x7E]/g, "").trim())}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#ffffff"/><rect x="0" y="0" width="1200" height="8" fill="${color}"/>
<text x="90" y="120" font-family="Verdana,sans-serif" font-size="26" letter-spacing="4" fill="#6b7280">MNEME · REPO X-RAY</text>
<rect x="90" y="160" width="120" height="120" rx="24" fill="${color}"/>
<text x="150" y="252" font-family="Verdana,sans-serif" font-size="74" font-weight="bold" fill="#fff" text-anchor="middle">${xesc(r.summary.grade)}</text>
<text x="240" y="232" font-family="Verdana,sans-serif" font-size="46" font-weight="bold" fill="#0a0a0a">${xesc(r.subject.repoName)}</text>
<text x="240" y="272" font-family="Verdana,sans-serif" font-size="24" fill="#6b7280">${xesc(r.summary.headline)}</text>
${lines}
<text x="90" y="590" font-family="Verdana,sans-serif" font-size="20" fill="#16a34a">✓ deterministic · signed · offline-verifiable — no AI guessed any number</text></svg>`;
}

/** latest stored report fingerprint for a repo slug like "github/owner/repo". */
function latestByRepoSlug(slug: string): { fingerprint: string; grade: string } | null {
  try {
    if (!existsSync(BOARD_FILE())) return null;
    const ownerRepo = slug.split("/").slice(1).join("/").toLowerCase();
    const host = slug.split("/")[0].toLowerCase();
    const lines = rf(BOARD_FILE(), "utf8").trim().split("\n").filter(Boolean).reverse();
    for (const l of lines) {
      const row = JSON.parse(l) as { ref?: string; fingerprint?: string; grade?: string };
      const ref = String(row.ref || "").toLowerCase();
      if (ref.includes(host) && ref.includes(ownerRepo) && row.fingerprint) {
        return { fingerprint: row.fingerprint, grade: String(row.grade || "?") };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function reportPageWithOg(signed: SignedXRay, origin: string): string {
  const tpl = readFileSync(join(PUBLIC_DIR, "report.html"), "utf8");
  const r = signed.report;
  const title = `${r.subject.repoName} — Grade ${r.summary.grade} · Mneme X-Ray`;
  const desc = (r.summary.bullets || []).slice(0, 4).map((b) => b.replace(/[^\x20-\x7E]/g, "").trim()).join(" · ") || r.summary.headline;
  const url = `${origin}/r/${r.fingerprint}`;
  const img = `${origin}/og/${r.fingerprint}.png`;   // X/Twitter need raster (PNG); falls back to SVG if rasteriser down
  const og = [
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:title" content="${xesc(title)}"/>`,
    `<meta property="og:description" content="${xesc(desc)}"/>`,
    `<meta property="og:url" content="${xesc(url)}"/>`,
    `<meta property="og:image" content="${xesc(img)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${xesc(title)}"/>`,
    `<meta name="twitter:description" content="${xesc(desc)}"/>`,
    `<meta name="twitter:image" content="${xesc(img)}"/>`,
    `<meta name="description" content="${xesc(desc)}"/>`,
  ].join("\n");
  return tpl.replace("<title>Mneme · Repo X-Ray</title>", `<title>${xesc(title)}</title>`).replace("<!--OGMETA-->", og);
}

export function createXRayServer(monitor?: CosmicMonitor, injectedHub?: TrackerHub) {
  // THE AUTONOMOUS REAL-TIME MONITOR — one hub per server instance. The scanner
  // (build) runs the SAME hosted, bounded, raw-free, signed pipeline as /api/xray;
  // the SHA source defaults to `git ls-remote` (the cheap poll). Both POLL and
  // WEBHOOK drive `hub.tick`; subscribed browsers get drift over SSE (no re-click).
  // An injected hub (tests) controls its own scanner + poller.
  const hub = injectedHub ?? new TrackerHub({
    build: async (gitUrl, branch) => {
      const report = await buildXRay({ gitUrl, branch, maxFiles: 2500 });
      const leak = xrayLeaksRaw(report);
      if (leak.leaks) throw new Error("report failed raw-free gate");
      const signed = sealXRay(process.cwd(), report);
      recordBoard(signed);
      saveReport(signed, "public", "");
      return { report, signed };
    },
    storePath: join(dataDir(), "tracks.json"),   // durable: survives a redeploy/restart
  });
  if (!injectedHub && process.env.XRAY_TRACK_POLL !== "off") hub.startPoller(parseInt(process.env.XRAY_TRACK_POLL_MS || "30000", 10));

  return createServer(async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") return send(res, 204, "");
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, ts: Date.now() });
    if (req.method === "GET" && url.pathname === "/api/board") {
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      return send(res, 200, page(aggregateByRepo(readBoardRows()), offset, limit));
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveStatic(res, "index.html");
    if (req.method === "GET" && url.pathname === "/favicon.svg") return serveStatic(res, "favicon.svg");
    if (req.method === "GET" && url.pathname === "/card.js") return serveStatic(res, "card.js");
    if (req.method === "GET" && url.pathname === "/local-scan.js") return serveStatic(res, "local-scan.js");
    if (req.method === "GET" && url.pathname === "/cosmic") return serveStatic(res, "cosmic.html");

    // COSMIC MONITOR (additive superpower for the cosmic-link server) — measured + signed
    if (req.method === "GET" && url.pathname === "/badge/cosmic.svg") {
      if (!monitor) return sendSvg(res, cosmicBadgeSvg({ url: "", up: false, lastCheck: null, uptimePct: 0, checks: 0, p50Ms: 0, p95Ms: 0, sinceTs: null, windowMs: 0 }), 30);
      return sendSvg(res, cosmicBadgeSvg(monitor.status()), 30);
    }
    if (req.method === "GET" && url.pathname === "/api/cosmic/status") {
      if (!monitor) return send(res, 200, { configured: false, note: "cosmic monitor not enabled on this instance" });
      const st = monitor.status();
      return send(res, 200, { ...st, attestation: signCosmicStatus(process.cwd(), st) });
    }

    // embeddable badge — /badge/<fingerprint>.svg OR /badge/github/owner/repo.svg
    if (req.method === "GET" && url.pathname.startsWith("/badge/") && url.pathname.endsWith(".svg")) {
      const target = decodeURIComponent(url.pathname.slice("/badge/".length, -4));
      let grade = "?";
      if (FP_RE.test(target)) { grade = getReport(target)?.report.summary.grade ?? "?"; }
      else { grade = latestByRepoSlug(target)?.grade ?? "?"; }
      return sendSvg(res, badgeSvg(grade));
    }

    // social card (og:image) — /og/<fingerprint>.svg  (vector) or .png (X/Twitter)
    if (req.method === "GET" && url.pathname.startsWith("/og/") && (url.pathname.endsWith(".svg") || url.pathname.endsWith(".png"))) {
      const png = url.pathname.endsWith(".png");
      const fp = decodeURIComponent(url.pathname.slice("/og/".length, png ? -4 : -4));
      const signed = getReport(fp);
      if (!signed || getReportMeta(fp)?.visibility === "private") return send(res, 404, { error: "not found" });
      const svg = socialCardSvg(signed.report);
      if (!png) return sendSvg(res, svg);
      const buf = await renderPng(svg);          // X/Twitter need raster
      if (!buf) return sendSvg(res, svg);          // fail-safe: serve SVG if rasteriser unavailable
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
      return res.end(buf);
    }

    // shareable permalink — /r/<fingerprint> (server-renders OG meta for social previews)
    if (req.method === "GET" && url.pathname.startsWith("/r/")) {
      const fp = decodeURIComponent(url.pathname.slice("/r/".length).replace(/\/$/, ""));
      const signed = getReport(fp);
      const meta = getReportMeta(fp);
      const origin = `${(req.headers["x-forwarded-proto"] as string) || "http"}://${req.headers.host || "localhost"}`;
      // private (or unknown) → serve the bare shell with NO OG meta, so the repo
      // name never leaks; the page's API fetch will 404 for anyone but the owner.
      if (!signed || meta?.visibility === "private") {
        return send(res, 200, readFileSync(join(PUBLIC_DIR, "report.html"), "utf8"), "text/html; charset=utf-8");
      }
      return send(res, 200, reportPageWithOg(signed, origin), "text/html; charset=utf-8");
    }

    // deep-view: fetch a stored full signed report by fingerprint.
    // PRIVATE reports are access-controlled: only the owning key may fetch them,
    // and we return 404 (not 403) so their very existence isn't revealed.
    if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
      const fp = decodeURIComponent(url.pathname.slice("/api/report/".length));
      const signed = getReport(fp);
      if (!signed) return send(res, 404, { error: "report not found" });
      const meta = getReportMeta(fp);
      if (meta?.visibility === "private") {
        const tok = bearer(req);
        if (!tok || profileIdFromToken(tok) !== meta.profileId) return send(res, 404, { error: "report not found" });
      }
      return send(res, 200, signed);
    }

    // a profile's reports — aggregated by repo (first/last seen + count), paged.
    // id is the profile hash; knowing it is required to list. Private items live
    // ONLY here, never on the public board.
    if (req.method === "GET" && url.pathname.startsWith("/api/profile/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/profile/".length));
      if (!/^[a-f0-9]{8,32}$/.test(id)) return send(res, 400, { error: "bad profile id" });
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      return send(res, 200, { profileId: id, ...page(aggregateByRepo(readProfileRows(id)), offset, limit) });
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
        // hosted scan: bound the file battery so a huge monorepo can't hog the box
        const report = await buildXRay({ gitUrl, maxFiles: 2500 });
        const leak = xrayLeaksRaw(report);
        if (leak.leaks) return send(res, 500, { error: "internal: report failed raw-free gate", reasons: leak.reasons });
        const signed = sealXRay(process.cwd(), report);
        const tok = bearer(req);
        recordBoard(signed); // public repos are public by definition
        saveReport(signed, "public", tok ? profileIdFromToken(tok) : "");
        if (tok) recordProfile(profileIdFromToken(tok), report, "public");
        return send(res, 200, signed);
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      }
    }

    // AI CONTEXT PACK — prioritized, budgeted, secret-redacted repo→AI text.
    // Public repos only here (the pack contains code, so it is RETURNED to the
    // user and never stored). Private repos use the local bridge.
    if (req.method === "POST" && url.pathname === "/api/pack") {
      if (rateLimited("pack:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let body: { gitUrl?: string; budget?: number };
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const gitUrl = (body.gitUrl || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs. For private repos, run the local bridge." });
      let handle: { path: string; dispose: () => void } | null = null;
      try {
        handle = shallowClone(gitUrl);
        const pack = buildContextPack(handle.path, { budget: Math.min(200_000, body.budget || 120_000) });
        return send(res, 200, pack);
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      } finally { if (handle) handle.dispose(); }
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
      saveReport(signed, visibility, profileIdFromToken(tok));
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

    // ─── REAL-TIME TRACKING (branch-aware · poll + webhook · live SSE) ────────
    // list a repo's branches → the branch picker
    if (req.method === "GET" && url.pathname === "/api/branches") {
      const gitUrl = (url.searchParams.get("url") || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs." });
      if (rateLimited("branches:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      try { return send(res, 200, { branches: listRemoteBranches(gitUrl) }); }
      catch (e) { return send(res, 502, { error: (e as Error).message.slice(0, 200) }); }
    }
    // start tracking a repo+branch → initial signed report + a trackId
    if (req.method === "POST" && url.pathname === "/api/track") {
      if (rateLimited("track:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let body: { gitUrl?: string; branch?: string };
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const gitUrl = (body.gitUrl || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs." });
      try {
        const { id, signed } = await hub.createTrack(gitUrl, body.branch?.trim() || undefined);
        return send(res, 200, { trackId: id, signed, pollMs: parseInt(process.env.XRAY_TRACK_POLL_MS || "30000", 10) });
      } catch (e) { return send(res, 502, { error: (e as Error).message.slice(0, 200) }); }
    }
    // live updates over Server-Sent Events — the browser subscribes; drift is
    // pushed on every detected change with no re-click.
    if (req.method === "GET" && /^\/api\/track\/[a-f0-9]{8,32}\/stream$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
      if (!hub.subscribe(id, res)) { res.write(`event: error\ndata: ${JSON.stringify({ error: "unknown trackId — POST /api/track first" })}\n\n`); return res.end(); }
      const keepAlive = setInterval(() => { try { res.write(`: ping\n\n`); } catch { /* */ } }, 25_000);
      if (typeof keepAlive.unref === "function") keepAlive.unref();
      req.on("close", () => clearInterval(keepAlive));
      return;
    }
    // webhook (GitHub/GitLab push) → trigger an immediate tick (true real-time).
    // When XRAY_WEBHOOK_SECRET is set, the raw body's HMAC-SHA256 must match the
    // x-hub-signature-256 header (forged webhooks rejected); else open mode.
    if (req.method === "POST" && /^\/api\/track\/[a-f0-9]{8,32}\/webhook$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      let raw = ""; try { raw = await readBody(req, 2 * 1024 * 1024); } catch { /* SHA is re-resolved from ls-remote anyway */ }
      const sig = (req.headers["x-hub-signature-256"] || req.headers["x-hub-signature"]) as string | undefined;
      if (!verifyWebhookSig(process.env.XRAY_WEBHOOK_SECRET, raw, sig)) return send(res, 401, { error: "invalid webhook signature" });
      const r = await hub.tick(id);
      if (r === null) return send(res, 404, { error: "unknown trackId" });
      return send(res, 200, { ok: true, changed: r.changed, reason: r.reason });
    }

    return send(res, 404, { error: "not found" });
  });
}

// run when invoked directly (npm run serve / node dist/server.js)
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  // COSMIC MONITOR — observe the cosmic-link server over localhost (additive,
  // never touches it). Disable with COSMIC_URL=off.
  const cosmicUrl = process.env.COSMIC_URL ?? "http://127.0.0.1:8081/";
  const monitor = cosmicUrl && cosmicUrl !== "off"
    ? new CosmicMonitor(cosmicUrl, join(dataDir(), "cosmic-samples.jsonl"))
    : undefined;
  if (monitor) monitor.start(15000);
  const server = createXRayServer(monitor);
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Mneme X-Ray server on http://${HOST}:${PORT}  (data: ${dataDir()})${monitor ? `  · cosmic monitor → ${cosmicUrl}` : ""}\n`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
