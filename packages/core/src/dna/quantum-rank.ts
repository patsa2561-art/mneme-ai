/**
 * A3 — Quantum Superposition Rank.
 *
 * Standard search engines rank files deterministically: file A is rank #1
 * forever. Quantum Rank treats each file as living in a "superposition"
 * across multiple intent dimensions. The same file can be #1 for
 * intent-X and #50 for intent-Y. The query "collapses" the superposition
 * into a concrete ranking specific to its intent profile.
 *
 * Mathematically: a 3-tensor T[file, query-feature, intent] reduced via
 * the query's intent vector. Pure linear algebra (Tucker-style mode-3
 * contraction) — no actual quantum computation involved.
 *
 * Pure function. Uses F1 (QRS) under the hood for cross-feature scoring.
 */

import { qrs } from "./formulas.js";

export interface FileTensor {
  /** Stable file id. */
  id: string;
  /** 2D matrix per file: rows = features, cols = intents.
   *  Tensor[i][f][k] = how strongly file i exhibits feature f under intent k. */
  matrix: number[][];
}

export interface QuantumRankInput {
  /** Per-file feature × intent matrices. All must share dimensions. */
  files: FileTensor[];
  /** Query feature vector (one entry per feature row). */
  queryFeatures: number[];
  /** Intent vector (one entry per intent col). Should sum ~ 1. */
  intentVector: number[];
  /**
   * Optional cross-feature operator H. If provided, score becomes
   * QRS(file_collapsed_vector, H) instead of plain dot product. */
  queryOperator?: number[][];
}

export interface QuantumRankResult {
  id: string;
  /** Intent-conditional score. */
  score: number;
}

/**
 * Rank files conditional on the user's intent vector.
 *
 * Steps:
 *   1. Collapse each file's matrix along the intent axis: v_i = M_i · intentVector
 *      (yields a per-feature score for file i, given the intent mix).
 *   2. Score(i) = either ⟨queryFeatures, v_i⟩ (linear) or QRS(v_i, H) (with operator).
 *
 * Returns deterministic descending order.
 */
export function quantumRank(input: QuantumRankInput): QuantumRankResult[] {
  const { files, queryFeatures, intentVector, queryOperator } = input;
  if (files.length === 0) return [];

  // Validate shapes (fail-loud)
  const expectedFeatures = queryFeatures.length;
  const expectedIntents = intentVector.length;
  for (const f of files) {
    if (f.matrix.length !== expectedFeatures) {
      throw new Error(`quantumRank: file ${f.id} has ${f.matrix.length} feature rows, expected ${expectedFeatures}`);
    }
    for (let r = 0; r < f.matrix.length; r++) {
      if (f.matrix[r]!.length !== expectedIntents) {
        throw new Error(`quantumRank: file ${f.id} row ${r} has ${f.matrix[r]!.length} cols, expected ${expectedIntents}`);
      }
    }
  }
  if (queryOperator) {
    if (queryOperator.length !== expectedFeatures) {
      throw new Error(`quantumRank: operator size ${queryOperator.length} != ${expectedFeatures}`);
    }
  }

  const out: QuantumRankResult[] = [];
  for (const f of files) {
    // Step 1: collapse along intent
    const collapsed: number[] = new Array(expectedFeatures).fill(0);
    for (let r = 0; r < expectedFeatures; r++) {
      let s = 0;
      const row = f.matrix[r]!;
      for (let c = 0; c < expectedIntents; c++) s += row[c]! * intentVector[c]!;
      collapsed[r] = s;
    }
    // Step 2: score
    let score: number;
    if (queryOperator) {
      score = qrs({ fileVector: collapsed, queryOperator });
    } else {
      score = 0;
      for (let i = 0; i < expectedFeatures; i++) score += collapsed[i]! * queryFeatures[i]!;
    }
    out.push({ id: f.id, score });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return out;
}
