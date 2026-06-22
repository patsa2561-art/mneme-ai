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
import { crossLayerGraph, riskHotspots, authzGap, testGap, graphLogic, accuracy, hotspots as hotspotsMod, changeCoupling as changeCouplingMod, vericert, notary, commitPersona, seance } from "@mneme-ai/core";
import { dirname, join } from "node:path";
import { spawnSync as gitSpawn } from "node:child_process";
// Open every off-page link in a NEW TAB (incl. dynamically-rendered anchors); same-page #anchors stay put.
const NEWTAB_SCRIPT = "<script>(function(){function f(r){try{(r.querySelectorAll?r.querySelectorAll('a[href]'):[]).forEach(function(a){var h=a.getAttribute('href')||'';if(h&&h.charAt(0)!=='#'&&h.lastIndexOf('javascript:',0)!==0&&!a.target){a.target='_blank';a.rel='noopener noreferrer';}});}catch(e){}}try{new MutationObserver(function(){f(document.body);}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}document.addEventListener('DOMContentLoaded',function(){f(document);});})();</script>";
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${NEWTAB_SCRIPT}
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
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Codebase Accountability Report · Mneme</title>" + NEWTAB_SCRIPT +
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
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Cross-Layer Accountability Suite · Mneme</title>" + NEWTAB_SCRIPT +
    "<meta name=\"description\" content=\"The cross-layer accountability layer for the autonomous-agent era. Paste any repo for a graded report; 10 deterministic, signed checks no single-layer tool can do.\">" +
    ogMeta("Cross-Layer Accountability Suite · Mneme", "Paste any repo → a graded report across code · data · api · business. 10 deterministic, signed checks no single-layer tool can do. No LLM in the analysis path.", "/suite") +
    "<style>body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:1000px;margin:0 auto;padding:clamp(22px,4vw,56px) 20px}h1{font-size:clamp(30px,5.5vw,52px);margin:0 0 10px;font-weight:850;text-align:center}.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:680px;margin:0 auto;text-align:center;font-size:17px}.inst{text-align:center;margin:16px 0}.inst code{background:#0f1b2e;border:1px solid #2b3a52;border-radius:8px;padding:8px 14px;color:#22d3ee;font-size:15px}form{display:flex;gap:10px;max-width:760px;margin:24px auto 8px;flex-wrap:wrap}input{flex:1;min-width:240px;background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none}input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;cursor:pointer}button.go:disabled{opacity:.6;cursor:wait}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:transparent;border:1px solid #1f2937;color:#94a3b8;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#22d3ee;color:#22d3ee}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}#rep{display:none;max-width:820px;margin:0 auto}.card{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:16px;padding:20px;margin:14px 0}.gradeRow{display:flex;gap:18px;align-items:center}.gradeBadge{width:60px;height:60px;border-radius:14px;display:grid;place-items:center;font-size:34px;font-weight:900;color:#04141b;flex:none}.repo{font-size:14px;color:#22d3ee}.verdict{font-size:16px;font-weight:700;margin:2px 0 8px}.barw{height:9px;background:#1f2937;border-radius:999px;overflow:hidden;max-width:340px}.bar{height:100%;border-radius:999px}.score{color:#94a3b8;font-size:12px;margin-top:4px}.row{border-top:1px solid #1f2937;padding:11px 2px}.row ul{margin:6px 0 0;padding-left:18px;color:#cbd5e1}.foot{color:#64748b;font-size:12px;margin-top:12px}code{background:#1f2937;padding:1px 5px;border-radius:4px}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#22d3ee;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}.gems{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:30px 0}.gem{background:#0f1b2e;border:1px solid #1f2937;border-radius:14px;padding:16px;transition:border-color .15s}.gem:hover{border-color:#22d3ee}.gi{font-size:24px}.gn{font-weight:750;margin:6px 0 4px}.gd{color:#94a3b8;font-size:13px;min-height:52px}.gem code{display:block;margin-top:8px;color:#67e8f9;font-size:12.5px;background:#0b1220;padding:6px 8px;border-radius:7px;overflow-x:auto}h2{text-align:center;font-size:24px;margin:38px 0 4px}.sub{text-align:center;color:#94a3b8;margin:0 0 6px}.foot2{text-align:center;color:#64748b;font-size:13px;margin-top:34px}a{color:#22d3ee}.hero{max-width:640px;margin:20px auto 4px;background:radial-gradient(circle at 28% 0%,#11203a,#0b1220 72%);border:1px solid #243049;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px -24px rgba(34,211,238,.35)}.hbar{display:flex;align-items:center;gap:7px;padding:11px 16px;border-bottom:1px solid #1f2937}.hd{width:11px;height:11px;border-radius:50%}.hd.r{background:#ff5f56}.hd.y{background:#ffbd2e}.hd.g{background:#27c93f}.ht{margin-left:8px;color:#64748b;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace}.hbody{padding:20px}.hgrade{width:62px;height:62px;border-radius:14px;display:grid;place-items:center;font-size:36px;font-weight:900;color:#04141b;float:right;margin-left:14px}.hcmd{font-family:ui-monospace,Menlo,Consolas,monospace;color:#22d3ee;font-size:15px}.hg{color:#94a3b8;font-size:13.5px;margin:8px 0}.hbarw{height:9px;background:#1f2937;border-radius:999px;overflow:hidden;max-width:300px;margin-top:6px}.hbarf{height:100%;border-radius:999px;animation:fill 1s cubic-bezier(.2,.8,.2,1) both}.hscore{color:#94a3b8;font-size:12px;margin-top:4px}.hsec{margin:14px 0 4px;font-size:14px;color:#e5e7eb}.hr{font-size:13.5px;color:#cbd5e1;padding:2px 0 2px 14px}.hrf{color:#94a3b8}.hload{color:#94a3b8;font-size:14px;padding:18px 4px;text-align:center}.hfoot{margin-top:16px;padding-top:12px;border-top:1px solid #1f2937;color:#94a3b8;font-size:13px;text-align:center}.reveal{opacity:0;animation:rise .5s ease forwards}.reveal.pop{animation:pop .6s cubic-bezier(.2,1.3,.4,1) forwards}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes pop{0%{opacity:0;transform:scale(.4)}70%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}@keyframes fill{from{width:0}}@media(prefers-reduced-motion){.reveal,.hbarf{animation:none!important;opacity:1!important}}</style></head>" +
    "<body><div class=\"wrap\"><h1>🕸 <span class=\"grad\">Cross-Layer Accountability</span></h1>" +
    "<p class=\"tag\">The accountability layer for the autonomous-agent era. Mneme links <b>code ↔ database ↔ API ↔ business rules</b> into one deterministic graph — and asks the questions a single-layer tool can't. <b>No LLM in the analysis path</b> — every finding is reproducible and signed.</p>" +
    "<div class=\"inst\"><code>npm i -g mneme-ai &nbsp;&amp;&amp;&nbsp; mneme review</code></div>" +
    "<div style=\"text-align:center;margin:8px 0 2px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap\"><a href=\"/certify\" style=\"display:inline-block;background:#0f1b2e;border:1px solid #2b3a52;border-radius:999px;padding:9px 18px;color:#e5e7eb;text-decoration:none;font-size:14px\">🎗️ <b>Verified by Mneme</b>: certify AI-worker output →</a><a href=\"/persona\" style=\"display:inline-block;background:#0f1b2e;border:1px solid #2b3a52;border-radius:999px;padding:9px 18px;color:#e5e7eb;text-decoration:none;font-size:14px\">🎭 <b>Commit Persona</b>: your git style as a 3D cartoon →</a><a href=\"/seance\" style=\"display:inline-block;background:#0f1b2e;border:1px solid #2b3a52;border-radius:999px;padding:9px 18px;color:#e5e7eb;text-decoration:none;font-size:14px\">🔮 <b>Séance</b>: the reasoning behind any commit →</a></div>" +
    hero +
    "<form id=\"f\"><input id=\"u\" type=\"text\" placeholder=\"…or paste a public repo URL to try it now — https://github.com/owner/repo\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"go\" id=\"go\" type=\"submit\">Review →</button></form>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    "<h2>The 10 checks</h2><p class=\"sub\">each one answers a question nothing else answered — and your AI agent gets them all as MCP tools, automatically</p>" +
    "<div class=\"gems\">" + cards + "</div>" +
    "<p class=\"foot2\" style=\"color:#94a3b8;font-size:14px\">" + accuracyLine() + "</p>" +
    "<p class=\"foot2\">Deterministic · signed · local-first · works on JS/TS · Python · Go · Rust · Ruby · Java · C# · the source never leaves your machine (the demo clones to a temp dir, scans, and deletes). <br><a href=\"https://www.npmjs.com/package/mneme-ai\">npm</a> · <a href=\"/review\">/review</a> · <a href=\"/radar\">/radar</a> · <sub>honest: each finding is a candidate to inspect, not a proof of a runtime bug.</sub></p>" +
    "<script>" + js + "</script></div></body></html>";
}

