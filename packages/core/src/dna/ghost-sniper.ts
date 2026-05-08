/**
 * A8 — Ghost-Sniper Verifier (the strict-mode killer).
 *
 * The hallucination firewall. Any candidate result must clear THREE gates
 * before being returned to the AI agent:
 *
 *   1. AST-EXISTENCE GATE      — symbol/file actually exists in the repo
 *   2. SEMANTIC-MATCH GATE     — embedding similarity ≥ semanticThreshold
 *   3. CONFIDENCE GATE (F7 CC) — Wilson 95% lower bound × Hebbian ≥ confidenceThreshold
 *
 * If a candidate fails ANY gate, it is REJECTED. We do not "show with low
 * confidence." We do not "guess." Empty answer is honest; lying is not.
 *
 * One shot. Ghost sniper.
 *
 * Pure function. Caller pre-fetches AST/file existence + embeddings.
 */

import { cc } from "./formulas.js";

export type GateName = "ast-existence" | "semantic-match" | "confidence";

export interface GhostSniperCandidate {
  /** Stable id. */
  id: string;
  /** Optional file path / symbol the candidate refers to. */
  reference?: string;
  /** AST-existence flag — does the path/symbol actually exist? */
  existsInRepo: boolean;
  /** Cosine similarity between query embedding and candidate embedding. */
  semanticSimilarity: number;
  /** Past success count for this candidate (or pattern). */
  successCount: number;
  /** Past total trials. */
  totalCount: number;
  /** Hebbian co-activation strength between query and candidate. */
  hebbianStrength: number;
  /** Optional context (snippet, line, etc.). */
  meta?: Record<string, unknown>;
}

export interface GhostSniperConfig {
  /** Strict mode: rejected candidates → empty result rather than fallback list. Default: true. */
  strict?: boolean;
  /** Minimum semantic similarity to pass gate 2. Default 0.6. */
  semanticThreshold?: number;
  /** Minimum Compositional Confidence to pass gate 3. Default 0.6. */
  confidenceThreshold?: number;
}

export interface AcceptedResult {
  outcome: "accepted";
  id: string;
  reference?: string;
  /** Final score (CC × semanticSimilarity). */
  score: number;
  /** Computed CC for transparency. */
  confidence: number;
  /** Computed semantic similarity for transparency. */
  semanticSimilarity: number;
  meta?: Record<string, unknown>;
}

export interface RejectedResult {
  outcome: "rejected";
  id: string;
  reference?: string;
  /** Which gate did the candidate fail? */
  failedGate: GateName;
  /** Human reason. */
  reason: string;
  meta?: Record<string, unknown>;
}

export type SniperResult = AcceptedResult | RejectedResult;

export interface GhostSniperOutput {
  /** Accepted candidates only (for the AI to consume). */
  accepted: AcceptedResult[];
  /** Per-candidate decisions (full transparency, including rejections). */
  decisions: SniperResult[];
  /** Aggregate stats. */
  stats: {
    total: number;
    accepted: number;
    rejectedAtAst: number;
    rejectedAtSemantic: number;
    rejectedAtConfidence: number;
  };
}

/**
 * Run the 3-gate verifier on every candidate. Returns:
 *   • accepted[]  — what AI agent should consume
 *   • decisions[] — full transparency (every candidate's verdict)
 *   • stats       — per-gate rejection counts (for audit + bench)
 */
export function ghostSniperVerify(
  candidates: GhostSniperCandidate[],
  config: GhostSniperConfig = {},
): GhostSniperOutput {
  const semThreshold = config.semanticThreshold ?? 0.6;
  const confThreshold = config.confidenceThreshold ?? 0.6;

  const decisions: SniperResult[] = [];
  let rejAst = 0;
  let rejSem = 0;
  let rejConf = 0;

  for (const c of candidates) {
    // Gate 1: AST existence
    if (!c.existsInRepo) {
      rejAst += 1;
      decisions.push({
        outcome: "rejected",
        id: c.id,
        reference: c.reference,
        failedGate: "ast-existence",
        reason: c.reference
          ? `Reference '${c.reference}' does not exist in this repo (likely hallucinated)`
          : "Candidate does not resolve to a real file/symbol in this repo",
        meta: c.meta,
      });
      continue;
    }
    // Gate 2: Semantic match
    if (c.semanticSimilarity < semThreshold) {
      rejSem += 1;
      decisions.push({
        outcome: "rejected",
        id: c.id,
        reference: c.reference,
        failedGate: "semantic-match",
        reason: `Semantic similarity ${c.semanticSimilarity.toFixed(2)} < threshold ${semThreshold}`,
        meta: c.meta,
      });
      continue;
    }
    // Gate 3: Compositional Confidence (Wilson × Hebbian)
    const confidence = cc({
      successCount: c.successCount,
      totalCount: c.totalCount,
      hebbianStrength: c.hebbianStrength,
    });
    // CC can exceed 1 because Hebbian strength is unbounded above 1; threshold is
    // applied to the Wilson lower bound × Hebbian product. Clamp for the comparison
    // by capping Hebbian at 1 for threshold check; preserve raw value in output.
    const wilsonProduct = cc({
      successCount: c.successCount,
      totalCount: c.totalCount,
      hebbianStrength: Math.min(1, c.hebbianStrength),
    });
    if (wilsonProduct < confThreshold) {
      rejConf += 1;
      decisions.push({
        outcome: "rejected",
        id: c.id,
        reference: c.reference,
        failedGate: "confidence",
        reason: `Compositional Confidence ${wilsonProduct.toFixed(2)} < threshold ${confThreshold}`,
        meta: c.meta,
      });
      continue;
    }

    const score = confidence * c.semanticSimilarity;
    decisions.push({
      outcome: "accepted",
      id: c.id,
      reference: c.reference,
      score,
      confidence,
      semanticSimilarity: c.semanticSimilarity,
      meta: c.meta,
    });
  }

  // In strict mode (default), if zero accepted, accepted[] stays empty.
  // In permissive mode, we still return only accepted but the caller can
  // inspect decisions[] for "best rejected" candidates.
  const accepted = decisions
    .filter((d): d is AcceptedResult => d.outcome === "accepted")
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    accepted,
    decisions,
    stats: {
      total: candidates.length,
      accepted: accepted.length,
      rejectedAtAst: rejAst,
      rejectedAtSemantic: rejSem,
      rejectedAtConfidence: rejConf,
    },
  };
}

/**
 * Strict-mode helper: returns the SINGLE highest-confidence accepted result,
 * or null if nothing passed all 3 gates. The "ghost sniper, one-shot" output.
 */
export function snipeOne(
  candidates: GhostSniperCandidate[],
  config: GhostSniperConfig = {},
): AcceptedResult | null {
  const result = ghostSniperVerify(candidates, config);
  return result.accepted[0] ?? null;
}
