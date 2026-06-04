/**
 * GOLDILOCKS — the config-fragility / "habitable-zone" analyzer.
 *
 * The honest core of the "cosmic fine-tuning" idea: a real engineering technique
 * (sensitivity analysis / boundary-finding), NOT cosmology. Give it a numeric
 * config value, a range, and a deterministic pass/fail ORACLE (a verify command,
 * or a pure predicate), and it finds the **habitable zone** — the band of values
 * where the system still works — by bisecting outward from the current value to
 * each pass→fail boundary. It reports how WIDE that zone is and how close your
 * current value sits to the nearest cliff:
 *
 *   verdict: ROBUST     — comfortable margin on both sides
 *            TIGHT      — small margin; one bad input class away from breaking
 *            KNIFE-EDGE — essentially on the boundary (fine-tuned / fragile)
 *            UNSTABLE   — the current value already FAILS the oracle
 *
 * HONEST (DIAKRISIS): deterministic boundary bisection on an oracle YOU supply —
 * not "the cosmological constant of your code". It assumes the passing region is
 * roughly CONTIGUOUS around the current value (it finds the nearest fail boundary
 * on each side); a non-contiguous pass set yields the LOCAL band (stated, not
 * hidden). Pure + total: a flaky/throwing oracle is treated as fail at that point.
 */

export type Oracle = (value: number) => boolean;

export interface ZoneOpts { lo: number; hi: number; current: number; tol?: number }
export type Verdict = "ROBUST" | "TIGHT" | "KNIFE-EDGE" | "UNSTABLE";
export interface Zone {
  passesNow: boolean;
  current: number;
  lowEdge: number; highEdge: number;   // the habitable band [lowEdge, highEdge]
  lowOpen: boolean; highOpen: boolean;  // true = band extends past the search range (no cliff found that side)
  marginLow: number; marginHigh: number; // distance from current to each edge
  margin: number;                        // min(marginLow, marginHigh) — the nearest cliff
  zoneWidth: number;
  marginPct: number;                     // margin / (hi-lo) — fraction of the search span
  verdict: Verdict;
  reason: string;
}

const safe = (oracle: Oracle, v: number): boolean => { try { return !!oracle(v); } catch { return false; } };

/** Bisect between a known-passing point and a known-failing point → the edge. */
function findEdge(oracle: Oracle, passAt: number, failAt: number, tol: number): number {
  let p = passAt, f = failAt;
  for (let i = 0; i < 200 && Math.abs(p - f) > tol; i++) {
    const m = p + (f - p) / 2;
    if (m === p || m === f) break;
    if (safe(oracle, m)) p = m; else f = m;
  }
  return p; // last value known to PASS ≈ the cliff edge
}

/** Find the habitable zone around `current` + the margin to the nearest cliff. Total. */
export function habitableZone(oracle: Oracle, opts: ZoneOpts): Zone {
  const lo = Math.min(opts.lo, opts.hi), hi = Math.max(opts.lo, opts.hi);
  const current = opts.current;
  const span = hi - lo;
  const tol = opts.tol ?? Math.max(1e-12, span * 1e-6);
  const base = (v: Partial<Zone>): Zone => ({ passesNow: true, current, lowEdge: lo, highEdge: hi, lowOpen: false, highOpen: false, marginLow: 0, marginHigh: 0, margin: 0, zoneWidth: 0, marginPct: 0, verdict: "ROBUST", reason: "", ...v });

  if (!safe(oracle, current)) {
    return base({ passesNow: false, verdict: "UNSTABLE", margin: 0, marginPct: 0, reason: "current value already FAILS the oracle — not inside any habitable zone" });
  }
  // low edge: walk down. If lo still passes, the band is open below the search range.
  let lowEdge: number, lowOpen = false;
  if (safe(oracle, lo)) { lowEdge = lo; lowOpen = true; } else lowEdge = findEdge(oracle, current, lo, tol);
  // high edge: walk up.
  let highEdge: number, highOpen = false;
  if (safe(oracle, hi)) { highEdge = hi; highOpen = true; } else highEdge = findEdge(oracle, current, hi, tol);

  const marginLow = current - lowEdge;
  const marginHigh = highEdge - current;
  const margin = Math.min(marginLow, marginHigh);
  const zoneWidth = highEdge - lowEdge;
  const marginPct = span > 0 ? margin / span : 0;

  const knife = Math.max(tol * 8, span * 1e-4);
  let verdict: Verdict, reason: string;
  if (margin <= knife) { verdict = "KNIFE-EDGE"; reason = `current sits on the boundary — margin ${fmt(margin)} ≈ 0`; }
  else if (marginPct < 0.05 || (zoneWidth > 0 && margin / zoneWidth < 0.12)) { verdict = "TIGHT"; reason = `narrow margin — nearest cliff is ${fmt(margin)} away (${(marginPct * 100).toFixed(1)}% of range)`; }
  else { verdict = "ROBUST"; reason = `comfortable — nearest cliff ${fmt(margin)} away${lowOpen && highOpen ? " (no boundary found in range)" : ""}`; }
  return { passesNow: true, current, lowEdge, highEdge, lowOpen, highOpen, marginLow, marginHigh, margin, zoneWidth, marginPct, verdict, reason };
}