// ─── 🎗️ VERIFIED-BY-MNEME — certify AI-worker output (the trust layer) ───────
// Stores ONLY the certificate (verdict + score + certId + fault claim-slices),
// never the full deliverable. The cert is named by its certId, so a badge/permalink
// is shareable + the signed receipt is verifiable offline.
type StoredCert = vericert.Certificate & { signed?: unknown };
const CERTS_DIR = () => join(dataDir(), "certs");
const CERT_RE = /^[a-f0-9]{12,64}$/;
function saveCert(c: StoredCert) {
  try { if (!existsSync(CERTS_DIR())) mkdirSync(CERTS_DIR(), { recursive: true }); if (CERT_RE.test(c.certId)) writeFileSync(join(CERTS_DIR(), c.certId + ".json"), JSON.stringify(c)); } catch { /* best-effort */ }
}
function getCert(certId: string): StoredCert | null {
  try { if (!CERT_RE.test(certId)) return null; const p = join(CERTS_DIR(), certId + ".json"); return existsSync(p) ? (JSON.parse(rf(p, "utf8")) as StoredCert) : null; } catch { return null; }
}

/** The 🎗️ Verified-by-Mneme landing — paste an AI-produced deliverable, get a
 *  signed certificate + a shareable badge. Same dark theme as /review. */
