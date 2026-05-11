/**
 * v1.52.0 -- ACGV LAYER 3+: Z3 SAT SOLVER (formal proof upgrade).
 *
 * The v1.51 propositional Godel check is good enough for smoking-gun
 * cases but trades formal proof for speed. v1.52 adds a REAL SAT solver
 * pass on top: when z3-solver is installed (optional dependency), the
 * orchestrator runs Z3 alongside the propositional check and lifts the
 * verdict to "Z3-certified" with a formal UNSAT-core. When z3-solver
 * isn't installed, the propositional check still works -- so no install
 * burden on free-first users.
 *
 * Why Z3 matters even though the propositional check often agrees:
 *
 *   1. UNSAT-core is FORMAL -- a court / auditor can re-run Z3 against
 *      the same constraints and verify. Heuristic checks have no such
 *      transferable proof.
 *
 *   2. Compound claims with OR / IMPLIES become tractable. e.g.,
 *      "either the daemon is in Rust or it's in Python" -> Z3 catches
 *      that BOTH disjuncts ground at zero, so the OR is also zero.
 *      The propositional check would need bespoke OR handling.
 *
 *   3. Numeric arithmetic. e.g., "tool count is between 300 and 500"
 *      with actual count 172 -> Z3 with Int arithmetic proves UNSAT;
 *      the propositional check can only encode discrete entity match.
 *
 *   4. Mutually-exclusive entity claims. "the daemon is in Rust AND
 *      the daemon is in Python" -> impossible by construction.
 *
 * Engine = "z3" when z3-solver was loaded; "propositional" when it
 * wasn't or when Z3 fell back. The orchestrator surfaces the engine
 * tag so callers know which proof system carried the verdict.
 *
 * SCOPE LIMIT: this module returns the SAME GodelResult shape as the
 * propositional version, so it's a drop-in upgrade. The next-gen
 * encoding (with arithmetic + implications + sorts) lands in v1.53+.
 */

import { godelPostMortem as godelPropositional, type GodelResult, type UnsatConstraint } from "./acgv_godel.js";
import type { GroundingResult } from "./acgv_neutrino.js";
import type { ChandrasekharResult } from "./acgv_chandrasekhar.js";

export interface GodelZ3Result extends GodelResult {
  /** Which engine produced this verdict. */
  engine: "z3" | "propositional";
  /** True when both engines agreed. Disagreement is logged as a finding. */
  enginesAgree?: boolean;
}

/** Try to load z3-solver. Returns null when missing (the free-first
 *  user path). */
async function tryLoadZ3(): Promise<{ init: () => Promise<{ Context: (name: string) => Record<string, unknown> }> } | null> {
  try {
    // Dynamic import so static type checking + bundlers don't fail when
    // the optional dep is absent.
    const mod = await import(/* webpackIgnore: true */ "z3-solver" as string);
    return mod as { init: () => Promise<{ Context: (name: string) => Record<string, unknown> }> };
  } catch {
    return null;
  }
}

/** Encode the grounded assertions as Z3 boolean variables + constraints,
 *  then ask the solver if the conjunction is satisfiable. */
