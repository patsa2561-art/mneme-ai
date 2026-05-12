/**
 * v1.65.0 -- APOPTOSIS L5: EPISTEMIC HUMILITY DENSITY.
 *
 * Real experts hedge. They say "usually", "in v1.X+", "depends on",
 * "as of <date>", "I'm not sure but...". Hallucinators speak in
 * absolutes: "always", "never", "guaranteed", "100%".
 *
 * Measure: hedges per 100 words MINUS absolutes per 100 words.
 * Below threshold -> ALERT (overconfident speech is a lie signal).
 *
 * No LLM. Lexicon + token count.
 */

const HEDGES = [
  "usually", "often", "typically", "generally", "mostly", "sometimes", "occasionally",
  "approximately", "around", "roughly", "about",
  "may", "might", "could", "should", "would", "likely", "possibly", "perhaps", "maybe",
  "i think", "i believe", "i'm not sure", "afaik", "to my knowledge",
  "depends on", "in some cases", "in most cases", "subject to",
  "as of", "currently", "at present", "as far as i know",
  "estimate", "estimated", "approx",
];

const ABSOLUTES = [
  "always", "never", "every", "no exception", "without exception",
  "100%", "0%", "guaranteed", "guarantee", "absolutely", "definitely",
  "impossible", "certain", "certainty", "unquestionably", "undeniably",
  "all", "none", "no one", "everyone", "everything", "nothing",
  "perfect", "perfectly", "flawless",
];

const NUMERIC_ABSOLUTES = /\b\d{2,3}%\b|\bzero\b|\bnone\b/;

export interface HumilityReport {
  /** Hedges per 100 words. */
  hedgeDensity: number;
  /** Absolutes per 100 words. */
  absoluteDensity: number;
  /** Composite score in [-1, 1]; positive = humble, negative = overconfident. */
  humilityScore: number;
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  hedgesFound: string[];
  absolutesFound: string[];
  detail: string;
  ms: number;
}

function countOccurrences(text: string, lexicon: string[]): { count: number; found: string[] } {
  const lc = text.toLowerCase();
  let count = 0;
  const found: string[] = [];
  for (const term of lexicon) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "g");
    const matches = lc.match(re);
    if (matches) {
      count += matches.length;
      found.push(term);
    }
  }
  return { count, found };
}

export function humilityDensity(text: string, opts?: { minWords?: number; humilityThreshold?: number }): HumilityReport {
  const t0 = Date.now();
  const minWords = opts?.minWords ?? 12;
  const humilityThreshold = opts?.humilityThreshold ?? -0.5;

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < minWords) {
    return {
      hedgeDensity: 0,
      absoluteDensity: 0,
      humilityScore: 0,
      verdict: "INAPPLICABLE",
      hedgesFound: [],
      absolutesFound: [],
      detail: `Text too short for humility analysis (${words} < ${minWords} words).`,
      ms: Date.now() - t0,
    };
  }

  const hedges = countOccurrences(text, HEDGES);
  const absolutes = countOccurrences(text, ABSOLUTES);
  const numericAbsoluteHit = NUMERIC_ABSOLUTES.test(text);
  const absCount = absolutes.count + (numericAbsoluteHit ? 1 : 0);
  const hedgeDensity = (hedges.count / words) * 100;
  const absoluteDensity = (absCount / words) * 100;

  // Composite: hedges - absolutes, normalized.
  const raw = hedgeDensity - absoluteDensity * 2; // absolutes are heavier
  const humilityScore = Math.max(-1, Math.min(1, raw / 10));

  const verdict: HumilityReport["verdict"] = humilityScore <= humilityThreshold ? "ALERT" : "GROUNDED";

  return {
    hedgeDensity,
    absoluteDensity,
    humilityScore,
    verdict,
    hedgesFound: hedges.found,
    absolutesFound: absolutes.found,
    detail: verdict === "ALERT"
      ? `Overconfident speech: humility ${humilityScore.toFixed(2)} <= ${humilityThreshold}. ${absCount} absolute(s), ${hedges.count} hedge(s) in ${words} words.`
      : `Calibrated speech: humility ${humilityScore.toFixed(2)} (>${humilityThreshold}). ${hedges.count} hedge(s) vs ${absCount} absolute(s).`,
    ms: Date.now() - t0,
  };
}