function certifyLandingHtml(): string {
  const examples = [
    ["✓ a clean report", "The service returns a JSON object. In our staging tests, median latency dropped about 12% with a warm cache. Verify the schema before relying on it in production."],
    ["🛑 a hallucinated answer", "The build is great. Because p > 0.05 the change has no effect on latency. It always works and never fails on any input. Studies prove exactly 73.2% of users convert immediately."],
    ["📊 a fishy stat claim", "Adoption is strong: after the rollout, 120% of users upgraded immediately, and there is a 95% probability the true value lies inside our confidence interval."],
    ["📚 a faked citation", "The approach is sound. According to Smith et al. (2019), this definitively proves the method is guaranteed to work with absolutely no risk."],
  ];
  const chips = examples.map(([label, t]) => `<button class="chip" data-fill="${xesc(t)}">${xesc(label)}</button>`).join("");
  const js = [
    "var f=document.getElementById('f'),u=document.getElementById('u'),go=document.getElementById('go'),st=document.getElementById('st'),rep=document.getElementById('rep');",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "var VC={CERTIFIED:'#22c55e',CONDITIONAL:'#eab308',REJECTED:'#ef4444'};",
    "function render(d){var c=d.cert,col=VC[c.verdict]||'#94a3b8';var h='<div class=card>';",
    "  h+='<div class=gradeRow><div class=gradeBadge style=\\'background:'+col+'\\'>'+(c.verdict==='CERTIFIED'?'✓':c.verdict==='CONDITIONAL'?'❔':'🛑')+'</div><div style=flex:1><div class=verdict>'+c.verdict+'</div><div class=repo>score '+Math.round(c.score*100)+'% · '+c.trusted+'/'+c.claimsChecked+' claims clean · certId '+esc(c.certId.slice(0,16))+'…</div></div></div>';",
    "  if(c.faults&&c.faults.length){h+='<div class=row><b>What to fix</b><ul>';c.faults.forEach(function(x){var ic=x.verdict==='BLOCK'?'🛑':'❔';h+='<li>'+ic+' <b>'+esc(x.nerves.join(', '))+'</b> — '+esc(x.claim)+'</li>';});h+='</ul></div>';}",
    "  else h+='<div class=row>✓ no known fault in any checked claim.</div>';",
    "  h+='<div class=row><b>🎗 Shareable badge</b><div style=margin:10px_0>'+d.badgeSvg+'</div>';",
    "  h+='<div class=mono>Embed: <code>&lt;img src=\"'+location.origin+d.badgeUrl+'\"&gt;</code></div>';",
    "  h+='<div class=mono>Permalink: <a target=_blank href=\"'+d.permalink+'\">'+location.origin+d.permalink+'</a></div></div>';",
    "  h+='<div class=foot>CERTIFIED = no <i>known</i> fault + the engine\\'s measured precision, <b>not</b> a proof of truth. Ed25519-signed · verify offline with <code>mneme certify verify</code>.</div></div>';",
    "  rep.innerHTML=h;rep.style.display='block';}",
    "function run(){var d=String(u.value||'').trim();if(!d){st.className='err';st.textContent='Paste an AI-produced deliverable to certify.';return;}go.disabled=true;rep.style.display='none';st.className='';st.innerHTML='<span class=spin></span>certifying — running every claim through the verification stack…';",
    "  fetch('/api/certify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deliverable:d})}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(o){if(o.ok&&o.j&&o.j.cert){st.textContent='';render(o.j);}else{st.className='err';st.textContent=(o.j&&o.j.error)||'could not certify';}}).catch(function(e){st.className='err';st.textContent='network error: '+e.message;}).finally(function(){go.disabled=false;});}",
    "f.addEventListener('submit',function(e){e.preventDefault();run();});",
    "Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){u.value=c.getAttribute('data-fill');run();});});",
  ].join("\n");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Verified by Mneme · certify AI-worker output</title>" + NEWTAB_SCRIPT +
    "<meta name=\"description\" content=\"Paste any AI-produced deliverable → a signed, offline-verifiable trust certificate (CERTIFIED / CONDITIONAL / REJECTED) + a shareable badge. CERTIFIED-precision 1.0 — never certifies a hallucinated deliverable.\">" +
    ogMeta("Verified by Mneme · the trust certificate for AI work", "Everyone builds the AI worker; nobody certifies the work. Paste a deliverable → a signed, offline-verifiable certificate + a shareable badge. Never certifies a hallucinated deliverable.", "/certify") +
    "<style>body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:860px;margin:0 auto;padding:clamp(20px,4vw,52px) 20px}h1{font-size:clamp(28px,5vw,44px);margin:0 0 8px;font-weight:850;text-align:center}.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:660px;margin:0 auto;text-align:center}form{display:flex;flex-direction:column;gap:10px;max-width:760px;margin:24px auto 8px}textarea{background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none;min-height:120px;resize:vertical;font-family:inherit}textarea:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;cursor:pointer;align-self:center}button.go:disabled{opacity:.6;cursor:wait}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:transparent;border:1px solid #1f2937;color:#94a3b8;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#22d3ee;color:#22d3ee}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}#rep{display:none}.card{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:16px;padding:20px;margin:14px 0}.gradeRow{display:flex;gap:18px;align-items:center}.gradeBadge{width:64px;height:64px;border-radius:14px;display:grid;place-items:center;font-size:32px;font-weight:900;color:#04141b;flex:none}.verdict{font-size:20px;font-weight:800}.repo{font-size:13px;color:#94a3b8;margin-top:2px}.row{border-top:1px solid #1f2937;padding:13px 2px}.row ul{margin:8px 0 0;padding-left:18px;color:#cbd5e1}.row li{margin:4px 0}.mono{font-size:12.5px;color:#94a3b8;margin-top:6px}.foot{color:#64748b;font-size:12px;margin-top:14px}code{background:#1f2937;padding:1px 5px;border-radius:4px;color:#cbd5e1}a{color:#22d3ee}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#22d3ee;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}.foot2{text-align:center;color:#64748b;font-size:13px;margin-top:30px}.eg{max-width:720px;margin:6px auto 0;text-align:center;color:#94a3b8;font-size:13.5px;background:#0f1b2e;border:1px solid #1f2937;border-radius:12px;padding:12px 16px}.eg b{color:#cbd5e1}.egline{text-align:center;color:#94a3b8;font-size:13px;margin:14px 0 4px}.chip{background:#0f1b2e;border:1px solid #2b3a52;color:#cbd5e1;font-size:13.5px;padding:8px 15px}.chip:hover{border-color:#22d3ee;color:#22d3ee;background:#11233a}</style></head>" +
    "<body><div class=\"wrap\"><div style=\"text-align:center\"><h1>🎗️ <span class=\"grad\">Verified by Mneme</span></h1>" +
    "<p class=\"tag\">Everyone builds the AI worker; <b>nobody certifies the work</b>. Paste an AI-produced deliverable — report, code, answer — and get a <b>signed, offline-verifiable certificate</b> + a shareable badge. <b>CERTIFIED-precision 1.0</b>: it never certifies a hallucinated deliverable.</p></div>" +
    "<p class=\"eg\">📋 <b>What goes here?</b> Any text an AI produced for you — a ChatGPT/Claude answer, a research or status report, a PR description, a data summary. VERICERT checks every sentence for hallucination, stat fallacies, faked citations, overconfidence &amp; injection.</p>" +
    "<form id=\"f\"><textarea id=\"u\" placeholder=\"e.g.  Because p > 0.05 the change has no effect. It always works and never fails. Studies prove exactly 73.2% of users convert.&#10;&#10;…or click a one-click example just below ↓\" spellcheck=\"false\"></textarea><button class=\"go\" id=\"go\" type=\"submit\">Certify →</button></form>" +
    "<div class=\"egline\">👇 No deliverable handy? Click a live example:</div>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    "<p class=\"foot2\">Local + private: <code>npm i -g mneme-ai</code> then <code>mneme certify \"&lt;deliverable&gt;\"</code> · MCP <code>mneme.vericert.certify</code> · auto-wired into every AI agent. <br>Part of the <a href=\"/suite\">Cross-Layer Accountability Suite</a> · <a href=\"https://github.com/patsa2561-art/mneme\">how it works →</a> · <sub>honest: CERTIFIED = no known fault, not a proof of truth.</sub></p>" +
    "<script>" + js + "</script></div></body></html>";
}

