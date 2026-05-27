/**
 * 🦠 PROTOPLASM — types
 *
 * Live atom embedded in every function. Reports super_quan findings to
 * orchestrator. Orchestrator decides: HEALTHY → crawl-and-learn,
 * BROKEN → wisdom-space root-cause + heal.
 */

export type ProbeOutcome = "healthy" | "warn" | "broken";

/** A single recorded invocation snapshot. */
export interface InvocationSnapshot {
  fnId: string;             // canonical function name + module
  ts: string;               // ISO timestamp
  durationMs: number;
  args: { count: number; shape: string };   // count + structural fingerprint (no values)
  output: { kind: "ok" | "throw"; shape?: string; errorClass?: string };
}

/** Statistical baseline for a single function (rolling). */
export interface FunctionBaseline {
  fnId: string;
  samples: number;
  durationMean: number;
  durationStdev: number;
  errorRate: number;             // 0..1
  argShapeEntropy: number;       // Shannon entropy of arg shapes seen
  outputShapeEntropy: number;
  lastUpdate: string;
}

/** Result of a single super_quan probe run. */
export interface SuperQuanFinding {
  fnId: string;
  at: string;
  outcome: ProbeOutcome;
  zScores: Record<string, number>;        // per-metric z-score vs baseline
  quantumSignals: QuantumSignals;
  rootCauseHints: string[];               // populated by wisdom_space if broken
  evidence: string;                       // plain-English summary
  hmac: string;
  prev: string;
}

/** Quantum-inspired signals (analogues, not literal QM). */
export interface QuantumSignals {
  /** Shannon entropy of output distribution. Low = collapse to single state. High = decoherence. */
  outputEntropy: number;
  /** Chaos-input divergence — how much the function's output varies given structured perturbation. */
  chaosDivergence: number;
  /** Cross-function correlation — does this function's broken state coincide w/ neighbors? */
  neighborCorrelation: number;
  /** Superposition collapse score — proportion of calls that produce typed output vs throw. */
  collapseStability: number;
}

export interface WisdomRootCause {
  fnId: string;
  hypothesis: string;
  upstreamSuspects: string[];        // other fnIds that may have triggered this
  confidence: number;
  proposedHeal: HealAction[];
}

export interface HealAction {
  kind: "retry-with-backoff" | "fallback-to-cached" | "request-supernova-restart" | "raise-truth-gate-block" | "noop";
  rationale: string;
}

export interface CrawlPlan {
  trigger: "healthy-burst" | "scheduled" | "manual";
  fnId: string;
  searchTopics: string[];     // what to learn about
  budgetMs: number;
  estimatedROI: number;       // 0..1
}

export interface ProtoplasmConfig {
  baselineSamplesMin: number;     // # samples before z-score is trusted
  zScoreWarn: number;              // |z| > this → warn
  zScoreBroken: number;            // |z| > this → broken
  ledgerDir: string;               // where to write findings
  hmacKey: string;
  crawlOnHealthyEvery: number;     // every N healthy bursts, trigger crawl
}
