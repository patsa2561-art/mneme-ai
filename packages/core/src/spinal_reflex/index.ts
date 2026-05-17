/**
 * v2.19.23 — MNEME SPINAL REFLEX (organ #4 of LIMBIC · G3+G4 killer)
 *
 *   "100 functions vs <10 used auto — bug prophet, consequence ledger,
 *    dream cycle, negev token-tax — มีแต่ไม่หมุน. user ต้องคิดเองว่า
 *    จะเรียก tool ไหนเมื่อไหร่."
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.22 REFLEX predicts top-N tools by FREQUENCY only.
 *   First-day users have zero frequency data → predictions are empty →
 *   90 features stay idle until manually invoked.
 *
 *   Fix: BUILTIN RULES ship domain knowledge from day zero. Each rule
 *   matches an event signature and proposes a high-priority follow-up
 *   tool (with confidence). At prediction time, frequency confidence
 *   gets BLENDED with rule confidence so cold-start has actual top-N.
 *
 *   Composes onto v2.19.22 REFLEX (Prediction interface, eventCacheKey)
 *   + v2.19.10 REVERSE-WRAPPER BUILTIN_RULES pattern (proven).
 *
 * Honest scope:
 *   - 8 BUILTIN_RULES ship now; caller can register more.
 *   - Rule confidence is a STATIC PRIOR (0.30..0.80); frequency confidence
 *     is the OBSERVED posterior. Final = blend(prior, posterior).
 *   - When frequency data is rich (>= 5 obs for same event sig),
 *     posterior dominates (weight 0.8); when sparse, prior dominates.
 *   - PURE FUNCTION; deterministic; composes with REFLEX predictor.
 */

const PROTOCOL_VERSION = 1 as const;
const RICH_OBSERVATION_THRESHOLD = 5;
const POSTERIOR_WEIGHT_WHEN_RICH = 0.8;
const POSTERIOR_WEIGHT_WHEN_SPARSE = 0.3;

export type ReflexEventKind = "file_save" | "git_commit" | "terminal_command" | "user_chat" | "tool_call";

export interface BuiltinReflexRule {
  /** Stable id; used for analytics + dedup. */
  id: string;
  /** Event kind this rule fires on. */
  eventKind: ReflexEventKind;
  /** Optional context predicate (e.g., context.command startsWith "git push"). */
  contextPredicate?: (context: Record<string, unknown>) => boolean;
  /** Proposed follow-up tool name. */
  toolName: string;
  /** Default args (template; caller specializes). */
  argsTemplate: Record<string, unknown>;
  /** Prior confidence 0..1 (static; before any observation). */
  priorConfidence: number;
  /** Human reason for the rule. */
  reason: string;
}

/**
 * 8 built-in rules that turn cold-start REFLEX into a useful pre-execution
 * layer from day one. Drawn from common AI-agent workflows on a repo.
 */
export const BUILTIN_RULES: BuiltinReflexRule[] = [
  {
    id: "git_commit_then_why",
    eventKind: "git_commit",
    toolName: "mneme.ask",
    argsTemplate: { question: "what just changed and why" },
    priorConfidence: 0.7,
    reason: "After every commit, agents commonly ask what changed",
  },
  {
    id: "git_commit_then_atrophy",
    eventKind: "git_commit",
    toolName: "mneme.consequence.record",
    argsTemplate: { cmd: "git commit", repoStateBefore: {} },
    priorConfidence: 0.55,
    reason: "Every commit is a data point for CONSEQUENCE ledger",
  },
  {
    id: "file_save_then_ask",
    eventKind: "file_save",
    toolName: "mneme.ask",
    argsTemplate: { question: "is this file consistent with the rest of the repo" },
    priorConfidence: 0.4,
    reason: "Saving a file often precedes a 'is this OK' question",
  },
  {
    id: "file_save_ts_then_premortem",
    eventKind: "file_save",
    contextPredicate: (c) => typeof c["path"] === "string" && /\.(ts|tsx)$/.test(c["path"] as string),
    toolName: "mneme.premortem",
    argsTemplate: { change: "edited TS file" },
    priorConfidence: 0.45,
    reason: "TS edits commonly trigger 'will this regress' inspection",
  },
  {
    id: "terminal_npm_install_then_deps",
    eventKind: "terminal_command",
    contextPredicate: (c) => typeof c["command"] === "string" && (c["command"] as string).startsWith("npm install"),
    toolName: "mneme.deps.oracle",
    argsTemplate: {},
    priorConfidence: 0.6,
    reason: "npm install -> predict dep fate via DEPS ORACLE",
  },
  {
    id: "user_chat_authentic_then_caption_sever",
    eventKind: "user_chat",
    contextPredicate: (c) => {
      const p = String(c["prompt"] ?? "").toLowerCase();
      return p.includes("authentic") || p.includes("real or fake") || p.includes("ตรวจของแท้");
    },
    toolName: "mneme.caption.sever",
    argsTemplate: {},
    priorConfidence: 0.8,
    reason: "Authenticity query on image -> v2.19.18 CAPTION SEVERANCE",
  },
  {
    id: "tool_call_then_proof_attach",
    eventKind: "tool_call",
    toolName: "mneme.proof.attach",
    argsTemplate: {},
    priorConfidence: 0.3,
    reason: "Any tool call may need v2.19.10 PROOF-CARRYING certificate",
  },
  {
    id: "user_chat_what_changed_then_status",
    eventKind: "user_chat",
    contextPredicate: (c) => {
      const p = String(c["prompt"] ?? "").toLowerCase();
      return p.includes("what changed") || p.includes("repo status") || p.includes("มีอะไรใหม่");
    },
    toolName: "mneme.status",
    argsTemplate: {},
    priorConfidence: 0.75,
    reason: "Status query -> mneme status",
  },
];

