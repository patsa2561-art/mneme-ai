/**
 * MPE — Multi-stage Pipelined Eigentrust.
 *
 * The novel formula. Three ingredients composed:
 *
 *   1. Eigentrust   (Kamvar, Schlosser, Garcia-Molina 2003) — P2P reputation
 *      via power iteration on a stochastic trust matrix.
 *   2. PageRank-style decay — preserves recency bias and prevents the
 *      eigenvector from collapsing onto one dominant stage.
 *   3. Latency-weighted success — fast successful stages contribute more
 *      to the trust update than slow successful stages.
 *
 * The update at iteration n:
 *
 *      T_n = α × E_n × T_{n-1} + (1 - α) × prior
 *
 * where:
 *      T_n     trust eigenvector at iteration n          (Map<stage, [0..1]>)
 *      E_n     stage success matrix at iteration n       (diagonal — each
 *              stage's contribution is independent; latency-discounted)
 *      α       decay (PageRank teleport probability)     default 0.85
 *      prior   uniform exploration term                  1 / numStages
 *
 * E_n is built from per-stage StageResult observations:
 *
 *      e_i = ok ? exp(-latency / target) : 0
 *
 * so a fast success ≈ 1, a slow success approaches 0, a failure is exactly 0.
 * The exponential decay is the latency weighting referenced above.
 *
 * After enough iterations (or just one, if initial trust is uniform) the
 * eigenvector ranks stages by recency × success × speed. The runtime uses
 * this ranking to:
 *   1. Allocate more workers to high-trust bottlenecks (scaleUp)
 *   2. Reclaim workers from low-trust noisy stages (scaleDown)
 *   3. Suppress speculative pre-fetch when trust < speculateThreshold
 *
 * Mneme is the first CLI memory layer to compose Eigentrust with deep
 * pipeline scheduling. The persistence file is .mneme/mpe.json so the
 * trust ranking carries across runs and adapts to each repo + user.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Per-stage trust eigenvector. Updates after every pipeline run. */
export interface MpeState {
  trust: Map<string, number>;
  successCount: Map<string, number>;
  failureCount: Map<string, number>;
  totalLatencyMs: Map<string, number>;
  callCount: Map<string, number>;
  /** Soft target latency per stage — used in latency weighting. */
  targetMs: Map<string, number>;
  /** PageRank-style decay term. */
  decay: number;
  /** Last update ISO ts. */
  updatedAt?: string;
}

/** Single observation produced by the pipeline runtime. */
export interface StageResult {
  stage: string;
  ok: boolean;
  latencyMs: number;
  /** Optional target latency for the stage. Defaults to whatever's already
   *  recorded in MpeState.targetMs (or 100ms if neither is present). */
  targetMs?: number;
}

/** Recommend an action for the next pipeline run based on trust. */
export interface MpeRecommendation {
  /** Stages to allocate MORE workers to (high trust + bottleneck). */
  scaleUp: string[];
  /** Stages to allocate FEWER workers to (low trust, save resources). */
  scaleDown: string[];
  /** Stages where speculative pre-fetch is unsafe (low trust). */
  noSpeculate: string[];
  /** Updated trust ranking, top-down. */
  ranking: Array<{ stage: string; trust: number }>;
}

/** Build an empty MpeState with the given decay (default 0.85). */
export function emptyMpeState(decay = 0.85): MpeState {
  return {
    trust: new Map(),
    successCount: new Map(),
    failureCount: new Map(),
    totalLatencyMs: new Map(),
    callCount: new Map(),
    targetMs: new Map(),
    decay,
  };
}

/**
 * Apply one Eigentrust-style update step to `state` given the latest
 * batch of stage observations. The function is pure — it returns a new
 * MpeState rather than mutating the input.
 *
 * The math is:
 *
 *   prior_i  = 1 / numStages
 *   e_i      = sum over results in stage i of (ok ? exp(-lat / target) : 0) / count
 *   T'_i     = α × e_i × T_i + (1 - α) × prior_i
 *
 * After computing the raw vector we renormalize so it sums to 1, which
 * makes it a probability distribution (proper eigenvector form).
 */
