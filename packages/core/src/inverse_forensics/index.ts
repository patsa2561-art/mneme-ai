/**
 * v2.19.3 — MNEME INVERSE-LLM PROMPT FORENSICS (the rarest direction in AI)
 *
 *   "Every AI vendor runs INPUT → OUTPUT. Nobody runs OUTPUT → INPUT
 *    — because there's no business reason to. That's exactly the gap
 *    Mneme exploits. Given an AI output and a CLAIMED question that
 *    produced it, ask any inverse-oracle 'what K questions would a
 *    calibrated AI most likely answer with this exact output?'. If the
 *    claimed question is not among the top-K (by similarity), the
 *    output is either (a) hallucinated by the producing AI, or
 *    (b) prompt-injected — secretly answering a DIFFERENT question
 *    that an attacker smuggled in. Either way: reject it."
 *
 * Why this is novel:
 *   - First HMAC-signed inverse-direction audit primitive
 *   - Vendor-agnostic — caller supplies the inverse oracle (any vendor)
 *   - Pure mathematical verdict over similarity ranking — no LLM call
 *     inside this module (we orchestrate the math; caller calls the AI)
 *   - Closes the prompt-injection class for ANY text Mneme ingests
 *     (soul prompts, inbox messages, commit messages, parasite bridges)
 *
 * Honest scope:
 *   - This catches CONSISTENCY between claimed question and output.
 *     A perfectly camouflaged injection where the malicious output
 *     also plausibly answers the benign claimed question will still
 *     pass — but the COST of building such an output is high.
 *   - This does NOT prove TRUTH. An output can be consistent with its
 *     question and still be wrong about the world.
 *   - Similarity is method-dependent. We support 3 methods (Jaccard /
 *     trigram / caller-supplied-embeddings) and signal the choice in
 *     the receipt so audits are reproducible.
 *
 * Composes onto v2.6 TRUTH KERNEL (this becomes a new sensor) +
 * v2.18 NEXUS PROACTIVE (rejection can be pushed to the AI agent).
 * Pure additive layer; no breaking change.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type SimilarityMethod = "jaccard" | "trigram" | "embedded";
export type Verdict = "trusted" | "suspicious" | "rejected";

export interface InverseAuditInput {
  /** The AI-generated output we're auditing. */
  output: string;
  /** The question the user/AI claims produced this output. */
  claimedQuestion: string;
  /** K candidate questions returned by the inverse oracle (any AI vendor),
   *  ordered by inverse-oracle's likelihood (most likely first). */
  oracleQuestions: string[];
  /** Similarity threshold to count as a match. Default 0.45 for Jaccard,
   *  0.55 for trigram, 0.6 for embedded (caller can override). */
  threshold?: number;
  /** If best match rank ≤ this, verdict = trusted. Default 3. */
  topKForTrust?: number;
  /** Default "jaccard" (no deps + fast + portable). */
  similarityMethod?: SimilarityMethod;
  /** When using embedded mode, caller must supply vectors. */
  precomputedEmbeddings?: {
    claimed: number[];
    oracle: number[][];
  };
  ts?: string;
  secret?: string;
}

export interface InverseAuditVerdict {
  v: typeof PROTOCOL_VERSION;
  auditId: string;
  verdict: Verdict;
  /** 1..K (best match rank) or K+1 (no match found). */
  bestRank: number;
  /** Highest similarity any oracle question reached vs claimed. */
  bestSimilarity: number;
  /** Similarity of each oracle question vs claimed (same order as input). */
  perOracleSimilarity: number[];
  /** Threshold used. */
  threshold: number;
  topKForTrust: number;
  similarityMethod: SimilarityMethod;
  /** K, derived from oracleQuestions.length. */
  k: number;
  reasons: string[];
  /** Plain-English message for the AI agent / user. */
  message: string;
  /** Output digest (first 16 hex of sha256) — for audit cross-reference without leaking content. */
  outputDigest: string;
  ts: string;
  sig: string;
}

const DEFAULT_THRESHOLDS: Record<SimilarityMethod, number> = {
  jaccard: 0.45,
  trigram: 0.55,
  embedded: 0.60,
};

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_INVERSE_SECRET"] || `mneme-inverse-forensics-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

// ─── Similarity functions ────────────────────────────────────────────
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "it", "to", "of", "in", "on",
  "for", "with", "as", "at", "by", "this", "that", "be", "you", "i", "we",
  "they", "are", "was", "were", "have", "has", "had", "do", "does", "did",
  "not", "so", "if", "then", "than", "from", "out", "up", "your", "my",
  "our", "their", "its", "what", "when", "where", "how", "why", "would",
  "could", "should", "may", "might", "will", "shall",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => !STOP.has(t) && t.length >= 2);
}