export interface BlendedPrediction {
  toolName: string;
  argsTemplate: Record<string, unknown>;
  /** Blended confidence (0..1). */
  confidence: number;
  /** Where did the confidence come from? */
  source: "rule_only" | "observation_only" | "blended";
  /** Original prior (rule) confidence; null if no rule matched. */
  priorConfidence: number | null;
  /** Original posterior (frequency) confidence; null if no observations. */
  posteriorConfidence: number | null;
  sampleCount: number;
}

export interface BlendInput {
  eventKind: ReflexEventKind;
  context: Record<string, unknown>;
  /** Frequency-based predictions from v2.19.22 REFLEX. */
  observations: Array<{ toolName: string; argsTemplate: Record<string, unknown>; confidence: number; sampleCount: number }>;
  /** Custom rules; defaults to BUILTIN_RULES. */
  rules?: BuiltinReflexRule[];
  topN?: number;
}

function blendConfidence(prior: number | null, posterior: number | null, sampleCount: number): number {
  if (prior === null && posterior === null) return 0;
  if (prior === null) return posterior!;
  if (posterior === null) return prior;
  const w = sampleCount >= RICH_OBSERVATION_THRESHOLD ? POSTERIOR_WEIGHT_WHEN_RICH : POSTERIOR_WEIGHT_WHEN_SPARSE;
  return w * posterior + (1 - w) * prior;
}

/**
 * Blend built-in rule priors with frequency-observed posteriors.
 * Returns top-N predictions; cold-start works because rules ship priors.
 */
export function blendPredictions(input: BlendInput): BlendedPrediction[] {
  const rules = input.rules ?? BUILTIN_RULES;
  const topN = input.topN ?? 3;
  // Index observations by toolName
  const obsByTool = new Map(input.observations.map((o) => [o.toolName, o]));
  // Filter rules matching event kind + (optional) context predicate
  const matchingRules = rules.filter((r) => {
    if (r.eventKind !== input.eventKind) return false;
    if (r.contextPredicate && !r.contextPredicate(input.context)) return false;
    return true;
  });
  const rulesByTool = new Map(matchingRules.map((r) => [r.toolName, r]));
  // Union the toolNames
  const allTools = new Set<string>([...obsByTool.keys(), ...rulesByTool.keys()]);
  const blended: BlendedPrediction[] = [];
  for (const toolName of allTools) {
    const obs = obsByTool.get(toolName);
    const rule = rulesByTool.get(toolName);
    const prior = rule ? rule.priorConfidence : null;
    const posterior = obs ? obs.confidence : null;
    const sampleCount = obs?.sampleCount ?? 0;
    const confidence = blendConfidence(prior, posterior, sampleCount);
    let source: BlendedPrediction["source"];
    if (rule && obs) source = "blended";
    else if (rule) source = "rule_only";
    else source = "observation_only";
    blended.push({
      toolName,
      argsTemplate: obs?.argsTemplate ?? rule!.argsTemplate,
      confidence,
      source,
      priorConfidence: prior,
      posteriorConfidence: posterior,
      sampleCount,
    });
  }
  return blended
    .sort((a, b) => b.confidence - a.confidence || a.toolName.localeCompare(b.toolName))
    .slice(0, topN);
}

export function formatBlendLine(p: BlendedPrediction): string {
  const conf = (p.confidence * 100).toFixed(0);
  return `⚡ ${p.toolName} · ${conf}% (${p.source}, n=${p.sampleCount})`;
}

export function listBuiltinRules(): BuiltinReflexRule[] {
  return [...BUILTIN_RULES];
}

export const _PROTOCOL_VERSION = PROTOCOL_VERSION;
