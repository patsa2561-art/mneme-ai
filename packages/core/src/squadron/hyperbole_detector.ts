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
  // Medical / global-impossible: action verb + target. v2.38.0 expansion —
  // adds "ends world hunger", "solves poverty", "eliminates all disease",
  // "ends starvation", "cures aging / death / mortality" as targets so
  // multi-impossible compound claims like "Mneme cures cancer + ends world
  // hunger" fire deterministically.
  {
    category: "medical-cure",
    detector: /\b(cure[ds]?|cures|treat(?:s|ed|ing)?|heal[eds]?|prevent[s]?|reverse[ds]?|eliminat[esd]+|end[s]?|solve[ds]?)\s+(?:[a-z]+\s+){0,4}(?:cancer|diabetes|alzheimer'?s?|als|aids|hiv|covid|disease|infection|tumou?rs?|stroke|dementia|parkinson'?s?|autism|world\s+hunger|world\s+poverty|all\s+(?:disease|illness|suffering)|starvation|aging|death|mortality)/i,
    reason: "claim asserts medical cure / global-impossible end of suffering without supporting evidence",
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
  // v2.37.0 — IMPOSSIBLE FACULTY v2. User audit caught "v999.0.0 quantum
  // mind control" passing as UNKNOWN instead of REFUTED because none of
  // the medical/superlative/faculty/physics regexes matched the phrase
  // "quantum mind control". This pattern catches sci-fi / consciousness-
  // engineering / impossible-tech keywords that appear in over-the-top
  // marketing claims (especially when paired with version numbers).
  {
    category: "impossible-faculty",
    detector: /\b(quantum\s+(?:mind|consciousness|soul|brain)\s+(?:control|reading|upload|download|manipulation|hacking)|mind[- ]?(?:control|hacking|upload)|consciousness\s+(?:upload|download|transfer)|soul\s+(?:upload|extraction|capture)|simulated\s+reality\s+detection|reality\s+(?:bending|warping|hacking)|time\s+(?:travel|reversal)\s+(?:engine|module|system)|telekines(?:is|tic)|astral\s+projection|psionic\s+(?:upload|interface))/i,
    reason: "claim asserts impossible sci-fi faculty (quantum mind control / consciousness upload / reality bending)",
  },
  // v2.37.0 — PARODY-VERSION pattern. STRICT: only triggers on absurd
  // major versions (≥ 999) like "v999.0.0" — the canonical parody shape
  // in vendor hallucinations. Real software doesn't ship at v999.x.y
  // (Chrome is at v140-ish; Linux kernel 6.x; even libraries that
  // bump fast top out around v200 — Babel 7, etc). The threshold of
  // 999 excludes every legitimate software project we could find.
  {
    category: "superlative-absolute",
    detector: /\bv?(?:9{3,}|[1-9]\d{3,})\.\d+\.\d+\b/i,
    reason: "claim cites a parody-grade version number (major ≥ 999); near-certain hallucination",
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
