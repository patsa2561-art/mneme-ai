/**
 * v1.64.0 -- COGNITIVE LAYER 5: COUNTERFACTUAL ENGINE.
 *
 * Given a decision (commit / file change / strategic choice), simulate
 * the alternative timelines:
 *   - "if we had NOT done this"
 *   - "if we had done it SOONER"
 *   - "if we had done it DIFFERENTLY"
 *
 * Each branch is scored on the same axes as Tree-of-Thought (regression,
 * stakeholder fairness, token cost). The output is a regret/relief
 * delta vs. the actual timeline.
 *
 *   actual          regression=0.18, fair=0.75
 *   not-done        regression=0.05, fair=0.40   --> relief +0.10
 *   done-sooner     regression=0.12, fair=0.80   --> relief +0.05
 *   done-different  regression=0.30, fair=0.65   --> regret -0.06
 *
 * Mneme learns from these regrets. If "done-sooner" consistently shows
 * relief, Mneme nudges future decisions earlier. If "done-different"
 * shows regret, the original choice is reinforced.
 *
 * Pure read; persists audit only when persistDelta=true.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const COGNITIVE_DIR = ".mneme/cognitive";

export interface CounterfactualBranch {
  /** Branch label. */
  label: "actual" | "not-done" | "done-sooner" | "done-different";
  estimatedRegressionP: number;
  estimatedStakeholderFair: number;
  estimatedTokenCost: number;
  /** Composite score in [0, 1]; higher = better outcome. */
  outcomeScore: number;
}

export interface CounterfactualResult {
  decision: string;
  branches: CounterfactualBranch[];
  /** Relief = sum of (counterfactual.outcomeScore - actual.outcomeScore) where positive. */
  totalRelief: number;
  /** Regret = sum of (actual.outcomeScore - counterfactual.outcomeScore) where positive. */
  totalRegret: number;
  /** Most-relieving alternative if it exists. */
  topAlternative: { label: string; deltaScore: number } | null;
  /** Plain-English summary. */
  summary: string;
}

function score(regression: number, fair: number, tokens: number): number {
  const tokenPenalty = 1 + Math.log10(Math.max(100, tokens) / 100);
  return Math.max(0, Math.min(1, ((1 - regression) * fair) / tokenPenalty));
}

/** Deterministic perturbation based on decision string + branch label. */
function perturb(seed: string, axis: "regression" | "fair" | "tokens", actual: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = ((h >>> 0) % 1000) / 1000; // 0..1
  if (axis === "regression") {
    // not-done usually lower regression; done-sooner ~ same; done-different ~ higher
    if (seed.includes("not-done")) return Math.max(0.02, actual - 0.1 - r * 0.05);
    if (seed.includes("done-sooner")) return Math.max(0.02, actual - 0.04 + (r - 0.5) * 0.08);
    return Math.min(0.95, actual + 0.05 + r * 0.1);
  }
  if (axis === "fair") {
    if (seed.includes("not-done")) return Math.max(0.1, actual - 0.25 - r * 0.05);
    if (seed.includes("done-sooner")) return Math.min(0.98, actual + 0.04 + (r - 0.5) * 0.06);
    return Math.max(0.1, actual - 0.05 + (r - 0.5) * 0.1);
  }
  // tokens
  if (seed.includes("not-done")) return Math.round(actual * 0.1);
  if (seed.includes("done-sooner")) return Math.round(actual * 0.85);
  return Math.round(actual * 1.4 + r * 200);
}

export interface CounterfactualInput {
  /** Decision label. */
  decision: string;
  /** Estimated regression P of the actual timeline. */
  actualRegressionP: number;
  /** Estimated stakeholder fairness of the actual timeline. */
  actualStakeholderFair: number;
  /** Estimated token cost of the actual timeline. */
  actualTokenCost: number;
}

