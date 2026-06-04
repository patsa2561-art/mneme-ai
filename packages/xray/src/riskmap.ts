/**
 * RISK MAP — the "if this person leaves, what breaks?" constellation.
 *
 * A 2D network the CEO grasps in two seconds: each node is a FILE the analysis
 * actually flagged; node colour = key-person risk (single-owner share), node size
 * = churn/size, edges = files that change together (temporal coupling). High-risk
 * single-owner files sit near the centre.
 *
 * ★ACCURACY CONTRACT (so it can't be disputed): every node + edge is taken
 * VERBATIM from the signed X-Ray report — fragileFiles (single-owner %), hotspots
 * (churn × size), coupling pairs. NOTHING is invented; a file with no measured
 * signal is not drawn. The layout is DETERMINISTIC (a golden-angle spiral, no
 * randomness) so the same report always renders the same map.
 *
 * Pure + total: missing/garbage fields never throw; coordinates are always finite
 * and clamped inside the viewBox. Proven over 100,000 random reports (the gauntlet).
 */

export interface RiskNode { id: number; file: string; risk: number; size: number; ownerPct: number; churn: number; r: number; x: number; y: number }
export interface RiskEdge { a: number; b: number; weight: number; hidden: boolean }
export interface RiskMap { nodes: RiskNode[]; edges: RiskEdge[]; maxRisk: number; W: number; H: number; note: string }

export const MAP_W = 960, MAP_H = 520, MAP_CAP = 22;
/** Node display radius from its size signal (also the basis for spacing). */
export const nodeRadius = (size: number): number => 17 + clamp(size, 0, 1) * 30;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (x: unknown): number => (Number.isFinite(Number(x)) ? Number(x) : 0);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

