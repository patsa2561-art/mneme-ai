/**
 * G3 — Operons (co-regulated tool clusters).
 *
 * In biology, an operon is a cluster of genes sharing a single promoter
 * and one regulatory protein. Change the regulator → all genes downstream
 * change behavior coordinately.
 *
 * Apply to MCP: an "operon" is a set of tools that share a regulatory
 * gene. When the regulator's level changes, every tool in the operon
 * updates its behavior modifier.
 *
 * Example:
 *   stripe-operon = { regulator: "pci-compliance-level", tools: [
 *     "mneme.stripe.find_pricing_logic",
 *     "mneme.stripe.audit_pii_handlers",
 *     "mneme.stripe.list_webhook_handlers",
 *   ]}
 *
 *   level=high → every tool in the operon requires Constitutional Gate
 *                verify before returning results
 *   level=low  → tools work permissively
 *
 * Pure functions. The "regulator level" is caller-managed state.
 */

export type RegulatorLevel = "off" | "low" | "medium" | "high" | "max";

const LEVEL_ORDINAL: Record<RegulatorLevel, number> = {
  off: 0, low: 1, medium: 2, high: 3, max: 4,
};

export interface BehaviorModifier {
  /** Require Constitutional Gate verification before returning results? */
  requireConstitutionGate: boolean;
  /** Require Ghost-Sniper Verifier in strict mode? */
  requireStrictSniper: boolean;
  /** Trim results below this confidence threshold (0..1). */
  minConfidence: number;
  /** Max results returned. */
  maxResults: number;
  /** Free-form notes for the AI agent (surfaced via wisdom). */
  notes: string[];
}

export interface OperonDefinition {
  /** Stable id (e.g., "stripe-pci"). */
  id: string;
  /** Human label. */
  displayName: string;
  /** Tools whose behavior this operon regulates. */
  toolNames: string[];
  /** Regulator's logical id. */
  regulator: string;
  /** Per-level behavior modifier. */
  perLevel: Record<RegulatorLevel, BehaviorModifier>;
}

export interface OperonRegistry {
  operons: OperonDefinition[];
}

export interface OperonResolution {
  /** Which operon governs this tool, or null if unregulated. */
  operon: OperonDefinition | null;
  /** Current modifier (after level resolution), or null when unregulated. */
  modifier: BehaviorModifier | null;
  /** Effective level. */
  level: RegulatorLevel | null;
}

/**
 * Resolve which operon governs a given tool + what behavior to apply.
 */
export function resolveOperonForTool(
  toolName: string,
  registry: OperonRegistry,
  regulatorLevels: Record<string, RegulatorLevel>,
): OperonResolution {
  for (const op of registry.operons) {
    if (op.toolNames.includes(toolName)) {
      const level = regulatorLevels[op.regulator] ?? "off";
      const modifier = op.perLevel[level] ?? op.perLevel.off ?? null;
      return { operon: op, modifier, level };
    }
  }
  return { operon: null, modifier: null, level: null };
}

/**
 * Set the regulator level for an operon. Returns the new state map.
 * Pure function — caller persists the result.
 */
export function setRegulatorLevel(
  current: Record<string, RegulatorLevel>,
  regulator: string,
  level: RegulatorLevel,
): Record<string, RegulatorLevel> {
  return { ...current, [regulator]: level };
}

/**
 * Cascade — when a regulator changes, return the full list of affected
 * tools + the new modifier each will receive. Useful for observability.
 */
export interface CascadeResult {
  regulator: string;
  fromLevel: RegulatorLevel;
  toLevel: RegulatorLevel;
  affected: Array<{ toolName: string; operonId: string; newModifier: BehaviorModifier }>;
}

export function cascade(
  registry: OperonRegistry,
  regulator: string,
  fromLevel: RegulatorLevel,
  toLevel: RegulatorLevel,
): CascadeResult {
  const affected: CascadeResult["affected"] = [];
  for (const op of registry.operons) {
    if (op.regulator !== regulator) continue;
    const newMod = op.perLevel[toLevel] ?? op.perLevel.off!;
    for (const toolName of op.toolNames) {
      affected.push({ toolName, operonId: op.id, newModifier: newMod });
    }
  }
  affected.sort((a, b) => a.toolName.localeCompare(b.toolName));
  return { regulator, fromLevel, toLevel, affected };
}

/** Compare two RegulatorLevels. Returns -1/0/1. */
export function compareLevels(a: RegulatorLevel, b: RegulatorLevel): number {
  return Math.sign(LEVEL_ORDINAL[a] - LEVEL_ORDINAL[b]);
}

/** A bundled stripe-pci operon factory — useful as a starting template. */
export function stripeBuiltinOperon(): OperonDefinition {
  return {
    id: "stripe-pci",
    displayName: "Stripe — PCI Compliance",
    regulator: "pci-compliance-level",
    toolNames: [
      "mneme.stripe.find_pricing_logic",
      "mneme.stripe.audit_pii_handlers",
      "mneme.stripe.list_webhook_handlers",
    ],
    perLevel: {
      off: {
        requireConstitutionGate: false,
        requireStrictSniper: false,
        minConfidence: 0,
        maxResults: 50,
        notes: ["pci=off — full results, no extra gates"],
      },
      low: {
        requireConstitutionGate: false,
        requireStrictSniper: false,
        minConfidence: 0.3,
        maxResults: 50,
        notes: ["pci=low — minimum confidence floor 0.3"],
      },
      medium: {
        requireConstitutionGate: true,
        requireStrictSniper: false,
        minConfidence: 0.5,
        maxResults: 30,
        notes: ["pci=medium — Constitutional Gate required + min conf 0.5"],
      },
      high: {
        requireConstitutionGate: true,
        requireStrictSniper: true,
        minConfidence: 0.7,
        maxResults: 20,
        notes: [
          "pci=high — Constitutional Gate + Ghost-Sniper strict + min conf 0.7",
          "All results must cite a real commit hash + author + first-commit-introduced",
        ],
      },
      max: {
        requireConstitutionGate: true,
        requireStrictSniper: true,
        minConfidence: 0.85,
        maxResults: 10,
        notes: [
          "pci=max — banking-grade gates + min conf 0.85",
          "Operator manual review required before any tool result reaches AI",
        ],
      },
    },
  };
}
