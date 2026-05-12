/**
 * v1.64.0 -- COGNITIVE LAYER 7: DECISION ATOM (FUSION CORE).
 *
 * The capstone. A decision atom fuses the outputs of all six previous
 * cognitive layers into a single, audit-traceable verdict for ANY
 * non-trivial decision:
 *
 *   1. theory-of-mind   -- which vendor is best for this task
 *   2. tree-of-thought  -- which strategy + tactic has highest EV
 *   3. curiosity        -- are there gaps that should be probed first
 *   4. consolidation    -- is the wisdom stack consistent (no near-dupes)
 *   5. counterfactual   -- would any alternative timeline score higher
 *   6. debate           -- skeptic / optimist / realist arbitration
 *
 * Each layer contributes a sub-verdict + confidence. The atom's
 * fusion rule:
 *
 *   PROCEED          all layers AGREE or near-neutral
 *   PROCEED-WITH-CARE one layer DISAGREES with low confidence
 *   PAUSE-INVESTIGATE one layer DISAGREES with high confidence, OR
 *                     two+ layers express concern
 *   ABORT-FOR-NOW    debate DISAGREES with arbiterConfidence >= 0.7
 *                     AND tree-of-thought best EV < 0.3
 *
 * Output is a single screen worth of plain English -- the user (or
 * AI agent) reads it and acts. The full audit trail is on disk.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { buildProfile, recommendVendor, type VendorProfile } from "./theory_of_mind.js";
import { search as totSearch, type ToTResult } from "./tree_of_thought.js";
import { scanGaps, type CuriosityScan } from "./curiosity.js";
import { runConsolidation, type ConsolidationReport } from "./consolidation.js";
import { simulate as cfSimulate, type CounterfactualResult } from "./counterfactual.js";
import { debate, type DebateResult } from "./debate.js";

const COGNITIVE_DIR = ".mneme/cognitive";

export type AtomVerdict = "PROCEED" | "PROCEED-WITH-CARE" | "PAUSE-INVESTIGATE" | "ABORT-FOR-NOW";

export interface DecisionAtomInput {
  /** The decision in plain English (e.g. "refactor authentication"). */
  intent: string;
  /** Optional list of vendors to consider (e.g. ["claude", "cursor", "gemini"]). */
  vendors?: string[];
  /** Optional task profile for vendor recommendation. */
  taskProfile?: { domain?: string; needsTerse?: boolean; needsStable?: boolean };
  /** Counterfactual baseline (the actual decision's risk/fair/cost). */
  counterfactualBaseline?: { actualRegressionP: number; actualStakeholderFair: number; actualTokenCost: number };
}

export interface DecisionAtom {
  intent: string;
  verdict: AtomVerdict;
  /** Overall confidence in [0, 1]. */
  confidence: number;
  /** Per-layer sub-verdicts. */
  layers: {
    theoryOfMind: { recommendedVendor: string | null; vendorProfiles: number };
    treeOfThought: { bestPath: string[]; bestEv: number; alternatives: number };
    curiosity: { totalGaps: number; highPriority: number; topGap: string | null };
    consolidation: { vaccinesMerged: number; lessonsPruned: number; lessonsPromoted: number };
    counterfactual: { topAlternative: string | null; netRelief: number; netRegret: number } | null;
    debate: { verdict: DebateResult["verdict"]; arbiterConfidence: number };
  };
  /** One-screen plain-English explanation. */
  briefing: string;
  /** Recommended next concrete action. */
  recommendedAction: string;
  /** Raw layer outputs for audit. */
  raw: {
    profiles: VendorProfile[];
    tot: ToTResult;
    curiosity: CuriosityScan;
    consolidation: ConsolidationReport;
    counterfactual: CounterfactualResult | null;
    debate: DebateResult;
  };
  /** ISO timestamp. */
  builtAt: string;
}

