/**
 * v2.22.1 — PHYSICS LATHE.
 *
 * Formal physics-axiom verifier for LLM claims. Given free-text
 * containing quantities + units (e.g. "the rocket needs ~50,000 km/s
 * to reach LEO"), the lathe extracts the numbers, normalises them to
 * SI, and checks against:
 *   1. A list of well-known physical values (LEO velocity, escape
 *      velocity, ISS altitude, delta-v budgets, etc.)
 *   2. A list of axioms (Tsiolkovsky, Kepler, ideal gas,
 *      Stefan-Boltzmann, Newtonian gravity, etc.)
 *
 * Verdict: CONFIRMED | REFUTED | OUT_OF_AXIOM_SET | INSUFFICIENT_DATA
 *
 * No LLM is called. All work is deterministic SAT-style numerics —
 * the verdict is reproducible and auditable.
 *
 * Composes with:
 *   - `mneme.truth.check`     (general claim verifier; lathe extends
 *                              for physics)
 *   - `mneme.chronostasis.*`  (axioms here could become Chronostasis
 *                              crystallised claims in a future
 *                              release)
 *   - `mneme conduct`         (lathe verdict gates verb execution
 *                              when conduct is asked to do something
 *                              physics-bounded)
 */

export { allAxioms, allConstants, allKnownValues, CONSTANTS, KNOWN_VALUES, AXIOMS, type Constant, type Axiom, type KnownValue, type Unit, type SiBase } from "./axioms.js";
export { parseUnit, unitsEqual, formatUnit, type ParsedUnit } from "./units.js";
export { extractQuantities, type ExtractedQuantity } from "./extractor.js";
export { verifyClaim, formatReport, type PhysicsCheckReport, type Verdict, type Hit, type AxiomHit, type KnownValueHit } from "./verifier.js";

import { extractQuantities } from "./extractor.js";
import { verifyClaim, type PhysicsCheckReport } from "./verifier.js";

/** One-shot verifier — extract quantities then check. */
export function physicsCheck(claim: string): PhysicsCheckReport {
  const qs = extractQuantities(claim);
  return verifyClaim(claim, qs);
}
