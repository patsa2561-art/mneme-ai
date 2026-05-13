/**
 * v1.99.0 -- FLASH INTELLIGENCE · the master function
 *
 * The ONE function AI agents call before stating a factual claim:
 *
 *   const r = runFlash({ claim, context: rawImageText, hallucinationFactor })
 *
 * Stacks:
 *   1. GROUNDING        — classify source context (seller listing vs auction record)
 *   2. VERACITY         — compute V_eff = Σ(E·W)/ln(H+e) × Φ_qx
 *   3. DEVIL'S ADVOCATE — Recursive Self-Verification; downgrade if refutation pressure > 0.10
 *
 * AI agent then uses `r.template` as the START of its reply (so the user
 * gets the FLASH-grade answer, not the surface-text hallucination).
 *
 * The whole stack is HMAC-loggable so users can audit which claims
 * passed the V_eff filter and which were downgraded.
 *
 *   "Not trained to be skeptical. Engineered to be."
 */

import { computeVeracity, templateForVerdict, type EvidenceItem, type VeracityResult, type ClaimVerdict } from "./veracity.js";
import { runDevilsAdvocate, type DevilsAdvocateResult } from "./devils_advocate.js";
import { groundClaim, type GroundingResult } from "./grounding.js";

export interface FlashInput {
  /** The factual claim under evaluation. */
  claim: string;
  /** Raw text in the user's input (image OCR result, paste, caption, ...). */
  contextText: string;
  /** Optional additional evidence items the AI has gathered. */
  additionalEvidence?: readonly EvidenceItem[];
  /** Base hallucination factor (0 if you're confident; 1 if you're guessing). */
  baseHallucinationFactor?: number;
  /** User's Φ_qx paranoia multiplier. Default 1.0; recommend 2.0 for commerce. */
  phi_qx?: number;
}

export interface FlashResult {
  claim: string;
  grounding: GroundingResult;
  veracity: VeracityResult;
  devilsAdvocate: DevilsAdvocateResult;
  /** Final verdict considering grounding + veracity + devil's advocate. */
  verdict: ClaimVerdict;
  /** Suggested first line of the AI's reply. */
  template: string;
  /** Full one-line pulse summary. */
  pulseLine: string;
}

/** The master FLASH call. Pure function. Same input → same verdict. */
export function runFlash(input: FlashInput): FlashResult {
  // 1) Ground the source context
  const grounding = groundClaim(input.contextText);

  // 2) Compose evidence: start with the grounding inference + any additional
  //    evidence the caller provided.
  const groundingEvidence: EvidenceItem = {
    fact: input.contextText.slice(0, 240),
    supportStrength: grounding.rarityClaims.length > 0 ? 0.8 : 0.3,
    sourceWeight: grounding.suggestedSourceWeight,
    sourceKind: grounding.sourceKind,
  };
  const evidence: EvidenceItem[] = [groundingEvidence, ...(input.additionalEvidence ?? [])];

  // 3) Compute hallucination factor: base + grounding-suggested add-on
  const H = (input.baseHallucinationFactor ?? 0) + grounding.suggestedHallucinationAddOn;

  // 4) Compute V_eff
  const veracity = computeVeracity({
    claim: input.claim,
    evidence,
    hallucinationFactor: H,
    phi_qx: input.phi_qx,
  });

  // 5) Recursive Self-Verification
  const devilsAdvocate = runDevilsAdvocate({
    claim: input.claim,
    evidence,
    hallucinationFactor: H,
    phi_qx: input.phi_qx,
  });

  // Final verdict = max(downgrade) over the two layers
  const verdict = devilsAdvocate.finalVerdict;
  const template = templateForVerdict(verdict, input.claim);
  const pulseLine = `FLASH · ${verdict} · V_eff=${veracity.V_eff.toFixed(3)} · context=${grounding.context} · refutation-pressure=${devilsAdvocate.topRefutation?.pressure.toFixed(3) ?? "0"}`;

  return {
    claim: input.claim,
    grounding,
    veracity,
    devilsAdvocate,
    verdict,
    template,
    pulseLine,
  };
}