function decideVerdict(d: {
  debateVerdict: DebateResult["verdict"];
  debateConfidence: number;
  bestEv: number;
  highPriorityGaps: number;
  regret: number;
  relief: number;
}): { verdict: AtomVerdict; confidence: number; reasoning: string } {
  // ABORT: strong disagreement + low best EV
  if (d.debateVerdict === "DISAGREE" && d.debateConfidence >= 0.7 && d.bestEv < 0.3) {
    return { verdict: "ABORT-FOR-NOW", confidence: 0.9, reasoning: `Skeptic dominated (confidence ${d.debateConfidence.toFixed(2)}) AND best strategy EV is low (${d.bestEv.toFixed(3)}).` };
  }
  // PAUSE: significant gaps OR moderate disagreement OR significant counterfactual regret
  if (d.highPriorityGaps >= 2 || d.regret >= 0.15 || (d.debateVerdict === "DISAGREE" && d.debateConfidence >= 0.5)) {
    return {
      verdict: "PAUSE-INVESTIGATE",
      confidence: 0.6,
      reasoning: `Investigate first: ${d.highPriorityGaps} high-priority gaps, regret ${d.regret.toFixed(2)}, debate=${d.debateVerdict}@${d.debateConfidence.toFixed(2)}.`,
    };
  }
  // CARE: mild concerns
  if (d.debateVerdict === "INCONCLUSIVE" || d.bestEv < 0.4 || d.regret > 0.05) {
    return {
      verdict: "PROCEED-WITH-CARE",
      confidence: 0.5,
      reasoning: `Mild concern: debate=${d.debateVerdict}, EV=${d.bestEv.toFixed(3)}, regret=${d.regret.toFixed(2)}.`,
    };
  }
  return {
    verdict: "PROCEED",
    confidence: Math.min(1, 0.7 + d.bestEv * 0.3),
    reasoning: `All layers green: EV ${d.bestEv.toFixed(3)}, debate AGREE@${d.debateConfidence.toFixed(2)}, ${d.highPriorityGaps} high-priority gaps.`,
  };
}

export function build(repoRoot: string, input: DecisionAtomInput): DecisionAtom {
  // Layer 1: Theory of Mind
  const vendorList = input.vendors ?? [];
  const profiles: VendorProfile[] = vendorList.map((v) => buildProfile(repoRoot, v));
  const recommended = recommendVendor(profiles, input.taskProfile ?? {});

  // Layer 2: Tree of Thought
  const tot = totSearch(repoRoot, input.intent);

  // Layer 3: Curiosity
  const curiosity = scanGaps(repoRoot);

  // Layer 4: Consolidation (dry run -- we don't want to mutate disk during a decision)
  const consolidation = runConsolidation(repoRoot, { dryRun: true });

  // Layer 5: Counterfactual (only if baseline provided)
  let cf: CounterfactualResult | null = null;
  if (input.counterfactualBaseline) {
    cf = cfSimulate(repoRoot, {
      decision: input.intent,
      actualRegressionP: input.counterfactualBaseline.actualRegressionP,
      actualStakeholderFair: input.counterfactualBaseline.actualStakeholderFair,
      actualTokenCost: input.counterfactualBaseline.actualTokenCost,
    });
  }

  // Layer 6: Debate
  const dbt = debate(repoRoot, input.intent);

  const fused = decideVerdict({
    debateVerdict: dbt.verdict,
    debateConfidence: dbt.arbiterConfidence,
    bestEv: tot.bestEv,
    highPriorityGaps: curiosity.highPriority,
    regret: cf?.totalRegret ?? 0,
    relief: cf?.totalRelief ?? 0,
  });

  const topGap = curiosity.gaps[0]?.description ?? null;
  const recommendedAction =
    fused.verdict === "PROCEED"
      ? `Proceed with strategy "${tot.bestPath.join(" -> ")}".`
      : fused.verdict === "PROCEED-WITH-CARE"
      ? `Proceed with "${tot.bestPath.join(" -> ")}", but add a pre-flight check: ${dbt.turns[0]?.evidence[0] ?? "review skeptic concerns"}.`
      : fused.verdict === "PAUSE-INVESTIGATE"
      ? `Investigate first: ${topGap ?? dbt.reasoning.split("\n")[2]}.`
      : `Abort for now. Reason: ${fused.reasoning}`;

  const briefing = [
    `## Decision Atom -- ${input.intent}`,
    ``,
    `**Verdict:** ${fused.verdict}  (confidence ${fused.confidence.toFixed(2)})`,
    ``,
    `**Why:** ${fused.reasoning}`,
    ``,
    `### Layer breakdown`,
    `- Theory of Mind: ${profiles.length} vendor profile(s)${recommended ? `, recommended **${recommended.vendor}**` : ", no profiles supplied"}`,
    `- Tree of Thought: best path \`${tot.bestPath.join(" -> ")}\` (EV ${tot.bestEv.toFixed(3)}); ${tot.rankedLeaves.length - 1} alternative(s)`,
    `- Curiosity: ${curiosity.totalGaps} gap(s), ${curiosity.highPriority} high-priority${topGap ? `; top: "${topGap}"` : ""}`,
    `- Consolidation (dry): ${consolidation.vaccines.merged} vaccine(s) would merge, ${consolidation.lessons.pruned} lesson(s) prune, ${consolidation.lessons.promoted} promote`,
    cf ? `- Counterfactual: ${cf.summary}` : `- Counterfactual: (no baseline supplied -- skipped)`,
    `- Debate: ${dbt.verdict} @ ${dbt.arbiterConfidence.toFixed(2)} -- "${dbt.turns[2]?.argument ?? ""}"`,
    ``,
    `### Recommended action`,
    recommendedAction,
  ].join("\n");

  const atom: DecisionAtom = {
    intent: input.intent,
    verdict: fused.verdict,
    confidence: fused.confidence,
    layers: {
      theoryOfMind: { recommendedVendor: recommended?.vendor ?? null, vendorProfiles: profiles.length },
      treeOfThought: { bestPath: tot.bestPath, bestEv: tot.bestEv, alternatives: Math.max(0, tot.rankedLeaves.length - 1) },
      curiosity: { totalGaps: curiosity.totalGaps, highPriority: curiosity.highPriority, topGap },
      consolidation: { vaccinesMerged: consolidation.vaccines.merged, lessonsPruned: consolidation.lessons.pruned, lessonsPromoted: consolidation.lessons.promoted },
      counterfactual: cf ? { topAlternative: cf.topAlternative?.label ?? null, netRelief: cf.totalRelief, netRegret: cf.totalRegret } : null,
      debate: { verdict: dbt.verdict, arbiterConfidence: dbt.arbiterConfidence },
    },
    briefing,
    recommendedAction,
    raw: { profiles, tot, curiosity, consolidation, counterfactual: cf, debate: dbt },
    builtAt: new Date().toISOString(),
  };

  // Audit log
  try {
    const dir = join(repoRoot, COGNITIVE_DIR, "atoms");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "decisions.jsonl"),
      JSON.stringify({
        ts: atom.builtAt,
        intent: atom.intent,
        verdict: atom.verdict,
        confidence: atom.confidence,
        bestEv: tot.bestEv,
        debateVerdict: dbt.verdict,
      }) + "\n",
      "utf8",
    );
  } catch { /* */ }

  return atom;
}