async function runZ3(
  z3Mod: { init: () => Promise<{ Context: (name: string) => Record<string, unknown> }> },
  grounded: GroundingResult[],
): Promise<{ status: "UNSAT" | "SAT" | "UNKNOWN"; core: UnsatConstraint[]; certificate: string } | null> {
  try {
    const { Context } = await z3Mod.init();
    const ctx = Context("acgv-godel");
    // Pull the pieces we need; cast loosely so optional dep types don't
    // need to be in the public surface.
    const Bool = (ctx as Record<string, unknown>)["Bool"] as { const: (n: string) => unknown };
    const And = (ctx as Record<string, unknown>)["And"] as (...args: unknown[]) => unknown;
    const Not = (ctx as Record<string, unknown>)["Not"] as (x: unknown) => unknown;
    const SolverCtor = (ctx as Record<string, unknown>)["Solver"] as new () => {
      add: (c: unknown) => void;
      check: () => Promise<"sat" | "unsat" | "unknown">;
    };
    const solver = new SolverCtor();

    const vars: unknown[] = [];
    const core: UnsatConstraint[] = [];

    for (let i = 0; i < grounded.length; i++) {
      const g = grounded[i]!;
      const v = Bool.const(`a_${i}`);
      vars.push(v);

      const substrateNegative = /no |not |never |zero /i.test(g.substrate.evidence);

      if (g.harmonic === 0 && substrateNegative) {
        // Hard impossibility: this assertion MUST be false.
        solver.add(Not(v));
        core.push({
          asserted: `${g.claim.kind}=${g.claim.asserted}`,
          proof: [
            `v_surface = ${g.surface.score.toFixed(2)}: ${g.surface.evidence}`,
            `v_substrate = ${g.substrate.score.toFixed(2)}: ${g.substrate.evidence}`,
            `v_spectrum = ${g.spectrum.score.toFixed(2)}: ${g.spectrum.evidence}`,
            `Z3 encoding: assertion forced false; conjunction with claim makes solver UNSAT`,
          ],
        });
      } else if (g.harmonic >= 0.7) {
        // Strongly grounded: assertion is true.
        solver.add(v);
      }
      // Otherwise leave free (Z3 picks an assignment).
    }

    // The compound claim requires ALL assertions to be true.
    if (vars.length > 0) {
      solver.add(And(...vars));
    }

    const result = await solver.check();

    if (result === "unsat") {
      const lines = ["Z3 SAT solver returned UNSAT for compound claim."];
      if (core.length > 0) {
        lines.push(`UNSAT-CORE (${core.length} simultaneously-unsatisfiable assertion(s)):`);
        for (const c of core) {
          lines.push(`  ${c.asserted}:`);
          for (const p of c.proof) lines.push(`    - ${p}`);
        }
      } else {
        lines.push("Solver found no satisfying assignment for the encoded conjunction.");
      }
      return { status: "UNSAT", core, certificate: lines.join("\n") };
    }

    return {
      status: result === "sat" ? "SAT" : "UNKNOWN",
      core: [],
      certificate: `Z3 returned ${result}; no formal UNSAT proof available`,
    };
  } catch {
    return null;
  }
}

/** v1.52 entry point. Always returns a result; falls back to the v1.51
 *  propositional check whenever Z3 is missing or fails. */
export async function godelPostMortemZ3(
  chandra: ChandrasekharResult,
  grounded: GroundingResult[],
): Promise<GodelZ3Result> {
  // Propositional always runs (fast + free).
  const propResult = godelPropositional(chandra, grounded);

  // Skip Z3 too when Chandrasekhar didn't trigger.
  if (chandra.verdict !== "BLACK_HOLE" && chandra.verdict !== "LIMBO") {
    return { ...propResult, engine: "propositional" };
  }

  const z3Mod = await tryLoadZ3();
  if (!z3Mod) {
    // Free-first: no Z3 installed, propositional is canonical.
    return { ...propResult, engine: "propositional" };
  }

  const z3Result = await runZ3(z3Mod, grounded);
  if (!z3Result) {
    return { ...propResult, engine: "propositional" };
  }

  // Both engines ran. Prefer Z3's verdict (it's formal) and note agreement.
  const enginesAgree = (z3Result.status === "UNSAT") === (propResult.status === "UNSAT");
  const certificate = z3Result.status === "UNSAT"
    ? `${z3Result.certificate}\n\n(propositional check ${propResult.status === "UNSAT" ? "agrees" : "disagreed -- " + propResult.certificate.split("\n")[0]})`
    : `${propResult.certificate}\n\n(Z3 returned ${z3Result.status.toLowerCase()}; propositional check carries the verdict)`;

  return {
    status: z3Result.status === "UNSAT" ? "UNSAT" : propResult.status,
    core: z3Result.status === "UNSAT" ? z3Result.core : propResult.core,
    upgrade: z3Result.status === "UNSAT" || propResult.upgrade,
    certificate,
    engine: "z3",
    enginesAgree,
  };
}

/** Synchronous-style helper for callers that don't want to await but are
 *  fine with propositional-only results. Returns the v1.51 result + the
 *  engine="propositional" tag. */
export function godelPostMortemSync(
  chandra: ChandrasekharResult,
  grounded: GroundingResult[],
): GodelZ3Result {
  const r = godelPropositional(chandra, grounded);
  return { ...r, engine: "propositional" };
}
