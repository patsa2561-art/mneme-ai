/**
 * v2.19.33 B2 fix — MNEME TRUTH SENSOR PACK (zero-config defaults that work first-run)
 *
 *   User-audit diagnosis (2026-05-17):
 *   "mneme truth check_multi sensors=0 (no active sensors).
 *    verdict: INCONCLUSIVE · pTrue: 0.5 · sensors: 0.
 *    Root cause: TRUTH KERNEL ออกแบบให้ register sensors แต่ default config มี 0 sensors active.
 *    Wisdom: zero-config means good defaults — ไม่ใช่ 'empty until configured'"
 *
 *   v2.19.33 ships a CANONICAL DEFAULT STACK that any AI agent can wire
 *   into `mneme.truth.check_multi` without having to invent the recipe.
 *
 *   The stack is intentionally PURE METADATA (not executable) because the
 *   real sensors require I/O the kernel deliberately doesn't do:
 *     - inverse_forensics needs the codebase + LLM call
 *     - truth_forensic needs the live MCP catalog
 *     - apoptosis needs file/symbol grep + git history
 *     - bountyVendor needs vendor-API calls
 *
 *   So the recipe tells the CALLER:
 *     1. Which sensors to invoke
 *     2. What MCP tool to invoke each one through
 *     3. What weight to apply
 *     4. What to do if the sensor is unavailable
 *
 *   The CALLER (AI agent / daemon) wires the I/O; the kernel fuses the
 *   results. This stays vendor-neutral + testable + offline-safe.
 *
 *   Plus: `proposeSensorPlan(claim)` filters the stack to the sensors most
 *   relevant for the claim shape (e.g., file-existence claim → apoptosis +
 *   truth_forensic; conceptual claim → inverse_forensics + bountyVendor).
 *
 * Composes onto:
 *   - v2.6  TRUTH KERNEL (consumes Sensor list; fuses verdicts)
 *   - v2.19.15 TRUTH FORENSIC (one of the canonical sensors)
 *   - v2.19.3  INVERSE LLM (one of the canonical sensors)
 *   - v1.65    APOPTOSIS (one of the canonical sensors)
 *
 * Honest scope:
 *   - PURE FUNCTION metadata + planner. No I/O.
 *   - The recipe is the canonical Mneme answer to "what sensors do I run by default?"
 *   - Defensive: empty claim / weird input never throws; returns minimal plan.
 *   - 24/7 safe: 1000 random plans never crash (measured in test suite).
 */

const PROTOCOL_VERSION = 1 as const;

export type ClaimShape =
  | "file_existence"
  | "symbol_existence"
  | "version_claim"
  | "tool_capability"
  | "conceptual"
  | "narrative"
  | "unknown";

export interface SensorRecipe {
  /** Canonical sensor id used by truthKernel.checkTruth. */
  id: string;
  /** What MCP tool the CALLER should invoke to get this sensor's verdict. */
  mcpTool: string;
  /** Suggested weight for log-odds fusion (higher = more authoritative). */
  weight: number;
  /** One-sentence description for the AI agent / user. */
  description: string;
  /** What to feed the MCP tool; placeholder template. */
  inputTemplate: Record<string, string>;
  /** What to do if this sensor is unavailable (e.g., no network). */
  fallbackBehaviour: "skip" | "treat_as_uncertain" | "treat_as_inapplicable";
  /** Which claim shapes this sensor performs best on. */
  bestFor: ClaimShape[];
}

/**
 * The canonical Mneme default sensor stack. Wire these in your `mneme.truth.check_multi`
 * call when you don't have specific reason to pick differently.
 */
const _DEFAULT_PACK_RAW: SensorRecipe[] = [
  {
    id: "truth_forensic",
    mcpTool: "mneme.truth.forensic",
    weight: 1.5,
    description: "🔬 ground claim against live MCP catalog + installed version + file existence (5 sniffers; offline; no LLM cost).",
    inputTemplate: { claim: "<the claim text>" },
    fallbackBehaviour: "skip",
    bestFor: ["file_existence", "symbol_existence", "version_claim", "tool_capability"],
  },
  {
    id: "apoptosis",
    mcpTool: "mneme.apoptosis.detect",
    weight: 1.3,
    description: "🦠 7-oracle adversarial verification (witness + semantic + humility + ...). Detects fabrication where claim names files/symbols/tags.",
    inputTemplate: { claim: "<the claim text>" },
    fallbackBehaviour: "skip",
    bestFor: ["file_existence", "symbol_existence", "narrative"],
  },
  {
    id: "inverse_forensics",
    mcpTool: "mneme.inverse.forensics",
    weight: 1.2,
    description: "🔁 inverse-LLM prompt forensics — flips burden of proof; the claim must SURVIVE every refutation we can think of.",
    inputTemplate: { claim: "<the claim text>" },
    fallbackBehaviour: "treat_as_uncertain",
    bestFor: ["conceptual", "narrative", "tool_capability"],
  },
  {
    id: "bounty_vendor",
    mcpTool: "mneme.boomerang.build_context",
    weight: 0.9,
    description: "🎯 vendor-agnostic cross-AI consensus — surface what other vendors said about similar claims.",
    inputTemplate: { vendor: "claude" },
    fallbackBehaviour: "treat_as_uncertain",
    bestFor: ["conceptual", "narrative"],
  },
  {
    id: "contradictions",
    mcpTool: "mneme.truth.contradictions",
    weight: 1.4,
    description: "🌀 self-contradiction detector (v2.19.31 BUG #2 fix) — claim asserting X AND NOT X = REJECTED.",
    inputTemplate: { claim: "<the claim text>" },
    fallbackBehaviour: "skip",
    bestFor: ["file_existence", "symbol_existence", "tool_capability", "narrative"],
  },
];
export const DEFAULT_SENSOR_PACK: ReadonlyArray<SensorRecipe> = Object.freeze(_DEFAULT_PACK_RAW);

