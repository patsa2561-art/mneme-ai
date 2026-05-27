/**
 * 💥 2. CONTRA-RAG — Contradiction-finding retrieval
 *
 * Standard RAG: find docs that SUPPORT the answer.
 * CONTRA-RAG: find docs that CONTRADICT the answer.
 *
 * Wired via pluggable corpus: caller supplies async fetcher that returns
 * candidate documents; this module ranks them by contradiction strength.
 *
 * Contradiction scoring (pragmatic, sans LLM):
 *   - negation detector: "X is Y" vs candidate "X is NOT Y" / "X is Z"
 *   - antonym density (small lexicon — extendable)
 *   - numeric inversion: claim 100 vs candidate 1000
 *   - syntactic position match: same subject + opposite predicate
 *
 * Returns ContraRagResult with HMAC-signed candidate list.
 */

import { createHmac } from "node:crypto";
import type { ContraRagCandidate, ContraRagResult } from "./types.js";

// Tiny antonym lexicon — extendable via opts.lexicon
const DEFAULT_ANTONYMS: Array<[string, string]> = [
  ["increase", "decrease"], ["increases", "decreases"], ["up", "down"],
  ["true", "false"], ["correct", "incorrect"], ["safe", "unsafe"],
  ["always", "never"], ["all", "none"], ["yes", "no"],
  ["allowed", "forbidden"], ["approved", "rejected"],
  ["before", "after"], ["positive", "negative"], ["high", "low"],
];

const NEGATION_PATTERNS = [
  /\bis NOT\b/i, /\bisn'?t\b/i, /\bdoes NOT\b/i, /\bdoesn'?t\b/i,
  /\bcannot\b/i, /\bnever\b/i, /\bno\b/i, /\bno longer\b/i, /\bfalse\b/i,
];

const NUMBER_RE = /\d+(?:\.\d+)?/g;

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(Boolean);
}

function jaccardOverlap(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  return inter / new Set([...sa, ...sb]).size;
}

function numericInversion(claim: string, candidate: string): number {
  const cn = (claim.match(NUMBER_RE) ?? []).map(Number);
  const dn = (candidate.match(NUMBER_RE) ?? []).map(Number);
  if (cn.length === 0 || dn.length === 0) return 0;
  // If any claim number is >2× away from any candidate number → inversion signal
  for (const c of cn) for (const d of dn) {
    if (c > 0 && d > 0 && (Math.max(c, d) / Math.min(c, d) > 2)) return 0.6;
  }
  return 0;
}

function antonymHit(claim: string, candidate: string, lexicon: Array<[string, string]>): number {
  const c = claim.toLowerCase();
  const d = candidate.toLowerCase();
  for (const [a, b] of lexicon) {
    if ((c.includes(a) && d.includes(b)) || (c.includes(b) && d.includes(a))) return 0.7;
  }
  return 0;
}

function negationHit(claim: string, candidate: string): number {
  const cIsAffirmed = !NEGATION_PATTERNS.some((re) => re.test(claim));
  const dIsNegated = NEGATION_PATTERNS.some((re) => re.test(candidate));
  if (cIsAffirmed && dIsNegated && jaccardOverlap(tokenize(claim), tokenize(candidate)) > 0.2) return 0.5;
  return 0;
}

export function contradictionScore(claim: string, candidate: string, lexicon = DEFAULT_ANTONYMS): number {
  const overlap = jaccardOverlap(tokenize(claim), tokenize(candidate));
  if (overlap < 0.1) return 0;     // unrelated → no contradiction
  const signals = [
    negationHit(claim, candidate),
    antonymHit(claim, candidate, lexicon),
    numericInversion(claim, candidate),
  ];
  return Math.min(1, signals.reduce((a, b) => a + b, 0) * overlap);
}

export interface ContraRagOptions {
  hmacKey: string;
  threshold?: number;             // 0..1 — candidate kept if score ≥ this
  lexicon?: Array<[string, string]>;
  topK?: number;
}

export async function contraRagSearch(
  query: string,
  fetchCandidates: () => Promise<ContraRagCandidate[]>,
  opts: ContraRagOptions,
): Promise<ContraRagResult> {
  const threshold = opts.threshold ?? 0.25;
  const lexicon = opts.lexicon ?? DEFAULT_ANTONYMS;
  const raw = await fetchCandidates();

  const scored: ContraRagCandidate[] = raw.map((c) => ({
    ...c,
    contradictionScore: contradictionScore(query, c.excerpt, lexicon),
  }));

  const filtered = scored
    .filter((c) => c.contradictionScore >= threshold)
    .sort((a, b) => b.contradictionScore - a.contradictionScore)
    .slice(0, opts.topK ?? 10);

  const hmac = createHmac("sha256", opts.hmacKey)
    .update(query + "::" + JSON.stringify(filtered.map((c) => c.docId).sort()))
    .digest("hex").slice(0, 16);

  return {
    query,
    candidates: filtered,
    totalContradictions: filtered.length,
    threshold,
    hmac,
  };
}