export function simulate(repoRoot: string, input: CounterfactualInput, opts?: { persistDelta?: boolean }): CounterfactualResult {
  const actualScore = score(input.actualRegressionP, input.actualStakeholderFair, input.actualTokenCost);
  const branches: CounterfactualBranch[] = [
    {
      label: "actual",
      estimatedRegressionP: input.actualRegressionP,
      estimatedStakeholderFair: input.actualStakeholderFair,
      estimatedTokenCost: input.actualTokenCost,
      outcomeScore: actualScore,
    },
  ];

  for (const label of ["not-done", "done-sooner", "done-different"] as const) {
    const seed = `${input.decision}::${label}`;
    const regression = perturb(seed, "regression", input.actualRegressionP);
    const fair = perturb(seed, "fair", input.actualStakeholderFair);
    const tokens = perturb(seed, "tokens", input.actualTokenCost);
    const outcome = score(regression, fair, tokens);
    branches.push({
      label,
      estimatedRegressionP: regression,
      estimatedStakeholderFair: fair,
      estimatedTokenCost: tokens,
      outcomeScore: outcome,
    });
  }

  let totalRelief = 0;
  let totalRegret = 0;
  let topAlternative: { label: string; deltaScore: number } | null = null;
  for (const b of branches) {
    if (b.label === "actual") continue;
    const delta = b.outcomeScore - actualScore;
    if (delta > 0) {
      totalRelief += delta;
      if (!topAlternative || delta > topAlternative.deltaScore) {
        topAlternative = { label: b.label, deltaScore: delta };
      }
    } else {
      totalRegret += -delta;
    }
  }

  const summary = topAlternative
    ? `Best counterfactual: "${topAlternative.label}" would have scored +${topAlternative.deltaScore.toFixed(3)} over actual. Net relief ${totalRelief.toFixed(3)} vs regret ${totalRegret.toFixed(3)}.`
    : `Actual decision dominates all counterfactuals. Net regret ${totalRegret.toFixed(3)} -- choice was sound.`;

  // Audit log
  if (opts?.persistDelta) {
    try {
      const dir = join(repoRoot, COGNITIVE_DIR, "counterfactual");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, "deltas.jsonl"),
        JSON.stringify({
          ts: new Date().toISOString(),
          decision: input.decision,
          totalRelief,
          totalRegret,
          topAlternative,
        }) + "\n",
        "utf8",
      );
    } catch { /* */ }
  }

  return {
    decision: input.decision,
    branches,
    totalRelief,
    totalRegret,
    topAlternative,
    summary,
  };
}

/** Aggregate regret/relief deltas over a window -- detects systematic
 *  bias toward acting too late, too early, too aggressively. */
export interface CounterfactualBias {
  totalEntries: number;
  meanRelief: number;
  meanRegret: number;
  topAlternativeFrequency: Record<string, number>;
  /** Dominant systematic bias or "balanced". */
  systematicBias: "act-sooner" | "act-different" | "act-less" | "balanced";
}

export function detectBias(repoRoot: string): CounterfactualBias {
  const p = join(repoRoot, COGNITIVE_DIR, "counterfactual", "deltas.jsonl");
  if (!existsSync(p)) {
    return { totalEntries: 0, meanRelief: 0, meanRegret: 0, topAlternativeFrequency: {}, systematicBias: "balanced" };
  }
  let totalEntries = 0;
  let sumRelief = 0;
  let sumRegret = 0;
  const counts: Record<string, number> = {};
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    for (const l of lines) {
      try {
        const row = JSON.parse(l) as { totalRelief?: number; totalRegret?: number; topAlternative?: { label?: string } | null };
        totalEntries += 1;
        sumRelief += row.totalRelief ?? 0;
        sumRegret += row.totalRegret ?? 0;
        const lbl = row.topAlternative?.label ?? "none";
        counts[lbl] = (counts[lbl] ?? 0) + 1;
      } catch { /* */ }
    }
  } catch { /* */ }

  const meanRelief = totalEntries === 0 ? 0 : sumRelief / totalEntries;
  const meanRegret = totalEntries === 0 ? 0 : sumRegret / totalEntries;
  let dominant: keyof typeof counts | null = null;
  let dominantCount = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (k === "none") continue;
    if (v > dominantCount) {
      dominant = k;
      dominantCount = v;
    }
  }
  let bias: CounterfactualBias["systematicBias"] = "balanced";
  if (dominant && dominantCount / totalEntries >= 0.4) {
    if (dominant === "done-sooner") bias = "act-sooner";
    else if (dominant === "done-different") bias = "act-different";
    else if (dominant === "not-done") bias = "act-less";
  }

  return {
    totalEntries,
    meanRelief,
    meanRegret,
    topAlternativeFrequency: counts,
    systematicBias: bias,
  };
}
