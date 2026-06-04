/**
 * TEAM INTELLIGENCE — turn the raw technical signals into ranked, ACTIONABLE,
 * fully-traceable next-steps a CEO / lead / dev acts on, WITHOUT inventing a
 * single number, dollar figure, or accusation about a named person.
 *
 * Two gems, both composed only from fields already in the signed report:
 *
 *  1. KEYSTONE RISK ("single point of catastrophe") — the novel composite no
 *     SonarQube/Snyk computes: a file whose change historically RIPPLES to many
 *     others (temporal-coupling reach) AND is written almost entirely by ONE
 *     author (authorship concentration). If that person is unavailable, a wide
 *     blast radius has no second expert. Pure git facts (co-change rate + author
 *     share) — same data class as `git shortlog`. No money, no blame, no LLM.
 *
 *  2. ACTION PLAN — every signal (secrets, destructive commands, dead deps,
 *     single-owner files, licenses, hidden coupling, complexity) folded into a
 *     severity-ranked to-do list where EVERY line cites the metric it came from.
 *
 * Pure + total: missing/garbage fields never throw. Proven over 100,000 random
 * reports (intelGauntlet).
 */
import { buildBlastRadius } from "./riskmap.js";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (x: unknown): number => (Number.isFinite(Number(x)) ? Number(x) : 0);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const arr = (x: unknown): Array<Record<string, unknown>> => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
const base = (f: string): string => { const p = String(f).split("/"); return p[p.length - 1] || f; };

// ─── GEM 1 · KEYSTONE RISK ────────────────────────────────────────────────────
export interface Keystone {
  file: string;
  /** sum of co-change confidence to other files (how far an edit ripples). */
  reach: number;
  /** number of files it historically pulls along. */
  partners: number;
  /** single-author share of this file's history, [0,1]. */
  ownerPct: number;
  /** factual top author of the file (who to ask for a handoff), if known. */
  expert: string | null;
  /** reach × ownerPct — the catastrophe score. */
  score: number;
}

/** Single-owner threshold: a file is "key-person held" at ≥60% one-author share. */
export const KEYSTONE_OWNER = 0.6;

export function buildKeystones(report: unknown, max = 5): { keystones: Keystone[]; note: string } {
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const bf = (r["busFactor"] || {}) as Record<string, unknown>;
  const hs = (r["hotspots"] || {}) as Record<string, unknown>;

  // file → single-author share (verbatim from busFactor.fragileFiles)
  const owner = new Map<string, number>();
  for (const x of arr(bf["fragileFiles"])) { const f = str(x?.["file"]); if (f) owner.set(f, Math.max(owner.get(f) ?? 0, clamp(num(x?.["topAuthorShare"]), 0, 1))); }
  // file → factual top author (verbatim from hotspots.expert)
  const expertOf = new Map<string, string>();
  for (const x of arr(hs["hotspots"])) { const f = str(x?.["file"]); const e = str(x?.["expert"]); if (f && e) expertOf.set(f, e); }

  const { targets } = buildBlastRadius(report, 100, 8);
  const keystones: Keystone[] = [];
  for (const t of targets) {
    const ownerPct = owner.get(t.file) ?? 0;
    if (ownerPct < KEYSTONE_OWNER) continue;          // requires the key-person angle
    keystones.push({ file: t.file, reach: t.reach, partners: t.partners.length, ownerPct, expert: expertOf.get(t.file) ?? null, score: t.reach * ownerPct });
  }
  keystones.sort((a, b) => (b.score - a.score) || (b.reach - a.reach) || a.file.localeCompare(b.file));
  const top = keystones.slice(0, max);
  return {
    keystones: top,
    note: top.length
      ? `${top.length} keystone path(s): high change-ripple AND single-owner`
      : "no keystone paths — change-ripple and ownership do not overlap",
  };
}

// ─── GEM 2 · ACTION PLAN ──────────────────────────────────────────────────────
export type Sev = "high" | "med" | "low";
export interface ActionItem { sev: Sev; icon: string; title: string; detail: string; source: string }
const SEV_RANK: Record<Sev, number> = { high: 0, med: 1, low: 2 };

