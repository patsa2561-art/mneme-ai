/**
 * v1.99.0 -- FLASH · Recursive Self-Verification (Devil's Advocate)
 *
 * Before AI confirms ANY claim, it must spawn a second persona that
 * tries to REFUTE the claim. The refutation candidate set is generated
 * by a deterministic transformer (not the AI itself — the AI would
 * just rationalize). Each refutation is scored against the same
 * evidence pool via Veracity. If any refutation's V_eff exceeds the
 * original claim's V_eff, the original is downgraded.
 *
 * The transformer takes a claim and produces refutation candidates by:
 *   1. Negation         "X is rare"          → "X is common"
 *   2. Source attack    "X is rare"          → "the rarity claim is from a seller"
 *   3. Specificity flip "Super rare"         → "moderately collectible"
 *   4. Burden shift     "X is the best Y"    → "X is one of several Ys"
 *
 * Each candidate gets V_eff'd. The strongest candidate wins. The
 * difference between candidate.V_eff and original.V_eff is the
 * "refutation pressure" — high pressure means the AI should NOT
 * confirm the original claim.
 *
 * Pure function. Deterministic candidates. No LLM in the hot path.
 */

import { computeVeracity, type EvidenceItem, type VeracityResult } from "./veracity.js";

export interface RefutationCandidate {
  text: string;
  /** Which transformation produced it. */
  kind: "negation" | "source-attack" | "specificity-flip" | "burden-shift" | "outlier";
}

const NEGATION_PAIRS: Array<[RegExp, string]> = [
  [/\b(super )?rare\b/i, "common / mass-produced"],
  [/\bbest\b/i, "one of many"],
  [/\bunique\b/i, "one of several similar items"],
  [/\bauthentic\b/i, "unverified / possibly counterfeit"],
  [/\bcollectible\b/i, "ordinary consumer item"],
  [/\boriginal\b/i, "reissue / reproduction"],
  [/\bofficial\b/i, "unauthorized / unofficial"],
  [/\blimited edition\b/i, "standard production"],
  [/\bguaranteed\b/i, "claimed without backing"],
];

const SOURCE_ATTACK_HINTS = [
  "the rarity / value claim originates from the seller's own listing",
  "the descriptor appears as printed text on commercial packaging",
  "the assertion is marketing copy, not third-party verification",
];

const SPECIFICITY_FLIPS: Array<[RegExp, string]> = [
  [/\bsuper rare\b/i, "moderately collectible — short of \"super rare\""],
  [/\bextremely\b/i, "moderately"],
  [/\bvery\b/i, "somewhat"],
  [/\bhighly\b/i, "occasionally"],
];

const BURDEN_SHIFT_HINTS = [
  "the claim shifts the burden of proof — no public auction record was cited",
  "no production-count is given; the descriptor is qualitative",
  "without independent third-party verification this is a self-attestation",
];

/** Generate refutation candidates for a claim. Deterministic — same
 *  input → same candidates. */
export function generateRefutations(claim: string): RefutationCandidate[] {
  const candidates: RefutationCandidate[] = [];

  // Negation: pattern-match on the claim and emit negated form
  for (const [pattern, replacement] of NEGATION_PAIRS) {
    if (pattern.test(claim)) {
      candidates.push({
        text: claim.replace(pattern, replacement),
        kind: "negation",
      });
    }
  }

  // Source attack: emit ALL source-attack refutations (relevant whenever
  // the original claim involved a commercial / promotional source).
  for (const hint of SOURCE_ATTACK_HINTS) {
    candidates.push({ text: hint, kind: "source-attack" });
  }

  // Specificity flip
  for (const [pattern, replacement] of SPECIFICITY_FLIPS) {
    if (pattern.test(claim)) {
      candidates.push({
        text: claim.replace(pattern, replacement),
        kind: "specificity-flip",
      });
    }
  }

  // Burden shift
  for (const hint of BURDEN_SHIFT_HINTS) {
    candidates.push({ text: hint, kind: "burden-shift" });
  }

  // Outlier (always added — null hypothesis)
  candidates.push({
    text: "There is no reliable evidence to evaluate this claim at all.",
    kind: "outlier",
  });

  return candidates;
}

