/**
 * v2.23.0 — DOJO · ARENA (orchestrator).
 *
 * Runs all 6 sensei in sequence, grades each, seals the report card,
 * auto-logs new failures into the regression set. Single entry point
 * the CLI uses.
 */

import { runLiarSensei, type LiarResult } from "./sensei/liar.js";
import { runEdgeSensei, type EdgeSenseiResult } from "./sensei/edge.js";
import { runInjectionSensei, type InjectionSenseiResult } from "./sensei/injection.js";
import { runSelfContradictSensei, type SelfContradictSenseiResult } from "./sensei/self_contradict.js";
import { detectSpecDrift, type SpecDiffResult } from "./sensei/spec_diff.js";
import { runEnduranceSensei, type EnduranceResult } from "./sensei/endurance.js";
import { gradeLiar, gradeEdge, gradeInjection, gradeSelfContradict, gradeSpecDiff, gradeEndurance, sealReportCard, formatReportCard, type ReportCard } from "./report_card.js";
import { recordRegression } from "./regression_set.js";

export interface ArenaResult {
  card: ReportCard;
  raw: {
    liar: LiarResult;
    edge: EdgeSenseiResult;
    injection: InjectionSenseiResult;
    selfContradict: SelfContradictSenseiResult;
    specDiff: SpecDiffResult;
    endurance: EnduranceResult;
  };
  /** New regressions logged this run (count). */
  newRegressions: number;
}

export interface RunArenaOptions {
  repoRoot: string;
  mnemeVersion: string;
  /** When true (default), failures auto-log into the regression set. */
  recordFailures?: boolean;
  /** Secret for report card HMAC. Defaults to a per-install key when
   *  not supplied; production callers should pass an explicit shared
   *  secret for cross-machine verification. */
  secret?: string;
  /** Endurance sensei iterations (default 50). */
  enduranceIterations?: number;
}

const DEFAULT_SECRET = "mneme-dojo-default-secret-v1";

export async function runArena(opts: RunArenaOptions): Promise<ArenaResult> {
  const record = opts.recordFailures !== false;
  const liar = await runLiarSensei({ repoRoot: opts.repoRoot });
  const edge = await runEdgeSensei();
  const injection = runInjectionSensei();
  const selfContradict = await runSelfContradictSensei({ repoRoot: opts.repoRoot });
  const specDiff = detectSpecDrift();
  const endurance = await runEnduranceSensei({ repoRoot: opts.repoRoot, iterations: opts.enduranceIterations ?? 50 });
  const grades = [
    gradeLiar(liar),
    gradeEdge(edge),
    gradeInjection(injection),
    gradeSelfContradict(selfContradict),
    gradeSpecDiff(specDiff),
    gradeEndurance(endurance),
  ];
  const card = sealReportCard({ mnemeVersion: opts.mnemeVersion, grades, secret: opts.secret ?? DEFAULT_SECRET });
  // Auto-record open failures.
  let newRegressions = 0;
  if (record) {
    for (const pc of liar.perClaim.filter((p) => !p.correct)) {
      recordRegression(opts.repoRoot, {
        sensei: "liar",
        input: pc.text,
        observedVerdict: pc.verdict,
        expectedVerdict: pc.truth === "true" ? "FUSION (or PASSTHROUGH)" : "BLACK_HOLE/IMPOSSIBLE_REFUTE",
        reason: `liar sensei: expected ${pc.truth}, observed verdict=${pc.verdict}`,
      });
      newRegressions++;
    }
    for (const pp of injection.perProbe.filter((p) => !p.correct)) {
      recordRegression(opts.repoRoot, {
        sensei: "injection",
        input: pp.name,
        observedVerdict: `flagged=${pp.flagged} maxSev=${pp.maxSeverity}`,
        expectedVerdict: pp.expectFlag ? "flagged (sev ≥ 4)" : "not flagged (sev < 4)",
        reason: `injection sensei: probe ${pp.name} expected expectFlag=${pp.expectFlag}`,
      });
      newRegressions++;
    }
    for (const f of specDiff.findings) {
      recordRegression(opts.repoRoot, {
        sensei: "spec_diff",
        input: f.command,
        observedVerdict: f.driftKind,
        expectedVerdict: "command signature matches description",
        reason: f.detail,
      });
      newRegressions++;
    }
  }
  return { card, raw: { liar, edge, injection, selfContradict, specDiff, endurance }, newRegressions };
}

export function formatArena(r: ArenaResult): string {
  const lines: string[] = [];
  lines.push(formatReportCard(r.card));
  if (r.newRegressions > 0) {
    lines.push("");
    lines.push(`  ⚠ ${r.newRegressions} new regression${r.newRegressions === 1 ? "" : "s"} auto-recorded to .mneme/dojo/regression.jsonl`);
  }
  return lines.join("\n");
}