/**
 * Detect the shape of a claim from its text. Pure heuristic; defensive.
 * Returns "unknown" if no signal — caller may still use the full default pack.
 */
export function classifyClaimShape(claim: string): ClaimShape {
  if (typeof claim !== "string" || claim.length === 0) return "unknown";
  const c = claim.toLowerCase();
  if (/(?:^|\s)(?:packages|scripts|tests|src)\/[\w./-]+\.(?:ts|js|json|md)/.test(claim)) return "file_existence";
  if (/\bmneme\.[a-z_]+\.[a-z_]+\b/.test(c)) return "tool_capability";
  if (/\bv?\d+\.\d+\.\d+\b/.test(c)) return "version_claim";
  if (/\b(?:function|class|interface|export(?:s)?|const|let|var)\s+\w+/.test(c)) return "symbol_existence";
  if (/(?:because|therefore|since|implies|means that|in other words)/i.test(c)) return "conceptual";
  if (/(?:we|i|they|the team|the user)\s+(?:want|need|plan|will|would|should)/.test(c)) return "narrative";
  return "unknown";
}

export interface SensorPlan {
  v: typeof PROTOCOL_VERSION;
  claim: string;
  shape: ClaimShape;
  recommendedSensors: SensorRecipe[];
  /** Sensors NOT in the recommendation but available if the caller wants the full stack. */
  optionalSensors: SensorRecipe[];
  /** Human-readable summary: "🛡 4 sensors recommended for file_existence claim". */
  rationale: string;
}

/**
 * Build a recommended sensor plan for a specific claim.
 * If the claim shape is "unknown" or the caller wants the full stack, use
 * `DEFAULT_SENSOR_PACK` directly. Otherwise this filters to high-relevance sensors.
 */
export function proposeSensorPlan(input: { claim: string; full?: boolean }): SensorPlan {
  const claim = typeof input.claim === "string" ? input.claim : "";
  const shape = classifyClaimShape(claim);
  if (input.full || shape === "unknown") {
    return {
      v: PROTOCOL_VERSION,
      claim,
      shape,
      recommendedSensors: DEFAULT_SENSOR_PACK.slice(),
      optionalSensors: [],
      rationale: `🛡 full default stack (${DEFAULT_SENSOR_PACK.length} sensors) — no claim-shape signal detected, or caller requested full stack`,
    };
  }
  const recommended = DEFAULT_SENSOR_PACK.filter((r) => r.bestFor.includes(shape));
  const optional = DEFAULT_SENSOR_PACK.filter((r) => !r.bestFor.includes(shape));
  return {
    v: PROTOCOL_VERSION,
    claim,
    shape,
    recommendedSensors: recommended.length > 0 ? recommended : DEFAULT_SENSOR_PACK.slice(),
    optionalSensors: optional,
    rationale: `🛡 ${recommended.length} sensors recommended for ${shape} claim (optional: ${optional.length})`,
  };
}

/**
 * Render the recipe as the AI-agent-ingestible instruction text used by
 * `mneme.truth.init`. Vendor-neutral; safe to display in clear text.
 */
export function explainDefaultStack(plan: SensorPlan): string {
  const lines: string[] = [];
  lines.push(`# 🛡 Mneme Truth Sensor Pack (default zero-config stack)`);
  lines.push(``);
  lines.push(plan.rationale);
  lines.push(``);
  lines.push(`## Recommended sensors (run these first)`);
  for (const r of plan.recommendedSensors) {
    lines.push(`- **${r.id}** (weight ${r.weight}) — ${r.description}`);
    lines.push(`  - MCP tool: \`${r.mcpTool}\``);
    lines.push(`  - Fallback if unavailable: ${r.fallbackBehaviour}`);
  }
  if (plan.optionalSensors.length > 0) {
    lines.push(``);
    lines.push(`## Optional sensors`);
    for (const r of plan.optionalSensors) {
      lines.push(`- **${r.id}** (weight ${r.weight}) — ${r.description}`);
    }
  }
  lines.push(``);
  lines.push(`## How to wire`);
  lines.push(`1. For each recommended sensor, invoke its MCP tool with the claim`);
  lines.push(`2. Collect { sensor, verdict, confidence, rationale } for each`);
  lines.push(`3. Pass the list to \`mneme.truth.check_multi({ claim, sensors: [...] })\``);
  lines.push(`4. Use the fused verdict (TRUE / FALSE / DISPUTED / INCONCLUSIVE)`);
  return lines.join("\n");
}