// ─── 🎭 COMMIT PERSONA — render each developer's commit style as a 3D cartoon ──
// Reads REAL git history (two cheap `git log` passes joined by hash), builds a
// measured persona + a distinct avatar per author. Honest: it measures commit
// HYGIENE, not skill or worth. Source cloned → scanned → deleted (nothing stored).
function parseCommitsFromGit(repoPath: string, max = 600): commitPersona.CommitRec[] {
  const US = "\x1f", RS = "\x1e";
  // pass 1 — metadata (hash, author, ts, subject, body); body has no RS/US so it's safe
  const meta = gitSpawn("git", ["-C", repoPath, "log", "--no-merges", "-n", String(max), `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (meta.status !== 0 || !meta.stdout) return [];
  const byHash = new Map<string, commitPersona.CommitRec>();
  for (const blk of meta.stdout.split(RS)) {
    if (!blk.trim()) continue;
    const [hash, author, at, subject, ...rest] = blk.split(US);
    if (!hash) continue;
    byHash.set(hash.trim(), { author: (author || "unknown").trim(), ts: parseInt(at || "0", 10) || 0, subject: (subject || "").trim(), body: (rest.join(US) || "").trim(), files: [], insertions: 0, deletions: 0 });
  }
  // pass 2 — numstat per commit, joined by hash
  const ns = gitSpawn("git", ["-C", repoPath, "log", "--no-merges", "-n", String(max), "--numstat", `--format=${RS}%H`], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (ns.status === 0 && ns.stdout) {
    for (const blk of ns.stdout.split(RS)) {
      const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const rec = byHash.get(lines[0]!); if (!rec) continue;
      for (const l of lines.slice(1)) {
        const m = l.split("\t"); if (m.length < 3) continue;
        rec.insertions += parseInt(m[0]!, 10) || 0; rec.deletions += parseInt(m[1]!, 10) || 0; rec.files.push(m[2]!);
      }
    }
  }
  return [...byHash.values()];
}

function personaLandingHtml(): string {
  const examples = ["https://github.com/sindresorhus/slugify", "https://github.com/honojs/hono", "https://github.com/expressjs/express"];
  const chips = examples.map((u) => `<button class="chip" data-url="${u}">${u.replace(/^https:\/\/github.com\//, "")}</button>`).join("");
  const js = [
    "var f=document.getElementById('f'),u=document.getElementById('u'),go=document.getElementById('go'),st=document.getElementById('st'),rep=document.getElementById('rep');",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function valid(v){return /^https?:\\/\\/(www\\.)?(github|gitlab|bitbucket)\\.(com|org)\\/[^\\s]+\\/[^\\s]+/.test(String(v||'').trim());}",
    "var TC={ROOKIE:'#9ca3af',BRONZE:'#c2803f',SILVER:'#cbd5e1',GOLD:'#f4b400',PLATINUM:'#5eead4',DIAMOND:'#818cf8',LEGENDARY:'#f0abfc'};",
    "var RM={COMMON:'#9ca3af',UNCOMMON:'#22c55e',RARE:'#38bdf8',EPIC:'#f4b400',MYTHIC:'#5eead4',LEGENDARY:'#818cf8',SECRET:'#f0abfc'};",
    "var CURREPO='';",
    "function bar(lbl,v,c){return '<div class=sb><span>'+lbl+'</span><i><b style=\"width:'+v+'%;background:'+c+'\"></b></i><em>'+v+'</em></div>';}",
    "function shareX(b){var a=b.getAttribute('data-a'),t=b.getAttribute('data-t'),r=b.getAttribute('data-r');var url=location.origin+'/persona?gitUrl='+encodeURIComponent('https://'+CURREPO);var text=a+' commits like a '+t+' ('+r+') 🎭 — find your git hero on Mneme Commit Persona:';window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text)+'&url='+encodeURIComponent(url),'_blank','noopener');}",
    "function copyL(b){var url=location.origin+'/persona?gitUrl='+encodeURIComponent('https://'+CURREPO);if(navigator.clipboard){navigator.clipboard.writeText(url);b.textContent='✓ copied';setTimeout(function(){b.textContent='🔗 Copy link';},1500);}}",
    "function card(p){var m=p.metrics,s=p.stats||{},tc=TC[p.tier]||'#9ca3af',rc=RM[p.rarity]||'#9ca3af';",
    "  return '<div class=toon style=\"border-color:'+rc+'66;box-shadow:0 0 22px '+rc+'22\"><div class=rartag style=\"background:'+rc+'\">'+esc(p.rarity)+'</div><div class=stage><div class=avatar>'+p.avatarSvg+'</div></div>'+",
    "  '<div class=name>'+esc(p.author)+'</div>'+",
    "  '<div class=tierrow><span class=tierbadge style=\"background:'+tc+'\">'+esc(p.tier)+'</span><span class=lvl>Lv.'+p.level+'</span><span class=pw title=\"overall, quality-weighted — not skill\">⚡'+p.power+'</span></div>'+",
    "  '<div class=arch>'+esc(p.archetype)+'</div>'+",
    "  '<div class=blurb>'+esc(p.blurb)+'</div>'+",
    "  '<div class=sheet>'+bar('Precision',s.precision||0,'#22d3ee')+bar('Discipline',s.discipline||0,'#a78bfa')+bar('Coverage',s.coverage||0,'#22c55e')+bar('Velocity',s.velocity||0,'#f4b400')+bar('Stability',s.stability||0,'#f97316')+'</div>'+",
    "  '<div class=stats>'+'<span title=\"non-merge commits authored by this contributor\">📦 '+m.commits+' commits</span>'+'<span>📏 ~'+Math.round(m.avgChurn)+' lines/commit</span>'+'<span>🧪 '+Math.round(m.testTouchRate*100)+'% w/ tests</span>'+'<span>📝 '+Math.round(m.conventionalRate*100)+'% conventional</span>'+(m.fixRate>0.1?'<span>🚒 '+Math.round(m.fixRate*100)+'% firefighting</span>':'')+(m.nightRate>0.3?'<span>🌙 '+Math.round(m.nightRate*100)+'% night</span>':'')+'</div>'+",
    "  '<div class=share><button class=shbtn onclick=\"shareX(this)\" data-a=\"'+esc(p.author)+'\" data-t=\"'+esc(p.archetype)+'\" data-r=\"'+esc(p.rarity)+'\">𝕏 Share</button><button class=shbtn onclick=\"copyL(this)\">🔗 Copy link</button></div></div>';}",
    "function render(d){if(!d.personas||!d.personas.length){st.className='err';st.textContent='No commits found to analyze.';return;}CURREPO=d.repo||'';",
    "  var recon='<div class=recon><b>'+d.repoCommits+'</b> commits in repo'+(d.merges?' · <b>'+d.merges+'</b> merge'+(d.merges>1?'s':'')+' excluded':'')+' · <b>'+d.analyzedCommits+'</b> authored commits analyzed across <b>'+d.contributors+'</b> contributor'+(d.contributors>1?'s':'')+(d.shownContributors<d.contributors?' (showing '+d.shownContributors+' with ≥'+(d.minCommitsForPersona||3)+' commits — a 1-commit author isn\\'t a style)':'')+'. <span class=mq>Matches git exactly — merge commits aren\\'t authored work, so they\\'re counted separately.</span></div>';",
    "  rep.innerHTML='<h2 class=rt>'+esc(d.repo)+'</h2>'+recon+'<div class=grid>'+d.personas.map(card).join('')+'</div><p class=foot>🎭 each hero is generated from <b>measured git signals</b> (deterministic — same history, same hero). ⚡ = commit <b>hygiene</b>, not skill or worth. Source was cloned, scanned, and <b>deleted</b>.</p>';rep.style.display='block';rep.scrollIntoView({behavior:'smooth',block:'nearest'});}",
    "function run(url){url=String(url||'').trim();if(!valid(url)){st.className='err';st.textContent='Paste a public GitHub/GitLab/Bitbucket repo URL.';return;}u.value=url;go.disabled=true;rep.style.display='none';st.className='';st.innerHTML='<span class=spin></span>reading the commit history of '+esc(url.replace(/^https?:\\/\\//,''))+' …';",
    "  fetch('/api/persona?gitUrl='+encodeURIComponent(url)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(o){if(o.ok&&o.j&&o.j.personas){st.textContent='';render(o.j);}else{st.className='err';st.textContent=(o.j&&o.j.error)||'could not analyze this repo';}}).catch(function(e){st.className='err';st.textContent='network error: '+e.message;}).finally(function(){go.disabled=false;});}",
    "f.addEventListener('submit',function(e){e.preventDefault();run(u.value);});",
    "Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){run(c.getAttribute('data-url'));});});",
    "var q=new URLSearchParams(location.search).get('gitUrl');if(q)run(q);",
  ].join("\n");
  // collection gallery — one representative hero per rarity, rendered server-side
  const gcards = commitPersona.sampleCollection().map((p) => {
    const meta = commitPersona.RARITY_META[p.rarity];
    return `<div class="gcard${p.rarity === "SECRET" ? " secret" : ""}" style="border-color:${meta.color}66"><div class="gmini">${commitPersona.personaAvatarSvg(p)}</div><div class="grar" style="color:${meta.color}">${xesc(meta.label)}</div><div class="gtier">${xesc(p.tier)} · ${xesc(meta.chance)}</div><div class="ghow">${xesc(meta.how)}</div></div>`;
  }).join("");
  const galleryHtml = `<h2 class="gh">🎴 Collect them all</h2><p class="gsub">Seven rarities, earned by <b>how you push</b> — not luck, not who you are. Climb from <b style="color:#9ca3af">Common</b> to the 1-in-a-repo <b style="color:#f0abfc">✦ Secret</b> by shipping small, tested, well-told, stable commits. Every rank is a measured, deterministic verdict.</p><div class="gallery">${gcards}</div>`;
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Commit Persona · your git style as a 3D cartoon · Mneme</title>" + NEWTAB_SCRIPT +
    "<meta name=\"description\" content=\"Paste any public repo → every contributor's commit style rendered as a distinct 3D cartoon, from measured git signals. The Surgeon, the Bulldozer, the Firefighter… deterministic, honest (hygiene, not skill).\">" +
    ogMeta("Commit Persona · your git style as a 3D cartoon", "Every developer commits differently. Mneme turns a repo's real git history into a distinct 3D cartoon per contributor — measured, deterministic, honest (commit hygiene, not skill).", "/persona") +
    "<style>body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:1000px;margin:0 auto;padding:clamp(20px,4vw,52px) 20px}h1{font-size:clamp(28px,5vw,46px);margin:0 0 8px;font-weight:850;text-align:center}.grad{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:660px;margin:0 auto;text-align:center}form{display:flex;gap:10px;max-width:760px;margin:24px auto 8px;flex-wrap:wrap}input{flex:1;min-width:240px;background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:15px 16px;color:#e5e7eb;font-size:15px;outline:none}input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}button.go{background:linear-gradient(90deg,#22d3ee,#0891b2);color:#04141b;border:0;border-radius:12px;padding:15px 26px;font-weight:800;cursor:pointer}button.go:disabled{opacity:.6;cursor:wait}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:transparent;border:1px solid #1f2937;color:#94a3b8;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#22d3ee;color:#22d3ee}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}#rep{display:none}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:18px}.toon{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:18px;padding:18px;text-align:center}.stage{perspective:700px;height:212px;display:grid;place-items:center;overflow:hidden}.avatar{transform-style:preserve-3d;animation:float 4s ease-in-out infinite;transition:transform .25s}.toon:hover .avatar{animation-play-state:paused;transform:rotateY(26deg) rotateX(-7deg) scale(1.05)}.avatar svg{display:block;width:auto;height:204px;filter:drop-shadow(0 14px 22px rgba(0,0,0,.5))}@keyframes float{0%,100%{transform:translateY(0) rotateY(-14deg)}50%{transform:translateY(-12px) rotateY(14deg)}}@media(prefers-reduced-motion){.avatar{animation:none}}.name{font-weight:750;margin-top:8px;color:#e5e7eb;font-size:15px;word-break:break-word}.tierrow{display:flex;gap:8px;align-items:center;justify-content:center;margin:6px 0 2px}.tierbadge{font-size:11px;font-weight:800;color:#0b1220;border-radius:999px;padding:2px 10px;letter-spacing:.5px}.lvl{font-size:13px;font-weight:800;color:#e5e7eb}.pw{font-size:12px;color:#cbd5e1;background:#0b1220;border:1px solid #1f2937;border-radius:999px;padding:2px 8px}.arch{color:#22d3ee;font-weight:700;font-size:14px;margin-top:2px}.blurb{color:#94a3b8;font-size:12.5px;margin:6px 0 10px;min-height:34px}.sheet{margin:8px 0 10px;text-align:left}.sb{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;color:#94a3b8}.sb span{width:64px;text-align:right}.sb i{flex:1;height:7px;background:#0b1220;border:1px solid #1f2937;border-radius:999px;overflow:hidden}.sb b{display:block;height:100%;border-radius:999px}.sb em{width:22px;font-style:normal;color:#cbd5e1;text-align:right}.stats{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.stats span{background:#0b1220;border:1px solid #1f2937;border-radius:999px;padding:4px 9px;font-size:11.5px;color:#cbd5e1}.foot{color:#64748b;font-size:12.5px;text-align:center;margin-top:22px}.foot2{text-align:center;color:#64748b;font-size:13px;margin-top:28px}a{color:#22d3ee}code{background:#1f2937;padding:1px 5px;border-radius:4px}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#22d3ee;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}.toon{position:relative}.rartag{position:absolute;top:10px;right:10px;font-size:9.5px;font-weight:800;color:#0b1220;border-radius:999px;padding:2px 8px;letter-spacing:.5px}.rt{text-align:center;font-size:18px;margin:10px 0 0;color:#e5e7eb}.recon{text-align:center;color:#94a3b8;font-size:13px;margin:4px auto 0;max-width:680px;background:#0f1b2e;border:1px solid #1f2937;border-radius:10px;padding:8px 14px}.recon b{color:#cbd5e1}.mq{display:block;color:#64748b;font-size:11.5px;margin-top:3px}.share{display:flex;gap:8px;justify-content:center;margin-top:12px}.shbtn{background:#0b1220;border:1px solid #2b3a52;color:#cbd5e1;border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer}.shbtn:hover{border-color:#22d3ee;color:#22d3ee}.gh{text-align:center;font-size:24px;margin:42px 0 4px}.gsub{text-align:center;color:#94a3b8;max-width:680px;margin:0 auto 8px;font-size:13.5px}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px}.gcard{background:#0f1b2e;border:1px solid #1f2937;border-radius:14px;padding:12px 10px;text-align:center}.gcard.secret{background:radial-gradient(circle at 50% 0%,#241433,#0b1220 75%);box-shadow:0 0 26px #f0abfc33}.gmini svg{width:100%;height:auto;max-height:150px}.grar{font-weight:800;font-size:13px;margin-top:4px}.gtier{color:#94a3b8;font-size:11px}.ghow{color:#7c8698;font-size:10.5px;margin-top:5px;line-height:1.4}</style></head>" +
    "<body><div class=\"wrap\"><div style=\"text-align:center\"><h1>🎭 <span class=\"grad\">Commit Persona</span></h1>" +
    "<p class=\"tag\">Every developer commits differently. Paste a public repo and watch each contributor become a <b>distinct 3D cartoon</b> — <i>The Surgeon</i>, <i>The Bulldozer</i>, <i>The Firefighter</i>… built from <b>measured git signals</b>. Hover to spin them. <b>Honest:</b> it scores commit <b>hygiene</b>, not skill.</p></div>" +
    "<form id=\"f\"><input id=\"u\" type=\"text\" placeholder=\"https://github.com/owner/repo\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"go\" id=\"go\" type=\"submit\">Reveal personas →</button></form>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    galleryHtml +
    "<p class=\"foot2\">Local + private repos: <code>npm i -g mneme-ai</code> then <code>mneme persona</code> · part of the <a href=\"/suite\">Accountability Suite</a> · <sub>deterministic · honest: commit hygiene, not a judgment of the person.</sub></p>" +
    "<script>" + js + "</script></div></body></html>";
}

// ─── 🔮 SÉANCE — the reasoning behind any commit (git-native grounded context) ──
function seanceLandingHtml(): string {
  const examples = ["https://github.com/honojs/hono", "https://github.com/sindresorhus/slugify", "https://github.com/expressjs/express"];
  const chips = examples.map((u) => `<button class="chip" data-url="${u}">${u.replace(/^https:\/\/github.com\//, "")}</button>`).join("");
  const js = [
    "var f=document.getElementById('f'),u=document.getElementById('u'),rf=document.getElementById('rf'),go=document.getElementById('go'),st=document.getElementById('st'),rep=document.getElementById('rep');",
    "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function valid(v){return /^https?:\\/\\/(www\\.)?(github|gitlab|bitbucket)\\.(com|org)\\/[^\\s]+\\/[^\\s]+/.test(String(v||'').trim());}",
    "function rows(title,arr,icon){if(!arr||!arr.length)return '';var h='<div class=sec><div class=sh>'+icon+' '+title+'</div>';arr.slice(0,7).forEach(function(c){h+='<div class=cm><code>'+esc(c.hash)+'</code> '+esc(c.subject)+'</div>';});return h+'</div>';}",
    "function render(p){var h='<div class=card>';",
    "  h+='<div class=at>🔮 summoned at <code>'+esc(p.at.ref)+'</code> · '+p.at.monthsAgo+' month(s) ago</div>';",
    "  h+='<div class=said><div class=sh>💬 What was said</div><div class=q>\"'+esc(p.decision.subject)+'\"</div>'+(p.decision.body?'<div class=body>'+esc(p.decision.body)+'</div>':'')+'</div>';",
    "  if(p.themes&&p.themes.length)h+='<div class=sec><div class=sh>🎯 Focused on</div><div class=themes>'+p.themes.map(function(t){return '<span>'+esc(t)+'</span>';}).join('')+'</div></div>';",
    "  h+=rows('How this code evolved (same files)',p.lineage,'🧬');",
    "  h+=rows('Leading up to it',p.window,'🕰');",
    "  h+=rows('Paths abandoned',p.abandoned,'👻');",
    "  if(p.todosThen&&p.todosThen.length){h+='<div class=sec><div class=sh>📌 Intentions open then</div>';p.todosThen.slice(0,8).forEach(function(t){h+='<div class=cm><code>'+esc(t.file)+':'+t.line+'</code> '+esc(t.text)+'</div>';});h+='</div>';}",
    "  h+='<div class=foot>🧷 '+p.citations.length+' citations · packetId <code>'+esc(p.packetId.slice(0,16))+'…</code><br>'+esc(p.groundingNote)+'</div></div>';",
    "  rep.innerHTML=h;rep.style.display='block';rep.scrollIntoView({behavior:'smooth',block:'nearest'});}",
    "function run(){var url=String(u.value||'').trim();if(!valid(url)){st.className='err';st.textContent='Paste a public GitHub/GitLab/Bitbucket repo URL.';return;}go.disabled=true;rep.style.display='none';st.className='';st.innerHTML='<span class=spin></span>summoning the decision context…';",
    "  var q='/api/seance?gitUrl='+encodeURIComponent(url);var r=String(rf.value||'').trim();if(r)q+='&ref='+encodeURIComponent(r);",
    "  fetch(q).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(o){if(o.ok&&o.j&&o.j.decision){st.textContent='';render(o.j);}else{st.className='err';st.textContent=(o.j&&o.j.error)||'could not summon';}}).catch(function(e){st.className='err';st.textContent='network error: '+e.message;}).finally(function(){go.disabled=false;});}",
    "f.addEventListener('submit',function(e){e.preventDefault();run();});",
    "Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){u.value=c.getAttribute('data-url');run();});});",
    "var qp=new URLSearchParams(location.search);if(qp.get('gitUrl')){u.value=qp.get('gitUrl');if(qp.get('ref'))rf.value=qp.get('ref');run();}",
  ].join("\n");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Séance · the reasoning behind any commit · Mneme</title>" + NEWTAB_SCRIPT +
    "<meta name=\"description\" content=\"Summon the decision context behind any commit — what was said, how the code evolved (same files), paths abandoned, TODOs open then — reconstructed deterministically from git and fully cited. Git-native grounded context.\">" +
    ogMeta("Séance · talk to a commit's past", "Summon the reasoning behind any commit: what was said, how the code evolved, what was abandoned — reconstructed from git, fully cited, never invented. Git-native grounded context, local-first.", "/seance") +
    "<style>body{margin:0;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:820px;margin:0 auto;padding:clamp(20px,4vw,52px) 20px}h1{font-size:clamp(28px,5vw,44px);margin:0 0 8px;font-weight:850;text-align:center}.grad{background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}.tag{color:#94a3b8;max-width:640px;margin:0 auto;text-align:center}form{display:flex;gap:10px;max-width:760px;margin:24px auto 8px;flex-wrap:wrap}input{background:#0f1b2e;border:1px solid #2b3a52;border-radius:12px;padding:14px 15px;color:#e5e7eb;font-size:15px;outline:none}#u{flex:1;min-width:240px}#rf{width:150px}input:focus{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.15)}button.go{background:linear-gradient(90deg,#a78bfa,#7c3aed);color:#fff;border:0;border-radius:12px;padding:14px 24px;font-weight:800;cursor:pointer}button.go:disabled{opacity:.6}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0}.chip{background:#0f1b2e;border:1px solid #2b3a52;color:#cbd5e1;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer}.chip:hover{border-color:#a78bfa;color:#c4b5fd}#st{text-align:center;color:#94a3b8;min-height:22px;margin:10px 0}#st.err{color:#fca5a5}#rep{display:none}.card{background:radial-gradient(circle at 30% 0%,#11132a,#0b1220 70%);border:1px solid #2a2050;border-radius:16px;padding:22px;margin:14px 0}.at{color:#94a3b8;font-size:13px}.said{margin:12px 0;padding:14px;background:#0b1220;border-left:3px solid #a78bfa;border-radius:8px}.q{font-size:17px;color:#e5e7eb;font-weight:600}.body{color:#94a3b8;font-size:13.5px;margin-top:6px;white-space:pre-wrap}.sec{margin:14px 0}.sh{font-size:13px;color:#c4b5fd;font-weight:700;margin-bottom:6px}.cm{font-size:13px;color:#cbd5e1;padding:2px 0}.themes span{display:inline-block;background:#0b1220;border:1px solid #2a2050;border-radius:999px;padding:3px 10px;font-size:12px;color:#c4b5fd;margin:2px}code{background:#1f2340;padding:1px 5px;border-radius:4px;color:#a5b4fc;font-size:12px}.foot{color:#64748b;font-size:12px;margin-top:16px;border-top:1px solid #2a2050;padding-top:12px}.foot2{text-align:center;color:#64748b;font-size:13px;margin-top:28px}a{color:#a78bfa}.spin{display:inline-block;width:13px;height:13px;border:2px solid #334155;border-top-color:#a78bfa;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}</style></head>" +
    "<body><div class=\"wrap\"><div style=\"text-align:center\"><h1>🔮 <span class=\"grad\">Séance</span></h1>" +
    "<p class=\"tag\">Summon the <b>reasoning behind any commit</b> — what was said, <b>how the code evolved</b> (the same files over time), the paths abandoned, and the TODOs open then. Reconstructed <b>deterministically from git</b> and <b>fully cited</b> — never invented. Git-native grounded context, local-first.</p></div>" +
    "<form id=\"f\"><input id=\"u\" type=\"text\" placeholder=\"https://github.com/owner/repo\" autocomplete=\"off\" spellcheck=\"false\"><input id=\"rf\" type=\"text\" placeholder=\"commit/tag (optional)\" autocomplete=\"off\"><button class=\"go\" id=\"go\" type=\"submit\">Summon →</button></form>" +
    "<div class=\"chips\">" + chips + "</div><div id=\"st\"></div><div id=\"rep\"></div>" +
    "<p class=\"foot2\">Local + private repos: <code>npm i -g mneme-ai</code> then <code>mneme seance --at &lt;ref&gt;</code> · MCP <code>mneme.seance.summon</code> · part of the <a href=\"/suite\">Accountability Suite</a> · <sub>honest: a deterministic projection of git, not spirit-channeling — reason only from the citations.</sub></p>" +
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
    if (req.method === "GET" && (url.pathname === "/certify" || url.pathname === "/vericert" || url.pathname === "/verified")) return send(res, 200, certifyLandingHtml(), "text/html; charset=utf-8");
    if (req.method === "GET" && (url.pathname === "/persona" || url.pathname === "/personas")) return send(res, 200, personaLandingHtml(), "text/html; charset=utf-8");
    if (req.method === "GET" && (url.pathname === "/seance" || url.pathname === "/s%C3%A9ance")) return send(res, 200, seanceLandingHtml(), "text/html; charset=utf-8");

    // 🔮 SÉANCE — reconstruct the decision context behind any commit. Cloned→scanned→deleted.
    if (req.method === "GET" && url.pathname === "/api/seance") {
      const gitUrl = (url.searchParams.get("gitUrl") || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs. For private repos, run `mneme seance` locally." });
      if (rateLimited("seance:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let handle: { path: string; dispose: () => void } | null = null;
      try {
        handle = shallowClone(gitUrl);
        const g = (args: string[]) => { const r = gitSpawn("git", ["-C", handle!.path, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return r.status === 0 ? (r.stdout || "").trim() : ""; };
        // parse commits WITH hash + files (seance needs the hash to cite)
        const US = "\x1f", RS = "\x1e";
        const meta = g(["log", "--no-merges", "-n", "5000", `--format=${RS}%H${US}%an${US}%at${US}%s${US}%b`]);
        const byHash = new Map<string, seance.PastCommit>();
        for (const blk of meta.split(RS)) { if (!blk.trim()) continue; const [h, a, t, s, ...r] = blk.split(US); if (!h) continue; byHash.set(h.trim(), { hash: h.trim(), author: (a || "").trim(), ts: parseInt(t || "0", 10) || 0, subject: (s || "").trim(), body: (r.join(US) || "").trim(), files: [] }); }
        const nsout = g(["log", "--no-merges", "-n", "5000", "--numstat", `--format=${RS}%H`]);
        for (const blk of nsout.split(RS)) { const lines = blk.split("\n").map((l) => l.trim()).filter(Boolean); if (!lines.length) continue; const rec = byHash.get(lines[0]!); if (!rec) continue; for (const l of lines.slice(1)) { const m = l.split("\t"); if (m.length < 3) continue; rec.files!.push(m[2]!); } }
        const commits = [...byHash.values()];
        if (!commits.length) return send(res, 502, { error: "no commit history found" });
        const refArg = (url.searchParams.get("ref") || "").trim();
        const monthsArg = parseInt(url.searchParams.get("months") || "", 10);
        let hash = "", ref = "HEAD";
        if (refArg) { hash = g(["rev-parse", refArg]); ref = refArg; }
        else if (Number.isFinite(monthsArg)) { hash = g(["rev-list", "-1", `--before=${monthsArg} months ago`, "HEAD"]); ref = `${monthsArg} months ago`; }
        if (!hash) { hash = g(["rev-parse", "HEAD"]); ref = refArg || "HEAD"; }
        const grep = g(["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", hash, "--", "*.ts", "*.tsx", "*.js", "*.py", "*.go", "*.rs"]);
        const todosThen = grep.split("\n").map((l) => l.match(/^[^:]+:([^:]+):(\d+):(.*)$/)).filter(Boolean).slice(0, 30).map((m) => ({ file: m![1]!, line: parseInt(m![2]!, 10), text: m![3]!.trim().slice(0, 120) }));
        const packet = seance.reconstructSeance(commits, hash, { ref, todosThen, now: Math.floor(Date.now() / 1000) });
        return send(res, 200, packet);
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      } finally { if (handle) handle.dispose(); }
    }

    // 🎭 COMMIT PERSONA — clone a public repo, read its git history, render each
    // contributor as a measured persona + a distinct 3D cartoon. Cloned → scanned → DELETED.
    if (req.method === "GET" && url.pathname === "/api/persona") {
      const gitUrl = (url.searchParams.get("gitUrl") || "").trim();
      if (!isAllowedPublicUrl(gitUrl)) return send(res, 400, { error: "Only public github.com / gitlab.com / bitbucket.org URLs. For private repos, run `mneme persona` locally." });
      if (rateLimited("persona:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let handle: { path: string; dispose: () => void } | null = null;
      try {
        handle = shallowClone(gitUrl);                           // blob:none = FULL history (needed for personas)
        // EXACT git reconciliation — so the numbers match what GitHub/GitLab shows.
        const countOf = (args: string[]) => { const r = gitSpawn("git", ["-C", handle!.path, "rev-list", "--count", ...args, "HEAD"], { encoding: "utf8" }); return r.status === 0 ? parseInt((r.stdout || "0").trim(), 10) || 0 : 0; };
        const repoCommits = countOf([]);                         // ALL commits incl merges = GitHub/GitLab's number
        const nonMergeCommits = countOf(["--no-merges"]);        // what authorship analysis uses
        const merges = Math.max(0, repoCommits - nonMergeCommits);
        const commits = parseCommitsFromGit(handle.path, 5000);  // raised cap so big repos aren't truncated
        const all = commitPersona.analyzeCommitPersonas(commits, { minCommits: 1 });
        const analyzedCommits = commits.length;                  // non-merge commits we processed
        const contributors = all.length;
        // a single (or tiny) commit isn't a "commit style" — need ≥3 commits for a
        // persona; below that it's noise (e.g. a one-shot vendored/import commit).
        // Still COUNTED in `contributors`, just not shown as a hero card.
        const display = all.filter((p) => p.metrics.commits >= 3);
        const shown = (display.length ? display : all).slice(0, 12);
        const personas = shown.map((p) => ({ ...p, avatarSvg: commitPersona.personaAvatarSvg(p) }));
        return send(res, 200, { repo: gitUrl.replace(/^https?:\/\//, "").replace(/\.git$/, ""), repoCommits, nonMergeCommits, merges, analyzedCommits, contributors, shownContributors: personas.length, minCommitsForPersona: 3, personas });
      } catch (e) {
        return send(res, 502, { error: (e as Error).message.slice(0, 300) });
      } finally { if (handle) handle.dispose(); }
    }

    // 🎗️ VERIFIED-BY-MNEME — certify an AI-produced deliverable → signed cert + badge.
    // The deliverable is NOT stored — only the resulting certificate (named by certId).
    if (req.method === "POST" && url.pathname === "/api/certify") {
      if (rateLimited("certify:" + ip)) return send(res, 429, { error: "rate limit — try again in a minute" });
      let body: { deliverable?: string };
      try { body = JSON.parse(await readBody(req, 512 * 1024) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const deliverable = String(body.deliverable || "");
      if (!deliverable.trim()) return send(res, 400, { error: "expected { deliverable }" });
      try {
        const cert = vericert.certify(deliverable, { ts: Date.now() });
        let receipt: unknown = null;
        try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `vericert:${cert.verdict}:${cert.certId.slice(0, 12)}`, payload: { certId: cert.certId }, includePayload: true }); } catch { /* sign best-effort */ }
        const stored: StoredCert = { ...cert, signed: receipt };
        saveCert(stored);
        return send(res, 200, { cert: stored, badgeSvg: vericert.badgeSVG(cert), badgeUrl: `/vericert/badge/${cert.certId}.svg`, permalink: `/c/${cert.certId}` });
      } catch (e) { return send(res, 502, { error: (e as Error).message.slice(0, 300) }); }
    }
    // verify a posted certificate offline (tamper-evidence + signature + optional re-check)
    if (req.method === "POST" && url.pathname === "/api/certify/verify") {
      let body: { cert?: StoredCert; deliverable?: string };
      try { body = JSON.parse(await readBody(req, 512 * 1024) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
      if (!body.cert) return send(res, 400, { error: "expected { cert }" });
      const v = vericert.verifyCertBody(body.cert, typeof body.deliverable === "string" ? body.deliverable : undefined);
      let sigOk: boolean | null = null;
      try { if (body.cert.signed) sigOk = notary.verifyReceipt(body.cert.signed).valid; } catch { sigOk = false; }
      return send(res, 200, { ...v, signatureValid: sigOk });
    }
    // embeddable badge — /vericert/badge/<certId>.svg
    if (req.method === "GET" && url.pathname.startsWith("/vericert/badge/") && url.pathname.endsWith(".svg")) {
      const id = decodeURIComponent(url.pathname.slice("/vericert/badge/".length, -4));
      const c = getCert(id);
      if (!c) return sendSvg(res, vericert.badgeSVG({ verdict: "REJECTED", certId: id } as vericert.Certificate), 30);
      return sendSvg(res, vericert.badgeSVG(c));
    }
    // cert permalink — /c/<certId> (shows verdict + badge + offline-verify)
    if (req.method === "GET" && url.pathname.startsWith("/c/")) {
      const id = decodeURIComponent(url.pathname.slice("/c/".length).replace(/\/$/, ""));
      const c = getCert(id);
      if (!c) return send(res, 404, { error: "certificate not found" });
      const col = c.verdict === "CERTIFIED" ? "#22c55e" : c.verdict === "CONDITIONAL" ? "#eab308" : "#ef4444";
      const faults = (c.faults || []).map((f) => `<li>${f.verdict === "BLOCK" ? "🛑" : "❔"} <b>${xesc(f.nerves.join(", "))}</b> — ${xesc(f.claim)}</li>`).join("");
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verified by Mneme · ${xesc(c.verdict)}</title>${NEWTAB_SCRIPT}${ogMeta(`Verified by Mneme · ${c.verdict}`, `An AI-produced deliverable certified by Mneme — ${c.verdict}, score ${Math.round(c.score * 100)}%. Ed25519-signed, verifiable offline.`, "/c/" + id)}<style>body{margin:0;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb}.wrap{max-width:680px;margin:0 auto;padding:48px 20px}.card{background:radial-gradient(circle at 30% 0%,#0f1b2e,#0b1220 70%);border:1px solid #1f2937;border-radius:16px;padding:24px}.row{display:flex;gap:18px;align-items:center}.b{width:72px;height:72px;border-radius:16px;display:grid;place-items:center;font-size:36px;color:#04141b;background:${col};flex:none}.v{font-size:24px;font-weight:800}.m{color:#94a3b8;font-size:13px;margin-top:3px}ul{color:#cbd5e1;padding-left:18px}code{background:#1f2937;padding:1px 5px;border-radius:4px}a{color:#22d3ee}.f{color:#64748b;font-size:12px;margin-top:18px;border-top:1px solid #1f2937;padding-top:14px}</style></head><body><div class="wrap"><div class="card"><div class="row"><div class="b">${c.verdict === "CERTIFIED" ? "✓" : c.verdict === "CONDITIONAL" ? "❔" : "🛑"}</div><div><div class="v">${xesc(c.verdict)}</div><div class="m">score ${Math.round(c.score * 100)}% · ${c.trusted}/${c.claimsChecked} claims clean · certId ${xesc(c.certId.slice(0, 16))}…</div></div></div>${faults ? `<h3>What to fix</h3><ul>${faults}</ul>` : `<p>✓ no known fault in any checked claim.</p>`}<div style="margin:14px 0">${vericert.badgeSVG(c)}</div><div class="m">Embed: <code>&lt;img src="/vericert/badge/${xesc(c.certId)}.svg"&gt;</code></div><div class="f">🎗️ <b>Verified by Mneme</b> · CERTIFIED = no <i>known</i> fault + the engine's measured precision, <b>not</b> a proof of truth · Ed25519-signed, verify offline with <code>mneme certify verify</code> · <a href="/certify">certify your own →</a></div></div></div></body></html>`;
      return send(res, 200, html, "text/html; charset=utf-8");
    }
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
      const urls = ["/", "/suite", "/certify", "/persona", "/seance", "/review", "/radar"].map((p) => `  <url><loc>https://xray.mneme-ai.space${p}</loc><changefreq>weekly</changefreq><priority>${p === "/suite" ? "1.0" : "0.8"}</priority></url>`).join("\n");
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
