/**
 * v2.74.0 — CHRONOS stance normalization.
 *
 * A "stance" is the position an AI took on a question — the answer's
 * load-bearing assertion ("React 19 RSC is opt-in", "the price is $182",
 * "yes", "refuted"). To detect drift we must decide whether two stances
 * are THE SAME position or DIFFERENT positions.
 *
 * Two-tier comparison (max precision):
 *   1. EXACT normalized key — lowercase, Unicode-digit canonicalize (reuse
 *      the v2.71 homograph guard so "١٨٢" ≡ "182"), collapse whitespace,
 *      strip filler/hedge words. If keys are equal → definitely same.
 *   2. EMBEDDING cosine — when keys differ, compare stance embeddings; a
 *      high cosine (≥ stanceSameThreshold) means "paraphrase of the same
 *      position" (same), below means "different position" (drift candidate).
 *
 * Also extracts the stance's NUMERIC core: if both stances assert a number
 * (version, price, count) and the numbers differ, that is a STRONG drift
 * signal regardless of surrounding words.
 *
 * Pure deterministic.
 */

import { canonicalize } from "../protoplasm/super_quan/homograph_guard.js";

const FILLER = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to", "in",
  "on", "at", "for", "and", "or", "that", "this", "it", "as", "by", "with",
  "i", "think", "believe", "actually", "basically", "essentially", "really",
  "currently", "now", "today", "well", "so", "just", "quite", "very",
]);

export function normalizeStance(stance: string): string {
  if (typeof stance !== "string") return "";
  // Canonicalize Unicode-digit homographs first (١٨٢ → 182, ２ → 2).
  let s = stance;
  try { s = canonicalize(stance).canonical; } catch { /* best effort */ }
  s = s.toLowerCase();
  const toks = (s.match(/[a-z0-9$%.+-]+/g) ?? []).filter((t) => !FILLER.has(t));
  toks.sort(); // order-independent — "RSC is opt-in" ≡ "opt-in RSC"
  return toks.join(" ").trim();
}

/** Extract the salient numbers a stance asserts (versions, prices, counts). */
export function stanceNumbers(stance: string): string[] {
  let s = stance;
  try { s = canonicalize(stance).canonical; } catch { /* best effort */ }
  const m = s.match(/-?\d+(?:\.\d+)*/g) ?? [];
  return m.map((x) => x.replace(/^(\d+\.\d+)\.0+$/, "$1")); // 1.2.0 vs 1.2 noise-trim
}

export interface StanceComparison {
  /** True iff the two stances assert the SAME position. */
  same: boolean;
  /** How the decision was made. */
  basis: "exact_key" | "embedding" | "numeric_conflict" | "numeric_match";
  /** Cosine when embedding was used. */
  cosine?: number;
}

export interface StanceComparator {
  /** Embedding function for the fallback path. */
  embed: (t: string) => number[];
  cosineFn: (a: number[], b: number[]) => number;
  /** Cosine ≥ this means "same paraphrased position" (default 0.85). */
  sameThreshold?: number;
}

/**
 * Decide whether two stances are the same position.
 *
 * Precedence:
 *   1. If both assert numbers AND any salient number differs → DIFFERENT
 *      (numeric_conflict) — "$182" vs "$190" is a drift even if the words
 *      are identical.
 *   2. Equal normalized key → SAME (exact_key).
 *   3. Else embedding cosine vs threshold (embedding).
 */
export function compareStances(a: string, b: string, cmp: StanceComparator): StanceComparison {
  const numsA = stanceNumbers(a);
  const numsB = stanceNumbers(b);
  if (numsA.length > 0 && numsB.length > 0) {
    const setA = new Set(numsA);
    const setB = new Set(numsB);
    const conflict = numsA.some((n) => !setB.has(n)) || numsB.some((n) => !setA.has(n));
    // The numeric core is the load-bearing assertion for a factual stance
    // (price / version / count). Since the TOPIC already matched (same
    // question), the number decides the stance:
    //   any number differs  → DIFFERENT position (numeric_conflict)
    //   numbers all match    → SAME position (numeric_match), regardless of
    //                          surrounding hedge words ("around" vs "about").
    if (conflict) return { same: false, basis: "numeric_conflict" };
    return { same: true, basis: "numeric_match" };
  }
  const keyA = normalizeStance(a);
  const keyB = normalizeStance(b);
  if (keyA === keyB) {
    // If keys match AND numbers all match → strong same.
    return { same: true, basis: numsA.length > 0 ? "numeric_match" : "exact_key" };
  }
  const threshold = cmp.sameThreshold ?? 0.85;
  const cos = cmp.cosineFn(cmp.embed(keyA), cmp.embed(keyB));
  return { same: cos >= threshold, basis: "embedding", cosine: +cos.toFixed(4) };
}
