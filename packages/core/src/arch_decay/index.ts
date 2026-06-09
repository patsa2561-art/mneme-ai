/**
 * ARCHITECTURAL DECAY VELOCITY — architectural debt as a TIME SERIES.
 *
 * The temporal vein's trend counterpart to bisect (which finds one break). Because the cross-layer graph
 * replays at any commit, Mneme can measure a structural-debt metric across history and report the
 * VELOCITY: is your architecture getting MORE entangled (harder to change) or less, and how fast — and
 * which commits added the most coupling. Nobody ships "your architecture's entanglement velocity"; it
 * needs a deterministic graph replayed over time.
 *
 * The debt metric is the count of CROSS-LAYER couplings (function↔table, endpoint↔function, rule↔
 * function) plus single-point-of-failure keystones and authorization gaps — the things that make a
 * system rigid and risky. Rising = eroding.
 *
 * ★HONEST (DIAKRISIS): a TREND over sampled commits, not a forecast and not a value judgment — more
 * coupling isn't always bad (a growing app grows edges); the signal is the RATE and which commits
 * spiked it, computed deterministically from the structural graph, to look at — not a verdict that the
 * architecture is "good" or "bad".
 */
import { buildCrossLayerGraph, graphHealth, type SourceFile } from "../cross_layer_graph/index.js";
import { authzGaps } from "../authz_gap/index.js";

export interface DebtSnapshot { ref?: string; author?: string; functions: number; tables: number; endpoints: number; couplings: number; keystones: number; authzGaps: number }
export type DecayTrend = "ERODING" | "STABLE" | "IMPROVING";
export interface DecayReport { series: DebtSnapshot[]; velocity: { couplings: number; keystones: number; authzGaps: number }; worstStep: { fromIndex: number; toIndex: number; deltaCouplings: number; author?: string } | null; trend: DecayTrend; reason: string }

const CROSS_LAYER = new Set(["WRITES_TO", "READS", "HANDLED_BY", "IMPLEMENTS"]);
/** The structural-debt metrics of one commit's file snapshot. */
export function measureDebt(files: ReadonlyArray<SourceFile>, meta?: { ref?: string; author?: string }): DebtSnapshot {
  const g = buildCrossLayerGraph((files ?? []) as SourceFile[]);
  const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
  const couplings = g.edges.filter((e) => CROSS_LAYER.has(e.relation)).length;
  return { ref: meta?.ref, author: meta?.author, functions: byType("function"), tables: byType("db_table"), endpoints: byType("api_endpoint"), couplings, keystones: graphHealth(g).keystones.length, authzGaps: authzGaps(g).length };
}

/** Pure: turn a chronological series of debt snapshots (oldest→newest) into a trend + velocity + worst step. */
export function decaySeries(snapshots: ReadonlyArray<DebtSnapshot>): DecayReport {
  const series = [...(snapshots ?? [])];
  if (series.length < 2) return { series, velocity: { couplings: 0, keystones: 0, authzGaps: 0 }, worstStep: null, trend: "STABLE", reason: "need at least 2 snapshots to measure velocity" };
  const first = series[0], last = series[series.length - 1]; const span = series.length - 1;
  const velocity = { couplings: (last.couplings - first.couplings) / span, keystones: (last.keystones - first.keystones) / span, authzGaps: (last.authzGaps - first.authzGaps) / span };
  let worstStep: DecayReport["worstStep"] = null;
  for (let i = 1; i < series.length; i++) { const d = series[i].couplings - series[i - 1].couplings; if (!worstStep || d > worstStep.deltaCouplings) worstStep = { fromIndex: i - 1, toIndex: i, deltaCouplings: d, author: series[i].author }; }
  const netCoupling = last.couplings - first.couplings; const netGaps = last.authzGaps - first.authzGaps;
  const trend: DecayTrend = (netGaps > 0 || netCoupling > 0) ? "ERODING" : (netCoupling < 0 && netGaps <= 0) ? "IMPROVING" : "STABLE";
  const reason = trend === "ERODING" ? `cross-layer coupling rose ${first.couplings}→${last.couplings} (${velocity.couplings >= 0 ? "+" : ""}${velocity.couplings.toFixed(1)}/commit)${netGaps > 0 ? `, authz gaps +${netGaps}` : ""} — the architecture is getting more entangled`
    : trend === "IMPROVING" ? `cross-layer coupling fell ${first.couplings}→${last.couplings} — the architecture is getting leaner`
      : `coupling roughly flat (${first.couplings}→${last.couplings})`;
  return { series, velocity, worstStep, trend, reason };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
const snap = (couplings: number, keystones = 0, authzGaps = 0, author?: string): DebtSnapshot => ({ functions: 0, tables: 0, endpoints: 0, couplings, keystones, authzGaps, author });
export interface ArchDecayGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archDecayGauntlet(): ArchDecayGauntlet {
  // real measure: a 2-edge app → couplings ≥ 2 (reads + handled_by)
  const m = measureDebt([
    { path: "s.prisma", content: "model Wallet { id Int @id }" },
    { path: "r.ts", content: "router.get(\"/bal\", getBal);" },
    { path: "h.ts", content: "export function getBal(){ return prisma.wallet.findMany(); }" },
  ]);
  const measureOK = m.couplings >= 2 && m.tables === 1 && m.endpoints === 1;
  const eroding = decaySeries([snap(10), snap(20), snap(45, 0, 0, "Bob")]);
  const erodeOK = eroding.trend === "ERODING" && eroding.velocity.couplings > 0 && eroding.worstStep?.toIndex === 2 && eroding.worstStep?.author === "Bob";
  const improving = decaySeries([snap(40), snap(30), snap(15)]);
  const improveOK = improving.trend === "IMPROVING" && improving.velocity.couplings < 0;
  const flat = decaySeries([snap(20), snap(20), snap(20)]);
  const flatOK = flat.trend === "STABLE";
  const gapsErode = decaySeries([snap(20, 0, 0), snap(20, 0, 2)]).trend === "ERODING";   // coupling flat but authz gaps appeared → eroding
  const total = (() => { try { measureDebt(null as never); decaySeries(null as never); decaySeries([snap(1)]); return true; } catch { return false; } })();
  const checks = [
    { name: "MEASURE-DEBT", pass: measureOK, detail: "one commit's structural debt: cross-layer couplings + keystones + authz gaps, from the graph" },
    { name: "ERODING-VELOCITY", pass: erodeOK, detail: "rising coupling → ERODING, with the per-commit velocity + the worst-step commit (and author)" },
    { name: "IMPROVING", pass: improveOK, detail: "falling coupling → IMPROVING (negative velocity)" },
    { name: "STABLE", pass: flatOK, detail: "flat coupling → STABLE (no false alarm)" },
    { name: "AUTHZ-GAPS-ERODE", pass: gapsErode, detail: "new authz gaps count as erosion even when coupling is flat" },
    { name: "TOTAL", pass: total, detail: "null / <2 snapshots never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
