/**
 * QSAC Tech 3 — Mutation-Test Counterfactual.
 *
 * "Tests pass" is a binary signal. The current cert can't tell whether
 * tests are STRONG (kill mutants) or WEAK (a bare smoke check that an
 * AI can paper over by reverting a return statement). v0.48 adds the
 * missing signal: **mutation testing INVERTED into a trust score**.
 *
 * Procedure
 *   1. The user's tests pass on AI's commit.
 *   2. We apply a small bank of well-defined mutation operators to
 *      AI's diff (bool flip, operator swap, return invert, branch flip).
 *   3. For each mutant, run the test suite once.
 *   4. Mutation score = (mutants killed by tests) / (total mutants).
 *   5. High score → tests genuinely cover this code → "pass" claim
 *      is strongly supported. Low score → tests are weak → "pass" claim
 *      is suspect.
 *
 * The output is a `VerdictDistribution` that gates the test_pass_rate axis.
 *
 * Why no production audit tool does this
 *   - Mutation testing exists (Pitest, Stryker, Mutmut) but is run
 *     manually as a code-quality metric.
 *   - Mneme is the first to fold mutation score into the COMMIT-AUDIT
 *     certificate as a continuous AI-trust signal.
 *
 * Performance
 *   8-16 mutants × parallel test run via the existing concurrency.pmap
 *   helper = ~30 s per commit on a typical small test suite. Acceptable
 *   for CI gate; opt-in (off by default) so users with multi-minute
 *   test suites aren't penalised.
 *
 * Honest scope
 *   v0.48 ships the **mutation-operator library + score function**. The
 *   harness that actually applies + runs the test command is wired in
 *   v0.49 alongside the wisdom drill-through (so the executor + the
 *   reporter ship together). Today the score function is fully unit-
 *   tested with synthetic mutant outcomes.
 */

import { distribution, type VerdictDistribution } from "./superposition.js";

/* ──────────────────────  Mutation operators  ───────────────────────── */

export type MutationOpKind =
  | "negate-equality"        // === ↔ !==
  | "flip-comparison"         // < → >=, etc
  | "invert-boolean"          // true ↔ false
  | "negate-return-bool"      // return true → return false
  | "off-by-one"              // i + 1 → i + 2; i - 1 → i; etc
  | "remove-throw"            // delete `throw new Error(...)`
  | "constant-zero"           // numeric literal → 0
  | "constant-empty-string";  // string literal → ""

export interface Mutator {
  kind: MutationOpKind;
  /** Apply to a single source line; return the mutated line OR undefined if not applicable. */
  apply(line: string): string | undefined;
  /** Short label for reports. */
  label: string;
}

export const MUTATORS: Mutator[] = [
  {
    kind: "negate-equality",
    label: "=== ↔ !==  /  == ↔ !=",
    apply: (line) => {
      const re = /(===|!==|==|!=)/;
      const m = re.exec(line);
      if (!m) return undefined;
      const swap: Record<string, string> = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" };
      return line.replace(re, swap[m[1]!]!);
    },
  },
  {
    kind: "flip-comparison",
    label: "<,<= → >,>= and vice versa",
    apply: (line) => {
      const re = /(>=|<=|<|>)/;
      const m = re.exec(line);
      if (!m) return undefined;
      const swap: Record<string, string> = { ">=": "<=", "<=": ">=", "<": ">", ">": "<" };
      return line.replace(re, swap[m[1]!]!);
    },
  },
  {
    kind: "invert-boolean",
    label: "true ↔ false (literal)",
    apply: (line) => {
      const re = /\b(true|false)\b/;
      const m = re.exec(line);
      if (!m) return undefined;
      return line.replace(re, m[1] === "true" ? "false" : "true");
    },
  },
  {
    kind: "negate-return-bool",
    label: "return true → return false (and vice versa)",
    apply: (line) => {
      if (/\breturn\s+true\b/.test(line)) return line.replace(/\breturn\s+true\b/, "return false");
      if (/\breturn\s+false\b/.test(line)) return line.replace(/\breturn\s+false\b/, "return true");
      return undefined;
    },
  },
  {
    kind: "off-by-one",
    label: "i + 1 → i + 2  /  i - 1 → i + 0",
    apply: (line) => {
      // Add 1 to numeric literals after + or -
      const m = /([+\-])\s*(\d+)/.exec(line);
      if (!m) return undefined;
      const op = m[1]!;
      const n = Number(m[2]!);
      const newN = op === "+" ? n + 1 : Math.max(0, n - 1);
      return line.replace(m[0], `${op} ${newN}`);
    },
  },
  {
    kind: "remove-throw",
    label: "delete a `throw new Error(...)` statement",
    apply: (line) => {
      if (/^\s*throw\s+new\s+\w+/.test(line)) return line.replace(/throw\s+new\s+\w+\([^)]*\);?/, "// throw removed");
      return undefined;
    },
  },
  {
    kind: "constant-zero",
    label: "numeric literal → 0",
    apply: (line) => {
      const re = /\b\d+(\.\d+)?\b/;
      const m = re.exec(line);
      if (!m) return undefined;
      if (m[0] === "0") return undefined; // already zero — would be no-op
      return line.replace(re, "0");
    },
  },
  {
    kind: "constant-empty-string",
    label: "string literal → \"\"",
    apply: (line) => {
      const re = /"[^"]*"|'[^']*'/;
      const m = re.exec(line);
      if (!m) return undefined;
      if (m[0] === '""' || m[0] === "''") return undefined;
      const quote = m[0]!.charAt(0);
      return line.replace(re, `${quote}${quote}`);
    },
  },
];