export interface DevilsAdvocateResult {
  originalClaim: string;
  originalVeracity: VeracityResult;
  /** Each refutation + its V_eff against the same evidence pool. */
  refutations: Array<{ candidate: RefutationCandidate; veracity: VeracityResult; pressure: number }>;
  /** Strongest refutation (max V_eff). */
  topRefutation: { candidate: RefutationCandidate; veracity: VeracityResult; pressure: number } | null;
  /** Adjusted final verdict considering devil's-advocate pressure. */
  finalVerdict: VeracityResult["verdict"];
  /** Reason for the adjustment. */
  adjustmentReason: string;
}

export interface DevilsAdvocateInput {
  claim: string;
  evidence: readonly EvidenceItem[];
  hallucinationFactor: number;
  phi_qx?: number;
  /** Optional: provide your own refutation generator (for tests). */
  refutationGenerator?: (claim: string) => RefutationCandidate[];
}

/** Run Recursive Self-Verification. Returns the original verdict plus
 *  adjustment based on refutation pressure. */
export function runDevilsAdvocate(input: DevilsAdvocateInput): DevilsAdvocateResult {
  const originalVeracity = computeVeracity({
    claim: input.claim,
    evidence: input.evidence,
    hallucinationFactor: input.hallucinationFactor,
    phi_qx: input.phi_qx,
  });

  // Refutation evidence: the SAME evidence pool, but each item's
  // supportStrength is INVERTED. If E says "support for rarity = 0.8",
  // then the refutation "support for non-rarity = 0.2". This is the
  // simplest correct flip; callers can override by passing custom
  // evidence into a manual VeracityResult.
  const refutationEvidence: EvidenceItem[] = input.evidence.map((e) => ({
    ...e,
    supportStrength: 1 - e.supportStrength,
  }));

  const gen = input.refutationGenerator ?? generateRefutations;
  const candidates = gen(input.claim);
  const scored = candidates.map((c) => {
    const veracity = computeVeracity({
      claim: c.text,
      evidence: refutationEvidence,
      hallucinationFactor: input.hallucinationFactor,
      phi_qx: input.phi_qx,
    });
    const pressure = veracity.V_eff - originalVeracity.V_eff;
    return { candidate: c, veracity, pressure };
  });

  // Find top (max V_eff) refutation
  let topRefutation: DevilsAdvocateResult["topRefutation"] = null;
  for (const s of scored) {
    if (!topRefutation || s.veracity.V_eff > topRefutation.veracity.V_eff) {
      topRefutation = s;
    }
  }

  // Adjustment: if the top refutation's V_eff > original's V_eff +
  // small margin, downgrade the original verdict by one tier.
  let finalVerdict = originalVeracity.verdict;
  let adjustmentReason = "no refutation exceeds original V_eff — verdict preserved";
  if (topRefutation && topRefutation.pressure > 0.10) {
    // Downgrade ladder
    const ladder: VeracityResult["verdict"][] = ["AFFIRM", "CAUTIOUS", "DOUBTFUL", "REFUTE"];
    const idx = ladder.indexOf(finalVerdict);
    const newIdx = Math.min(ladder.length - 1, idx + 1);
    finalVerdict = ladder[newIdx]!;
    adjustmentReason = `refutation "${topRefutation.candidate.text}" had V_eff=${topRefutation.veracity.V_eff.toFixed(3)} > original ${originalVeracity.V_eff.toFixed(3)} (pressure ${topRefutation.pressure.toFixed(3)}) — downgraded`;
  }

  return {
    originalClaim: input.claim,
    originalVeracity,
    refutations: scored,
    topRefutation,
    finalVerdict,
    adjustmentReason,
  };
}

/** One-line summary for AI agents to relay. */
export function formatDevilsAdvocatePulseLine(r: DevilsAdvocateResult): string {
  const topId = r.topRefutation ? r.topRefutation.candidate.kind : "none";
  const pressure = r.topRefutation ? r.topRefutation.pressure.toFixed(3) : "0";
  return `DEVILS-ADVOCATE · original=${r.originalVeracity.verdict}(${r.originalVeracity.V_eff.toFixed(3)}) · top-refutation=${topId}(pressure=${pressure}) · final=${r.finalVerdict}`;
}