/** Roll up the atom history -- how often does Mneme tell us PROCEED vs PAUSE? */
export interface AtomHistorySummary {
  totalAtoms: number;
  verdictCounts: Record<AtomVerdict, number>;
  meanConfidence: number;
  /** Most-recent atom's intent + verdict for quick recall. */
  lastAtom: { intent: string; verdict: AtomVerdict; ts: string } | null;
}

export function summarizeHistory(repoRoot: string): AtomHistorySummary {
  const p = join(repoRoot, COGNITIVE_DIR, "atoms", "decisions.jsonl");
  const verdictCounts: Record<AtomVerdict, number> = { "PROCEED": 0, "PROCEED-WITH-CARE": 0, "PAUSE-INVESTIGATE": 0, "ABORT-FOR-NOW": 0 };
  let total = 0;
  let confSum = 0;
  let last: AtomHistorySummary["lastAtom"] = null;
  if (!existsSync(p)) return { totalAtoms: 0, verdictCounts, meanConfidence: 0, lastAtom: null };
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    for (const l of lines) {
      try {
        const r = JSON.parse(l) as { ts?: string; intent?: string; verdict?: AtomVerdict; confidence?: number };
        if (!r.verdict || !(r.verdict in verdictCounts)) continue;
        verdictCounts[r.verdict] += 1;
        confSum += r.confidence ?? 0;
        total += 1;
        last = { intent: r.intent ?? "(unknown)", verdict: r.verdict, ts: r.ts ?? "(unknown)" };
      } catch { /* */ }
    }
  } catch { /* */ }
  return {
    totalAtoms: total,
    verdictCounts,
    meanConfidence: total === 0 ? 0 : confSum / total,
    lastAtom: last,
  };
}
