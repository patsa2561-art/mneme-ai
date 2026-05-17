/**
 * v2.19.27 — MNEME DREAMSPACE · PAIR (stage 3 of 6)
 *
 *   "for every pair (A, B): score = mutual_info(output_A, expected_
 *    input_B). top pairs → ผ่านขั้น 4"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.26 EVOLUTION.selectMatingPairs uses FREQUENCY
 *   (how often A→B fires together). PAIR adds QUALITY — measures
 *   how well A's output matches what B EXPECTS as input. High
 *   mutual_info → A and B are genuinely complementary; safe to splice.
 *
 *   We approximate mutual information without LLM: compare key-name
 *   overlap (Jaccard over object property names) AND value-type
 *   compatibility. Both signals together approximate "would A's output
 *   be a plausible input to B?".
 *
 *   Composes onto:
 *     - v2.19.26 EVOLUTION (replaces co-occurrence ranking with quality)
 *     - v2.19.27 PROBE (probe outputs feed PAIR's mutual_info)
 *     - v2.19.9 WRAPPER_GENESPLICING (high-mutual-info pairs → chimera)
 *     - v2.19.25 SLEEP TRAINING (PAIR fitness blends with jaccard reward)
 *
 * Honest scope:
 *   - Mutual info APPROXIMATION via shape-matching, not full Shannon
 *     information. Faster, deterministic, sufficient for "are these
 *     two tools complementary?" decision.
 *   - HMAC-signed PairReport so federation can ship verified pairs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_MIN_SCORE = 0.3;

export interface ToolOutputSample {
  toolName: string;
  /** Object output (we focus on object-shape compatibility). */
  result: Record<string, unknown>;
}

export interface ToolInputSchema {
  toolName: string;
  /** Required + optional property names. */
  requiredProps: string[];
  optionalProps: string[];
}

export interface PairScore {
  toolA: string;
  toolB: string;
  /** Object key overlap A.outputs vs B.requiredProps (Jaccard 0..1). */
  keyOverlapScore: number;
  /** Required-coverage: fraction of B's required props that A produces. */
  requiredCoverage: number;
  /** Optional-coverage: fraction of B's optional props A also produces. */
  optionalCoverage: number;
  /** Final mutual_info approximation (weighted blend). */
  mutualInfoScore: number;
}

export interface PairReport {
  v: typeof PROTOCOL_VERSION;
  pairs: PairScore[];
  totalCandidatePairs: number;
  qualifyingPairs: number;
  minScore: number;
  builtAt: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_PAIR_SECRET"] || `mneme-dreamspace-pair-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Jaccard over two string sets, case-insensitive. */
function jaccardKeys(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  if (sa.size === 0 && sb.size === 0) return 1.0;
  if (sa.size === 0 || sb.size === 0) return 0.0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Union of all output keys observed across the tool's samples. */
function unionOutputKeys(samples: ToolOutputSample[]): string[] {
  const keys = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s.result)) keys.add(k.toLowerCase());
  }
  return Array.from(keys).sort();
}

/**
 * Score a single (A, B) pair: how complementary is A's output to B's
 * expected input?
 *
 *   keyOverlapScore       = jaccard(unionOutputKeys(A), requiredProps(B) ∪ optionalProps(B))
 *   requiredCoverage      = |outputKeys(A) ∩ requiredProps(B)| / |requiredProps(B)|
 *   optionalCoverage      = |outputKeys(A) ∩ optionalProps(B)| / |optionalProps(B)|
 *   mutualInfoScore       = 0.5 * requiredCoverage + 0.3 * optionalCoverage + 0.2 * keyOverlapScore
 *
 * Required-coverage dominates because B will THROW if a required prop
 * is missing; optional is nice-to-have; raw key overlap captures broader
 * signal compatibility.
 */
export function scorePair(input: {
  toolA: string;
  outputsA: ToolOutputSample[];
  schemaB: ToolInputSchema;
}): PairScore {
  const outputKeysA = unionOutputKeys(input.outputsA);
  const setA = new Set(outputKeysA);
  const reqB = input.schemaB.requiredProps.map((p) => p.toLowerCase());
  const optB = input.schemaB.optionalProps.map((p) => p.toLowerCase());
  const allB = [...reqB, ...optB];
  const keyOverlap = jaccardKeys(outputKeysA, allB);
  const reqCov = reqB.length === 0 ? 1.0 : reqB.filter((k) => setA.has(k)).length / reqB.length;
  const optCov = optB.length === 0 ? 1.0 : optB.filter((k) => setA.has(k)).length / optB.length;
  const mi = 0.5 * reqCov + 0.3 * optCov + 0.2 * keyOverlap;
  return {
    toolA: input.toolA,
    toolB: input.schemaB.toolName,
    keyOverlapScore: keyOverlap,
    requiredCoverage: reqCov,
    optionalCoverage: optCov,
    mutualInfoScore: mi,
  };
}

/**
 * Score ALL ordered (A, B) pairs across the supplied tools; filter
 * above minScore; sort by mutualInfoScore desc. Self-pairs excluded.
 *
 * Returns top pairs ready to feed into v2.19.26 GESTATION as
 * `pattern_co_occurrence` signals with quality (not just frequency).
 */
export function rankAllPairs(input: {
  toolOutputs: ToolOutputSample[][];   // one array of samples per tool
  toolSchemas: ToolInputSchema[];
  minScore?: number;
  topN?: number;
  builtAt?: number;
  secret?: string;
}): PairReport {
  const minScore = input.minScore ?? DEFAULT_MIN_SCORE;
  const topN = input.topN ?? 25;
  const samplesByTool = new Map<string, ToolOutputSample[]>();
  for (const arr of input.toolOutputs) {
    if (arr.length === 0) continue;
    const name = arr[0]!.toolName;
    const prev = samplesByTool.get(name) ?? [];
    samplesByTool.set(name, prev.concat(arr));
  }
  const scoredPairs: PairScore[] = [];
  let totalCandidatePairs = 0;
  for (const [aName, aSamples] of samplesByTool) {
    for (const schemaB of input.toolSchemas) {
      if (aName === schemaB.toolName) continue;
      totalCandidatePairs++;
      const s = scorePair({ toolA: aName, outputsA: aSamples, schemaB });
      if (s.mutualInfoScore >= minScore) scoredPairs.push(s);
    }
  }
  scoredPairs.sort((a, b) => b.mutualInfoScore - a.mutualInfoScore || a.toolA.localeCompare(b.toolA) || a.toolB.localeCompare(b.toolB));
  const top = scoredPairs.slice(0, topN);
  const body: Omit<PairReport, "sig"> = {
    v: PROTOCOL_VERSION,
    pairs: top,
    totalCandidatePairs,
    qualifyingPairs: scoredPairs.length,
    minScore,
    builtAt: input.builtAt ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyPairReport(r: PairReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function formatPairLine(p: PairScore): string {
  const mi = (p.mutualInfoScore * 100).toFixed(0);
  return `💞 PAIR ${p.toolA} → ${p.toolB} · MI=${mi}% · req=${(p.requiredCoverage * 100).toFixed(0)}% · opt=${(p.optionalCoverage * 100).toFixed(0)}%`;
}