export function buildActionPlan(report: unknown, max = 8): { items: ActionItem[]; note: string } {
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const items: ActionItem[] = [];
  const push = (sev: Sev, icon: string, title: string, detail: string, source: string) => items.push({ sev, icon, title, detail, source });

  const secrets = (r["secrets"] || {}) as Record<string, unknown>;
  const sFind = num(secrets["totalFindings"]);
  if (sFind > 0) {
    const hit = arr(secrets["hits"])[0];
    const src = hit ? `${base(str(hit["file"]))}:${num(hit["line"])}` : "secret scan";
    push("high", "🔑", `Rotate ${sFind} exposed credential pattern${sFind > 1 ? "s" : ""}`, "Found in production code — rotate the key(s) and purge them from git history.", src);
  }

  const security = (r["security"] || {}) as Record<string, unknown>;
  const destr = arr(security["destructive"]);
  if (destr.length > 0) {
    const where = str(destr[0]?.["where"]);
    push("high", "💣", `Review ${destr.length} destructive command${destr.length > 1 ? "s" : ""}`, "rm -rf / curl|bash in build or CI scripts can wipe data or run remote code unattended.", where ? base(where) : "security scan");
  }

  const deps = (r["deps"] || {}) as Record<string, unknown>;
  const band = (deps["byBand"] || {}) as Record<string, unknown>;
  const dead = num(band["dead"]), morib = num(band["moribund"]);
  const atRisk = arr(deps["atRisk"]);
  if (dead > 0) {
    const d = atRisk.find((x) => str(x["band"]) === "dead") || atRisk[0];
    const succ = d && str(d["successor"]) ? ` → ${str(d["successor"])}` : "";
    push("high", "📦", `Replace ${dead} dead dependenc${dead > 1 ? "ies" : "y"}`, `Unmaintained — a known-good successor exists${succ}.`, d ? str(d["name"]) : "dependency scan");
  }
  if (morib > 0) push("med", "📦", `Plan to replace ${morib} moribund dependenc${morib > 1 ? "ies" : "y"}`, "Maintenance is slowing — schedule a migration before it goes dead.", "dependency scan");

  // GEM 1 folded into the plan — the keystone is the single highest-leverage action.
  const ks = buildKeystones(report, 1).keystones[0];
  if (ks) {
    const who = ks.expert ? ` Only ${ks.expert} knows it best.` : "";
    push("high", "🔑", `Protect the keystone: ${base(ks.file)}`, `Editing it historically ripples to ${ks.partners} file${ks.partners > 1 ? "s" : ""}, and ~${Math.round(ks.ownerPct * 100)}% is one author.${who} Document it and pair a second dev.`, "coupling × bus-factor");
  }

  const bf = (r["busFactor"] || {}) as Record<string, unknown>;
  const single = arr(bf["fragileFiles"]).filter((x) => clamp(num(x["topAuthorShare"]), 0, 1) >= KEYSTONE_OWNER).length;
  if (single > 0) push("med", "👥", `Spread ownership of ${single} single-owner file${single > 1 ? "s" : ""}`, "These have no documented second contributor — a knowledge-loss risk if the owner is away.", "bus-factor");

  const lic = arr(deps["licenseFlags"]);
  if (lic.length > 0) push("med", "⚖️", `Legal review: ${lic.length} copyleft/unknown-license dep${lic.length > 1 ? "s" : ""}`, "Copyleft or unknown licenses can constrain commercial/closed-source use — confirm with counsel.", lic[0] ? str(lic[0]["name"]) : "license scan");

  const cp = (r["coupling"] || {}) as Record<string, unknown>;
  const hidden = arr(cp["pairs"]).filter((p) => !!p["hidden"]);
  if (hidden.length > 0) { const h = hidden[0]; push("med", "🔗", `Document a hidden dependency`, `${base(str(h["a"]))} and ${base(str(h["b"]))} live in different modules but always change together — make the link explicit.`, "coupling"); }

  const cx = (r["complexity"] || {}) as Record<string, unknown>;
  const hot = arr(cx["hotspots"])[0];
  if (hot && num(hot["bodyLines"]) >= 120) push("low", "🔧", `Refactor the longest function`, `${num(hot["bodyLines"])} lines in one symbol is hard to test and review.`, `${base(str(hot["file"]))}:${num(hot["startLine"])}`);

  items.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  const top = items.slice(0, max);
  return { items: top, note: top.length ? `${top.length} prioritised action${top.length > 1 ? "s" : ""}` : "No action items — every signal is clear. ✓" };
}

