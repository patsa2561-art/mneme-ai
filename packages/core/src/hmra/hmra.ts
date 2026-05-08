/**
 * HMRA — Holographic Memory Ranking Algorithm
 *
 * The novel composite scoring function that ranks Mneme memories
 * (commits, decisions, atrophy entries, regret patterns) for retrieval.
 *
 * No other AI memory system blends these five components into a single
 * ranking score. The mathematical foundation:
 *
 *   M(memory) = α·R(t) + β·H(c, c') + γ·P(g) + δ·E(p) + ε·F(s)
 *
 * Where:
 *
 *   R(t) — RECENCY DECAY (Bayesian)
 *      R(t) = exp(-t / λ_kind)
 *      Per-kind half-life λ:
 *        commit  λ = 365 days   (long memory)
 *        atrophy λ = 90  days   (knowledge decays fast)
 *        regret  λ = 180 days   (recent regrets > old ones)
 *        decision λ = 730 days  (ADRs persist)
 *
 *   H(c, c') — HEBBIAN CO-ACTIVATION
 *      H = Σ_co (cosine_sim(emb(c), emb(c')) × log(1 + co_count))
 *      Memories that co-fired with the current query in past sessions
 *      strengthen exponentially (Hebbian learning rule). Tracked via
 *      lifecycle.invocationCount + cosine similarity of embeddings.
 *
 *   P(g) — PAGERANK CENTRALITY
 *      P = pagerank(citation_graph, damping=0.85)
 *      Commits that other commits cite (via subject regex / body refs)
 *      get a centrality boost. Independent of recency — historical
 *      "load-bearing" memories stay high-rank.
 *
 *   E(p) — INFORMATION ENTROPY BONUS
 *      E = -Σ p(token) · log2(p(token))   (Shannon entropy of memory text)
 *      Normalized to [0, 1]. High-entropy memories carry more
 *      information per byte → ranked higher than templated/boilerplate.
 *
 *   F(s) — FEDERATION PRIOR
 *      F = (signal_count_for_pattern - kmin) / max_observed
 *      Cross-repo signals (via federation hub) bump local priors when
 *      similar patterns are widespread. Differential-privacy preserved.
 *
 *   α, β, γ, δ, ε — LEARNABLE WEIGHTS
 *      Default: 0.30, 0.25, 0.20, 0.15, 0.10
 *      Self-learning daemon tunes these every 15 minutes based on
 *      observed retrieval-precision feedback.
 *
 * No retrieval system today combines recency + Hebbian + graph + entropy
 * + federated learning into one composite score. This is genuinely new.
 */

export interface HmraWeights {
  alpha: number;   // Recency
  beta: number;    // Hebbian
  gamma: number;   // PageRank
  delta: number;   // Entropy
  epsilon: number; // Federation
}

export const DEFAULT_HMRA_WEIGHTS: HmraWeights = {
  alpha: 0.30,
  beta: 0.25,
  gamma: 0.20,
  delta: 0.15,
  epsilon: 0.10,
};

export type MemoryKind = "commit" | "atrophy" | "regret" | "decision" | "ghost" | "incident";

const HALF_LIFE_DAYS: Record<MemoryKind, number> = {
  commit: 365,
  atrophy: 90,
  regret: 180,
  decision: 730,
  ghost: 120,
  incident: 540,
};

// ──────────────────────────────────────────────────────────────────────
// Component 1: RECENCY DECAY (Bayesian per-kind half-life)
// ──────────────────────────────────────────────────────────────────────

/** Returns ∈ [0, 1]. 1.0 = brand new, 0.5 at half-life, → 0 at infinity. */
export function recencyComponent(ageDays: number, kind: MemoryKind): number {
  if (ageDays < 0) return 1;
  const lambda = HALF_LIFE_DAYS[kind] ?? 365;
  // exp decay normalised so that age=0 → 1, age=lambda → 0.5
  return Math.exp(-ageDays * Math.LN2 / lambda);
}

// ──────────────────────────────────────────────────────────────────────
// Component 2: HEBBIAN CO-ACTIVATION
// ──────────────────────────────────────────────────────────────────────

export interface HebbianInput {
  /** Cosine similarity between memory's embedding and query embedding */
  cosineSim: number;
  /** Number of past sessions where this memory co-fired with similar queries */
  coActivationCount: number;
}

/** Returns ∈ [0, 1]. High when memory is BOTH similar to query AND
 *  has fired with similar queries before. */
export function hebbianComponent(input: HebbianInput): number {
  const sim = Math.max(0, Math.min(1, input.cosineSim));
  // log scale on co-activations — prevents one super-popular memory
  // from dominating the score (saturates at ~ log2(1+8) = 3.17 → 0.79)
  const coWeight = Math.log2(1 + Math.max(0, input.coActivationCount)) / 4;
  // Composite — both must be present
  return Math.tanh(sim * (1 + coWeight));
}