export function updateMpe(state: MpeState, results: StageResult[]): MpeState {
  // Defensive: clone all maps so callers can keep using the previous state.
  const trust = new Map(state.trust);
  const successCount = new Map(state.successCount);
  const failureCount = new Map(state.failureCount);
  const totalLatencyMs = new Map(state.totalLatencyMs);
  const callCount = new Map(state.callCount);
  const targetMs = new Map(state.targetMs);

  // Step 1 — fold observations into the running counters.
  // Group results by stage so we can compute a per-stage e_i.
  const perStageContribs = new Map<string, { sum: number; n: number }>();

  for (const r of results) {
    successCount.set(r.stage, (successCount.get(r.stage) ?? 0) + (r.ok ? 1 : 0));
    failureCount.set(r.stage, (failureCount.get(r.stage) ?? 0) + (r.ok ? 0 : 1));
    totalLatencyMs.set(
      r.stage,
      (totalLatencyMs.get(r.stage) ?? 0) + r.latencyMs,
    );
    callCount.set(r.stage, (callCount.get(r.stage) ?? 0) + 1);

    if (r.targetMs !== undefined) targetMs.set(r.stage, r.targetMs);
    const target = targetMs.get(r.stage) ?? 100;

    // Latency-weighted success contribution.
    // exp(-lat / target) ∈ (0, 1]; equals 1 at lat=0, ~0.37 at lat=target,
    // ~0.05 at lat=3*target. A failure contributes 0.
    const e = r.ok ? Math.exp(-Math.max(r.latencyMs, 0) / Math.max(target, 1)) : 0;
    const cur = perStageContribs.get(r.stage) ?? { sum: 0, n: 0 };
    cur.sum += e;
    cur.n += 1;
    perStageContribs.set(r.stage, cur);
  }

  // Make sure every known stage exists in trust with a starting value.
  // Stages not seen in this batch keep their previous trust (decay applied
  // implicitly — they get the (1-α)*prior nudge but no e_i contribution).
  const allStages = new Set<string>([
    ...trust.keys(),
    ...successCount.keys(),
    ...failureCount.keys(),
    ...perStageContribs.keys(),
  ]);
  const numStages = Math.max(allStages.size, 1);
  const prior = 1 / numStages;
  const alpha = state.decay;

  // Step 2 — apply the Eigentrust update.
  for (const stage of allStages) {
    const contrib = perStageContribs.get(stage);
    const e = contrib ? contrib.sum / Math.max(contrib.n, 1) : 0;
    // Bootstrap: if the stage has no prior trust, seed it with the prior so
    // the first observation can move it.
    const tPrev = trust.get(stage) ?? prior;
    const tNew = alpha * e * tPrev + (1 - alpha) * prior;
    trust.set(stage, tNew);
  }

  // Step 3 — renormalize so the eigenvector sums to 1.
  let total = 0;
  for (const v of trust.values()) total += v;
  if (total > 0) {
    for (const [k, v] of trust) trust.set(k, v / total);
  }

  return {
    trust,
    successCount,
    failureCount,
    totalLatencyMs,
    callCount,
    targetMs,
    decay: state.decay,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Power iteration helper — repeatedly applies updateMpe with the SAME batch
 * of results until the eigenvector converges (L1 distance < tol or maxIter).
 * Useful in tests and when you want a stable ranking without waiting for
 * many real pipeline runs.
 */
export function powerIterate(
  state: MpeState,
  results: StageResult[],
  opts: { maxIter?: number; tol?: number } = {},
): MpeState {
  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-6;
  let cur = state;
  for (let i = 0; i < maxIter; i++) {
    const next = updateMpe(cur, results);
    let l1 = 0;
    for (const k of next.trust.keys()) {
      l1 += Math.abs((next.trust.get(k) ?? 0) - (cur.trust.get(k) ?? 0));
    }
    cur = next;
    if (l1 < tol) break;
  }
  return cur;
}

/**
 * Compute a recommendation from the current trust state.
 *
 * Heuristics (deliberately simple — the runtime can override):
 *   - scaleUp:    top-third of stages by trust AND average latency above
 *                 target (likely bottlenecks worth more workers).
 *   - scaleDown:  bottom-third of stages by trust AND failure rate > 30%.
 *   - noSpeculate: trust below speculateThreshold (default 0.3 / numStages).
 */
export function recommendFromMpe(
  state: MpeState,
  opts: { speculateThreshold?: number } = {},
): MpeRecommendation {
  const ranking = [...state.trust.entries()]
    .map(([stage, trust]) => ({ stage, trust }))
    .sort((a, b) => b.trust - a.trust);

  const numStages = ranking.length || 1;
  const third = Math.max(1, Math.floor(numStages / 3));
  const top = new Set(ranking.slice(0, third).map((r) => r.stage));
  const bottom = new Set(ranking.slice(-third).map((r) => r.stage));

  // Threshold defaults to (speculateThreshold || 0.3) × prior so it scales
  // naturally with stage count.
  const prior = 1 / numStages;
  const noSpecCutoff = (opts.speculateThreshold ?? 0.3) * prior;

  const scaleUp: string[] = [];
  const scaleDown: string[] = [];
  const noSpeculate: string[] = [];

  for (const { stage, trust } of ranking) {
    const calls = state.callCount.get(stage) ?? 0;
    const fails = state.failureCount.get(stage) ?? 0;
    const totalLat = state.totalLatencyMs.get(stage) ?? 0;
    const target = state.targetMs.get(stage) ?? 100;
    const avgLat = calls > 0 ? totalLat / calls : 0;
    const failRate = calls > 0 ? fails / calls : 0;

    if (top.has(stage) && avgLat > target) scaleUp.push(stage);
    if (bottom.has(stage) && failRate > 0.3) scaleDown.push(stage);
    if (trust < noSpecCutoff) noSpeculate.push(stage);
  }

  return { scaleUp, scaleDown, noSpeculate, ranking };
}

/* ───────────────────────  Persistence  ─────────────────────── */

interface MpeStateJson {
  trust: Record<string, number>;
  successCount: Record<string, number>;
  failureCount: Record<string, number>;
  totalLatencyMs: Record<string, number>;
  callCount: Record<string, number>;
  targetMs: Record<string, number>;
  decay: number;
  updatedAt?: string;
}

function mapToObj<V>(m: Map<string, V>): Record<string, V> {
  const o: Record<string, V> = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}

function objToMap<V>(o: Record<string, V> | undefined): Map<string, V> {
  const m = new Map<string, V>();
  if (!o) return m;
  for (const k of Object.keys(o)) m.set(k, o[k]);
  return m;
}

export function serializeMpeState(state: MpeState): string {
  const json: MpeStateJson = {
    trust: mapToObj(state.trust),
    successCount: mapToObj(state.successCount),
    failureCount: mapToObj(state.failureCount),
    totalLatencyMs: mapToObj(state.totalLatencyMs),
    callCount: mapToObj(state.callCount),
    targetMs: mapToObj(state.targetMs),
    decay: state.decay,
    updatedAt: state.updatedAt,
  };
  return JSON.stringify(json, null, 2);
}

export function deserializeMpeState(text: string): MpeState {
  const json = JSON.parse(text) as MpeStateJson;
  return {
    trust: objToMap(json.trust),
    successCount: objToMap(json.successCount),
    failureCount: objToMap(json.failureCount),
    totalLatencyMs: objToMap(json.totalLatencyMs),
    callCount: objToMap(json.callCount),
    targetMs: objToMap(json.targetMs),
    decay: json.decay ?? 0.85,
    updatedAt: json.updatedAt,
  };
}

/** Read .mneme/mpe.json. Returns an empty state if the file does not exist. */
export function readMpeState(repoRoot: string): MpeState {
  const p = join(repoRoot, ".mneme", "mpe.json");
  if (!existsSync(p)) return emptyMpeState();
  try {
    return deserializeMpeState(readFileSync(p, "utf8"));
  } catch {
    return emptyMpeState();
  }
}

/** Write .mneme/mpe.json (creates parent dir if needed). */
export function writeMpeState(repoRoot: string, state: MpeState): void {
  const p = join(repoRoot, ".mneme", "mpe.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeMpeState(state), "utf8");
}
