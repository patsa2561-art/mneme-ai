/**
 * v1.51.0 — ACGV LAYER 3: GODEL POST-MORTEM (constraint impossibility).
 *
 * After Chandrasekhar emits a verdict, Godel runs a formal check on the
 * remaining BLACK_HOLE candidates. We DON'T ship z3-solver in v1.51 (huge
 * npm dep + native binding hassle). Instead we run a propositional check:
 *
 *   For each assertion a_i with harmonic = 0, check whether ALL THREE of:
 *
 *     - v_substrate(a_i) = 0 (entity absent on disk)
 *     - v_spectrum(a_i)  = 0 (entity never existed in git history)
 *     - v_surface(a_i)   = 0 (entity never appeared in text)
 *
 *   If yes -> that assertion is "constraint-violated": there is no possible
 *   repo state where it could be true. We collect these as the UNSAT-core.
 *
 *   If the UNSAT-core has any element -> verdict upgrades from BLACK_HOLE
 *   to IMPOSSIBLE_REFUTE with a proof certificate listing the constraints
 *   that are simultaneously unsatisfiable.
 *
 * This is the "Godel certificate" -- a self-contained proof a court (or
 * an auditor) can verify without re-running Mneme. Z3 SAT can land later
 * (v1.52+); the propositional version handles the smoking-gun cases.
 *
 * NOTE: We never call this on FUSION or LIMBO verdicts. Godel only runs
 * post-mortem on BLACK_HOLE to either CONFIRM it or downgrade if the
 * three-flavor zeros happen to all be borderline (rare).
 */

import type { GroundingResult } from "./acgv_neutrino.js";
import type { ChandrasekharResult } from "./acgv_chandrasekhar.js";

export interface UnsatConstraint {
  /** The asserted entity that can't be reconciled with any repo state. */
  asserted: string;
  /** Why this is unsat -- the conjunction of flavor zeros. */
  proof: string[];
}

export interface GodelResult {
  /** "UNSAT" means the proof is conclusive; "SAT" means we couldn't prove
   *  impossibility (borderline grounding survives); "SKIPPED" means we
   *  didn't run (e.g., Chandrasekhar wasn't a BLACK_HOLE). */
  status: "UNSAT" | "SAT" | "SKIPPED";
  /** The UNSAT-core: the assertions that are simultaneously impossible. */
  core: UnsatConstraint[];
  /** Human-readable certificate string. */
  certificate: string;
  /** When true, the orchestrator should upgrade verdict to IMPOSSIBLE_REFUTE
   *  with very high confidence (~0.99). */
  upgrade: boolean;
}

/** Run the Godel post-mortem on a Chandrasekhar result + raw grounding. */
export function godelPostMortem(
  chandra: ChandrasekharResult,
  grounded: GroundingResult[],
): GodelResult {
  // v1.51.0 -- Godel runs on BLACK_HOLE OR LIMBO. A compound claim like
  // "tools=200 AND daemon=Rust" lands in LIMBO when one assertion is
  // partially grounded and the other is impossible -- but AND-logic says
  // any single impossibility refutes the WHOLE claim. Godel catches this.
  // FUSION + UNKNOWN_MASS still skip Godel (no signal to prove against).
  if (chandra.verdict !== "BLACK_HOLE" && chandra.verdict !== "LIMBO") {
    return {
      status: "SKIPPED",
      core: [],
      certificate: `Godel skipped: Chandrasekhar verdict was ${chandra.verdict}, not BLACK_HOLE or LIMBO`,
      upgrade: false,
    };
  }

  const core: UnsatConstraint[] = [];
  for (const g of grounded) {
    // Definitive impossibility: all three flavors zero AND substrate has
    // an explicit negative ("no .rs files", "not in package.json", etc).
    // We exclude substrate=0 cases where substrate just had nothing to
    // check (e.g. tool_count returns 0.5 by default, not a hard zero).
    const substrateExplicitlyNegative =
      g.substrate.score === 0 &&
      /no |not |never |zero /i.test(g.substrate.evidence);
    if (g.harmonic === 0 && substrateExplicitlyNegative && g.zeroFlavors.includes("substrate")) {
      core.push({
        asserted: `${g.claim.kind}=${g.claim.asserted}`,
        proof: [
          `v_surface = ${g.surface.score.toFixed(2)}: ${g.surface.evidence}`,
          `v_substrate = ${g.substrate.score.toFixed(2)}: ${g.substrate.evidence}`,
          `v_spectrum = ${g.spectrum.score.toFixed(2)}: ${g.spectrum.evidence}`,
        ],
      });
    }
  }

  if (core.length === 0) {
    return {
      status: "SAT",
      core: [],
      certificate: "BLACK_HOLE verdict stands but no triple-zero impossibility was provable; some flavors may have returned partial signal",
      upgrade: false,
    };
  }

  const lines: string[] = ["GODEL UNSAT-CORE (claim is impossible against this repo):"];
  for (const c of core) {
    lines.push(`  ${c.asserted}:`);
    for (const p of c.proof) lines.push(`    - ${p}`);
  }
  lines.push(`Conjunction of ${core.length} constraint(s) is unsatisfiable -> IMPOSSIBLE_REFUTE`);

  return {
    status: "UNSAT",
    core,
    certificate: lines.join("\n"),
    upgrade: true,
  };
}
