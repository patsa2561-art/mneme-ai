/**
 * v2.29.0 — Vendor adapter contract.
 *
 * Each adapter takes ONE claim variant + returns ONE VendorVerdict.
 * Adapters are pure-IO: no shared state, no global config. The
 * orchestrator runs them in parallel.
 *
 * Real adapters speak HTTP to the vendor; mock adapter returns
 * deterministic verdicts for tests. Auth via env vars (e.g.
 * ANTHROPIC_API_KEY / OPENAI_API_KEY / etc).
 */

import type { VendorVerdict, VendorStance } from "../types.js";

export interface VendorAdapter {
  /** Canonical id (e.g. "claude-opus-4.7", "gpt-5", "mock"). */
  id: string;
  /** True iff the adapter has credentials + can make real network calls. */
  available(): boolean;
  /** Run the claim through the vendor's model + return a structured verdict. */
  run(input: {
    claim: string;
    variantId: string;
    timeoutMs?: number;
  }): Promise<VendorVerdict>;
}

/**
 * Parse a vendor's free-text reply into a structured stance.
 *
 * Heuristic-first parser; deterministic on the same input. Tries to
 * match obvious affirmative / negative / uncertain phrasings. Vendors
 * that follow the recommended response format ("STANCE: supports |
 * refutes | uncertain") get exact mapping.
 */
export function parseStance(text: string): VendorStance {
  const t = text.trim();
  // 1. Explicit STANCE: header
  const m = /^STANCE\s*[:=]\s*(supports|refutes|uncertain|refuses)/im.exec(t);
  if (m) return m[1]!.toLowerCase() as VendorStance;
  // 2. Refusal/policy phrases
  if (/\b(I can'?t|I cannot|won'?t answer|refuse|policy)\b/i.test(t)) return "refuses";
  // 3. Strong-no phrases
  if (/\b(no,|false|incorrect|not true|refute(d)?|disagree)\b/i.test(t)) return "refutes";
  // 4. Strong-yes phrases
  if (/\b(yes,|true|correct|confirm|agree|support(s|ed)?)\b/i.test(t)) return "supports";
  return "uncertain";
}

/** Extract a vendor-reported confidence number from free text. */
export function parseConfidence(text: string): number {
  // STANCE: ... CONFIDENCE: 0.85
  const m = /CONFIDENCE\s*[:=]\s*([0-9]*\.?[0-9]+)/i.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  // "I am 85% confident" / "with 90% certainty"
  const pct = /(\d{1,3})\s*%\s*(?:confident|certain|sure)/i.exec(text);
  if (pct) return Math.min(1, Math.max(0, Number(pct[1]!) / 100));
  // No signal → 0.5 (uncertain prior)
  return 0.5;
}

/**
 * The CONCLAVE PROMPT TEMPLATE — vendors are instructed to respond in a
 * structured form so parsing is reliable. The prompt is identical
 * across vendors so behavior differences attribute to the model, not
 * to per-vendor prompt engineering.
 */
export const CONCLAVE_PROMPT = `You are one of N independent verifiers. Read the CLAIM below + answer with EXACTLY this format (no preamble, no postamble):

STANCE: <supports | refutes | uncertain | refuses>
CONFIDENCE: <0.0 .. 1.0>
REASONING: <one paragraph, ≤ 3 sentences>

CLAIM: `;
