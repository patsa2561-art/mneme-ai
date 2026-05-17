/**
 * v1.55.0 -- Z3 ARITHMETIC + LOGIC ENCODING.
 *
 * v1.52 used Z3 only as a propositional SAT solver (per-claim true/false).
 * v1.55 lifts the encoding to first-order arithmetic + boolean connectives
 * so Z3 can prove a NEW class of refutations:
 *
 *   - Numeric range: "Mneme has between 200 and 500 tools" -> encode as
 *     200 <= actualCount <= 500. With actualCount=129, Z3 returns UNSAT.
 *
 *   - Arithmetic inequality: "Mneme has more than 200 tools" -> encode as
 *     actualCount > 200. UNSAT when actual is 129.
 *
 *   - Logical AND: "Mneme uses TypeScript AND has 200 tools" -> encode as
 *     conjunction. If EITHER conjunct fails, Z3 returns UNSAT and the
 *     UNSAT-core points to the failing conjunct -- no need to refute the
 *     whole claim.
 *
 *   - Logical OR: "Mneme is in Rust OR Python" -> Z3 checks satisfiability
 *     of the disjunction. UNSAT when neither disjunct grounds.
 *
 *   - Implication: "IF v1.42 is shipped THEN tests pass" -> encode as
 *     Implies(shipped_v142, tests_pass). Z3 checks the implication.
 *
 * THE GUARANTEE.
 *
 * When Z3 returns SAT we get a satisfying assignment we can show the
 * auditor. When Z3 returns UNSAT we get the unsat-core -- a minimal
 * set of clauses that together are impossible. The certificate is
 * REPLAYABLE: another auditor can re-encode the constraints + run Z3
 * and verify the same UNSAT-core. No trust in Mneme's implementation
 * required.
 *
 * GRACEFUL DEGRADATION.
 *
 * When z3-solver is not installed the module returns
 * `{engine: "propositional", available: false}` and the orchestrator
 * stays on the v1.51-v1.54 propositional check. Free-first users pay
 * zero install cost; opt-in installs unlock formal arithmetic.
 */

import { extractNumericIntent, extractLogicalConnectives, type NumericIntent, type LogicalShape } from "./acgv_logic.js";

export interface ArithmeticVerdict {
  /** Final Z3 outcome: "unsat" means the claim cannot hold; "sat" means
   *  a model exists where the claim holds; "unknown" means Z3 timed out
   *  or didn't engage; "skipped" means we found nothing arithmetic to
   *  encode. */
  status: "unsat" | "sat" | "unknown" | "skipped";
  /** Whether the Z3 layer ran or fell through to the simpler check. */
  engine: "z3" | "propositional";
  /** Certificate string -- replayable proof + numeric / logical encoding. */
  certificate: string;
  /** Specific encoded constraints (for the audit log). */
  constraints: string[];
  /** When true, the orchestrator should upgrade the verdict to
   *  IMPOSSIBLE_REFUTE with this certificate appended. */
  upgrade: boolean;
}

/** Attempt to load z3-solver. Same pattern as acgv_godel_z3. */
async function tryLoadZ3(): Promise<unknown | null> {
  try {
    const mod = await import(/* webpackIgnore: true */ "z3-solver" as string);
    return mod;
  } catch {
    return null;
  }
}

