/**
 * ARCHITECTURAL REGRESSION REPORT — the self-diagnosing capstone of the temporal vein.
 *
 * Each temporal gem answers one question; this fuses them into the report an AI agent (or a human)
 * actually wants when landing in a repo: "which of the architectural contracts this codebase USED to
 * uphold are now BROKEN — and, for each, exactly when and who broke it." It composes the whole stack:
 *   MINE  — induce the invariants the repo upheld at a baseline ref (zero config).
 *   CHECK — re-prove each against the current code; the ones that no longer hold are REGRESSIONS.
 *   BISECT (in the caller) — binary-search history to the commit + author that first broke each.
 *
 * The result is a signed architectural-incident report. No other tool can produce it: it needs induced
 * structural contracts AND a deterministic graph replayable across time — both unique to Mneme.
 *
 * This module owns the PURE half: mine-the-baseline + diff-against-current → the regression set. The
 * git-history bisect that pins each regression to a commit lives in the caller (CLI/MCP), so this stays
 * deterministic and unit-testable.
 *
 * ★HONEST (DIAKRISIS): a REGRESSION here is a contract the deterministic extractors proved held at the
 * baseline and prove is now VIOLATED — a real, re-checkable structural change, not a guess. A contract
 * that became UNKNOWN (e.g. its table vanished) is reported separately, never as a confirmed break. The
 * mined baseline is descriptive (what held then) — so a "regression" can also be an intended evolution;
 * it surfaces the change for a human to judge, with the exact counterexample.
 */
import { mineInvariants, checkInvariants, parseInvariants, renderMined, type InvKind } from "../invariants/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

export interface Regression { rule: string; kind: InvKind; status: "VIOLATED" | "UNKNOWN"; reason: string; counterexample?: string }
export interface RegressionAnalysis { baselineContracts: number; regressed: Regression[]; weakened: Regression[]; stillUpheld: number; clean: boolean }

/** Mine the contracts a baseline upheld, re-prove them against the current code → the regressions. */
export function analyzeRegressions(baselineFiles: ReadonlyArray<SourceFile>, currentFiles: ReadonlyArray<SourceFile>): RegressionAnalysis {
  const mined = mineInvariants(baselineFiles);
  if (!mined.length) return { baselineContracts: 0, regressed: [], weakened: [], stillUpheld: 0, clean: true };
  const inv = parseInvariants(renderMined(mined));
  const cur = checkInvariants(currentFiles, inv);
  const regressed: Regression[] = []; const weakened: Regression[] = []; let stillUpheld = 0;
  for (const r of cur.results) {
    if (r.status === "HOLDS") { stillUpheld++; continue; }
    const rec: Regression = { rule: r.invariant.raw, kind: r.invariant.kind as InvKind, status: r.status, reason: r.reason, counterexample: r.counterexample };
    if (r.status === "VIOLATED") regressed.push(rec); else weakened.push(rec);   // UNKNOWN = weakened/uncertain, not a confirmed break
  }
  return { baselineContracts: mined.length, regressed, weakened, stillUpheld, clean: regressed.length === 0 };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface ArchRegressionsGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archRegressionsGauntlet(): ArchRegressionsGauntlet {
  void buildCrossLayerGraph;
  // baseline: Wallet has exactly one writer (single-writer holds); Secret is internal (private holds).
  const baseline: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Secret { id Int @id }" },
    { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readSecret(){ return prisma.secret.findMany(); }" },
  ];
  // current: a SECOND writer to Wallet appears → single-writer is now VIOLATED (a regression).
  const current: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Secret { id Int @id }" },
    { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readSecret(){ return prisma.secret.findMany(); }" },
    { path: "b.ts", content: "export function drain(){ return prisma.wallet.update({where:{}}); }" },
  ];
  const a = analyzeRegressions(baseline, current);
  const detects = !a.clean && a.regressed.some((r) => /wallet/i.test(r.rule) && r.kind === "single-writer" && r.status === "VIOLATED" && /drain/.test(r.counterexample || ""));
  // baseline vs itself → no regression (every mined contract still holds).
  const cleanWhenSame = analyzeRegressions(baseline, baseline).clean === true;
  // an empty/garbage baseline yields no contracts → clean (nothing to regress).
  const emptyOK = analyzeRegressions([], current).clean === true && analyzeRegressions(null as never, null as never).baselineContracts === 0;
  const upheldCounted = analyzeRegressions(baseline, current).stillUpheld >= 1;   // Secret private still holds
  const total = (() => { try { analyzeRegressions(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "DETECTS-REGRESSION", pass: detects, detail: "a contract upheld at baseline (Wallet single-writer) that a new writer breaks → reported VIOLATED with the offending writer as counterexample" },
    { name: "CLEAN-WHEN-UNCHANGED", pass: cleanWhenSame, detail: "baseline vs itself → no regressions (every mined contract still holds)" },
    { name: "STILL-UPHELD-COUNTED", pass: upheldCounted, detail: "contracts that survived (Secret private) are counted as still-upheld, not flagged" },
    { name: "EMPTY-BASELINE-CLEAN", pass: emptyOK, detail: "no baseline contracts → clean (nothing to regress); null never throws" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