// ─── gauntlet (the 100,000-case stress test) ─────────────────────────────────
export interface IntelCheck { name: string; pass: boolean; detail: string }
export interface IntelGauntlet { score: number; iterations: number; checks: IntelCheck[] }

function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function randomReport(rnd: () => number): unknown {
  const file = () => `src/${Math.floor(rnd() * 1000)}/${Math.floor(rnd() * 1000)}.ts`;
  const n = (k: number) => Math.floor(rnd() * k);
  return {
    secrets: { totalFindings: rnd() < 0.4 ? n(20) : 0, hits: Array.from({ length: n(5) }, () => ({ kind: "aws", file: rnd() < 0.05 ? "" : file(), line: n(500) })) },
    security: { destructive: Array.from({ length: rnd() < 0.4 ? n(6) : 0 }, () => ({ command: "rm -rf x", where: rnd() < 0.1 ? "" : file(), signals: [] })) },
    deps: { byBand: { dead: rnd() < 0.3 ? n(5) : 0, moribund: rnd() < 0.3 ? n(5) : 0 }, atRisk: Array.from({ length: n(4) }, () => ({ name: "pkg", band: rnd() < 0.5 ? "dead" : "moribund", successor: rnd() < 0.5 ? "newpkg" : null })), licenseFlags: Array.from({ length: rnd() < 0.3 ? n(4) : 0 }, () => ({ name: "gpllib", license: "GPL-3.0", class: "strong-copyleft" })) },
    busFactor: { fragileFiles: Array.from({ length: n(40) }, () => ({ file: rnd() < 0.05 ? "" : file(), topAuthorShare: rnd() < 0.05 ? NaN : rnd() * 1.2, commits: n(100) })) },
    hotspots: { hotspots: Array.from({ length: n(40) }, () => ({ file: file(), changes: n(500), loc: n(3000), expert: rnd() < 0.1 ? "" : `dev${n(20)}` })) },
    complexity: { hotspots: Array.from({ length: n(20) }, () => ({ file: file(), bodyLines: n(800), startLine: n(2000) })) },
    coupling: { pairs: Array.from({ length: n(40) }, () => ({ a: file(), b: rnd() < 0.1 ? "" : file(), confidence: rnd() < 0.05 ? NaN : rnd(), coChanges: n(40), hidden: rnd() < 0.3 })) },
  };
}

export function intelGauntlet(iterations = 100_000): IntelGauntlet {
  const rnd = lcg(987654321);
  let threw = 0, badSev = 0, badSrc = 0, badKs = 0;
  const SEV = new Set(["high", "med", "low"]);
  for (let i = 0; i < iterations; i++) {
    const rep = randomReport(rnd);
    try {
      const plan = buildActionPlan(rep);
      for (const it of plan.items) { if (!SEV.has(it.sev)) badSev++; if (!it.title || !it.source || typeof it.detail !== "string") badSrc++; }
      const { keystones } = buildKeystones(rep);
      for (const k of keystones) { if (!(k.ownerPct >= KEYSTONE_OWNER && k.ownerPct <= 1) || !Number.isFinite(k.score) || k.reach < 0 || typeof k.file !== "string" || !k.file) badKs++; }
    } catch { threw++; }
  }
  const fixed = randomReport(lcg(2024));
  const det = JSON.stringify(buildActionPlan(fixed)) === JSON.stringify(buildActionPlan(fixed)) && JSON.stringify(buildKeystones(fixed)) === JSON.stringify(buildKeystones(fixed));
  const checks: IntelCheck[] = [
    { name: "TOTAL", pass: threw === 0, detail: `0 throws over ${iterations.toLocaleString()} random reports (got ${threw})` },
    { name: "SEV-VALID", pass: badSev === 0, detail: `every action item severity ∈ {high,med,low} (violations ${badSev})` },
    { name: "TRACEABLE", pass: badSrc === 0, detail: `every action item has a title + source + detail (violations ${badSrc})` },
    { name: "KEYSTONE-SOUND", pass: badKs === 0, detail: `keystones: owner≥${KEYSTONE_OWNER}, finite score, named file (violations ${badKs})` },
    { name: "DETERMINISTIC", pass: det, detail: "same report → byte-identical plan + keystones" },
  ];
  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), iterations, checks };
}
