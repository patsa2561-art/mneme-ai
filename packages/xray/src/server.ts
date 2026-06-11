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
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync as rf, readdirSync, statSync } from "node:fs";
import { crossLayerGraph, riskHotspots, authzGap, testGap, graphLogic, accuracy, hotspots as hotspotsMod, changeCoupling as changeCouplingMod } from "@mneme-ai/core";
import { dirname, join } from "node:path";
import { spawnSync as gitSpawn } from "node:child_process";
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
const reviewCache = new Map<string, { at: number; data: unknown }>();   // /api/review result cache (real, clone-once)
const REVIEW_TTL_MS = 30 * 60 * 1000;                                    // 30 min
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

/** OG + Twitter share-card meta tags (absolute URLs to the canonical domain) for a landing page. */
function ogMeta(title: string, desc: string, path: string): string {
  const base = "https://xray.mneme-ai.space", url = base + path, img = base + "/og.png", t = xesc(title), d = xesc(desc);
  return `<link rel="icon" href="/favicon.svg"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Mneme"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${url}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}">`;
}

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
  // SVG <text> does not wrap — clip every string to a width budget so nothing
  // ever bleeds off the right edge (the bug that made the card look broken).
  const ascii = (s: string) => String(s || "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  const clip = (s: string, n: number) => { const a = ascii(s); return a.length > n ? a.slice(0, n - 1).trimEnd() + "…" : a; };
  const repo = clip(r.subject.repoName, 26);
  const head = clip(r.summary.headline, 64);
  // four hard metrics (always present, never overflow) → a clean stat strip
  const bf = r.busFactor || ({} as XRayReport["busFactor"]);
  const stat = (x: number, lbl: string) => ({ x, lbl });
  const stats = [
    stat(r.secrets?.totalFindings ?? 0, "secrets"),
    stat(bf.busFactor ?? 0, "bus factor"),
    stat((r.security?.destructive || []).length, "risky cmds"),
    stat(r.deps?.byBand?.dead ?? 0, "dead deps"),
  ];
  const sx = 92, sgap = 256;
  const statCells = stats.map((s, i) => `
<text x="${sx + i * sgap}" y="406" font-family="Verdana,sans-serif" font-size="62" font-weight="bold" fill="#0a0a0a">${s.x}</text>
<text x="${sx + i * sgap}" y="438" font-family="Verdana,sans-serif" font-size="22" fill="#8b8f98">${s.lbl}</text>`).join("");
  const fp = xesc(clip(r.fingerprint, 18));
  // A 3-ACT STORY no other code-tool's social card tells: ① our VERDICT → ② the
  // EVIDENCE behind it → ③ the PROOF you can re-run yourself. Claim, then evidence,
  // then proof. The fingerprint is a top-right watermark (no longer overlapping the
  // footer — the bug in the previous card). Every string is width-clipped.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="${color}" flood-opacity="0.28"/></filter></defs>
<rect width="1200" height="630" fill="#ffffff"/><rect x="0" y="0" width="1200" height="10" fill="${color}"/>
<text x="92" y="74" font-family="Verdana,sans-serif" font-size="22" letter-spacing="5" fill="#9aa0aa">MNEME · REPO X-RAY</text>
<text x="1108" y="74" font-family="ui-monospace,Menlo,monospace" font-size="15" fill="#c8ccd3" text-anchor="end">${fp}…</text>
<text x="92" y="118" font-family="Verdana,sans-serif" font-size="16" letter-spacing="3" fill="#b6bac2">① THE VERDICT</text>
<rect x="92" y="138" width="112" height="112" rx="26" fill="${color}" filter="url(#sh)"/>
<text x="148" y="226" font-family="Verdana,sans-serif" font-size="70" font-weight="bold" fill="#fff" text-anchor="middle">${xesc(r.summary.grade)}</text>
<text x="232" y="196" font-family="Verdana,sans-serif" font-size="44" font-weight="bold" fill="#0a0a0a">${xesc(repo)}</text>
<text x="232" y="236" font-family="Verdana,sans-serif" font-size="23" fill="#6b7280">${xesc(head)}</text>
<text x="92" y="312" font-family="Verdana,sans-serif" font-size="16" letter-spacing="3" fill="#b6bac2">② THE EVIDENCE — measured from git, nothing invented</text>
<line x1="92" y1="328" x2="1108" y2="328" stroke="#eef0f2" stroke-width="2"/>
${statCells}
<line x1="92" y1="478" x2="1108" y2="478" stroke="#eef0f2" stroke-width="2"/>
<text x="92" y="516" font-family="Verdana,sans-serif" font-size="16" letter-spacing="3" fill="#b6bac2">③ THE PROOF — you don't have to trust us</text>
<text x="92" y="558" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#16a34a">✓ deterministic · Ed25519-signed · verifiable offline</text>
<text x="92" y="592" font-family="Verdana,sans-serif" font-size="19" fill="#9aa0aa">Re-run this commit → the identical fingerprint. No AI guessed any number.</text></svg>`;
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

/** The 🛰 Impact Radar landing page — type a public repo URL, click, and the live radar renders
 *  inline (the /api/radar HTML is fetched + dropped into an iframe). Self-contained, no framework. */
function radarLandingHtml(): string {
  const examples = [
    ["sindresorhus/slugify", "https://github.com/sindresorhus/slugify"],
    ["expressjs/express", "https://github.com/expressjs/express"],
    ["prisma/prisma", "https://github.com/prisma/prisma"],
    ["honojs/hono", "https://github.com/honojs/hono"],
  ];
  const chips = examples.map(([label, u]) => `<button class="chip" data-url="${u}">${label}</button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Impact Radar · Mneme X-Ray</title><meta name="description" content="See any public repo as a 4-layer cross-layer Impact Radar — code ↔ data ↔ api ↔ business. Deterministic, no LLM.">${ogMeta("Impact Radar · Mneme", "See any public repo as a 4-layer cross-layer map — code ↔ data ↔ api ↔ business. Click a node, the blast ripples across every layer. Deterministic, no LLM.", "/radar")}
<style>
:root{--cy:#22d3ee;--bg:#0b1220;--pan:#0f1b2e;--mut:#94a3b8;--line:#1f2937}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:#e5e7eb}
.wrap{max-width:1180px;margin:0 auto;padding:clamp(20px,4vw,52px) 20px}
.hero{text-align:center;margin-bottom:26px}
h1{font-size:clamp(30px,5vw,46px);margin:0 0 8px;font-weight:850;letter-spacing:-.02em}
.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.tag{color:var(--mut);font-size:clamp(14px,2vw,17px);margin:0 auto;max-width:640px}
.layers{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:18px 0 6px;color:var(--mut);font-size:13px}
.layers span{background:var(--pan);border:1px solid var(--line);border-radius:999px;padding:4px 12px}
form{display:flex;gap:10px;max-width:760px;margin:26px auto 10px;flex-wrap:wrap}
input{flex:1;min-width:240px;background:var(--pan);border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none}
input:focus{border-color:var(--cy);box-shadow:0 0 0 3px rgba(34,211,238,.15)}
button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;font-size:15px;cursor:pointer;white-space:nowrap}
button.go:disabled{opacity:.6;cursor:wait}
.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:8px 0 4px}
.chip{background:transparent;border:1px solid var(--line);color:var(--mut);border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}
.chip:hover{border-color:var(--cy);color:var(--cy)}
#status{text-align:center;color:var(--mut);min-height:22px;font-size:14px;margin:10px 0}
#status.err{color:#fca5a5}
.frameWrap{margin-top:14px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--pan);display:none}
iframe{width:100%;height:78vh;min-height:560px;border:0;display:block;background:var(--bg)}
.feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:34px}
.card{background:var(--pan);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card b{color:#e5e7eb}.card p{color:var(--mut);font-size:13.5px;margin:6px 0 0}
footer{color:#64748b;font-size:12.5px;text-align:center;margin-top:30px;line-height:1.7}
code{background:#1f2937;padding:1px 6px;border-radius:5px;color:#cbd5e1}
.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:var(--cy);border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
</style></head>
<body><div class="wrap">
<div class="hero">
<h1>🛰 <span class="grad">Impact Radar</span></h1>
<p class="tag">See <b>any public repo</b> as one cross-layer map — your code, your database tables, your API routes, and your product rules, joined. Pick a node and watch the blast radius ripple across every layer.</p>
<div class="layers"><span>💼 Business</span><span>🌐 API</span><span>⚙ Code</span><span>🗄 Data</span></div>
</div>
<form id="f"><input id="u" type="text" placeholder="https://github.com/owner/repo" autocomplete="off" spellcheck="false"><button class="go" id="go" type="submit">View Radar →</button></form>
<div class="chips">${chips}</div>
<div id="status"></div>
<div class="frameWrap" id="fw"><iframe id="frame" title="Impact Radar"></iframe></div>
<div class="feat">
<div class="card"><b>🧭 Cross-layer, not just code</b><p>Most graphs map code to code. This links code ↔ DB tables (from your Prisma/SQL schema) ↔ API routes ↔ business rules (from your PRD) — the join no single-layer tool draws.</p></div>
<div class="card"><b>🔒 Deterministic · no LLM</b><p>Every node and edge is derived from a real file. Nothing is guessed or hallucinated — a business rule with no code anchor stays honestly <i>unknown</i>.</p></div>
<div class="card"><b>🗑 Private by construction</b><p>Your repo is shallow-cloned to a temp dir, scanned, and <b>deleted</b> on the spot. Nothing persists on the server. For private repos, run it locally.</p></div>
</div>
<footer>
Local + private repos: <code>npm i -g mneme-ai</code> then <code>mneme graph view &lt;function&gt;</code> · or a shareable card with <code>mneme graph card</code>.<br>
Honest: the radar shows reachable <i>coupling</i> to inspect, not a proven runtime path · part of <a href="/" style="color:var(--cy)">Mneme Repo X-Ray</a>.
</footer>
</div>
<script>
var f=document.getElementById('f'),u=document.getElementById('u'),go=document.getElementById('go'),st=document.getElementById('status'),fw=document.getElementById('fw'),frame=document.getElementById('frame');
function setStatus(msg,err){st.className=err?'err':'';st.innerHTML=msg;}
function valid(v){return /^https?:\\/\\/(www\\.)?(github|gitlab|bitbucket)\\.(com|org)\\/[^\\s]+\\/[^\\s]+/.test(v.trim());}
function run(url){
  url=(url||'').trim(); if(!url){setStatus('Paste a public GitHub / GitLab / Bitbucket repo URL.',true);return;}
  if(!valid(url)){setStatus('That doesn\\'t look like a public repo URL (e.g. https://github.com/owner/repo).',true);return;}
  u.value=url; go.disabled=true; setStatus('<span class=spin></span>Cloning + scanning '+url.replace(/^https?:\\/\\//,'')+' …');
  fetch('/api/radar?gitUrl='+encodeURIComponent(url)).then(function(r){return r.text().then(function(t){return {ok:r.ok,t:t};});}).then(function(o){
    if(o.ok && o.t.indexOf('id="radar"')>-1){ frame.srcdoc=o.t; fw.style.display='block'; setStatus('✓ radar ready — click any node to re-center.'); fw.scrollIntoView({behavior:'smooth',block:'nearest'}); }
    else { var msg='Could not build the radar.'; try{msg=JSON.parse(o.t).error||msg;}catch(e){} setStatus(msg,true); }
  }).catch(function(e){ setStatus('Network error: '+e.message,true); }).finally(function(){ go.disabled=false; });
}
f.addEventListener('submit',function(e){e.preventDefault();run(u.value);});
Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){run(c.getAttribute('data-url'));});});
var q=new URLSearchParams(location.search).get('gitUrl'); if(q)run(q);
</script>
</body></html>`;
}

/** The 🔍 Codebase Accountability Report landing — paste a repo URL, get the graded report rendered. */
function reviewLandingHtml(): string {
  const examples = ["https://github.com/sindresorhus/slugify", "https://github.com/tiangolo/fastapi", "https://github.com/honojs/hono"];
  const chips = examples.map((u) => `<button class="chip" data-url="${u}">${u.replace(/^https:\/\/github.com\//, "")}</button>`).join("");
  const js = [
    "var f=document.getElementById('f'),u=document.getElementById('u'),go=document.getElementById('go'),st=document.getElementById('st'),rep=document.getElementById('rep');",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function valid(v){return /^https?:\\/\\/(www\\.)?(github|gitlab|bitbucket)\\.(com|org)\\/[^\\s]+\\/[^\\s]+/.test(String(v||'').trim());}",
    "var GC={A:'#22c55e',B:'#84cc16',C:'#eab308',D:'#f97316',F:'#ef4444'};",
    "function bar(n){var w=Math.round(n/2.5);return '<div class=barw><div class=bar style=\\'width:'+n+'%;background:'+(GC[grade(n)]||'#22d3ee')+'\\'></div></div>';}",
    "function grade(s){return s>=90?'A':s>=78?'B':s>=62?'C':s>=45?'D':'F';}",
    "function verdict(gr){return gr<='B'?(gr==='A'?'HEALTHY — accountable across every layer':'SOLID — a few things to guard'):gr==='C'?'NEEDS ATTENTION — real cross-layer risk':'AT RISK — unguarded critical surface';}",
    "function render(d){var gc=GC[d.grade]||'#22d3ee';var h='';",
    "  h+='<div class=card><div class=gradeRow><div class=gradeBadge style=\\'background:'+gc+'\\'>'+d.grade+'</div><div><div class=repo>'+esc(d.repo)+'</div><div class=verdict>'+verdict(d.grade)+'</div>'+bar(d.score)+'<div class=score>'+d.score+'/100</div></div></div></div>';",
    "  var gph=d.graph;h+='<div class=row><b>🕸 Cross-layer graph</b> &nbsp; ⚙ '+gph.functions+' fns · 🗄 '+gph.tables+' tables · 🌐 '+gph.endpoints+' endpoints · 💼 '+gph.rules+' rules</div>';",
    "  h+='<div class=row><b>🎯 Risk hotspots</b> &nbsp; '+d.risk.critical+' critical · '+d.risk.high+' high';if(d.risk.top&&d.risk.top.length){h+='<ul>';d.risk.top.forEach(function(r){var ic=r.band==='CRITICAL'?'🔴':r.band==='HIGH'?'🟠':'🟡';h+='<li>'+ic+' <b>'+esc(r.name)+'</b> — '+esc((r.factors&&r.factors[0])||'')+'</li>';});h+='</ul>';}else h+=' &nbsp; ✓ none';h+='</div>';",
    "  h+='<div class=row><b>🔒 Authorization</b> &nbsp; '+(d.authz.clear?'✓ no unguarded sensitive-write path':'🔴 '+d.authz.count+' unguarded write-path(s) → '+esc((d.authz.exposedTables||[]).join(', ')))+'</div>';",
    "  h+='<div class=row><b>🧪 Test coverage</b> &nbsp; keystones '+d.testGap.coverage+' guarded'+(d.testGap.untestedKeystones&&d.testGap.untestedKeystones.length?' · ⚠️ untested: '+esc(d.testGap.untestedKeystones.slice(0,5).join(', ')):' ✓')+'</div>';",
    "  h+='<div class=foot>deterministic · no LLM · fingerprint <code>'+esc(d.fingerprint)+'</code> · every finding traces to a real file · re-run to verify</div>';",
    "  rep.innerHTML=h;rep.style.display='block';}",
    "function run(url){url=String(url||'').trim();if(!valid(url)){st.className='err';st.textContent='Paste a public GitHub/GitLab/Bitbucket repo URL.';return;}u.value=url;go.disabled=true;rep.style.display='none';st.className='';st.innerHTML='<span class=spin></span>cloning + running the cross-layer suite on '+esc(url.replace(/^https?:\\/\\//,''))+' …';",
    "  fetch('/api/review?gitUrl='+encodeURIComponent(url)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(o){if(o.ok&&o.j&&o.j.grade){st.textContent='';st.className='';render(o.j);}else{st.className='err';st.textContent=(o.j&&o.j.error)||'could not review this repo';}}).catch(function(e){st.className='err';st.textContent='network error: '+e.message;}).finally(function(){go.disabled=false;});}",
    "f.addEventListener('submit',function(e){e.preventDefault();run(u.value);});",
    "Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){run(c.getAttribute('data-url'));});});",
    "var q=new URLSearchParams(location.search).get('gitUrl');if(q)run(q);",
  ].join("\n");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Codebase Accountability Report · Mneme</title>" +
    "<meta name=\"description\" content=\"Paste any public repo → a graded Codebase Accountability Report: risk hotspots, authz gaps, untested keystones. Deterministic, no LLM.\">" +
    ogMeta("Codebase Accountability Report · Mneme", "Paste any public repo → a graded report: risk hotspots, authz gaps, untested keystones. Deterministic, no LLM, nothing to install.", "/review") +
    "<style>body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:860px;margin:0 auto;padding:clamp(20px,4vw,52px) 20px}h1{font-size:clamp(28px,5vw,44px);margin:0 0 8px;font-weight:850}.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:640px}form{display:flex;gap:10px;max-width:760px;margin:26px auto 8px;flex-wrap:wrap}input{flex:1;min-width:240px;background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none}input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;cursor:pointer}button.go:disabled{opacity:.6;cursor:wait}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:transparent;border:1px solid #1f2937;color:#94a3b8;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#22d3ee;color:#22d3ee}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}.card{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:16px;padding:20px;margin:14px 0}.gradeRow{display:flex;gap:18px;align-items:center}.gradeBadge{width:64px;height:64px;border-radius:14px;display:grid;place-items:center;font-size:36px;font-weight:900;color:#04141b;flex:none}.repo{font-size:15px;color:#22d3ee;font-weight:600}.verdict{font-size:17px;font-weight:700;margin:2px 0 8px}.barw{height:10px;background:#1f2937;border-radius:999px;overflow:hidden;max-width:360px}.bar{height:100%;border-radius:999px}.score{color:#94a3b8;font-size:13px;margin-top:4px}#rep{display:none}.row{border-top:1px solid #1f2937;padding:13px 2px}.row b{color:#e5e7eb}.row ul{margin:8px 0 0;padding-left:18px;color:#cbd5e1}.row li{margin:3px 0}.foot{color:#64748b;font-size:12px;margin-top:14px}code{background:#1f2937;padding:1px 5px;border-radius:4px}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#22d3ee;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}</style></head>" +
    "<body><div class=\"wrap\"><div style=\"text-align:center\"><h1>🔍 <span class=\"grad\">Codebase Accountability</span></h1>" +
    "<p class=\"tag\" style=\"margin:0 auto\">Paste any public repo. Get a graded report across layers — <b>risk hotspots</b>, <b>authorization gaps</b>, <b>untested keystones</b> — in seconds. Deterministic, no LLM, nothing to install.</p></div>" +
    "<form id=\"f\"><input id=\"u\" type=\"text\" placeholder=\"https://github.com/owner/repo\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"go\" id=\"go\" type=\"submit\">Review →</button></form>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    "<p class=\"foot\" style=\"text-align:center\">Local + private repos: <code>npm i -g mneme-ai</code> then <code>mneme review</code>. Source is cloned to a temp dir, scanned, and deleted — nothing persists. · <a href=\"/radar\" style=\"color:#22d3ee\">Impact Radar</a></p>" +
    "<script>" + js + "</script></div></body></html>";
}

/** The HUB — one page that showcases the whole cross-layer suite: live review + radar + the 10 gems.
 *  The hero is NOT baked: on load the page calls the SAME /api/review endpoint on a real, recognizable
 *  public repo and animates the REAL result in (cloned-once + cached server-side). No mockup. */
function suiteLandingHtml(): string {
  const hero =
    `<div class="hero" id="hero"><div class="hbar"><span class="hd r"></span><span class="hd y"></span><span class="hd g"></span><span class="ht" id="hrepo">mneme review · loading a live example…</span></div>` +
    `<div class="hbody" id="hbody"><div class="hload"><span class="spin"></span> cloning a real public repo + running the cross-layer suite, live…</div></div></div>`;
  return suiteShell(hero);
}
let _accLine = "";
function accuracyLine(): string {
  if (_accLine) return _accLine;
  const r = accuracy.benchmark();
  _accLine = `📊 <b>Measured</b> extractor accuracy — precision <b>${(r.microPrecision * 100).toFixed(0)}%</b> · macro-F1 <b>${r.macroF1.toFixed(2)}</b> across ${r.dimensions.length} dimensions on a labeled corpus (it proves the accuracy, doesn't claim it) — <a href="/api/accuracy">audit /api/accuracy</a>`;
  return _accLine;
}
function suiteShell(hero: string): string {
  const gems = [
    ["🔍", "Codebase Review", "the one-command report: grade + risk + authz + tests", "mneme review"],
    ["🛰", "Impact Radar", "see a change ripple across code · data · api · business", "mneme graph view &lt;fn&gt;"],
    ["⛔", "Drop Safety", "what breaks if you remove this table? SAFE / RISKY / CRITICAL", "mneme graph reverse &lt;table&gt;"],
    ["💥", "Agent Collision", "two agents/branches colliding across DIFFERENT files — git is blind to it", "mneme collision --branches a,b"],
    ["🤝", "Scope Covenant", "did the agent stay in the scope it declared? signed, cross-vendor", "mneme scope verify"],
    ["🏷", "Commit Honesty", "a 'fix typo' that secretly rewrites a payment keystone", "mneme commit-check"],
    ["🧪", "Test Gap", "the keystone (sole writer to a table) no test even mentions", "mneme testgap"],
    ["🎯", "Risk Hotspots", "every signal fused into one 'what to guard first' ranking", "mneme risk"],
    ["🔒", "Authz Gap", "an endpoint that writes a sensitive table with no auth on the path", "mneme authz"],
    ["🧭", "Onboarding Path", "the real data-flows to read first — orient in a new repo fast", "mneme onboard"],
  ];
  const cards = gems.map((x) => "<div class=\"gem\"><div class=\"gi\">" + x[0] + "</div><div class=\"gn\">" + x[1] + "</div><div class=\"gd\">" + x[2] + "</div><code>" + x[3] + "</code></div>").join("");
  const examples = ["https://github.com/sindresorhus/slugify", "https://github.com/honojs/hono"];
  const chips = examples.map((u) => "<button class=\"chip\" data-url=\"" + u + "\">" + u.replace(/^https:\/\/github.com\//, "") + "</button>").join("");
  const js = [
    "var f=document.getElementById('f'),u=document.getElementById('u'),go=document.getElementById('go'),st=document.getElementById('st'),rep=document.getElementById('rep'),rl=document.getElementById('rl');",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function valid(v){return /^https?:\\/\\/(www\\.)?(github|gitlab|bitbucket)\\.(com|org)\\/[^\\s]+\\/[^\\s]+/.test(String(v||'').trim());}",
    "var GC={A:'#22c55e',B:'#84cc16',C:'#eab308',D:'#f97316',F:'#ef4444'};",
    "function verdict(gr){return gr<='B'?(gr==='A'?'HEALTHY — accountable across every layer':'SOLID — a few things to guard'):gr==='C'?'NEEDS ATTENTION — real cross-layer risk':'AT RISK — unguarded critical surface';}",
    "function render(d,url){var gc=GC[d.grade]||'#22d3ee';var h='<div class=card><div class=gradeRow><div class=gradeBadge style=\\'background:'+gc+'\\'>'+d.grade+'</div><div style=flex:1><div class=repo>'+esc(d.repo)+'</div><div class=verdict>'+verdict(d.grade)+'</div><div class=barw><div class=bar style=\\'width:'+d.score+'%;background:'+gc+'\\'></div></div><div class=score>'+d.score+'/100</div></div></div>';",
    "  var gph=d.graph;h+='<div class=row><b>🕸 graph</b> ⚙ '+gph.functions+' · 🗄 '+gph.tables+' · 🌐 '+gph.endpoints+' · 💼 '+gph.rules+'</div>';",
    "  h+='<div class=row><b>🎯 risk</b> '+d.risk.critical+' critical · '+d.risk.high+' high';if(d.risk.top&&d.risk.top.length){h+='<ul>';d.risk.top.slice(0,3).forEach(function(r){var ic=r.band==='CRITICAL'?'🔴':r.band==='HIGH'?'🟠':'🟡';h+='<li>'+ic+' <b>'+esc(r.name)+'</b> — '+esc((r.factors&&r.factors[0])||'')+'</li>';});h+='</ul>';}else h+=' ✓ none';h+='</div>';",
    "  h+='<div class=row><b>🔒 authz</b> '+(d.authz.clear?'✓ clean':'🔴 '+d.authz.count+' unguarded → '+esc((d.authz.exposedTables||[]).join(', ')))+'</div>';",
    "  h+='<div class=row><b>🧪 tests</b> keystones '+d.testGap.coverage+' guarded'+(d.testGap.untestedKeystones&&d.testGap.untestedKeystones.length?' · ⚠️ untested: '+esc(d.testGap.untestedKeystones.slice(0,4).join(', ')):' ✓')+'</div>';",
    "  if(d.temporal&&(d.temporal.hiddenCount||(d.temporal.topHotspots&&d.temporal.topHotspots.length))){h+='<div class=row><b>⏳ over time</b> '+((d.temporal.topHotspots&&d.temporal.topHotspots[0])?'🔥 <code>'+esc(d.temporal.topHotspots[0].file)+'</code> '+d.temporal.topHotspots[0].churn+'× changed × '+d.temporal.topHotspots[0].couplingEdges+' cross-layer edges':'')+(d.temporal.hiddenCount?' · 🔗 '+d.temporal.hiddenCount+' HIDDEN dependency(ies) the code does not show':'')+' <span style=color:#94a3b8>(replayed across git history)</span></div>';}",
    "  h+='<div class=foot>deterministic · no LLM · fingerprint <code>'+esc(d.fingerprint)+'</code> · <a target=_blank href=\\'/radar?gitUrl='+encodeURIComponent(url)+'\\' style=color:#22d3ee>🛰 see the Impact Radar →</a></div></div>';",
    "  rep.innerHTML=h;rep.style.display='block';}",
    "function run(url){url=String(url||'').trim();if(!valid(url)){st.className='err';st.textContent='Paste a public GitHub/GitLab/Bitbucket repo URL.';return;}u.value=url;go.disabled=true;rep.style.display='none';st.className='';st.innerHTML='<span class=spin></span>running the cross-layer suite on '+esc(url.replace(/^https?:\\/\\//,''))+' …';",
    "  fetch('/api/review?gitUrl='+encodeURIComponent(url)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(o){if(o.ok&&o.j&&o.j.grade){st.textContent='';render(o.j,url);}else{st.className='err';st.textContent=(o.j&&o.j.error)||'could not review this repo';}}).catch(function(e){st.className='err';st.textContent='network error: '+e.message;}).finally(function(){go.disabled=false;});}",
    "f.addEventListener('submit',function(e){e.preventDefault();run(u.value);});",
    "Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){run(c.getAttribute('data-url'));});});",
    "var FEAT='https://github.com/gothinkster/node-express-realworld-example-app';",
    "function hrow(i,html,cls){return '<div class=\"'+(cls?cls+' ':'')+'reveal\" style=\"animation-delay:'+(i*0.1)+'s\">'+html+'</div>';}",
    "function loadHero(){fetch('/api/review?gitUrl='+encodeURIComponent(FEAT)).then(function(r){return r.json();}).then(function(d){var hb=document.getElementById('hbody'),hr=document.getElementById('hrepo');if(!d||!d.grade){if(hb)hb.innerHTML='<div class=hload>live example unavailable — paste your own repo below ↓</div>';return;}var gc=GC[d.grade]||'#22d3ee';if(hr)hr.textContent='mneme review · '+d.repo+' · live';var g=d.graph;var rrows=((d.risk&&d.risk.top)||[]).slice(0,3).map(function(r,i){var ic=r.band==='CRITICAL'?'🔴':r.band==='HIGH'?'🟠':'🟡';return hrow(5+i,ic+' <b>'+esc(r.name)+'</b> <span class=hrf>'+esc((r.factors&&r.factors[0])||'')+'</span>','hr');});var risk=rrows.length?rrows.join(''):hrow(5,'<span class=hrf>✓ none — no single-point-of-failure keystone or authz gap in the scanned code</span>','hr');var tline=d.testGap.coverage==='0/0'?'no single-writer keystones detected (low single-point-of-failure risk)':'keystones '+d.testGap.coverage+' guarded'+(d.testGap.untestedKeystones&&d.testGap.untestedKeystones.length?' · ⚠️ untested: '+esc(d.testGap.untestedKeystones.slice(0,2).join(', ')):'');var h='<div class=\"hgrade reveal pop\" style=\"animation-delay:.1s;background:'+gc+'\">'+d.grade+'</div><div class=hmeta>'+hrow(0,'<span class=hcmd>$ npx mneme review</span>')+hrow(1,'<span class=hg>🕸 '+g.functions+' functions · '+g.tables+' tables · '+g.endpoints+' endpoints — linked across layers</span>')+'<div class=\"hbarw reveal\" style=\"animation-delay:.35s\"><div class=hbarf style=\"width:'+d.score+'%;background:'+gc+'\"></div></div>'+hrow(3,'<span class=hscore>'+d.score+'/100</span>')+'</div>'+hrow(4,'🎯 <b>RISK HOTSPOTS</b>','hsec')+risk+hrow(8,'🔒 <b>AUTHZ</b> &nbsp;'+(d.authz.clear?'✓ no unguarded sensitive-write path':'🔴 '+d.authz.count+' unguarded write → '+esc((d.authz.exposedTables||[]).join(', '))),'hsec')+hrow(9,'🧪 <b>TESTS</b> &nbsp;'+tline,'hsec')+(d.proven&&d.proven.verdict==='UNSAFE'?hrow(10,'🧠 <b>PROVEN</b> &nbsp;unsafe to drop <code>'+esc(d.proven.table)+'</code> — '+esc((d.proven.chain[d.proven.chain.length-1]||'').replace(/_/g,'_'))+' <span class=hrf>(a logic proof, not a guess)</span>','hsec'):'')+(d.temporal&&(d.temporal.hiddenCount||(d.temporal.topHotspots&&d.temporal.topHotspots.length))?hrow(10,'⏳ <b>OVER TIME</b> &nbsp;'+((d.temporal.topHotspots&&d.temporal.topHotspots[0])?'🔥 <code>'+esc(d.temporal.topHotspots[0].file)+'</code> '+d.temporal.topHotspots[0].churn+'× changed × '+d.temporal.topHotspots[0].couplingEdges+' cross-layer edges':'')+(d.temporal.hiddenCount?' · 🔗 '+d.temporal.hiddenCount+' HIDDEN dependency'+(d.temporal.hiddenCount>1?'(ies)':''):'')+' <span class=hrf>(from git history — only Mneme replays the graph across time)</span>','hsec'):'')+hrow(11,'↑ a <b>real</b> report on <b>'+esc(d.repo)+'</b>, computed live + deterministically — <b>no LLM guessed a thing</b>. Now run it on your repo ↓','hfoot');hb.innerHTML=h;}).catch(function(){var hb=document.getElementById('hbody');if(hb)hb.innerHTML='<div class=hload>live example unavailable — paste your own repo below ↓</div>';});}",
    "loadHero();",
    "var q=new URLSearchParams(location.search).get('gitUrl');if(q)run(q);",
  ].join("\n");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Cross-Layer Accountability Suite · Mneme</title>" +
    "<meta name=\"description\" content=\"The cross-layer accountability layer for the autonomous-agent era. Paste any repo for a graded report; 10 deterministic, signed checks no single-layer tool can do.\">" +
    ogMeta("Cross-Layer Accountability Suite · Mneme", "Paste any repo → a graded report across code · data · api · business. 10 deterministic, signed checks no single-layer tool can do. No LLM in the analysis path.", "/suite") +
    "<style>body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:1000px;margin:0 auto;padding:clamp(22px,4vw,56px) 20px}h1{font-size:clamp(30px,5.5vw,52px);margin:0 0 10px;font-weight:850;text-align:center}.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:680px;margin:0 auto;text-align:center;font-size:17px}.inst{text-align:center;margin:16px 0}.inst code{background:#0f1b2e;border:1px solid #2b3a52;border-radius:8px;padding:8px 14px;color:#22d3ee;font-size:15px}form{display:flex;gap:10px;max-width:760px;margin:24px auto 8px;flex-wrap:wrap}input{flex:1;min-width:240px;background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none}input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;cursor:pointer}button.go:disabled{opacity:.6;cursor:wait}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:transparent;border:1px solid #1f2937;color:#94a3b8;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#22d3ee;color:#22d3ee}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}#rep{display:none;max-width:820px;margin:0 auto}.card{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:16px;padding:20px;margin:14px 0}.gradeRow{display:flex;gap:18px;align-items:center}.gradeBadge{width:60px;height:60px;border-radius:14px;display:grid;place-items:center;font-size:34px;font-weight:900;color:#04141b;flex:none}.repo{font-size:14px;color:#22d3ee}.verdict{font-size:16px;font-weight:700;margin:2px 0 8px}.barw{height:9px;background:#1f2937;border-radius:999px;overflow:hidden;max-width:340px}.bar{height:100%;border-radius:999px}.score{color:#94a3b8;font-size:12px;margin-top:4px}.row{border-top:1px solid #1f2937;padding:11px 2px}.row ul{margin:6px 0 0;padding-left:18px;color:#cbd5e1}.foot{color:#64748b;font-size:12px;margin-top:12px}code{background:#1f2937;padding:1px 5px;border-radius:4px}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#22d3ee;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}.gems{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:30px 0}.gem{background:#0f1b2e;border:1px solid #1f2937;border-radius:14px;padding:16px;transition:border-color .15s}.gem:hover{border-color:#22d3ee}.gi{font-size:24px}.gn{font-weight:750;margin:6px 0 4px}.gd{color:#94a3b8;font-size:13px;min-height:52px}.gem code{display:block;margin-top:8px;color:#67e8f9;font-size:12.5px;background:#0b1220;padding:6px 8px;border-radius:7px;overflow-x:auto}h2{text-align:center;font-size:24px;margin:38px 0 4px}.sub{text-align:center;color:#94a3b8;margin:0 0 6px}.foot2{text-align:center;color:#64748b;font-size:13px;margin-top:34px}a{color:#22d3ee}.hero{max-width:640px;margin:20px auto 4px;background:radial-gradient(circle at 28% 0%,#11203a,#0b1220 72%);border:1px solid #243049;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px -24px rgba(34,211,238,.35)}.hbar{display:flex;align-items:center;gap:7px;padding:11px 16px;border-bottom:1px solid #1f2937}.hd{width:11px;height:11px;border-radius:50%}.hd.r{background:#ff5f56}.hd.y{background:#ffbd2e}.hd.g{background:#27c93f}.ht{margin-left:8px;color:#64748b;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace}.hbody{padding:20px}.hgrade{width:62px;height:62px;border-radius:14px;display:grid;place-items:center;font-size:36px;font-weight:900;color:#04141b;float:right;margin-left:14px}.hcmd{font-family:ui-monospace,Menlo,Consolas,monospace;color:#22d3ee;font-size:15px}.hg{color:#94a3b8;font-size:13.5px;margin:8px 0}.hbarw{height:9px;background:#1f2937;border-radius:999px;overflow:hidden;max-width:300px;margin-top:6px}.hbarf{height:100%;border-radius:999px;animation:fill 1s cubic-bezier(.2,.8,.2,1) both}.hscore{color:#94a3b8;font-size:12px;margin-top:4px}.hsec{margin:14px 0 4px;font-size:14px;color:#e5e7eb}.hr{font-size:13.5px;color:#cbd5e1;padding:2px 0 2px 14px}.hrf{color:#94a3b8}.hload{color:#94a3b8;font-size:14px;padding:18px 4px;text-align:center}.hfoot{margin-top:16px;padding-top:12px;border-top:1px solid #1f2937;color:#94a3b8;font-size:13px;text-align:center}.reveal{opacity:0;animation:rise .5s ease forwards}.reveal.pop{animation:pop .6s cubic-bezier(.2,1.3,.4,1) forwards}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes pop{0%{opacity:0;transform:scale(.4)}70%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}@keyframes fill{from{width:0}}@media(prefers-reduced-motion){.reveal,.hbarf{animation:none!important;opacity:1!important}}</style></head>" +
    "<body><div class=\"wrap\"><h1>🕸 <span class=\"grad\">Cross-Layer Accountability</span></h1>" +
    "<p class=\"tag\">The accountability layer for the autonomous-agent era. Mneme links <b>code ↔ database ↔ API ↔ business rules</b> into one deterministic graph — and asks the questions a single-layer tool can't. <b>No LLM in the analysis path</b> — every finding is reproducible and signed.</p>" +
    "<div class=\"inst\"><code>npm i -g mneme-ai &nbsp;&amp;&amp;&nbsp; mneme review</code></div>" +
    hero +
    "<form id=\"f\"><input id=\"u\" type=\"text\" placeholder=\"…or paste a public repo URL to try it now — https://github.com/owner/repo\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"go\" id=\"go\" type=\"submit\">Review →</button></form>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    "<h2>The 10 checks</h2><p class=\"sub\">each one answers a question nothing else answered — and your AI agent gets them all as MCP tools, automatically</p>" +
    "<div class=\"gems\">" + cards + "</div>" +
    "<p class=\"foot2\" style=\"color:#94a3b8;font-size:14px\">" + accuracyLine() + "</p>" +
    "<p class=\"foot2\">Deterministic · signed · local-first · works on JS/TS · Python · Go · Rust · Ruby · Java · C# · the source never leaves your machine (the demo clones to a temp dir, scans, and deletes). <br><a href=\"https://www.npmjs.com/package/mneme-ai\">npm</a> · <a href=\"/review\">/review</a> · <a href=\"/radar\">/radar</a> · <sub>honest: each finding is a candidate to inspect, not a proof of a runtime bug.</sub></p>" +
    "<script>" + js + "</script></div></body></html>";
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
    if (req.method === "GET" && url.pathname === "/radar") return send(res, 200, radarLandingHtml(), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/review") return send(res, 200, reviewLandingHtml(), "text/html; charset=utf-8");
    if (req.method === "GET" && (url.pathname === "/suite" || url.pathname === "/cross-layer")) return send(res, 200, suiteLandingHtml(), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/favicon.svg") return serveStatic(res, "favicon.svg");
    if (req.method === "GET" && url.pathname === "/api/accuracy") {     // measured extractor accuracy (deterministic)
      const r = accuracy.benchmark();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ macroF1: Number(r.macroF1.toFixed(3)), microPrecision: Number(r.microPrecision.toFixed(3)), microRecall: Number(r.microRecall.toFixed(3)), floor: r.floor, meetsFloor: r.meetsFloor, dimensions: r.dimensions.map((d) => ({ dimension: d.dimension, precision: Number(d.precision.toFixed(3)), recall: Number(d.recall.toFixed(3)) })) }, null, 2));
    }
    if (req.method === "GET" && url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" });
      return res.end("User-agent: *\nAllow: /\nSitemap: https://xray.mneme-ai.space/sitemap.xml\n");
    }
    if (req.method === "GET" && url.pathname === "/sitemap.xml") {
      const urls = ["/", "/suite", "/review", "/radar"].map((p) => `  <url><loc>https://xray.mneme-ai.space${p}</loc><changefreq>weekly</changefreq><priority>${p === "/suite" ? "1.0" : "0.8"}</priority></url>`).join("\n");
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=86400" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    }
    if (req.method === "GET" && url.pathname === "/og.png") {            // social share image (binary-safe)
      const p = join(PUBLIC_DIR, "og.png");
      if (!existsSync(p)) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" });
      return res.end(readFileSync(p));
    }
    if (req.method === "GET" && url.pathname === "/card.js") return serveStatic(res, "card.js");
    if (req.method === "GET" && url.pathname === "/local-scan.js") return serveStatic(res, "local-scan.js");
    if (req.method === "GET" && url.pathname === "/cosmic") return serveStatic(res, "cosmic.html");
    if (req.method === "GET" && (url.pathname === "/thymos" || url.pathname === "/thymos.html")) return serveStatic(res, "thymos.html");

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

    // 🛰 CROSS-LAYER IMPACT RADAR — clone a public repo, build the deterministic 4-layer graph
    // (code ↔ data ↔ api ↔ business), return the self-contained interactive radar HTML. Linkable:
    //   GET /api/radar?gitUrl=https://github.com/owner/repo[&focus=<name>]
    // Source is cloned to a temp dir, scanned, and DELETED in finally — nothing persists.
    if (req.method === "GET" && url.pathname === "/api/radar") {
      if (rateLimited("radar:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      const gitUrl = (url.searchParams.get("gitUrl") || "").trim();
      const focusName = (url.searchParams.get("focus") || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs. For private repos, run mneme graph view locally." });
      let handle: { path: string; dispose: () => void } | null = null;
      try {
        handle = shallowClone(gitUrl);
        const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
        const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
        const files: { path: string; content: string }[] = []; const stack = [handle.path];
        while (stack.length && files.length < 3000) {
          const d = stack.pop() as string; let ents: string[] = []; try { ents = readdirSync(d); } catch { continue; }
          for (const e of ents) { if (SKIP.has(e)) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(handle.path.length + 1), content: readFileSync(p, "utf8") }); } catch { /* */ } } }
        }
        const g = crossLayerGraph.buildCrossLayerGraph(files);
        const focus = focusName ? crossLayerGraph.resolveNode(g, focusName) : null;
        const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort())).digest("hex").slice(0, 16);
        const repoName = gitUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
        // default (no focus) → focused radar on the highest-degree hub (verified-rich render);
        // ?overview=1 → the project galaxy. Empty/sparse repos draw a friendly "nothing to map" note.
        const wantOverview = url.searchParams.get("overview") === "1";
        const html = crossLayerGraph.toRadarHtml(g, focus?.id, { fingerprint: fp, title: `Impact Radar — ${repoName}`, overview: wantOverview });
        return send(res, 200, html, "text/html; charset=utf-8");
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      } finally { if (handle) handle.dispose(); }
    }

    // 🔍 CODEBASE ACCOUNTABILITY REPORT — clone a public repo, run the cross-layer suite, return the
    // graded report as JSON. The /review landing renders it. Source cloned → scanned → DELETED.
    if (req.method === "GET" && url.pathname === "/api/review") {
      const gitUrl = (url.searchParams.get("gitUrl") || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs. For private repos, run `mneme review` locally." });
      const cached = reviewCache.get(gitUrl);                       // serve a recent real result instantly (clone once)
      if (cached && Date.now() - cached.at < REVIEW_TTL_MS) return send(res, 200, cached.data);
      if (rateLimited("review:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let handle: { path: string; dispose: () => void } | null = null;
      try {
        handle = shallowClone(gitUrl);
        const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
        const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
        const files: { path: string; content: string }[] = []; const stack = [handle.path];
        while (stack.length && files.length < 4000) {
          const d = stack.pop() as string; let ents: string[] = []; try { ents = readdirSync(d); } catch { continue; }
          for (const e of ents) { if (SKIP.has(e)) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(handle.path.length + 1), content: readFileSync(p, "utf8") }); } catch { /* */ } } }
        }
        const g = crossLayerGraph.buildCrossLayerGraph(files);
        const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
        const risk = riskHotspots.riskHotspots(files, { top: 6, graph: g }); const rsum = riskHotspots.riskSummary(risk);
        const authz = authzGap.authzVerdict(authzGap.authzGaps(g));
        const tg = testGap.analyzeTestGap(files, { graph: g });
        let score = 100; score -= rsum.critical * 22; score -= rsum.high * 9; score -= authz.count * 18; score -= Math.min(24, tg.uncoveredKeystones.length * 6); score = Math.max(0, score);
        const grade = score >= 90 ? "A" : score >= 78 ? "B" : score >= 62 ? "C" : score >= 45 ? "D" : "F";
        const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort())).digest("hex").slice(0, 16);
        // PROOF on the web: prove drop-safety for the most-depended table → every report carries a real proof
        const dep = new Map<string, number>();
        for (const e of g.edges) if ((e.relation === "READS" || e.relation === "WRITES_TO")) dep.set(e.target, (dep.get(e.target) || 0) + 1);
        let topTable = ""; let best = 0; for (const [id, n] of dep) { if (n > best) { best = n; topTable = g.nodes.find((x) => x.id === id)?.name || ""; } }
        let proven: { table: string; verdict: string; chain: string[] } | null = null;
        if (topTable) { const dp = graphLogic.dropProof(g, topTable); proven = { table: dp.table || topTable, verdict: dp.verdict, chain: dp.chain.map((s) => `${s.atom}${s.via === "given" ? " (given)" : " ⇐ " + s.from.join(" ∧ ")}`) }; }
        // TEMPORAL — fast on the blob:none clone (only needs commit→filenames, no blob content):
        // refactor hotspots (churn × cross-layer coupling) + HIDDEN dependencies (co-change with no graph link).
        let temporal: { topHotspots: Array<{ file: string; churn: number; couplingEdges: number; band: string }>; hiddenDeps: Array<{ a: string; b: string; coChanges: number }>; hiddenCount: number } | null = null;
        try {
          const SCAN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
          const lg = gitSpawn("git", ["-C", handle.path, "log", "--no-merges", "--format=%x1e", "--name-only", "-n", "400"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
          if (lg.status === 0 && lg.stdout) {
            const blocks = lg.stdout.split("\x1e");
            const churn: Record<string, number> = {};
            const changesets: string[][] = [];
            for (const b of blocks) { const fs2 = b.split("\n").map((s) => s.trim()).filter((s) => s && SCAN.test(s)); for (const f of fs2) churn[f] = (churn[f] || 0) + 1; if (fs2.length > 1 && fs2.length < 60) changesets.push(fs2); }
            const ranked = hotspotsMod.rankHotspots(hotspotsMod.fileCoupling(g), churn, { top: 4 });
            const cc = changeCouplingMod.changeCoupling(changesets, g, { minSupport: 4, top: 20 });
            temporal = { topHotspots: ranked.map((h) => ({ file: h.file, churn: h.churn, couplingEdges: h.couplingEdges, band: h.band })), hiddenDeps: cc.hidden.slice(0, 5).map((p) => ({ a: p.a, b: p.b, coChanges: p.coChanges })), hiddenCount: cc.hidden.length };
          }
        } catch { /* temporal is best-effort */ }
        const payload = {
          repo: gitUrl.replace(/^https?:\/\//, "").replace(/\.git$/, ""), grade, score, proven,
          graph: { functions: byType("function"), tables: byType("db_table"), endpoints: byType("api_endpoint"), rules: byType("business_rule") },
          risk: { critical: rsum.critical, high: rsum.high, top: risk.map((h) => ({ name: h.name, band: h.band, factors: h.factors, file: h.file })) },
          authz: { clear: authz.clear, count: authz.count, exposedTables: authz.worstTables },
          testGap: { untestedKeystones: tg.uncoveredKeystones.map((k) => k.node.name), coverage: `${tg.coveredKeystones}/${tg.totalKeystones}` },
          temporal,
          fingerprint: fp,
        };
        reviewCache.set(gitUrl, { at: Date.now(), data: payload });
        return send(res, 200, payload);
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