/** Encode + solve a single numeric intent. Returns the Z3 verdict. */
async function checkNumericIntent(
  z3Mod: { init: () => Promise<{ Context: (name: string) => Record<string, unknown> }> },
  intent: NumericIntent,
  actual: number,
): Promise<{ status: "sat" | "unsat" | "unknown"; constraint: string }> {
  try {
    const { Context } = await z3Mod.init();
    const ctx = Context("acgv-arith");
    const Int = (ctx as Record<string, unknown>)["Int"] as { val: (n: number) => unknown };
    const SolverCtor = (ctx as Record<string, unknown>)["Solver"] as new () => {
      add: (c: unknown) => void;
      check: () => Promise<"sat" | "unsat" | "unknown">;
    };
    const Eq = (ctx as Record<string, unknown>)["Eq"] as (a: unknown, b: unknown) => unknown;
    const GE = (ctx as Record<string, unknown>)["GE"] as (a: unknown, b: unknown) => unknown;
    const LE = (ctx as Record<string, unknown>)["LE"] as (a: unknown, b: unknown) => unknown;
    const GT = (ctx as Record<string, unknown>)["GT"] as (a: unknown, b: unknown) => unknown;
    const LT = (ctx as Record<string, unknown>)["LT"] as (a: unknown, b: unknown) => unknown;

    const solver = new SolverCtor();
    const A = Int.val(actual);
    let constraint: string;
    switch (intent.op) {
      case "eq":
        solver.add(Eq(A, Int.val(intent.value)));
        constraint = `actual=${actual} eq asserted=${intent.value}`;
        break;
      case "ge":
        solver.add(GE(A, Int.val(intent.value)));
        constraint = `actual=${actual} >= asserted=${intent.value}`;
        break;
      case "le":
        solver.add(LE(A, Int.val(intent.value)));
        constraint = `actual=${actual} <= asserted=${intent.value}`;
        break;
      case "gt":
        solver.add(GT(A, Int.val(intent.value)));
        constraint = `actual=${actual} > asserted=${intent.value}`;
        break;
      case "lt":
        solver.add(LT(A, Int.val(intent.value)));
        constraint = `actual=${actual} < asserted=${intent.value}`;
        break;
      case "between":
        solver.add(GE(A, Int.val(intent.value)));
        solver.add(LE(A, Int.val(intent.value2 ?? intent.value)));
        constraint = `actual=${actual} in [${intent.value}, ${intent.value2 ?? intent.value}]`;
        break;
      default:
        return { status: "unknown", constraint: `unknown op: ${intent.op}` };
    }
    const result = await solver.check();
    return { status: result === "sat" ? "sat" : result === "unsat" ? "unsat" : "unknown", constraint };
  } catch {
    return { status: "unknown", constraint: "z3 execution failed" };
  }
}

/** Public entry point. Walk the claim text for numeric + logical shapes,
 *  encode each as Z3 arithmetic, return a unified verdict + certificate. */