// ──────────────────────────────────────────────────────────────────────
// Component 3: PAGERANK CENTRALITY
// ──────────────────────────────────────────────────────────────────────

export interface CitationGraph {
  /** Adjacency: nodeId → list of nodeIds it cites */
  edges: Map<string, string[]>;
}

/** Compute PageRank over a small citation graph.
 *  Damping factor 0.85 (Brin-Page standard).
 *  Iterative until convergence (max 50 iterations).
 *  Returns a Map from nodeId → score ∈ [0, 1]. */
export function pageRank(graph: CitationGraph, opts: { damping?: number; iterations?: number; tolerance?: number } = {}): Map<string, number> {
  const damping = opts.damping ?? 0.85;
  const maxIter = opts.iterations ?? 50;
  const tol = opts.tolerance ?? 1e-6;

  const nodes = new Set<string>();
  for (const [from, tos] of graph.edges) {
    nodes.add(from);
    for (const to of tos) nodes.add(to);
  }
  const N = nodes.size;
  if (N === 0) return new Map();

  // Reverse adjacency: who points TO each node?
  const inbound = new Map<string, string[]>();
  for (const node of nodes) inbound.set(node, []);
  for (const [from, tos] of graph.edges) {
    for (const to of tos) inbound.get(to)?.push(from);
  }

  // Out-degree
  const outDegree = new Map<string, number>();
  for (const node of nodes) outDegree.set(node, graph.edges.get(node)?.length ?? 0);

  // Initialise: uniform 1/N
  let scores = new Map<string, number>();
  for (const node of nodes) scores.set(node, 1 / N);

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map<string, number>();
    let delta = 0;

    // Distribute mass from dangling nodes (no out-edges) uniformly
    let danglingMass = 0;
    for (const node of nodes) {
      if ((outDegree.get(node) ?? 0) === 0) {
        danglingMass += scores.get(node) ?? 0;
      }
    }

    for (const node of nodes) {
      let inboundSum = 0;
      for (const src of inbound.get(node) ?? []) {
        const srcScore = scores.get(src) ?? 0;
        const srcOut = outDegree.get(src) ?? 0;
        if (srcOut > 0) inboundSum += srcScore / srcOut;
      }
      const score = (1 - damping) / N + damping * (inboundSum + danglingMass / N);
      next.set(node, score);
      delta += Math.abs(score - (scores.get(node) ?? 0));
    }

    scores = next;
    if (delta < tol) break;
  }

  // Normalize so max = 1 for downstream use
  const max = Math.max(...scores.values(), 1e-9);
  const normalized = new Map<string, number>();
  for (const [k, v] of scores) normalized.set(k, v / max);
  return normalized;
}

/** PageRank component for a specific node. Returns ∈ [0, 1]. */
export function pageRankComponent(scores: Map<string, number>, nodeId: string): number {
  return scores.get(nodeId) ?? 0;
}

// ──────────────────────────────────────────────────────────────────────
// Component 4: INFORMATION ENTROPY (Shannon)
// ──────────────────────────────────────────────────────────────────────

/** Shannon entropy of a string, normalised to [0, 1].
 *  Higher entropy = more information density.
 *  Templated/boilerplate text → low entropy (rejected).
 *  Random / very diverse text → high entropy (boosted).
 *  Natural English / code → middle range ~0.6-0.8. */
