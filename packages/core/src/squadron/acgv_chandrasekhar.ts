/**
 * v1.51.0 — ACGV LAYER 2: TRUTH CHANDRASEKHAR LIMIT.
 *
 * A claim is treated as a star. The star has:
 *
 *   mass M(C)    = number of distinct factual assertions in the claim
 *   density rho  = sum of harmonic grounding scores / mass
 *
 * Two critical densities, anchored to the golden ratio:
 *
 *   rho_crit_low  = 1 / phi^2  ~= 0.382
 *   rho_crit_high = 1 - rho_crit_low ~= 0.618
 *
 * Verdicts:
 *
 *   rho < rho_crit_low  -> BLACK_HOLE  (claim collapses, auto REFUTE)
 *   rho > rho_crit_high -> FUSION      (claim ignites, SUPPORT with rho as confidence)
 *   in between          -> LIMBO       (REFUSE_VERDICT -- the taboo move)
 *
 * Why the golden ratio: it's the unique number where the inverse-square
 * equals 1 minus itself, the most-irrational "stability point" for ratio
 * chains. Calibrated so claims with grounded-evidence majority pass
 * (rho > 0.618) but claims with a single zero-flavor entity fail
 * (harmonic mean = 0 -> rho = 0 -> BLACK_HOLE).
 *
 * Special-case: claims with ZERO extractable assertions return UNKNOWN_MASS,
 * which the orchestrator handles as "fall through to legacy squadron logic".
 * We don't claim Chandrasekhar verdict on claims we couldn't parse facts from.
 */

import type { GroundingResult } from "./acgv_neutrino.js";

export type ChandrasekharVerdict =
  | "BLACK_HOLE"      // density too low, claim collapses -> auto REFUTE
  | "FUSION"          // density high enough, claim radiates -> SUPPORT
  | "LIMBO"           // between thresholds -> REFUSE_VERDICT
  | "UNKNOWN_MASS";   // no extractable facts -> fall through

export interface ChandrasekharResult {
  verdict: ChandrasekharVerdict;
  mass: number;
  density: number;
  rhoCritLow: number;
  rhoCritHigh: number;
  /** Confidence proxy from density. Black holes get inverse density (high
   *  confidence that this is wrong); fusion gets density; limbo gets a
   *  small positive number (we are not sure). */
  confidence: number;
  /** Per-claim citations of where each assertion landed. */
  citations: Array<{ asserted: string; harmonic: number; verdict: "true" | "false" | "borderline" }>;
  /** Human reasoning. */
  reasoning: string;
}

/** Golden-ratio critical points. Exported so tests can pin to known constants. */
export const PHI = (1 + Math.sqrt(5)) / 2;
export const RHO_CRIT_LOW = 1 / (PHI * PHI);   // ~0.381966...
export const RHO_CRIT_HIGH = 1 - RHO_CRIT_LOW; // ~0.618034...

/** Per-assertion specificity weight. Versions / file paths / function names
 *  are more specific than language claims, so they contribute more mass.
 *  Keeps the score from being gamed by stuffing one specific entity with
 *  several vague ones. */
function specificity(kind: string): number {
  switch (kind) {
    case "version":
    case "file_exists":
    case "function_exists":
      return 1.3;
    case "tool_count":
    case "library_used":
      return 1.1;
    case "language":
      return 1.0;
    default:
      return 1.0;
  }
}

/** Run the Chandrasekhar collapse on a set of grounded claims. */
export function chandrasekharCollapse(grounded: GroundingResult[]): ChandrasekharResult {
  if (grounded.length === 0) {
    return {
      verdict: "UNKNOWN_MASS",
      mass: 0,
      density: 0,
      rhoCritLow: RHO_CRIT_LOW,
      rhoCritHigh: RHO_CRIT_HIGH,
      confidence: 0,
      citations: [],
      reasoning: "no extractable factual assertions; Chandrasekhar yields no verdict",
    };
  }

  // Weighted mass: sum of specificity per assertion.
  const mass = grounded.reduce((acc, g) => acc + specificity(g.claim.kind), 0);
  // Weighted density: sum of (harmonic * specificity) / mass.
  const weightedSum = grounded.reduce(
    (acc, g) => acc + g.harmonic * specificity(g.claim.kind),
    0,
  );
  const density = mass === 0 ? 0 : weightedSum / mass;

  const citations = grounded.map((g) => ({
    asserted: `${g.claim.kind}=${g.claim.asserted}`,
    harmonic: g.harmonic,
    verdict: (g.harmonic === 0 ? "false" : g.harmonic >= RHO_CRIT_HIGH ? "true" : "borderline") as "true" | "false" | "borderline",
  }));

  let verdict: ChandrasekharVerdict;
  let confidence: number;
  let reasoning: string;
  if (density < RHO_CRIT_LOW) {
    verdict = "BLACK_HOLE";
    // The lower the density, the higher our confidence in the refute.
    // density=0 -> confidence ~0.95; density=0.38 -> confidence ~0.5.
    confidence = Math.min(0.99, 0.95 - density);
    const zeroes = grounded.filter((g) => g.harmonic === 0).length;
    reasoning = `density rho=${density.toFixed(3)} below critical rho_crit_low=${RHO_CRIT_LOW.toFixed(3)}; ${zeroes} of ${grounded.length} assertion(s) have zero harmonic grounding -> star collapses into a black-hole refute`;
  } else if (density > RHO_CRIT_HIGH) {
    verdict = "FUSION";
    confidence = density;
    reasoning = `density rho=${density.toFixed(3)} above critical rho_crit_high=${RHO_CRIT_HIGH.toFixed(3)}; claim ignites with grounded evidence on all assertions -> SUPPORT`;
  } else {
    verdict = "LIMBO";
    confidence = 0.3;
    reasoning = `density rho=${density.toFixed(3)} between thresholds [${RHO_CRIT_LOW.toFixed(3)}, ${RHO_CRIT_HIGH.toFixed(3)}]; insufficient signal in either direction -> REFUSE_VERDICT (the taboo move)`;
  }

  return {
    verdict,
    mass,
    density,
    rhoCritLow: RHO_CRIT_LOW,
    rhoCritHigh: RHO_CRIT_HIGH,
    confidence,
    citations,
    reasoning,
  };
}