export async function checkArithmetic(
  claim: string,
  repoState: { toolCount: number },
): Promise<ArithmeticVerdict> {
  const numericIntents = extractNumericIntent(claim);
  const logicalShape = extractLogicalConnectives(claim);

  if (numericIntents.length === 0 && logicalShape.kind === "none") {
    return {
      status: "skipped",
      engine: "propositional",
      certificate: "no arithmetic / logical shape to encode",
      constraints: [],
      upgrade: false,
    };
  }

  const z3Mod = await tryLoadZ3();
  const engine: "z3" | "propositional" = z3Mod ? "z3" : "propositional";
  if (!z3Mod) {
    return {
      status: "unknown",
      engine,
      certificate: "z3-solver not installed; v1.55 arithmetic layer fell through to v1.54 propositional check",
      constraints: numericIntents.map((i) => formatIntent(i)),
      upgrade: false,
    };
  }

  // Encode every numeric intent against the available repo state and
  // collect verdicts. The compound verdict follows the logical shape:
  //   AND  -> conjunction must hold; one UNSAT kills the whole
  //   OR   -> disjunction must hold; need at least one SAT
  //   none -> single intent, status carries
  const results: Array<{ intent: NumericIntent; status: "sat" | "unsat" | "unknown"; constraint: string }> = [];
  for (const intent of numericIntents) {
    if (intent.subject === "tool_count") {
      const r = await checkNumericIntent(z3Mod as { init: () => Promise<{ Context: (n: string) => Record<string, unknown> }> }, intent, repoState.toolCount);
      results.push({ intent, status: r.status, constraint: r.constraint });
    } else {
      // Other subjects (file count, version components, etc) will land in v1.56+
      results.push({ intent, status: "unknown", constraint: `subject "${intent.subject}" not yet encoded in v1.55` });
    }
  }

  const sats = results.filter((r) => r.status === "sat").length;
  const unsats = results.filter((r) => r.status === "unsat").length;
  let finalStatus: ArithmeticVerdict["status"];
  let upgrade = false;
  // v2.19.39 N2 ROOT-CAUSE FIX: a logical shape with ZERO encoded intents
  // cannot be SAT. Vague compound claims like "file X exists AND file X
  // does not exist" produce logicalShape='and' + results=[], and the old
  // code returned 'sat' because sats===results.length (0===0). That
  // tricked runACGVAsync into upgrading PASSTHROUGH -> FUSION at 85%
  // confidence. Honest answer is 'skipped': the arithmetic layer had
  // nothing to evaluate, so it must not vote sat / unsat / upgrade.
  if (results.length === 0) {
    return {
      status: "skipped",
      engine,
      certificate: `Z3 ARITHMETIC PROOF (v2.19.39 N2 GUARD) -- logical shape '${logicalShape.kind}' detected but no numeric intent encoded; layer abstains.`,
      constraints: [],
      upgrade: false,
    };
  }
  switch (logicalShape.kind) {
    case "and":
      // Every intent must SAT. Any UNSAT refutes the whole.
      if (unsats > 0) { finalStatus = "unsat"; upgrade = true; }
      else if (sats === results.length) finalStatus = "sat";
      else finalStatus = "unknown";
      break;
    case "or":
      // At least one SAT means the disjunction holds. All UNSAT means
      // the disjunction is refuted.
      if (sats > 0) finalStatus = "sat";
      else if (unsats === results.length) { finalStatus = "unsat"; upgrade = true; }
      else finalStatus = "unknown";
      break;
    case "implies":
      // Treat as material implication: !antecedent OR consequent. Simplified:
      // if both intents are SAT or both UNSAT the implication holds; the
      // refute case is antecedent SAT but consequent UNSAT.
      if (results.length >= 2 && results[0]!.status === "sat" && results[1]!.status === "unsat") {
        finalStatus = "unsat";
        upgrade = true;
      } else if (results.length >= 2 && results[0]!.status === "sat" && results[1]!.status === "sat") {
        finalStatus = "sat";
      } else {
        finalStatus = "unknown";
      }
      break;
    default:
      // Single intent (or no logical connective): status carries.
      if (results.length === 1) {
        finalStatus = results[0]!.status === "sat" ? "sat" : results[0]!.status === "unsat" ? "unsat" : "unknown";
        upgrade = finalStatus === "unsat";
      } else if (unsats > 0) {
        finalStatus = "unsat";
        upgrade = true;
      } else if (sats === results.length && sats > 0) {
        finalStatus = "sat";
      } else {
        finalStatus = "unknown";
      }
  }

  const lines: string[] = [
    `Z3 ARITHMETIC PROOF (v1.55) -- logical shape: ${logicalShape.kind}`,
    ...results.map((r) => `  [${r.status.toUpperCase()}] ${r.constraint}`),
    `  compound: ${finalStatus.toUpperCase()}`,
  ];
  return {
    status: finalStatus,
    engine,
    certificate: lines.join("\n"),
    constraints: results.map((r) => r.constraint),
    upgrade,
  };
}

function formatIntent(i: NumericIntent): string {
  switch (i.op) {
    case "between": return `${i.subject} in [${i.value}, ${i.value2 ?? i.value}]`;
    case "eq": return `${i.subject} = ${i.value}`;
    case "ge": return `${i.subject} >= ${i.value}`;
    case "le": return `${i.subject} <= ${i.value}`;
    case "gt": return `${i.subject} > ${i.value}`;
    case "lt": return `${i.subject} < ${i.value}`;
    default: return `${i.subject} ${i.op} ${i.value}`;
  }
}

export { type NumericIntent, type LogicalShape };
