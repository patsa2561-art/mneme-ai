/**
 * v2.23.2 — HYPERBOLE / IMPOSSIBLE-CLAIM DETECTOR.
 *
 * Closes the audit gap: lies like "Mneme cured cancer" / "Mneme is
 * the world's best AI" / "Mneme can read your mind" used to pass
 * through ACGV as PASSTHROUGH (no extractable fact-tuple → no
 * refutation). This module catches them deterministically + emits
 * IMPOSSIBLE_REFUTE so the vaccine bank learns the pattern.
 *
 * Categories:
 *   - medical-cure        — claims of curing/treating a disease
 *   - superlative-absolute — "best ever", "the only one", "world's first"
 *                            without evidence
 *   - impossible-faculty   — claims of psychic / future-predicting /
 *                            mind-reading abilities
 *   - impossible-physics   — claims of perpetual-motion / faster-than-
 *                            light / zero-resource compute
 *
 * Pure function; no LLM, no disk. Caller composes verdict into ACGV
 * pipeline.
 */

export type HyperboleCategory =
  | "medical-cure"
  | "superlative-absolute"
  | "impossible-faculty"
  | "impossible-physics";

export interface HyperbolePattern {
  category: HyperboleCategory;
  detector: RegExp;
  reason: string;
}

export const HYPERBOLE_PATTERNS: HyperbolePattern[] = [
  // Medical: action verb + disease/condition
  {
    category: "medical-cure",
    detector: /\b(cure[ds]?|cures|treat(?:s|ed|ing)?|heal[eds]?|prevent[s]?|reverse[ds]?|eliminat[esd]+)\s+(?:[a-z]+\s+){0,3}(?:cancer|diabetes|alzheimer'?s?|als|aids|hiv|covid|disease|infection|tumou?rs?|stroke|dementia|parkinson'?s?|autism)/i,
    reason: "claim asserts medical cure/treatment without clinical evidence",
  },
  // Superlative absolute without evidence
  {
    category: "superlative-absolute",
    detector: /\b(world'?s?\s+(?:best|first|only|fastest|smartest|most\s+accurate)|the\s+only\s+(?:way|tool|system|ai)\s+(?:that|to)|never\s+been\s+done|nothing\s+(?:like|comes\s+close)\s+to|unmatched\s+by|literally\s+(?:perfect|flawless|the\s+best))/i,
    reason: "superlative-absolute claim without supporting evidence",
  },
  // Impossible faculties
  {
    category: "impossible-faculty",
    detector: /\b(read[s]?\s+(?:your\s+)?(?:mind|thoughts)|predict[s]?\s+the\s+future|see[s]?\s+the\s+future|knows?\s+what\s+you'?re?\s+thinking|telepath(?:ic|y)|clairvoyan(?:t|ce)|precognition)/i,
    reason: "claim asserts physically-impossible faculty (telepathy / precognition)",
  },
  // Impossible physics
  {
    category: "impossible-physics",
    detector: /\b(perpetual\s+motion|faster[- ]than[- ]light|infinite\s+energy|zero[- ](?:cost|resource|latency)|free\s+energy|negative\s+entropy\s+machine|over[- ]?unity)/i,
    reason: "claim asserts physically-impossible mechanism",
  },
];

export interface HyperboleVerdict {
  /** True if at least one pattern matched. */
  flagged: boolean;
  matches: Array<{ category: HyperboleCategory; matched: string; reason: string }>;
  /** Stable signature usable as a vaccine key. */
  vaccineSignature: string;
}

export function detectHyperbole(claim: string): HyperboleVerdict {
  const matches: HyperboleVerdict["matches"] = [];
  for (const p of HYPERBOLE_PATTERNS) {
    const m = p.detector.exec(claim);
    if (m) matches.push({ category: p.category, matched: m[0], reason: p.reason });
  }
  const flagged = matches.length > 0;
  const vaccineSignature = flagged
    ? `HYPERBOLE :: ${matches.map((m) => m.category).join(",")} :: ${matches.map((m) => m.matched).join(" | ")}`
    : "";
  return { flagged, matches, vaccineSignature };
}
