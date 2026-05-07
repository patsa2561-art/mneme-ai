/**
 * ConstraintPruner — a unified shape for every "pluggable validator" in
 * Mneme. Generalizes the Strategy pattern from KAT-0B's ConstraintPruner
 * trait so that CWE rules, ENFSI verbal-scale checks, anomaly-axis
 * gates, drawdown classifiers, and any future domain validator all share
 * one signature.
 *
 * Why a single trait?
 *   - Composition for free (CompositePruner short-circuits on first reject).
 *   - Uniform `reason` strings flow into stream events ("How to read"
 *     reports in the CLI).
 *   - Testing one validator looks identical to testing another.
 *
 * Generic parameters:
 *   - `C` is the candidate the pruner inspects (a commit, a hypothesis,
 *     a price bar, a CWE finding — whatever the caller is screening).
 *   - `P` is the path/state accumulated from parent decisions, useful
 *     when validity depends on history (e.g. ENFSI: this evidence is
 *     "weakly supports" *given* the previous evidence already labelled
 *     "moderately supports").
 *
 * Verdicts:
 *   - `accept`     — pass; keep the candidate.
 *   - `reject`     — fail; caller decides hard vs. soft via `severity`.
 *   - `uncertain`  — neither pruner has enough info; keep checking with
 *                    later pruners. Composite does NOT short-circuit on
 *                    uncertain — only on reject.
 */

export type PrunerVerdict = "accept" | "reject" | "uncertain";

export interface PruneInput<C, P> {
  /** The candidate to validate. */
  candidate: C;
  /** Path / accumulated state from parent decisions. */
  pathState: P;
}

export interface PruneOutput {
  verdict: PrunerVerdict;
  /** One-line reason — surfaced via stream events for transparency. */
  reason: string;
  /** Severity if "reject" — caller decides if it's hard or soft fail. */
  severity?: "info" | "low" | "medium" | "high" | "critical";
}

export interface ConstraintPruner<C, P> {
  readonly name: string;
  /** What this pruner checks, in plain English (for "How to read" reports). */
  readonly description: string;
  validate(input: PruneInput<C, P>): PruneOutput;
}

/**
 * Compose multiple pruners. Semantics:
 *   - Iterate in order.
 *   - First `reject` short-circuits and is returned (its severity is preserved).
 *   - `uncertain` does NOT short-circuit; we keep evaluating subsequent pruners.
 *   - If any later pruner returns `accept`, that wins (accept beats uncertain).
 *   - If only uncertains were seen (and no reject, no accept), the *last*
 *     uncertain is returned — its reason is usually the most informative.
 *
 * Empty composite: returns `accept` with reason "no pruners configured".
 */
export class CompositePruner<C, P> implements ConstraintPruner<C, P> {
  readonly name: string;
  readonly description: string;

  constructor(
    private pruners: ConstraintPruner<C, P>[],
    name = "CompositePruner",
  ) {
    this.name = name;
    const childNames = pruners.map((p) => p.name).join(", ") || "none";
    this.description = `Runs each pruner in order, first reject wins. Children: ${childNames}.`;
  }

  validate(input: PruneInput<C, P>): PruneOutput {
    if (this.pruners.length === 0) {
      return { verdict: "accept", reason: "no pruners configured" };
    }

    let sawAccept = false;
    let lastUncertain: PruneOutput | undefined;
    for (const p of this.pruners) {
      const out = p.validate(input);
      if (out.verdict === "reject") {
        return out;
      }
      if (out.verdict === "accept") {
        sawAccept = true;
      } else {
        lastUncertain = out;
      }
    }

    if (sawAccept) {
      return {
        verdict: "accept",
        reason: `all ${this.pruners.length} pruner(s) accepted`,
      };
    }
    // Only uncertains seen.
    return lastUncertain ?? { verdict: "accept", reason: "no verdicts" };
  }
}

/**
 * AlwaysAcceptPruner — never rejects. Useful as a default in tests
 * and as a no-op slot in pruner pipelines that the user can override.
 */
export class AlwaysAcceptPruner<C, P> implements ConstraintPruner<C, P> {
  readonly name = "AlwaysAcceptPruner";
  readonly description = "No-op pruner that accepts every candidate.";

  validate(_input: PruneInput<C, P>): PruneOutput {
    return { verdict: "accept", reason: "no-op accept" };
  }
}
