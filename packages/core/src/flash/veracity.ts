/**
 * v1.99.0 -- FLASH INTELLIGENCE · Veracity-Velocity Singularity
 *
 *   "[Super rare] CAPCOM Capcom Character Trump Street Fighter Mega Man"
 *
 * The user showed every AI an image where the SELLER wrote "Super rare"
 * directly on the listing. 100% of vanilla AIs scanned the text, believed
 * it, and told the user "yes it's rare." That's hallucination born from
 * conflating marketing claims with empirical evidence.
 *
 * FLASH INTELLIGENCE refuses to do that. It applies the
 * Veracity-Velocity Singularity formula on EVERY claim before answering:
 *
 *                  Σ (E_i × W_i)
 *      V_eff  =  ─────────────────  ×  Φ_qx
 *                  ln(H + e)
 *
 * Where:
 *   E_i  — empirical evidence (auction history, production counts, ...)
 *   W_i  — source weight (verified-third-party > screenshot-text)
 *   H    — hallucination factor (low-entropy guessing penalty)
 *   Φ_qx — user-specific paranoia multiplier (e.g. 2.0 for commercial sources)
 *
 * V_eff thresholds:
 *   ≥ 0.75  → AFFIRM        (claim is well-supported)
 *   ≥ 0.40  → CAUTIOUS      (mixed signal — answer with caveats)
 *   ≥ 0.15  → DOUBTFUL      (marketing-tier claim, refuse to confirm)
 *   <  0.15 → REFUTE        (treat as hallucination bait — DO NOT confirm)
 *
 * Every AI agent installed with Mneme must run V_eff before stating a
 * factual claim. The output is HMAC-loggable so users can audit which
 * claims passed the filter.
 *
 * Pure function. Deterministic. Unit-testable. Same inputs → same V_eff.
 */

export type ClaimVerdict = "AFFIRM" | "CAUTIOUS" | "DOUBTFUL" | "REFUTE";

export interface EvidenceItem {
  /** What the evidence says (free text). */
  fact: string;
  /** 0..1 — how strongly this evidence supports the claim. */
  supportStrength: number;
  /** 0..1 — how trustworthy this source is. */
  sourceWeight: number;
  /** Source category — drives default sourceWeight when caller omits one. */
  sourceKind: "verified-third-party" | "primary-document" | "expert-database" | "user-statement" | "image-OCR" | "seller-listing" | "marketing-copy" | "AI-guess" | "unknown";
  /** Source identifier (URL / fingerprint) for audit. */
  sourceId?: string;
}

/** Default trustworthiness per source kind. Caller may override. */
export const DEFAULT_SOURCE_WEIGHT: Record<EvidenceItem["sourceKind"], number> = {
  "verified-third-party": 0.95,
  "primary-document": 0.90,
  "expert-database": 0.85,
  "user-statement": 0.55,
  "image-OCR": 0.35,
  "seller-listing": 0.20,   // text inside a seller's listing == marketing claim
  "marketing-copy": 0.15,
  "AI-guess": 0.10,
  "unknown": 0.30,
};

export interface VeracityInput {
  /** The claim being evaluated, e.g. "the item is rare". */
  claim: string;
  /** Pieces of evidence considered. */
  evidence: readonly EvidenceItem[];
  /** Hallucination factor 0..∞.
   *   0 = AI grounded its answer in firsthand evidence
   *   1 = AI had to guess from limited input
   *   3+ = AI is just pattern-matching to surface text
   *  Mneme suggests starting at 0 and incrementing per low-quality signal.
   */
  hallucinationFactor: number;
  /** User-specific paranoia multiplier 0..3.
   *   1.0 = neutral
   *   < 1.0 = trusting (e.g. internal docs)
   *   > 1.0 = skeptical (e.g. e-commerce listings — recommended 2.0)
   *  Default 1.0. */
  phi_qx?: number;
}