function fmt(n: number): string { return Number.isInteger(n) ? String(n) : n.toPrecision(4); }

/** Infer a habitable zone from DISCRETE probe samples (for callers who can't pass a
 *  live oracle, e.g. over MCP): the contiguous passing run that contains `current`. */
export function zoneFromSamples(samples: Array<{ v: number; pass: boolean }>, current: number): Zone {
  const pts = [...(samples || [])].filter((s) => s && typeof s.v === "number").sort((a, b) => a.v - b.v);
  if (!pts.length) return habitableZone(() => false, { lo: current, hi: current, current });
  const lo = pts[0].v, hi = pts[pts.length - 1].v;
  // nearest sample to current decides passesNow
  let ci = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].v - current) < Math.abs(pts[ci].v - current)) ci = i;
  if (!pts[ci].pass) return { passesNow: false, current, lowEdge: lo, highEdge: hi, lowOpen: false, highOpen: false, marginLow: 0, marginHigh: 0, margin: 0, zoneWidth: 0, marginPct: 0, verdict: "UNSTABLE", reason: "nearest probe to current FAILS" };
  // expand the contiguous passing run around ci
  let a = ci; while (a > 0 && pts[a - 1].pass) a--;
  let b = ci; while (b < pts.length - 1 && pts[b + 1].pass) b++;
  const lowEdge = a === 0 ? pts[0].v : (pts[a].v + pts[a - 1].v) / 2;
  const highEdge = b === pts.length - 1 ? pts[b].v : (pts[b].v + pts[b + 1].v) / 2;
  const lowOpen = a === 0, highOpen = b === pts.length - 1;
  const span = hi - lo || 1;
  const marginLow = current - lowEdge, marginHigh = highEdge - current, margin = Math.min(marginLow, marginHigh);
  const marginPct = margin / span;
  const verdict: Verdict = margin <= span * 1e-3 ? "KNIFE-EDGE" : marginPct < 0.08 ? "TIGHT" : "ROBUST";
  return { passesNow: true, current, lowEdge, highEdge, lowOpen, highOpen, marginLow, marginHigh, margin, zoneWidth: highEdge - lowEdge, marginPct, verdict, reason: `from ${pts.length} probes — nearest cliff ${fmt(margin)} away` };
}

export interface ParamSpec { name: string; oracle: Oracle; lo: number; hi: number; current: number }
export interface ParamResult extends Zone { name: string }

/** Analyze several config params; rank MOST-FRAGILE first (smallest marginPct). */
export function analyzeConfig(params: ParamSpec[]): { results: ParamResult[]; mostFragile: ParamResult | null } {
  const results = (params || []).map((p) => ({ name: p.name, ...habitableZone(p.oracle, { lo: p.lo, hi: p.hi, current: p.current }) }));
  const ranked = [...results].sort((a, b) => rank(a) - rank(b));
  return { results, mostFragile: ranked[0] ?? null };
}
const ORDER: Record<Verdict, number> = { UNSTABLE: 0, "KNIFE-EDGE": 1, TIGHT: 2, ROBUST: 3 };
function rank(z: Zone): number { return ORDER[z.verdict] * 1e6 + z.marginPct; }

// ─── gauntlet ────────────────────────────────────────────────────────────────
export interface GauntletCheck { name: string; pass: boolean; detail: string }
export interface GoldilocksGauntlet { score: number; checks: GauntletCheck[] }