/** Build the deterministic risk constellation from a signed report. Total. */
export function buildRiskMap(report: unknown): RiskMap {
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const bf = (r["busFactor"] || {}) as Record<string, unknown>;
  const hs = (r["hotspots"] || {}) as Record<string, unknown>;
  const cx = (r["complexity"] || {}) as Record<string, unknown>;
  const cp = (r["coupling"] || {}) as Record<string, unknown>;

  // 1) gather per-file signals from the report (verbatim)
  const byFile = new Map<string, { ownerPct: number; churn: number; loc: number }>();
  const touch = (file: string) => { const f = str(file); if (!f) return null; if (!byFile.has(f)) byFile.set(f, { ownerPct: 0, churn: 0, loc: 0 }); return byFile.get(f)!; };
  for (const x of (Array.isArray(bf["fragileFiles"]) ? bf["fragileFiles"] : []) as Array<Record<string, unknown>>) { const n = touch(str(x?.["file"])); if (n) n.ownerPct = Math.max(n.ownerPct, clamp(num(x?.["topAuthorShare"]), 0, 1)); }
  for (const x of (Array.isArray(hs["hotspots"]) ? hs["hotspots"] : []) as Array<Record<string, unknown>>) { const n = touch(str(x?.["file"])); if (n) { n.churn = Math.max(n.churn, num(x?.["changes"])); n.loc = Math.max(n.loc, num(x?.["loc"])); } }
  for (const x of (Array.isArray(cx["hotspots"]) ? cx["hotspots"] : []) as Array<Record<string, unknown>>) { const n = touch(str(x?.["file"])); if (n) n.loc = Math.max(n.loc, num(x?.["bodyLines"])); }
  const pairs = (Array.isArray(cp["pairs"]) ? cp["pairs"] : []) as Array<Record<string, unknown>>;
  for (const p of pairs) { touch(str(p?.["a"])); touch(str(p?.["b"])); }

  // 2) score + cap (worst-first: risk then size)
  const maxChurn = Math.max(1, ...[...byFile.values()].map((v) => v.churn));
  const maxLoc = Math.max(1, ...[...byFile.values()].map((v) => v.loc));
  let entries = [...byFile.entries()].map(([file, v]) => {
    const size = clamp(Math.max(v.churn / maxChurn, v.loc / maxLoc), 0, 1);
    const risk = clamp(v.ownerPct, 0, 1);
    return { file, risk, size, ownerPct: v.ownerPct, churn: v.churn };
  });
  entries.sort((a, b) => (b.risk - a.risk) || (b.size - a.size) || a.file.localeCompare(b.file));
  entries = entries.slice(0, MAP_CAP);
  const indexOf = new Map(entries.map((e, i) => [e.file, i]));

  // 3) DETERMINISTIC sunflower (golden-angle phyllotaxis) scaled to FILL the canvas —
  // even spacing edge-to-edge, no central clump; highest-risk (index 0) nearest centre.
  const cxC = MAP_W / 2, cyC = MAP_H / 2, GOLD = 2.399963229728653, PAD = 64;
  const RX = MAP_W / 2 - PAD, RY = MAP_H / 2 - PAD;
  const n = entries.length;
  const nodes: RiskNode[] = entries.map((e, i) => {
    const frac = n <= 1 ? 0 : Math.sqrt((i + 0.5) / n); // even area distribution → fills the ellipse
    const ang = i * GOLD;
    const x = clamp(cxC + RX * frac * Math.cos(ang), PAD, MAP_W - PAD);
    const y = clamp(cyC + RY * frac * Math.sin(ang), PAD, MAP_H - PAD);
    return { id: i, file: e.file, risk: e.risk, size: e.size, ownerPct: e.ownerPct, churn: e.churn, r: nodeRadius(e.size), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });

  // 4) edges = coupling pairs whose BOTH files are nodes (verbatim confidence)
  const edges: RiskEdge[] = [];
  for (const p of pairs) {
    const a = indexOf.get(str(p?.["a"])), b = indexOf.get(str(p?.["b"]));
    if (a === undefined || b === undefined || a === b) continue;
    edges.push({ a, b, weight: clamp(num(p?.["confidence"]), 0, 1), hidden: !!p?.["hidden"] });
  }
  const maxRisk = nodes.reduce((m, n) => Math.max(m, n.risk), 0);
  return { nodes, edges, maxRisk, W: MAP_W, H: MAP_H, note: nodes.length ? `${nodes.length} flagged file(s), ${edges.length} coupling link(s)` : "no per-file risk signals in this repo" };
}

// ─── BLAST RADIUS — "touch this file → what historically changed with it" ────
// Pure history, NOT prediction: from the report's temporal-coupling pairs (files
// that changed together in git), verbatim. Honest framing: "when you changed A,
// these changed too N% of the time" — a measured co-change rate, not a guess.
export interface BlastPartner { file: string; confidence: number; coChanges: number; hidden: boolean }
export interface BlastTarget { file: string; reach: number; partners: BlastPartner[] }

export function buildBlastRadius(report: unknown, maxTargets = 6, maxPartners = 5): { targets: BlastTarget[]; note: string } {
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const cp = (r["coupling"] || {}) as Record<string, unknown>;
  const pairs = (Array.isArray(cp["pairs"]) ? cp["pairs"] : []) as Array<Record<string, unknown>>;
  const adj = new Map<string, BlastPartner[]>();
  const add = (from: string, to: string, conf: number, co: number, hidden: boolean) => {
    if (!from || !to || from === to) return;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ file: to, confidence: conf, coChanges: co, hidden });
  };
  for (const p of pairs) {
    const a = str(p?.["a"]), b = str(p?.["b"]); if (!a || !b) continue;
    const conf = clamp(num(p?.["confidence"]), 0, 1), co = num(p?.["coChanges"]), hidden = !!p?.["hidden"];
    add(a, b, conf, co, hidden); add(b, a, conf, co, hidden);
  }
  const targets: BlastTarget[] = [...adj.entries()].map(([file, ps]) => {
    ps.sort((x, y) => (y.confidence - x.confidence) || (y.coChanges - x.coChanges) || x.file.localeCompare(y.file));
    const reach = ps.reduce((s, x) => s + x.confidence, 0);
    return { file, reach, partners: ps.slice(0, maxPartners) };
  });
  targets.sort((a, b) => (b.reach - a.reach) || (b.partners.length - a.partners.length) || a.file.localeCompare(b.file));
  const top = targets.slice(0, maxTargets);
  return { targets: top, note: top.length ? `${top.length} file(s) with historical change-coupling` : "no temporal coupling measured (files change independently)" };
}

