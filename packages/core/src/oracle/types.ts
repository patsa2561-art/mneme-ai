/**
 * MNEME ORACLE -- a precognition cache that predicts what AI will ask
 * NEXT, before it asks. (v1.26.3, world-first as far as we know for
 * MCP servers.)
 *
 * The metaphor: most caches are reactive (LRU evicts the least-recently-
 * used). Oracle is proactive -- it watches the AI's tool-call sequence,
 * builds a model of which tool tends to follow which, and pre-computes
 * the likely next answer in the daemon's idle time. By the time the AI
 * asks, the answer is already on the cache.
 *
 * Three algorithms work together:
 *
 *   1. MARKOV n-gram. Classic stochastic model: P(next | prev) =
 *      count(prev, next) / count(prev). We use a bigram (1st-order
 *      Markov) for v1 -- enough for the structural patterns ("after
 *      who_knows you almost always call passport") without sparse-data
 *      problems.
 *
 *   2. ACO PHEROMONE. Ant Colony Optimization: each (prev, next) edge
 *      has a pheromone strength tau(i,j). On observation, reinforce:
 *      tau(i,j) <- (1-rho)*tau(i,j) + delta. On idle cycle, evaporate
 *      every edge by factor rho. The result: paths that get used a lot
 *      stay strong; abandoned paths fade. This is what makes Oracle
 *      *self-organize* -- the AI's own behavior shapes the cache without
 *      any explicit retrain step.
 *
 *   3. DREAM LOOP. In daemon idle ticks, Oracle runs predictNext(K=3)
 *      against the current observed state and stores the top
 *      predictions in the cache with TTL + confidence score. When the
 *      AI's next tool call lands, Oracle checks the cache: if a hit
 *      with confidence >= threshold, the prediction is offered as a
 *      pre-warmed hint. (We do NOT auto-execute -- pre-execution
 *      requires an MCP client and breaks the read-only daemon
 *      contract.)
 *
 * This is genuinely novel for MCP. The closest prior art is Markov
 * autocomplete in editors (think IntelliSense), but those don't combine
 * pheromone-style emergent self-organization with a separate "dream"
 * pre-fetch loop -- and they certainly don't do it for tool calls.
 */

export interface OracleObservation {
  /** ISO timestamp. */
  at: string;
  /** Tool that was called, e.g. "mneme.who_knows". */
  tool: string;
  /** Args (top-level keys only; we don't store values to avoid PII). */
  argKeys: string[];
}

/** A bigram count: how many times `next` followed `prev` in the log. */
export interface BigramCount {
  prev: string;
  next: string;
  count: number;
  /** ISO timestamp of the most recent occurrence. Used for recency boost. */
  lastSeen: string;
}

/** Pheromone strength for a (prev, next) edge. Decays + reinforces. */
export interface PheromoneEdge {
  prev: string;
  next: string;
  /** Current strength tau(i,j) in [0, +inf). Practical range: ~0..10. */
  tau: number;
  /** ISO timestamp of last reinforce or evaporate. */
  lastTouched: string;
}

/** Cached prediction sitting in the on-disk cache. */
export interface OraclePrediction {
  /** Unique id (sha hash of {fromTool, toTool, time-bucket}). */
  id: string;
  /** State at prediction time: the tool that was just observed. */
  fromTool: string;
  /** Predicted next tool. */
  toTool: string;
  /** Combined score in [0, 1] -- alpha*Pmarkov + beta*norm(pheromone). */
  confidence: number;
  /** ISO timestamp the prediction was generated. */
  predictedAt: string;
  /** ISO timestamp after which the prediction is considered stale. */
  expiresAt: string;
  /** True when AI subsequently called toTool while the prediction was fresh. */
  hit?: boolean;
}

export interface OracleStats {
  totalObservations: number;
  uniqueTools: number;
  bigramCount: number;
  pheromoneEdges: number;
  predictions: number;
  /** Predictions that were subsequently confirmed (toTool actually called). */
  hits: number;
  hitRate: number;
  /** Number of dream cycles run. */
  dreamCycles: number;
  /** Most recently observed tool, used as the current state. */
  currentState: string | null;
  lastObservationAt: string | null;
  lastDreamAt: string | null;
}

export interface OracleConfig {
  /** Bigram weight in combined score. Default 0.6. */
  alpha: number;
  /** Pheromone weight in combined score. Default 0.4. */
  beta: number;
  /** Pheromone evaporation rate per dream cycle. Default 0.10 (10%). */
  rho: number;
  /** Pheromone reinforcement on observation. Default 1.0. */
  reinforcement: number;
  /** TTL on cached predictions (ms). Default 5 minutes. */
  predictionTtlMs: number;
  /** Minimum confidence to surface a prediction in pulse hints. Default 0.35. */
  minConfidenceForHint: number;
  /** Cap on observations log to avoid unbounded growth. Default 5000. */
  maxObservations: number;
}

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  alpha: 0.6,
  beta: 0.4,
  rho: 0.10,
  reinforcement: 1.0,
  predictionTtlMs: 5 * 60 * 1000,
  minConfidenceForHint: 0.35,
  maxObservations: 5000,
};