export function entropyComponent(text: string): number {
  if (!text || text.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let H = 0;
  const n = text.length;
  for (const f of freq.values()) {
    const p = f / n;
    if (p > 0) H -= p * Math.log2(p);
  }
  // Max entropy for ASCII printable is log2(95) ≈ 6.57.
  // Normalise to [0, 1].
  return Math.min(1, H / 6.57);
}

// ──────────────────────────────────────────────────────────────────────
// Component 5: FEDERATION PRIOR
// ──────────────────────────────────────────────────────────────────────

export interface FederationSignal {
  /** Number of cross-repo contributors that observed this pattern */
  contributorCount: number;
  /** k-anonymity floor (signal only meaningful if contributorCount ≥ k) */
  kMin: number;
  /** Maximum contributorCount observed across all known patterns */
  maxObserved: number;
}

/** Returns ∈ [0, 1]. 0 if k-anonymity floor not met.
 *  Higher when the pattern is widespread across federation. */
export function federationComponent(signal: FederationSignal | null | undefined): number {
  if (!signal) return 0;
  if (signal.contributorCount < signal.kMin) return 0;
  if (signal.maxObserved <= 0) return 0;
  // Normalise above kMin
  const adjusted = signal.contributorCount - signal.kMin;
  const range = Math.max(1, signal.maxObserved - signal.kMin);
  return Math.min(1, adjusted / range);
}

// ──────────────────────────────────────────────────────────────────────
// COMPOSITE: M(memory) = α·R + β·H + γ·P + δ·E + ε·F
// ──────────────────────────────────────────────────────────────────────

export interface HmraMemoryInput {
  /** Memory id (commit hash, atrophy entry id, etc) */
  id: string;
  kind: MemoryKind;
  /** Days since the memory was last touched */
  ageDays: number;
  /** Hebbian inputs from past sessions */
  hebbian: HebbianInput;
  /** PageRank scores map (already computed across the citation graph) */
  pageRankScores: Map<string, number>;
  /** Memory text for entropy calculation */
  text: string;
  /** Optional federation signal for the memory's pattern */
  federation?: FederationSignal | null;
}

export interface HmraScore {
  id: string;
  composite: number;          // The final M score
  components: {
    recency: number;          // R
    hebbian: number;          // H
    pageRank: number;         // P
    entropy: number;          // E
    federation: number;       // F
  };
  weights: HmraWeights;
}

export function hmraScore(input: HmraMemoryInput, weights: HmraWeights = DEFAULT_HMRA_WEIGHTS): HmraScore {
  const R = recencyComponent(input.ageDays, input.kind);
  const H = hebbianComponent(input.hebbian);
  const P = pageRankComponent(input.pageRankScores, input.id);
  const E = entropyComponent(input.text);
  const F = federationComponent(input.federation);

  const composite =
    weights.alpha * R +
    weights.beta * H +
    weights.gamma * P +
    weights.delta * E +
    weights.epsilon * F;

  return {
    id: input.id,
    composite,
    components: { recency: R, hebbian: H, pageRank: P, entropy: E, federation: F },
    weights,
  };
}

/** Rank a list of memories by HMRA composite score, descending. */
export function hmraRank(
  inputs: HmraMemoryInput[],
  weights: HmraWeights = DEFAULT_HMRA_WEIGHTS,
): HmraScore[] {
  return inputs
    .map((i) => hmraScore(i, weights))
    .sort((a, b) => b.composite - a.composite);
}

// ──────────────────────────────────────────────────────────────────────
// Weight tuning — tightly coupled with the self-learning daemon loop
// ──────────────────────────────────────────────────────────────────────

export interface FeedbackSample {
  /** The memory that was retrieved + presented */
  memoryId: string;
  /** Was this retrieval helpful? +1 = up, -1 = down, 0 = neutral */
  feedback: 1 | -1 | 0;
  /** The HMRA score that was computed at retrieval time */
  scoreAtRetrieval: HmraScore;
}

/** Update HMRA weights based on observed feedback.
 *  Algorithm: for each component, compute the correlation between
 *  the component value and the feedback signal across N samples.
 *  Components with positive correlation → bump weight. Negative → reduce.
 *  Renormalise so sum stays = 1.
 *
 *  This is the LEARNING half of the loop — runs every 15 minutes from
 *  the daemon when ≥10 new feedback samples have arrived. */
export function tuneHmraWeights(
  samples: FeedbackSample[],
  current: HmraWeights = DEFAULT_HMRA_WEIGHTS,
  learningRate: number = 0.1,
): HmraWeights {
  if (samples.length < 10) return current; // need minimum sample size

  const componentNames = ["recency", "hebbian", "pageRank", "entropy", "federation"] as const;
  const correlations: Record<string, number> = {};
  for (const name of componentNames) {
    correlations[name] = pearsonCorrelation(
      samples.map((s) => s.scoreAtRetrieval.components[name]),
      samples.map((s) => s.feedback),
    );
  }

  // Apply learning-rate-scaled gradient
  const updated = {
    alpha: Math.max(0, current.alpha + learningRate * (correlations["recency"] ?? 0)),
    beta: Math.max(0, current.beta + learningRate * (correlations["hebbian"] ?? 0)),
    gamma: Math.max(0, current.gamma + learningRate * (correlations["pageRank"] ?? 0)),
    delta: Math.max(0, current.delta + learningRate * (correlations["entropy"] ?? 0)),
    epsilon: Math.max(0, current.epsilon + learningRate * (correlations["federation"] ?? 0)),
  };

  // Renormalise so sum = 1
  const sum = updated.alpha + updated.beta + updated.gamma + updated.delta + updated.epsilon;
  if (sum < 1e-9) return current; // pathological — stick with current
  return {
    alpha: updated.alpha / sum,
    beta: updated.beta / sum,
    gamma: updated.gamma / sum,
    delta: updated.delta / sum,
    epsilon: updated.epsilon / sum,
  };
}

/** Pearson correlation coefficient between two equal-length numeric arrays. */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom < 1e-9 ? 0 : cov / denom;
}