// ─── gauntlet (the 100,000-case stress test) ─────────────────────────────────
export interface GauntletCheck { name: string; pass: boolean; detail: string }
export interface RiskMapGauntlet { score: number; iterations: number; checks: GauntletCheck[] }

/** seeded LCG → deterministic, reproducible "random" reports for the stress test */
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

function randomReport(rnd: () => number): unknown {
  const nF = Math.floor(rnd() * 40), nH = Math.floor(rnd() * 40), nP = Math.floor(rnd() * 40);
  const file = () => `src/${Math.floor(rnd() * 1000)}/${Math.floor(rnd() * 1000)}.ts`;
  return {
    busFactor: { fragileFiles: Array.from({ length: nF }, () => ({ file: rnd() < 0.05 ? "" : file(), topAuthorShare: rnd() < 0.05 ? NaN : rnd() * 1.2, commits: Math.floor(rnd() * 100) })) },
    hotspots: { hotspots: Array.from({ length: nH }, () => ({ file: file(), changes: rnd() < 0.05 ? -5 : Math.floor(rnd() * 500), loc: Math.floor(rnd() * 3000) })) },
    complexity: { hotspots: Array.from({ length: Math.floor(rnd() * 20) }, () => ({ file: file(), bodyLines: Math.floor(rnd() * 800) })) },
    coupling: { pairs: Array.from({ length: nP }, () => ({ a: file(), b: rnd() < 0.1 ? "" : file(), confidence: rnd() < 0.05 ? NaN : rnd(), hidden: rnd() < 0.3 })) },
  };
}

export function riskMapGauntlet(iterations = 100_000): RiskMapGauntlet {
  const rnd = lcg(1234567);
  let threw = 0, badCoord = 0, badRange = 0, badEdge = 0, overCap = 0, badBlast = 0;
  for (let i = 0; i < iterations; i++) {
    const rep = randomReport(rnd);
    let m: RiskMap;
    try { m = buildRiskMap(rep); } catch { threw++; continue; }
    if (m.nodes.length > MAP_CAP) overCap++;
    for (const n of m.nodes) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || n.x < 0 || n.x > MAP_W || n.y < 0 || n.y > MAP_H) badCoord++;
      if (!(n.risk >= 0 && n.risk <= 1) || !(n.size >= 0 && n.size <= 1)) badRange++;
    }
    for (const e of m.edges) if (e.a < 0 || e.b < 0 || e.a >= m.nodes.length || e.b >= m.nodes.length || e.a === e.b) badEdge++;
    // BLAST RADIUS stressed on the same random report
    try {
      const br = buildBlastRadius(rep);
      for (const t of br.targets) { if (typeof t.file !== "string" || !t.file) badBlast++; for (const p of t.partners) if (!(p.confidence >= 0 && p.confidence <= 1) || typeof p.file !== "string" || p.file === t.file) badBlast++; }
    } catch { threw++; }
  }
  // determinism: a fixed report renders identically twice (map + blast)
  const fixed = randomReport(lcg(42));
  const det = JSON.stringify(buildRiskMap(fixed)) === JSON.stringify(buildRiskMap(fixed)) && JSON.stringify(buildBlastRadius(fixed)) === JSON.stringify(buildBlastRadius(fixed));
  const checks: GauntletCheck[] = [
    { name: "TOTAL", pass: threw === 0, detail: `0 throws over ${iterations.toLocaleString()} random reports (got ${threw})` },
    { name: "COORDS-IN-BOX", pass: badCoord === 0, detail: `every node coordinate finite + inside ${MAP_W}×${MAP_H} (violations ${badCoord})` },
    { name: "RANGE-0-1", pass: badRange === 0, detail: `risk + size always in [0,1] (violations ${badRange})` },
    { name: "EDGES-VALID", pass: badEdge === 0, detail: `every edge references two distinct existing nodes (violations ${badEdge})` },
    { name: "CAP", pass: overCap === 0, detail: `node count never exceeds ${MAP_CAP} (violations ${overCap})` },
    { name: "BLAST-VALID", pass: badBlast === 0, detail: `blast-radius partners valid (conf∈[0,1], distinct files) (violations ${badBlast})` },
    { name: "DETERMINISTIC", pass: det, detail: "same report → byte-identical map + blast" },
  ];
  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), iterations, checks };
}