export interface VeracityResult {
  /** The computed V_eff score 0..∞ (typically 0..1 in practice). */
  V_eff: number;
  verdict: ClaimVerdict;
  /** Why the verdict — for the human + AI agent. */
  reasoning: string;
  /** Numerator = Σ E_i × W_i (informational). */
  weightedSupport: number;
  /** Denominator = ln(H + e) — clamps the hallucination penalty smoothly. */
  hallucinationPenalty: number;
  /** Φ_qx applied. */
  phi_qx: number;
  /** Evidence breakdown — every item with its effective contribution. */
  contributions: Array<{ fact: string; sourceKind: EvidenceItem["sourceKind"]; supportStrength: number; sourceWeight: number; contribution: number }>;
}

/** The Veracity-Velocity Singularity. The single formula every AI agent
 *  installed with Mneme runs before stating a factual claim. */
export function computeVeracity(input: VeracityInput): VeracityResult {
  const phi_qx = input.phi_qx ?? 1.0;
  const E = Math.E;

  const contributions = input.evidence.map((e) => {
    const sw = e.sourceWeight ?? DEFAULT_SOURCE_WEIGHT[e.sourceKind];
    const contribution = e.supportStrength * sw;
    return { fact: e.fact, sourceKind: e.sourceKind, supportStrength: e.supportStrength, sourceWeight: sw, contribution };
  });

  const weightedSupport = contributions.reduce((s, c) => s + c.contribution, 0);
  const hallucinationPenalty = Math.log(Math.max(0, input.hallucinationFactor) + E); // ≥ 1.0 always
  const V_eff = (weightedSupport / hallucinationPenalty) * phi_qx;

  let verdict: ClaimVerdict;
  let reasoning: string;
  if (V_eff >= 0.75) {
    verdict = "AFFIRM";
    reasoning = `weighted support ${weightedSupport.toFixed(3)} / hallucination-penalty ${hallucinationPenalty.toFixed(3)} × Φ_qx=${phi_qx} = V_eff=${V_eff.toFixed(3)} — strongly supported`;
  } else if (V_eff >= 0.40) {
    verdict = "CAUTIOUS";
    reasoning = `V_eff=${V_eff.toFixed(3)} — mixed signal; answer with explicit caveats about source strength`;
  } else if (V_eff >= 0.15) {
    verdict = "DOUBTFUL";
    reasoning = `V_eff=${V_eff.toFixed(3)} — claim is largely a marketing-tier assertion; do NOT confirm as fact`;
  } else {
    verdict = "REFUTE";
    reasoning = `V_eff=${V_eff.toFixed(3)} — hallucination bait; refuse to confirm and request external corroboration`;
  }

  return {
    V_eff,
    verdict,
    reasoning,
    weightedSupport,
    hallucinationPenalty,
    phi_qx,
    contributions,
  };
}

/** Render a one-line pulse summary. */
export function formatVeracityPulseLine(r: VeracityResult): string {
  return `V_eff=${r.V_eff.toFixed(3)} · verdict=${r.verdict} · support=${r.weightedSupport.toFixed(2)} · H-penalty=${r.hallucinationPenalty.toFixed(2)} · Φ_qx=${r.phi_qx}`;
}

/** Render a user-facing response template based on verdict. AI agents
 *  can use these templates as the start of their reply. */
export function templateForVerdict(verdict: ClaimVerdict, claim: string): string {
  switch (verdict) {
    case "AFFIRM":
      return `Verified: ${claim}. Evidence is well-grounded — V_eff above 0.75.`;
    case "CAUTIOUS":
      return `Partially supported: ${claim}. Evidence is mixed — V_eff 0.40-0.75. Treat as tentative; cross-check before acting.`;
    case "DOUBTFUL":
      return `Cannot confirm "${claim}" — the only sources are marketing-tier (seller listing / promotional copy). V_eff below 0.40. I'd need verified-third-party data (auction history, production count, expert database) to confirm.`;
    case "REFUTE":
      return `Refuse to confirm "${claim}" — V_eff below 0.15. The signal is dominated by surface-text guessing. This is the kind of question vanilla AIs hallucinate on. I'm holding the answer until you can point me at external corroboration.`;
  }
}
