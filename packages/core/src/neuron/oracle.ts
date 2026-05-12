/**
 * v1.79.0 -- NEURON: ORACLE (the wild function nobody dares to ship).
 *
 * Predicts which Mneme tool the user is ABOUT to invoke -- before
 * they finish typing -- by combining:
 *   1. Prompt prefix (autocompletion-style match against trigger phrases)
 *   2. Recent tool-call history (pheromone trail; same user reuses same tools)
 *   3. Tool composition graph (after tool A, tool B is often next)
 *
 * Output is a primed list of {tool, probability, reason}. The AI agent
 * can pre-warm the tool, surface a "did you mean…" hint, or auto-execute
 * if confidence is high enough.
 *
 * Why this is wild: no other MCP-style system pre-routes intent BEFORE
 * the user finishes typing. We're treating intent as a Markov chain
 * over the user's working session.
 */

import { rankByFuzzy } from "./fuzzy.js";
import { INTENT_ATOMS } from "../lattice/intent_atoms.js";
import { deriveAtomsFromCatalog, mergeAtoms, type ToolLike } from "./auto_atoms.js";

export interface OracleHistoryEntry {
  /** Tool that was actually called. */
  tool: string;
  /** ISO timestamp. */
  ts: string;
}

export interface OraclePrediction {
  tool: string;
  probability: number;
  reasons: string[];
  intent: string;
}

export interface OracleInput {
  /** What the user has typed so far (may be incomplete). */
  promptPrefix: string;
  /** Recent tool calls (most-recent last). Default empty. */
  recentCalls?: readonly OracleHistoryEntry[];
  /** Optional tool catalog -- expands the candidate pool beyond the
   *  hand-crafted lattice. */
  toolCatalog?: readonly ToolLike[];
  /** Maximum predictions to return. Default 3. */
  topK?: number;
}

export interface OracleReport {
  predictions: OraclePrediction[];
  /** Highest-probability prediction, or null if none above 0.2. */
  best: OraclePrediction | null;
  summary: string;
}

/** Predict the next Mneme tool the user will need. */
export function oraclePredict(input: OracleInput): OracleReport {
  const prefix = (input.promptPrefix ?? "").trim();
  const topK = input.topK ?? 3;
  if (!prefix) {
    return { predictions: [], best: null, summary: "no prefix -- nothing to predict" };
  }

  const allAtoms = mergeAtoms(INTENT_ATOMS, deriveAtomsFromCatalog(input.toolCatalog ?? []));

  // Signal 1: prefix fuzzy match.
  const fuzzy = rankByFuzzy(
    prefix,
    allAtoms.map((a) => ({ item: a, triggers: a.triggers })),
    0.12,
  );

  // Signal 2: recency bias from history.
  const recencyBoost = new Map<string, number>();
  const history = input.recentCalls ?? [];
  for (let i = 0; i < history.length; i++) {
    const age = history.length - i; // oldest = 1, newest = N
    const weight = Math.min(0.25, 0.05 * age); // newest weight 0.25, oldest 0.05
    const cur = recencyBoost.get(history[i]!.tool) ?? 0;
    recencyBoost.set(history[i]!.tool, cur + weight);
  }

  // Combine signals.
  const scored = new Map<string, OraclePrediction>();
  for (const f of fuzzy.slice(0, 8)) {
    const base = Math.min(0.85, f.similarity);
    const boost = recencyBoost.get(f.item.tool) ?? 0;
    const probability = Math.min(0.99, base + boost);
    const reasons: string[] = [`prefix fuzzy ${(f.similarity * 100).toFixed(0)}% on "${f.matched}"`];
    if (boost > 0) reasons.push(`recency bonus +${(boost * 100).toFixed(0)}%`);
    scored.set(f.item.tool, {
      tool: f.item.tool,
      probability,
      reasons,
      intent: f.item.intent,
    });
  }

  // History-only fallback (recent calls that didn't surface in fuzzy).
  for (const [tool, boost] of recencyBoost.entries()) {
    if (scored.has(tool)) continue;
    if (boost < 0.15) continue;
    scored.set(tool, {
      tool,
      probability: boost,
      reasons: [`recency-only (no prefix match)`],
      intent: `re-invoke ${tool}`,
    });
  }

  const predictions = Array.from(scored.values()).sort((a, b) => b.probability - a.probability).slice(0, topK);
  const best = predictions[0] && predictions[0].probability >= 0.2 ? predictions[0] : null;
  const summary = best
    ? `oracle best: ${best.tool} @ ${(best.probability * 100).toFixed(0)}% (${best.reasons.join(" · ")})`
    : "no confident prediction";
  return { predictions, best, summary };
}