/* ──────────────────────  Mutant generation  ────────────────────────── */

export interface MutantPlan {
  /** Index into the input lines that this mutant applies to. */
  lineIndex: number;
  /** Original line. */
  original: string;
  /** Mutated line. */
  mutated: string;
  /** Which operator produced this mutant. */
  operator: MutationOpKind;
}

/**
 * Generate up to `cap` mutants from a list of source lines. Selects lines
 * with applicable operators, capped to keep the test budget bounded.
 */
export function planMutants(lines: string[], cap = 16): MutantPlan[] {
  const plans: MutantPlan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*\/\/|^\s*#|^\s*\*/.test(line)) continue;
    for (const m of MUTATORS) {
      const out = m.apply(line);
      if (!out) continue;
      plans.push({ lineIndex: i, original: line, mutated: out, operator: m.kind });
      if (plans.length >= cap) return plans;
    }
  }
  return plans;
}

/* ──────────────────────  Score → distribution  ─────────────────────── */

export interface MutationScoreInput {
  /** Number of mutants generated. */
  totalMutants: number;
  /** Number of mutants whose application caused tests to fail. */
  killedMutants: number;
  /** Test command was actually runnable (had baseline + after passes). */
  haveBaseline: boolean;
}

export interface MutationVerdict {
  distribution: VerdictDistribution;
  /** Mutation score in [0, 1]. -1 when haveBaseline is false. */
  score: number;
  /** Plain-English label: "weak" / "decent" / "strong" / "exceptional" / "n/a". */
  label: "n/a" | "weak" | "decent" | "strong" | "exceptional";
  /** Rationale shown in the wisdom drill-through. */
  rationale: string;
}

/**
 * Map a mutation score to a verdict distribution. Calibration:
 *   - score < 0.4  → mostly fail (tests too weak; "pass" can't be trusted)
 *   - 0.4-0.6      → warn (mediocre coverage)
 *   - 0.6-0.8      → pass (decent)
 *   - >0.8         → strong pass
 */
export function scoreMutationVerdict(input: MutationScoreInput): MutationVerdict {
  if (!input.haveBaseline) {
    return {
      distribution: distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 }),
      score: -1,
      label: "n/a",
      rationale: "no test command available — mutation testing skipped",
    };
  }
  if (input.totalMutants === 0) {
    return {
      distribution: distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 }),
      score: -1,
      label: "n/a",
      rationale: "no applicable mutation operators found in the diff",
    };
  }
  const score = input.killedMutants / input.totalMutants;
  if (score < 0.4) {
    return {
      distribution: distribution({ pass: 0.05, warn: 0.20, fail: 0.70, skipped: 0.05 }),
      score: round3(score),
      label: "weak",
      rationale: `mutation score ${(score * 100).toFixed(0)}% — tests are weak; AI's "pass" claim is not strongly supported`,
    };
  }
  if (score < 0.6) {
    return {
      distribution: distribution({ pass: 0.30, warn: 0.50, fail: 0.15, skipped: 0.05 }),
      score: round3(score),
      label: "decent",
      rationale: `mutation score ${(score * 100).toFixed(0)}% — tests are mediocre; "pass" claim partially supported`,
    };
  }
  if (score < 0.8) {
    return {
      distribution: distribution({ pass: 0.75, warn: 0.18, fail: 0.04, skipped: 0.03 }),
      score: round3(score),
      label: "strong",
      rationale: `mutation score ${(score * 100).toFixed(0)}% — tests are strong; "pass" claim well-supported`,
    };
  }
  return {
    distribution: distribution({ pass: 0.92, warn: 0.06, fail: 0.01, skipped: 0.01 }),
    score: round3(score),
    label: "exceptional",
    rationale: `mutation score ${(score * 100).toFixed(0)}% — exceptional test coverage; AI's "pass" highly trustworthy`,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