export function goldilocksGauntlet(): GoldilocksGauntlet {
  const checks: GauntletCheck[] = [];
  // a classic two-sided habitable band: passes iff 10 <= v <= 90
  const band: Oracle = (v) => v >= 10 && v <= 90;

  // 1) centered → ROBUST, edges found at ~10 and ~90
  const z1 = habitableZone(band, { lo: 0, hi: 100, current: 50 });
  checks.push({ name: "ROBUST-CENTER", pass: z1.verdict === "ROBUST" && Math.abs(z1.lowEdge - 10) < 0.01 && Math.abs(z1.highEdge - 90) < 0.01, detail: `zone≈[${z1.lowEdge.toFixed(2)},${z1.highEdge.toFixed(2)}] margin ${z1.margin.toFixed(2)} → ${z1.verdict}` });

  // 2) near the lower cliff → TIGHT (margin ~1 of span 100)
  const z2 = habitableZone(band, { lo: 0, hi: 100, current: 11 });
  checks.push({ name: "TIGHT-NEAR-CLIFF", pass: z2.verdict === "TIGHT" && z2.marginLow < z2.marginHigh, detail: `current 11 → marginLow ${z2.marginLow.toFixed(2)} → ${z2.verdict}` });

  // 3) essentially on the edge → KNIFE-EDGE
  const z3 = habitableZone(band, { lo: 0, hi: 100, current: 10.0005 });
  checks.push({ name: "KNIFE-EDGE", pass: z3.verdict === "KNIFE-EDGE", detail: `current 10.0005 → margin ${z3.margin.toPrecision(2)} → ${z3.verdict}` });

  // 4) current already fails → UNSTABLE (no guessing)
  const z4 = habitableZone(band, { lo: 0, hi: 100, current: 5 });
  checks.push({ name: "UNSTABLE", pass: z4.verdict === "UNSTABLE" && !z4.passesNow, detail: `current 5 fails → ${z4.verdict}` });

  // 5) one-sided threshold (passes iff v <= 100): low edge open, high cliff at 100
  const thr: Oracle = (v) => v <= 100;
  const z5 = habitableZone(thr, { lo: 0, hi: 200, current: 50 });
  checks.push({ name: "OPEN-LOW", pass: z5.lowOpen && Math.abs(z5.highEdge - 100) < 0.01 && z5.marginHigh > 49, detail: `lowOpen=${z5.lowOpen} highEdge≈${z5.highEdge.toFixed(2)}` });

  // 6) passes everywhere in range → both open → ROBUST
  const z6 = habitableZone(() => true, { lo: 0, hi: 100, current: 50 });
  checks.push({ name: "ALL-PASS-OPEN", pass: z6.lowOpen && z6.highOpen && z6.verdict === "ROBUST", detail: `both edges open → ${z6.verdict}` });

  // 7) ranking — most fragile first
  const a = analyzeConfig([
    { name: "robust", oracle: band, lo: 0, hi: 100, current: 50 },
    { name: "fragile", oracle: band, lo: 0, hi: 100, current: 10.5 },
    { name: "broken", oracle: band, lo: 0, hi: 100, current: 200 },
  ]);
  checks.push({ name: "RANK-FRAGILE-FIRST", pass: a.mostFragile?.name === "broken", detail: `most fragile = ${a.mostFragile?.name} (${a.mostFragile?.verdict})` });

  // 8) zoneFromSamples (discrete) agrees on the band
  const zs = zoneFromSamples([{ v: 0, pass: false }, { v: 20, pass: true }, { v: 50, pass: true }, { v: 80, pass: true }, { v: 100, pass: false }], 50);
  checks.push({ name: "FROM-SAMPLES", pass: zs.passesNow && zs.lowEdge > 0 && zs.lowEdge < 20 && zs.highEdge > 80 && zs.highEdge < 100, detail: `samples → zone≈[${zs.lowEdge},${zs.highEdge}]` });

  // 9) total — throwing / NaN oracle never crashes (treated as fail)
  let total = true;
  try { habitableZone(() => { throw new Error("x"); }, { lo: 0, hi: 1, current: 0.5 }); habitableZone((v) => v > 0, { lo: 0, hi: 0, current: 0 }); zoneFromSamples([], 1); } catch { total = false; }
  checks.push({ name: "TOTAL", pass: total, detail: "throwing oracle / empty range / no samples never throw" });

  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), checks };
}
