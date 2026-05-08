/**
 * Manifest schema for the periodic table — Layer 1-3 of the
 * Element / Atom / Molecule architecture introduced in v0.40.
 *
 * Every primitive in Mneme registers a manifest. The manifest is the
 * contract between the primitive and the rest of the system: input
 * shape, output shape, side-effect class, cost model, and (for atoms +
 * molecules) the list of elements it composes.
 *
 * Why this exists: Mneme has 75 commands. New commands keep being
 * added. Most share the same primitive operations (git.log, embed,
 * cosineSim, regex, AST parse, …). Encoding those primitives once,
 * with manifests, means:
 *
 *   1. AI tools through MCP can discover the periodic table at runtime
 *      and assemble their own queries — no need to memorise a flat
 *      command bag.
 *   2. Cost-aware planning becomes possible — the compiler picks the
 *      cheapest composition for an intent.
 *   3. The system explains itself — `mneme periodic-table` lists
 *      everything humans need to read.
 *   4. Tests validate every primitive against its declared contract
 *      so nothing silently drifts.
 *
 * The metaphor maps to chemistry exactly:
 *   - Element = a single primitive operation (one git command, one
 *               regex match, one vector dot-product).
 *   - Atom    = an element configured with specific parameters.
 *               (git.log{since:'90d'} is one atom; git.log{author:X}
 *               is a different atom of the same element.)
 *   - Molecule = a composition of atoms that delivers a user-visible
 *                capability. Today's commands are molecules.
 *   - Compound = a multi-domain molecule (people + history + security).
 *   - Catalyst = config / model context that shapes a reaction without
 *                being consumed (stack priors, suppressions).
 *   - Reaction = a rule that transforms a molecule (Bayesian filter is
 *                a reaction).
 */

export type Kind = "element" | "atom" | "molecule" | "compound";

/** Type of side-effect a primitive may emit. */
export type SideEffect = "none" | "filesystem" | "network" | "git" | "subprocess";

/** Coarse cost class — mapped to ms_p50 for cost-aware planning. */
export type CostClass = "trivial" | "low" | "medium" | "high" | "io-bound";

export interface CostModel {
  /** Dominant cost source. */
  io: "none" | "subprocess" | "fs" | "cpu" | "network" | "memory";
  /** CPU intensity. */
  cpu: CostClass;
  /** Calibrated p50 latency on a mid-spec laptop with warm cache (ms). */
  msP50: number;
}

/** A JSON-serialisable type label. We don't use a full JSON-schema —
 *  too heavy for our purposes — just a string label that downstream
 *  tooling can render. */
export type TypeLabel = string;

/** Common manifest fields shared by every layer. */
export interface BaseManifest {
  /** Stable id, dot-separated. e.g. "git.log", "embed.text".  */
  id: string;
  /** Layer this primitive sits at. */
  kind: Kind;
  /** Short one-liner shown in `mneme periodic-table`. */
  summary: string;
  /** Long-form description (markdown allowed). */
  description: string;
  /** Input shape — keys are param names, values are TypeLabel strings. */
  inputs: Record<string, TypeLabel>;
  /** Output shape — single TypeLabel for the return value. */
  output: TypeLabel;
  /** Cost model used by the compiler when planning. */
  cost: CostModel;
  /** True when the primitive is a pure function — same input ↦ same output. */
  deterministic: boolean;
  /** Side-effect class (used to gate dry-run / sandbox modes). */
  sideEffect: SideEffect;
  /** Tags used for browsing + LLM intent matching. */
  tags: string[];
  /** Module that exports the implementation, for runtime resolution. */
  modulePath?: string;
  /** Function exported by the module that implements the primitive. */
  exportName?: string;
}

/** Element = base primitive. No `composes` field. */
export interface ElementManifest extends BaseManifest {
  kind: "element";
}

/** Atom = element + bound parameters. References its parent element. */
export interface AtomManifest extends BaseManifest {
  kind: "atom";
  /** Element this atom is a parameterisation of. */
  element: string;
  /** Bound parameters — passed as defaults to the element. */
  bind: Record<string, unknown>;
}

/** Molecule = composition of atoms. */
export interface MoleculeManifest extends BaseManifest {
  kind: "molecule";
  /** Atoms (or other molecules) used, in order of composition. */
  composes: string[];
  /** Optional reaction rules that shape inputs/outputs at runtime. */
  reactions?: string[];
}

/** Compound = cross-domain molecule. */
export interface CompoundManifest extends BaseManifest {
  kind: "compound";
  composes: string[];
  /** Domains spanned. */
  domains: Array<"people" | "history" | "security" | "memory" | "originals">;
}

export type AnyManifest =
  | ElementManifest
  | AtomManifest
  | MoleculeManifest
  | CompoundManifest;

/* ──────────────  Validation  ──────────────────────────────────────── */

/**
 * Validate a manifest. Returns a list of issues (empty when valid). Run
 * by every primitive's test file — drift in id/cost/inputs is caught at
 * test time rather than runtime.
 */
export function validateManifest(m: AnyManifest): string[] {
  const issues: string[] = [];
  if (!m.id || !/^[a-z][a-z0-9.-]*[a-z0-9]$/.test(m.id)) {
    issues.push(`id must be lowercase, dot-separated, [a-z0-9.-]: got "${m.id}"`);
  }
  if (!["element", "atom", "molecule", "compound"].includes(m.kind)) {
    issues.push(`kind must be element|atom|molecule|compound, got "${m.kind}"`);
  }
  if (!m.summary || m.summary.length < 8) {
    issues.push(`summary must be ≥ 8 chars`);
  }
  if (!m.description || m.description.length < 20) {
    issues.push(`description must be ≥ 20 chars`);
  }
  if (m.cost.msP50 < 0 || !Number.isFinite(m.cost.msP50)) {
    issues.push(`cost.msP50 must be a non-negative finite number`);
  }
  if (!Array.isArray(m.tags) || m.tags.length === 0) {
    issues.push(`tags must be a non-empty array`);
  }
  if (m.kind === "atom") {
    const a = m as AtomManifest;
    if (!a.element) issues.push(`atom must reference its parent element`);
  }
  if (m.kind === "molecule" || m.kind === "compound") {
    const x = m as MoleculeManifest | CompoundManifest;
    if (!Array.isArray(x.composes) || x.composes.length === 0) {
      issues.push(`molecule/compound must compose ≥ 1 atom or molecule`);
    }
  }
  return issues;
}

/* ──────────────  Cost class → ms_p50 lookup  ─────────────────────── */

/** Suggested ms_p50 budgets per cost class — for primitives that
 *  haven't been benchmarked yet, this gives a sane default. */
export const COST_BUDGET_MS: Record<CostClass, number> = {
  trivial: 1,
  low: 10,
  medium: 100,
  high: 1000,
  "io-bound": 200,
};
