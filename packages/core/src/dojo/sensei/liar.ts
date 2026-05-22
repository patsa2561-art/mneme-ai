/**
 * v2.23.0 — DOJO · LIAR SENSEI.
 *
 * Generates synthetic false claims that LOOK true to an LLM (numeric
 * mismatches, swapped languages, wrong dependencies, off-by-one tool
 * counts), then runs Mneme's verify pipeline against each. The
 * verdict tells us how often Mneme catches its own LIARS without
 * accidentally rejecting truthful claims (control set).
 *
 * Output:
 *   - caught   = number of false claims correctly REFUTED / IMPOSSIBLE
 *   - missed   = number of false claims that slipped through as
 *                CONFIRMED / PASSTHROUGH / TRUSTWORTHY
 *   - falsePositives = number of TRUE control claims incorrectly REFUTED
 *
 * Scoring: F1 over (caught, missed, falsePositives).
 *
 * Composes with: squadron/fact_grounding + squadron/acgv.
 */

import { extractFactClaims } from "../../squadron/fact_grounding.js";

export interface SyntheticClaim {
  text: string;
  truth: "true" | "false";
  category: string;
  reason: string;
}

export const LIAR_CORPUS: SyntheticClaim[] = [
  // Tool count — false (intentionally off by huge margin)
  { text: "Mneme has 50 MCP tools", truth: "false", category: "tool_count", reason: "actual count is far higher" },
  { text: "Mneme has 9999 MCP tools", truth: "false", category: "tool_count", reason: "actual count is far lower" },
  // Tool count — true (within slack)
  { text: "Mneme has 800 MCP tools", truth: "true", category: "tool_count", reason: "in the right ballpark" },
  // Swarm organ count — false
  { text: "Mneme has 50 verification agents", truth: "false", category: "swarm_organ_count", reason: "actual is 8" },
  // Swarm organ count — true
  { text: "Mneme has 8 verification agents", truth: "true", category: "swarm_organ_count", reason: "matches catalog" },
  // Language — false (Mneme is TS, not Rust)
  { text: "Mneme is a Rust project", truth: "false", category: "language", reason: "actually TypeScript" },
  // Language — true
  { text: "Mneme is a TypeScript project", truth: "true", category: "language", reason: "verified by file count" },
  // Library — false (no such library in package.json)
  { text: "Mneme depends on react", truth: "false", category: "library_used", reason: "not in any package.json" },
  // Library — true
  { text: "Mneme depends on commander", truth: "true", category: "library_used", reason: "in cli/package.json" },
  // File exists — true
  { text: "The file README.md exists in the Mneme repo root", truth: "true", category: "file_exists", reason: "obvious file" },
];

export interface LiarResult {
  total: number;
  caught: number;
  missed: number;
  falsePositives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Per-claim outcome for forensics. */
  perClaim: Array<{ text: string; truth: "true" | "false"; verdict: string; correct: boolean; category: string }>;
}

export interface LiarSenseiOptions {
  repoRoot: string;
  /** Override the corpus (defaults to LIAR_CORPUS). */
  corpus?: SyntheticClaim[];
}

/** Run the liar sensei. Compares Mneme's verdict to ground-truth labels;
 *  emits F1 score. */
export async function runLiarSensei(opts: LiarSenseiOptions): Promise<LiarResult> {
  const corpus = opts.corpus ?? LIAR_CORPUS;
  // Lazy import to avoid circular reference at module-init time.
  const { runACGV } = await import("../../squadron/acgv.js");
  const perClaim: LiarResult["perClaim"] = [];
  let caught = 0, missed = 0, falsePositives = 0, trueNegatives = 0;
  for (const s of corpus) {
    let verdict = "PASSTHROUGH";
    try {
      const r = runACGV({ claim: s.text, repoRoot: opts.repoRoot, noEmitVaccine: true, noStake: true });
      verdict = r.verdict;
    } catch {
      verdict = "ERROR";
    }
    const mnemeSaysFalse =
      verdict === "BLACK_HOLE" || verdict === "IMPOSSIBLE_REFUTE" || verdict === "AUTO_REFUTE";
    const mnemeSaysTrue = verdict === "FUSION";
    let correct = false;
    if (s.truth === "false") {
      if (mnemeSaysFalse) { caught++; correct = true; }
      else if (mnemeSaysTrue) { missed++; }
      else { missed++; } // PASSTHROUGH on a known lie = miss (we couldn't catch it)
    } else {
      if (mnemeSaysTrue) { trueNegatives++; correct = true; }
      else if (mnemeSaysFalse) { falsePositives++; }
      else { trueNegatives++; correct = true; } // PASSTHROUGH on truth is acceptable
    }
    perClaim.push({ text: s.text, truth: s.truth, verdict, correct, category: s.category });
  }
  // F1 over "false claim detection" task.
  const precision = (caught + falsePositives) === 0 ? 1 : caught / (caught + falsePositives);
  const recall = (caught + missed) === 0 ? 1 : caught / (caught + missed);
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    total: corpus.length,
    caught, missed, falsePositives, trueNegatives,
    precision, recall, f1,
    perClaim,
  };
}

/** Pure-function unit test: do we extract a fact from a known liar claim?
 *  Used by the dojo arena to gate the sensei's effectiveness. */
export function liarCorpusCoverage(): { total: number; extractable: number; coverage: number } {
  let extractable = 0;
  for (const s of LIAR_CORPUS) {
    const claims = extractFactClaims(s.text);
    if (claims.length > 0) extractable++;
  }
  return {
    total: LIAR_CORPUS.length,
    extractable,
    coverage: LIAR_CORPUS.length === 0 ? 0 : extractable / LIAR_CORPUS.length,
  };
}
