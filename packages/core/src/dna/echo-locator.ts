/**
 * A4 — Echo-Locator (SONAR for code).
 *
 * For each candidate file, compute a multi-signal "echo signature" — a
 * vector that records how strongly the file resonates with each known
 * signal (regret pattern, decision pattern, tribal-knowledge pattern).
 *
 * Then a query gets its own echo profile, and we match by signature
 * similarity rather than just raw embedding similarity. This catches
 * "files that LOOK like our prior successful pattern" even when surface
 * tokens differ.
 *
 * Pure function. No I/O. Uses F2 (HWC) under the hood.
 */

import { hwc } from "./formulas.js";

export interface EchoSignal {
  /** Stable id (e.g., "regret-12", "decision-7"). */
  id: string;
  /** Embedding vector of the signal/pattern. */
  embedding: number[];
  /** Optional human label. */
  label?: string;
}

export interface EchoSignatureInput {
  /** Embedding of the file (or query) we're profiling. */
  targetEmbedding: number[];
  /** Known signals to project against. */
  signals: EchoSignal[];
  /** Optional Hebbian co-activation per signal id. */
  coActivations?: Record<string, number>;
}

export interface EchoSignature {
  /** Per-signal strength in [0..∞). Cosine × Hebbian boost. */
  strengths: Array<{ id: string; strength: number; label?: string }>;
  /** Strongest signal — handy for "this file echoes regret-3 most strongly". */
  strongest: { id: string; strength: number; label?: string } | null;
}

/**
 * Compute the echo signature of a target embedding against a list of signals.
 * Higher strength = stronger resonance.
 */
export function echoSignature(input: EchoSignatureInput): EchoSignature {
  const strengths: EchoSignature["strengths"] = [];
  for (const sig of input.signals) {
    const co = input.coActivations?.[sig.id] ?? 0;
    const strength = hwc({
      queryEmbedding: input.targetEmbedding,
      codeEmbedding: sig.embedding,
      coActivationCount: co,
    });
    strengths.push({ id: sig.id, strength, label: sig.label });
  }
  // Sort by strength desc for deterministic output
  strengths.sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
  return {
    strengths,
    strongest: strengths.length > 0 ? strengths[0]! : null,
  };
}

export interface EchoMatchInput {
  /** Echo signature of the query (what kind of pattern user wants). */
  querySignature: EchoSignature;
  /** Echo signatures of candidate files keyed by file id. */
  candidates: Array<{ fileId: string; signature: EchoSignature }>;
}

export interface EchoMatch {
  fileId: string;
  /** Cosine similarity between query and candidate signature vectors. */
  similarity: number;
}

/**
 * Match a query against candidates by echo-signature similarity. Returns
 * candidates sorted by descending similarity.
 *
 * Two files with similar regret/decision profiles will score high even
 * if their raw text differs significantly — because they "sound the
 * same" to our SONAR.
 */
export function echoMatch(input: EchoMatchInput): EchoMatch[] {
  const querySigVec = signatureToVector(input.querySignature);
  const out: EchoMatch[] = [];
  for (const c of input.candidates) {
    const candVec = signatureToVector(c.signature);
    const sim = cosine(querySigVec, candVec);
    out.push({ fileId: c.fileId, similarity: sim });
  }
  out.sort((a, b) => b.similarity - a.similarity || a.fileId.localeCompare(b.fileId));
  return out;
}

function signatureToVector(sig: EchoSignature): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sig.strengths) m.set(s.id, s.strength);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, av] of a) {
    na += av * av;
    const bv = b.get(k);
    if (bv !== undefined) dot += av * bv;
  }
  for (const [, bv] of b) nb += bv * bv;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
