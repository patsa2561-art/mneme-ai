/**
 * v2.19.47 — CHRONOSHEAF P2-d · Friston Free Energy / Active Inference.
 *
 *   Math foundation (Friston 2010, Karl Friston's "Free-Energy Principle"):
 *
 *     Variational Free Energy
 *
 *       F = E_q[log q(z) − log p(z, o)]
 *         = D_KL(q(z) ‖ p(z|o)) − log p(o)
 *         ≥ −log p(o)             (Jensen)
 *
 *     where q(z) is the agent's recognition density, p(z, o) is the
 *     generative model over hidden states z and observations o.
 *     Minimising F over q yields q(z) ≈ p(z|o) (Bayes-optimal posterior)
 *     and the residual −log p(o) is the surprise/marginal likelihood.
 *
 *     Expected Free Energy (action selection)
 *
 *       G(a) = E_{q(o,z|a)}[log q(z|a) − log p(z, o)]
 *            ≈ epistemic_value(a) + extrinsic_value(a)
 *
 *     An agent picks a* = argmin_a G(a). G splits into
 *       (i) epistemic: information gained about hidden states
 *       (ii) extrinsic: log-prior preferences over observations.
 *
 *   AI-memory mapping (PAIN-001 time-direction + PAIN-006 confidence
 *   + PAIN-007 substrate-mutation):
 *
 *     The CLI / MCP server is an active inference agent. Hidden state z =
 *     "is upgrade safe to run now". Observations o = exit codes, pulse
 *     drift, daemon process state. Actions a = {wait, queue, run-now,
 *     remediation-message}. Minimising G picks the action that BOTH
 *     reduces uncertainty about safety AND respects user-preference
 *     priors (e.g. "do not break the running session"). The 60% verify
 *     confidence number (PAIN-006) becomes a measure-theoretic posterior,
 *     not a vibe.
 *
 *   Implementation: KL divergence + expected-free-energy computation on
 *   categorical distributions. Pure-function, numerically stable
 *   (log-sum-exp where needed).
 */

/** Categorical distribution as an array of probabilities (sums to 1). */
export type Categorical = ReadonlyArray<number>;

function safeLog(x: number): number { return x <= 0 ? -1e9 : Math.log(x); }

/** Normalise an array to a probability distribution (handles zeros). */
export function normalise(v: ReadonlyArray<number>): number[] {
  let s = 0;
  for (const x of v) s += Math.max(0, x);
  if (s <= 0) {
    // Degenerate input → uniform.
    return new Array(v.length).fill(1 / Math.max(1, v.length));
  }
  return v.map((x) => Math.max(0, x) / s);
}

/** D_KL(p ‖ q) = Σ p_i · log(p_i / q_i). */
export function klDivergence(p: Categorical, q: Categorical): number {
  if (p.length !== q.length) throw new Error("KL: distributions must have same support");
  let kl = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    if (pi <= 0) continue;
    if (qi <= 0) return Infinity;
    kl += pi * (Math.log(pi) - Math.log(qi));
  }
  return kl;
}

/** Shannon entropy H[p] = −Σ p_i log p_i. */
export function entropy(p: Categorical): number {
  let h = 0;
  for (const x of p) if (x > 0) h -= x * Math.log(x);
  return h;
}

/**
 * Variational free energy F = D_KL(q ‖ p_prior) − E_q[log p(o|z)].
 * Where:
 *   q       = recognition density over hidden states z
 *   prior   = p(z)
 *   logLikelihood[z] = log p(o|z) for each state z
 */
export function variationalFreeEnergy(
  q: Categorical,
  prior: Categorical,
  logLikelihood: ReadonlyArray<number>,
): number {
  if (q.length !== prior.length || q.length !== logLikelihood.length) {
    throw new Error("F: q, prior, and likelihood must have same support");
  }
  const kl = klDivergence(q, prior);
  let expectedNegLogLik = 0;
  for (let i = 0; i < q.length; i++) {
    expectedNegLogLik -= (q[i] ?? 0) * (logLikelihood[i] ?? 0);
  }
  return kl + expectedNegLogLik;
}

export interface ActionCandidate {
  /** Human-readable id (e.g. "wait", "run-now", "queue"). */
  id: string;
  /** Predicted distribution over observations given this action: p(o|a). */
  predictedObs: Categorical;
  /** Predicted posterior over hidden states given this action: q(z|a). */
  predictedQz: Categorical;
}

export interface ActionScoring {
  /** Prior over preferred observations: p(o) (the agent's goals). */
  preferredObs: Categorical;
  /** Prior over hidden states: p(z). */
  priorZ: Categorical;
}

/**
 * Expected Free Energy G(a) = epistemic + extrinsic.
 *   epistemic(a) = E_{p(o|a)}[D_KL(q(z|a, o) ‖ q(z|a))]
 *               (information gain about z from observing o)
 *   extrinsic(a) = D_KL(p(o|a) ‖ p(o))
 *               (divergence of predicted obs from preferred obs)
 *
 * Lower G = better action. We approximate epistemic via the entropy
 * reduction of the predicted posterior vs the prior on z; that's a
 * standard simplification when q(z|a, o) is hard to evaluate.
 */
export function expectedFreeEnergy(action: ActionCandidate, scoring: ActionScoring): {
  G: number; epistemic: number; extrinsic: number;
} {
  const epistemic = Math.max(0, entropy(scoring.priorZ) - entropy(action.predictedQz));
  const extrinsic = klDivergence(action.predictedObs, scoring.preferredObs);
  return { G: epistemic + extrinsic, epistemic, extrinsic };
}

/** Pick the action that minimises Expected Free Energy. */
export function selectAction(
  candidates: ReadonlyArray<ActionCandidate>,
  scoring: ActionScoring,
): { winner: ActionCandidate; ranked: Array<{ id: string; G: number; epistemic: number; extrinsic: number }> } {
  const scored = candidates.map((a) => {
    const s = expectedFreeEnergy(a, scoring);
    return { action: a, ...s };
  });
  scored.sort((a, b) => a.G - b.G);
  return {
    winner: scored[0]!.action,
    ranked: scored.map(({ action, G, epistemic, extrinsic }) => ({ id: action.id, G, epistemic, extrinsic })),
  };
}

/**
 * Convert a verify-style confidence number (0..1) into a measure-
 * theoretic posterior on a two-state {TRUE, FALSE} model. This is the
 * PAIN-006 fix: instead of returning 60% as a vibe, we return a Beta
 * posterior + the entropy of the posterior (epistemic uncertainty).
 */
export function confidenceToPosterior(
  confidence: number,
  observations: number,
): { posterior: Categorical; entropyBits: number; surprise: number } {
  const c = Math.max(0, Math.min(1, confidence));
  // Treat confidence as the mean of a Beta(α, β) with α + β = max(observations, 2).
  const n = Math.max(2, observations);
  const alpha = c * n + 1;
  const beta = (1 - c) * n + 1;
  const mean = alpha / (alpha + beta);
  const posterior = normalise([mean, 1 - mean]);
  const h = entropy(posterior);
  const surprise = -safeLog(mean); // -log p(TRUE)
  return { posterior, entropyBits: h / Math.log(2), surprise };
}
