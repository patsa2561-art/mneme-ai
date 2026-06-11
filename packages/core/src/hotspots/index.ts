/**
 * CROSS-LAYER HOTSPOTS — where the danger concentrates: files that change OFTEN and are ENTANGLED
 * across layers. The actionable counterpart to decay velocity (which gives the trend): this gives the
 * ranked refactor hit-list.
 *
 * The classic hotspot (churn × complexity) flags a big, frequently-edited file. This flags something
 * sharper: churn × CROSS-LAYER coupling — a file whose code reaches across into the database, the API,
 * and the business rules, AND that the team keeps changing. Those are the files where a change is most
 * likely to ripple across layers and break something far away — the highest-leverage things to
 * stabilize. Coupling comes from the deterministic graph; churn comes from git history.
 *
 * ★HONEST (DIAKRISIS): churn × cross-layer-coupling is a PRIORITIZATION signal — a candidate to look at,
 * not a proof a file is bad; a long-stable, heavily-coupled file is fine, and a churny but isolated file
 * is fine. The score deterministically composes two real measures (git change count × structural
 * cross-layer edges); the judgment of whether to refactor is still yours.
 */
import { graphHealth, type CrossLayerGraph } from "../cross_layer_graph/index.js";

const CROSS_LAYER = new Set(["WRITES_TO", "READS", "HANDLED_BY", "IMPLEMENTS"]);
export interface FileCoupling { file: string; couplingEdges: number; keystones: number }
/** Per-file cross-layer coupling: how many cross-layer edges originate in each file + keystones it holds. */
export function fileCoupling(graph: CrossLayerGraph): FileCoupling[] {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const agg = new Map<string, { couplingEdges: number; keystones: number }>();
  const bump = (file: string | undefined, k: "couplingEdges" | "keystones") => { if (!file) return; const e = agg.get(file) ?? { couplingEdges: 0, keystones: 0 }; e[k]++; agg.set(file, e); };
  for (const e of edges) if (CROSS_LAYER.has(e.relation)) bump(byId.get(e.source)?.file, "couplingEdges");
  for (const k of graphHealth(graph).keystones) bump(k.node.file, "keystones");
  return [...agg.entries()].map(([file, v]) => ({ file, ...v })).sort((a, b) => a.file.localeCompare(b.file));
}

export type HotspotBand = "CRITICAL" | "HIGH" | "MEDIUM";
export interface Hotspot { file: string; churn: number; couplingEdges: number; keystones: number; score: number; band: HotspotBand }
/** Rank files by churn × cross-layer coupling. Only files with BOTH change activity and coupling qualify. */
export function rankHotspots(coupling: ReadonlyArray<FileCoupling>, churn: Readonly<Record<string, number>>, opts?: { top?: number }): Hotspot[] {
  const slash = (p: string) => String(p).replace(/\\/g, "/");   // git uses '/'; scanned paths may use '\' on Windows
  const churnN: Record<string, number> = {}; for (const [k, v] of Object.entries(churn ?? {})) churnN[slash(k)] = v;
  const cmap = new Map((coupling ?? []).map((c) => [slash(c.file), { ...c, file: slash(c.file) }] as const));
  const out: Hotspot[] = [];
  for (const [file, c] of cmap) {
    const ch = churnN[file] || 0; if (ch <= 0) continue;                        // must have changed in the window
    const coup = c.couplingEdges + c.keystones * 3;                             // keystones weigh heavier (single points of failure)
    if (coup <= 0) continue;                                                    // must be cross-layer coupled
    out.push({ file, churn: ch, couplingEdges: c.couplingEdges, keystones: c.keystones, score: ch * coup, band: "MEDIUM" });
  }
  out.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const max = out[0]?.score || 1;
  for (const h of out) h.band = h.score >= max * 0.66 ? "CRITICAL" : h.score >= max * 0.33 ? "HIGH" : "MEDIUM";
  return typeof opts?.top === "number" ? out.slice(0, opts.top) : out;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface HotspotsGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function hotspotsGauntlet(): HotspotsGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
    { path: "money.ts", content: "router.post(\"/pay\", pay);\nexport function pay(){ return charge(); }\nexport function charge(){ return prisma.wallet.create({data:{}}); }" },   // endpoint + write → cross-layer edges here
    { path: "util.ts", content: "export function fmt(s){ return s.trim(); }" },   // no coupling
  ]);
  const fc = fileCoupling(g);
  const moneyFc = fc.find((f) => f.file === "money.ts");
  const couplingOK = !!moneyFc && moneyFc.couplingEdges >= 1 && !fc.some((f) => f.file === "util.ts" && f.couplingEdges > 0);
  // money.ts churns a lot + is coupled → top hotspot; util.ts churns but no coupling → excluded; schema churns 0 → excluded
  const ranked = rankHotspots(fc, { "money.ts": 12, "util.ts": 30, "schema.prisma": 0 });
  const topOK = ranked[0]?.file === "money.ts" && ranked[0].band === "CRITICAL";
  const excludesIsolated = !ranked.some((h) => h.file === "util.ts");           // high churn but no coupling → not a hotspot
  const excludesUnchanged = !ranked.some((h) => h.file === "schema.prisma");    // coupling but 0 churn → not a hotspot
  const total = (() => { try { fileCoupling(null as never); rankHotspots(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "FILE-COUPLING", pass: couplingOK, detail: "per-file cross-layer coupling from the graph (money.ts is coupled; util.ts is not)" },
    { name: "CHURN-X-COUPLING", pass: topOK, detail: "the file that both churns AND is cross-layer coupled ranks #1 (CRITICAL)" },
    { name: "EXCLUDES-ISOLATED", pass: excludesIsolated, detail: "a high-churn but uncoupled file is NOT a hotspot (needs both dimensions)" },
    { name: "EXCLUDES-UNCHANGED", pass: excludesUnchanged, detail: "a coupled but unchanged file is NOT a hotspot (no churn)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