/**
 * v2.19.35 R1 fix — 1-step zero-config truth check.
 *
 * Pre-v2.19.35: caller had to manually invoke 5 sensors then re-call
 * mneme.truth.check_multi with the verdicts. v2.19.35 ships an
 * EXECUTABLE PLAN: a self-contained array of (mcpTool, args) calls the
 * AI agent runs in sequence, then a final "fuse" instruction. From the
 * USER perspective it's 1 step ("mneme verify <claim>"); from the AI
 * agent perspective it's a deterministic plan with zero ambiguity.
 *
 * Wisdom: "default = auto, expert = manual" — pre-v2.19.35 required
 * caller to pre-compute everything (manual-only); v2.19.35 auto-plans
 * by default while preserving the expert path for callers who want
 * specific sensors.
 */
export interface AutoCheckStep {
  /** Sequential step number. */
  step: number;
  /** "invoke" — call an MCP tool; "fuse" — final fusion. */
  kind: "invoke" | "fuse";
  /** Tool name for "invoke" steps; "mneme.truth.check_multi" for "fuse". */
  mcpTool: string;
  /** Args to pass to the MCP tool. */
  args: Record<string, unknown>;
  /** Sensor id this step corresponds to (only for "invoke" steps). */
  sensorId?: string;
  /** Fallback behaviour if the call fails. */
  onFailure: "skip" | "treat_as_uncertain" | "treat_as_inapplicable";
}

export interface AutoCheckPlan {
  v: typeof PROTOCOL_VERSION;
  claim: string;
  shape: ClaimShape;
  /** Ordered execution plan: invoke each sensor → then fuse. */
  steps: AutoCheckStep[];
  /** Plain-English rationale shown to the user. */
  rationale: string;
  /** How AI agent collects per-step outputs into the fuse input. */
  collectionRule: string;
}

export function buildAutoCheckPlan(input: {
  claim: string;
  full?: boolean;
}): AutoCheckPlan {
  const plan = proposeSensorPlan({ claim: input.claim, full: input.full });
  const steps: AutoCheckStep[] = [];
  let stepNum = 1;
  for (const sensor of plan.recommendedSensors) {
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sensor.inputTemplate)) {
      args[k] = v === "<the claim text>" ? input.claim : v;
    }
    steps.push({
      step: stepNum++,
      kind: "invoke",
      mcpTool: sensor.mcpTool,
      args,
      sensorId: sensor.id,
      onFailure: sensor.fallbackBehaviour,
    });
  }
  // Final fuse step
  steps.push({
    step: stepNum,
    kind: "fuse",
    mcpTool: "mneme.truth.check_multi",
    args: {
      claim: input.claim,
      // AI agent fills sensors[] from collected outputs of prior steps
      sensors: "<COLLECT_FROM_PRIOR_STEPS>",
    },
    onFailure: "skip",
  });
  return {
    v: PROTOCOL_VERSION,
    claim: input.claim,
    shape: plan.shape,
    steps,
    rationale: `🛡 auto-check plan: ${plan.recommendedSensors.length} sensors then fuse (claim shape: ${plan.shape})`,
    collectionRule:
      "For each 'invoke' step: capture { sensor: sensorId, verdict: tool_output.verdict, confidence: tool_output.confidence, rationale: tool_output.rationale }. " +
      "Build an array of these objects and pass as sensors[] to the final 'fuse' step. " +
      "If an 'invoke' step fails, apply onFailure: skip = omit; treat_as_uncertain = include with verdict='UNCERTAIN' confidence=0; treat_as_inapplicable = include with verdict='INAPPLICABLE' confidence=0.",
  };
}

export interface SensorPackStats {
  totalDefaults: number;
  shapeSpecificMappings: number;
  averageWeight: number;
}

export function computePackStats(pack: ReadonlyArray<SensorRecipe> = DEFAULT_SENSOR_PACK): SensorPackStats {
  const total = pack.length;
  let mappings = 0;
  let weightSum = 0;
  for (const r of pack) {
    mappings += r.bestFor.length;
    weightSum += r.weight;
  }
  return {
    totalDefaults: total,
    shapeSpecificMappings: mappings,
    averageWeight: total > 0 ? Math.round((weightSum / total) * 100) / 100 : 0,
  };
}

export function formatPackLine(s: SensorPackStats): string {
  return `🛡 SENSOR PACK · ${s.totalDefaults} sensors · ${s.shapeSpecificMappings} shape-mappings · avg weight ${s.averageWeight}`;
}

export const TRUTH_SENSOR_PACK_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  DEFAULT_SENSOR_COUNT: DEFAULT_SENSOR_PACK.length,
});
