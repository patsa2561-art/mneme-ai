/**
 * v2.64.0 — ARENA multi-axis consensus scoring.
 *
 * Single-axis text-similarity (Jaccard on words) is too coarse: two
 * answers can use overlapping vocabulary while disagreeing on the
 * concrete numbers, OR disagree on phrasing while citing the same
 * facts. ARENA scores 4 axes:
 *
 *  1. JACCARD — token-set overlap on bigrams (more discriminative than
 *     single-token Jaccard).
 *  2. NUMERIC — do they cite the same numbers / versions / dates?
 *     Two answers about React that both say "19" agree on version.
 *  3. SENTIMENT — assert vs hedge balance (one says "definitely",
 *     another says "perhaps" → disagreement on confidence).
 *  4. LENGTH — log-ratio of word counts. Very different depth = often
 *     different scope.
 *
 * Composite consensus = weighted mean. Pairwise scores fold into an
 * NxN matrix; per-vendor "outlier score" = 1 - avg agreement with
 * everyone else. Identifies which vendor is the disagreer (or
 * possibly: the only one with the right answer).
 *
 * Pure deterministic.
 */

export interface ConsensusInput {
  /** Per-vendor responses (text only — ARENA passes the text field). */
  responses: Array<{ vendor: string; text: string }>;
}

export interface PairwiseScore {
  a: string;
  b: string;
  jaccard: number;
  numeric: number;
  sentiment: number;
  length: number;
  composite: number;
}

export interface VendorOutlier {
  vendor: string;
  /** Mean agreement with all OTHER vendors. */
  meanAgreement: number;
  /** 0..1; higher = more of an outlier. */
  outlierScore: number;
}

export interface ConsensusResult {
  /** Mean composite across all pairs. */
  score: number;
  /** "high" ≥0.70 / "medium" ≥0.40 / "low" <0.40. */
  agreement: "high" | "medium" | "low";
  /** Pairwise N choose 2. */
  pairs: PairwiseScore[];
  /** Per-vendor outlier diagnosis. */
  outliers: VendorOutlier[];
  /** Tokens / numbers / facts ALL vendors agree on (intersection). */
  commonFacts: string[];
  /** Tokens / numbers a SINGLE vendor mentioned (disputed). */
  uniqueClaims: Array<{ vendor: string; claim: string }>;
}

const HEDGES = ["may", "might", "could", "perhaps", "possibly", "seems", "appears", "approximately", "around", "about", "probably", "likely", "tends to"];
const ABSOLUTES = ["always", "never", "all", "every", "definitely", "certainly", "absolutely", "must", "guaranteed"];

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

function bigrams(toks: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + 1 < toks.length; i++) s.add(toks[i] + "_" + toks[i + 1]);
  return s;
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const NUM_RX = /\b(?:v?\d+(?:\.\d+){0,3}|\d{4}-\d{2}-\d{2}|\d{3,})\b/gi;

function extractNumbers(text: string): Set<string> {
  const m = text.match(NUM_RX) ?? [];
  return new Set(m.map((x) => x.toLowerCase()));
}

function sentimentScore(text: string): number {
  const lower = text.toLowerCase();
  let h = 0, a = 0;
  for (const w of HEDGES) if (lower.includes(w)) h++;
  for (const w of ABSOLUTES) if (lower.includes(w)) a++;
  if (h + a === 0) return 0; // neutral
  return (a - h) / (h + a); // -1 (hedged) … +1 (absolute)
}

export function pairwiseScore(a: { vendor: string; text: string }, b: { vendor: string; text: string }): PairwiseScore {
  const tokA = tokens(a.text);
  const tokB = tokens(b.text);
  const biA = bigrams(tokA);
  const biB = bigrams(tokB);
  const jaccard = jaccardSet(biA, biB);
  const numA = extractNumbers(a.text);
  const numB = extractNumbers(b.text);
  const numeric = jaccardSet(numA, numB);
  const sA = sentimentScore(a.text);
  const sB = sentimentScore(b.text);
  // sentiment alignment: 1 - |sA - sB| / 2
  const sentiment = 1 - Math.abs(sA - sB) / 2;
  // length alignment: 1 - |log(words_a/words_b)| / 3 (clamped)
  const wa = Math.max(1, tokA.length);
  const wb = Math.max(1, tokB.length);
  const lr = Math.abs(Math.log(wa / wb));
  const length = Math.max(0, 1 - lr / 3);
  // weighted composite — jaccard primary, numeric is killer signal, sentiment + length supportive.
  const composite = +(0.50 * jaccard + 0.30 * numeric + 0.10 * sentiment + 0.10 * length).toFixed(4);
  return { a: a.vendor, b: b.vendor, jaccard: +jaccard.toFixed(4), numeric: +numeric.toFixed(4), sentiment: +sentiment.toFixed(4), length: +length.toFixed(4), composite };
}

export function computeConsensus(input: ConsensusInput): ConsensusResult {
  const n = input.responses.length;
  if (n < 2) {
    return {
      score: 1, agreement: "high", pairs: [], outliers: [],
      commonFacts: input.responses[0] ? tokens(input.responses[0].text).slice(0, 20) : [],
      uniqueClaims: [],
    };
  }
  const pairs: PairwiseScore[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    pairs.push(pairwiseScore(input.responses[i]!, input.responses[j]!));
  }
  const score = +(pairs.reduce((s, p) => s + p.composite, 0) / pairs.length).toFixed(4);
  const agreement = score >= 0.70 ? "high" : score >= 0.40 ? "medium" : "low";

  // Per-vendor mean agreement (across all pairs involving them).
  const vendorTotals = new Map<string, { sum: number; count: number }>();
  for (const p of pairs) {
    const t1 = vendorTotals.get(p.a) ?? { sum: 0, count: 0 };
    t1.sum += p.composite; t1.count++;
    vendorTotals.set(p.a, t1);
    const t2 = vendorTotals.get(p.b) ?? { sum: 0, count: 0 };
    t2.sum += p.composite; t2.count++;
    vendorTotals.set(p.b, t2);
  }
  const outliers: VendorOutlier[] = [];
  for (const [vendor, t] of vendorTotals) {
    const meanAgreement = t.count === 0 ? 0 : t.sum / t.count;
    outliers.push({ vendor, meanAgreement: +meanAgreement.toFixed(4), outlierScore: +(1 - meanAgreement).toFixed(4) });
  }
  outliers.sort((a, b) => b.outlierScore - a.outlierScore);

  // Common facts = numbers that ALL vendors mentioned
  const numSets = input.responses.map((r) => extractNumbers(r.text));
  const allNumbers = new Set<string>();
  for (const s of numSets) for (const n of s) allNumbers.add(n);
  const commonFacts = Array.from(allNumbers).filter((num) => numSets.every((s) => s.has(num)));

  // Unique claims = numbers that exactly ONE vendor mentioned
  const uniqueClaims: ConsensusResult["uniqueClaims"] = [];
  for (const num of allNumbers) {
    const mentions = input.responses.filter((r, i) => numSets[i]!.has(num));
    if (mentions.length === 1) {
      uniqueClaims.push({ vendor: mentions[0]!.vendor, claim: num });
    }
  }

  return { score, agreement, pairs, outliers, commonFacts, uniqueClaims };
}
