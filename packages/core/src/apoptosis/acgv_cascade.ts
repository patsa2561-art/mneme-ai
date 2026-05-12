/**
 * v1.65.0 -- APOPTOSIS L7: ACGV CASCADE.
 *
 * Fire the full 11-layer ACGV pipeline as the final gate. APOPTOSIS
 * verdict promotes only if ACGV agrees. Conversely, an ACGV REFUTE
 * verdict can short-circuit APOPTOSIS straight to APOPTOTIC.
 *
 * Maps the rich ACGV ladder to APOPTOSIS:
 *   IMPOSSIBLE_REFUTE / AUTO_REFUTE / BLACK_HOLE  -> ALERT
 *   FUSION                                         -> GROUNDED
 *   LIMBO / PASSTHROUGH                            -> INAPPLICABLE
 */

import { runACGV, type ACGVResult } from "../squadron/acgv.js";

export interface ACGVCascadeReport {
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  acgvVerdict: ACGVResult["verdict"];
  acgvConfidence: number;
  caveats: string[];
  summary: string;
  detail: string;
  ms: number;
}

export function acgvCascade(repoRoot: string, claim: string): ACGVCascadeReport {
  const t0 = Date.now();
  let acgv: ACGVResult;
  try {
    acgv = runACGV({ claim, repoRoot, noEmitVaccine: true, noStake: true });
  } catch (e) {
    return {
      verdict: "INAPPLICABLE",
      acgvVerdict: "PASSTHROUGH",
      acgvConfidence: 0,
      caveats: [],
      summary: "(error)",
      detail: `ACGV cascade threw: ${(e as Error).message}`,
      ms: Date.now() - t0,
    };
  }
  let verdict: ACGVCascadeReport["verdict"];
  switch (acgv.verdict) {
    case "IMPOSSIBLE_REFUTE":
    case "AUTO_REFUTE":
    case "BLACK_HOLE":
      verdict = "ALERT";
      break;
    case "FUSION":
      verdict = "GROUNDED";
      break;
    case "LIMBO":
    case "PASSTHROUGH":
    default:
      verdict = "INAPPLICABLE";
      break;
  }
  return {
    verdict,
    acgvVerdict: acgv.verdict,
    acgvConfidence: acgv.confidence,
    caveats: acgv.caveats,
    summary: acgv.summary,
    detail: `ACGV ${acgv.verdict} @ ${(acgv.confidence * 100).toFixed(0)}% -> APOPTOSIS ${verdict}.`,
    ms: Date.now() - t0,
  };
}