export function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function trigramSimilarity(a: string, b: string): number {
  const norm = (s: string) => `  ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()}  `;
  const grams = (s: string): Set<string> => {
    const out = new Set<string>();
    const n = norm(s);
    for (let i = 0; i < n.length - 2; i++) out.add(n.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function pickSim(method: SimilarityMethod, claimed: string, oracle: string, embeds?: InverseAuditInput["precomputedEmbeddings"], i?: number): number {
  if (method === "jaccard") return jaccardSimilarity(claimed, oracle);
  if (method === "trigram") return trigramSimilarity(claimed, oracle);
  // embedded
  if (!embeds) throw new Error("INVERSE: similarityMethod=embedded requires precomputedEmbeddings");
  if (i === undefined) throw new Error("INVERSE: index required for embedded mode");
  if (!embeds.oracle[i]) throw new Error(`INVERSE: missing embedding for oracle[${i}]`);
  return cosineSimilarity(embeds.claimed, embeds.oracle[i]!);
}

// ─── Core: auditOutput ──────────────────────────────────────────────────
export function auditOutput(input: InverseAuditInput): InverseAuditVerdict {
  if (input.oracleQuestions.length === 0) {
    throw new Error("INVERSE: oracleQuestions must contain at least 1 candidate from the inverse oracle");
  }
  const ts = input.ts ?? new Date().toISOString();
  const method: SimilarityMethod = input.similarityMethod ?? "jaccard";
  const threshold = input.threshold ?? DEFAULT_THRESHOLDS[method];
  const topKForTrust = input.topKForTrust ?? 3;
  const k = input.oracleQuestions.length;

  // Compute similarity per oracle question.
  const sims: number[] = new Array(k);
  for (let i = 0; i < k; i++) {
    sims[i] = pickSim(method, input.claimedQuestion, input.oracleQuestions[i]!, input.precomputedEmbeddings, i);
  }

  // Best rank: index of first question whose similarity ≥ threshold, +1 (1-indexed).
  let bestRank = k + 1;
  let bestSim = 0;
  for (let i = 0; i < k; i++) {
    if (sims[i]! > bestSim) bestSim = sims[i]!;
    if (sims[i]! >= threshold && bestRank > i + 1) bestRank = i + 1;
  }
  // round sim numbers
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const perOracleSimilarity = sims.map(round3);
  bestSim = round3(bestSim);

  const reasons: string[] = [];
  reasons.push(`similarity method: ${method} · threshold: ${threshold}`);
  reasons.push(`best similarity ${bestSim} at rank ${bestRank === k + 1 ? "(none)" : bestRank}`);

  let verdict: Verdict;
  let message: string;
  // No oracle question passed threshold → REJECTED (regardless of K size).
  // This branch must come FIRST: when k < topKForTrust and no match exists,
  // bestRank = k+1 would otherwise be ≤ topKForTrust and falsely trust.
  if (bestRank > k) {
    verdict = "rejected";
    message = `🔁 INVERSE REJECTED · claimed question NOT found in oracle's top-${k} reconstructions (best sim ${bestSim} < threshold ${threshold}) · likely prompt-injection or hallucination`;
  } else if (bestRank <= topKForTrust) {
    verdict = "trusted";
    message = `🔁 INVERSE TRUSTED · claimed question matches oracle's top-${bestRank} reconstruction · sim ${bestSim}`;
  } else {
    verdict = "suspicious";
    message = `🔁 INVERSE SUSPICIOUS · claimed question matches but only at rank ${bestRank}/${k} · sim ${bestSim} · review before trusting`;
  }

  const outputDigest = createHmac("sha256", "mneme-inverse-digest").update(input.output).digest("hex").slice(0, 16);
  const auditId = "inv-" + createHmac("sha256", "mneme-inverse-id").update(`${ts}|${outputDigest}|${input.claimedQuestion.slice(0, 40)}`).digest("hex").slice(0, 14);

  const body: Omit<InverseAuditVerdict, "sig"> = {
    v: PROTOCOL_VERSION,
    auditId,
    verdict,
    bestRank,
    bestSimilarity: bestSim,
    perOracleSimilarity,
    threshold,
    topKForTrust,
    similarityMethod: method,
    k,
    reasons,
    message,
    outputDigest,
    ts,
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyAuditVerdict(v: InverseAuditVerdict, secret?: string): boolean {
  const { sig: claimed, ...body } = v;
  const expected = hmac(body, secret ?? defaultSecret());
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

export function formatInverseLine(v: InverseAuditVerdict): string {
  const icon = v.verdict === "trusted" ? "✅" : v.verdict === "suspicious" ? "🟧" : "🟥";
  return `${icon} INVERSE · ${v.verdict.toUpperCase()} · rank=${v.bestRank}/${v.k} · sim=${v.bestSimilarity}`;
}

/**
 * Build the meta-prompt the caller should send to ANY inverse-oracle AI.
 * Returned as plain text — caller wires this into chatgpt / claude / gemini /
 * grok / etc., parses the K-question response, and passes it back to
 * auditOutput().
 */
export function buildInverseOraclePrompt(input: { output: string; k?: number }): string {
  const k = input.k ?? 10;
  return [
    `You are an INVERSE-ORACLE for AI prompt forensics.`,
    `Given the AI-generated OUTPUT below, list the ${k} most likely QUESTIONS that a calibrated AI would answer with exactly this output.`,
    `Rules:`,
    `  1. Rank by likelihood; most likely first.`,
    `  2. Each question on its own line, no numbering, no extra commentary.`,
    `  3. Use natural human phrasing; no template boilerplate.`,
    `  4. Do NOT explain — just the ${k} questions.`,
    ``,
    `OUTPUT:`,
    `"""`,
    input.output,
    `"""`,
    ``,
    `Now list the ${k} most likely questions, one per line:`,
  ].join("\n");
}

/**
 * Parse the inverse-oracle's free-text response into a question array.
 * Tolerant of numbering prefixes, leading dashes, blank lines.
 */
export function parseInverseOracleResponse(text: string, maxK: number = 20): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(?:\d+[.)\s]+|[-*•]\s+)/, "").trim())
    .filter((l) => l.length >= 4)
    .slice(0, maxK);
}

// ─── Benchmark — Nobel-tier measurability ───────────────────────────────
export interface BenchmarkSample {
  output: string;
  claimedQuestion: string;
  oracleQuestions: string[];
  /** Ground truth: was this output really an answer to claimedQuestion? */
  trueLabel: "legitimate" | "injection_or_hallucination";
}

export interface BenchmarkResult {
  v: typeof PROTOCOL_VERSION;
  samples: number;
  truePositive: number;   // injection correctly rejected
  falsePositive: number;  // legitimate wrongly rejected
  trueNegative: number;   // legitimate correctly trusted
  falseNegative: number;  // injection wrongly trusted (the bad miss)
  precision: number;      // TP / (TP + FP)
  recall: number;         // TP / (TP + FN)
  f1: number;
  similarityMethod: SimilarityMethod;
  threshold: number;
  topKForTrust: number;
  ranByVendor?: string;
  ts: string;
  sig: string;
}

export function benchmark(input: {
  samples: BenchmarkSample[];
  similarityMethod?: SimilarityMethod;
  threshold?: number;
  topKForTrust?: number;
  ranByVendor?: string;
  secret?: string;
}): BenchmarkResult {
  const method = input.similarityMethod ?? "jaccard";
  const threshold = input.threshold ?? DEFAULT_THRESHOLDS[method];
  const topKForTrust = input.topKForTrust ?? 3;
  let TP = 0, FP = 0, TN = 0, FN = 0;
  for (const s of input.samples) {
    const v = auditOutput({
      output: s.output,
      claimedQuestion: s.claimedQuestion,
      oracleQuestions: s.oracleQuestions,
      similarityMethod: method,
      threshold,
      topKForTrust,
    });
    const flagged = v.verdict === "rejected" || v.verdict === "suspicious";
    const isBad = s.trueLabel === "injection_or_hallucination";
    if (isBad && flagged) TP++;
    else if (!isBad && flagged) FP++;
    else if (!isBad && !flagged) TN++;
    else FN++;
  }
  const precision = TP + FP === 0 ? 0 : TP / (TP + FP);
  const recall = TP + FN === 0 ? 0 : TP / (TP + FN);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const ts = new Date().toISOString();
  const body: Omit<BenchmarkResult, "sig"> = {
    v: PROTOCOL_VERSION,
    samples: input.samples.length,
    truePositive: TP, falsePositive: FP, trueNegative: TN, falseNegative: FN,
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    similarityMethod: method,
    threshold,
    topKForTrust,
    ...(input.ranByVendor ? { ranByVendor: input.ranByVendor } : {}),
    ts,
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}
