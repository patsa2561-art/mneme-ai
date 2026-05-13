/**
 * v2.6.0 -- TRUTH KERNEL.
 *
 *   "Many gates · one verdict · disagreement is signal, not noise."
 *
 * The pattern Mneme accumulated by v2.5: more than ten folders all
 * answering the same family of question — "is this AI claim true?".
 * Each carries a different sensor:
 *   FLASH        — Veracity-Velocity Singularity over evidence weights
 *   APOPTOSIS    — 7-witness fusion (file ∧ symbol ∧ type ∧ git ∧ test ∧ ...)
 *   X-RAY        — surface-text hedging vs. absolutism
 *   TWINS        — opposing-prior debate disagreement
 * (additional sensors can be added — the kernel is sensor-agnostic.)
 *
 * Until now AI agents had to PICK which sensor to call. That's the
 * wrong mental model. A truthful claim should look truthful to every
 * sensor; a false claim is detected EARLIER when multiple sensors are
 * fused. Mneme should ask the AI for a claim and run every sensor in
 * parallel, then BAYESIAN-FUSE the verdicts into a single probability
 * with calibrated weights.
 *
 * Wild move: DISAGREEMENT is itself the most valuable output. When
 * apoptosis says HEALTHY and x-ray says LOW-CONFIDENCE, that conflict
 * is a louder signal than either verdict alone. The kernel surfaces
 * the disagreement, not just the fused score.
 *
 * Sensors stay independently callable (no breaking change). Kernel
 * is a NEW SURFACE that composes them.
 */

export type SensorVerdict = "TRUE" | "FALSE" | "UNCERTAIN" | "INAPPLICABLE";

export interface SensorOutput {
  /** Stable sensor id ("flash" / "apoptosis" / etc). */
  sensor: string;
  /** This sensor's verdict on the claim. */
  verdict: SensorVerdict;
  /** Sensor's confidence in its own verdict, 0..1. */
  confidence: number;
  /** Free-form rationale a human can read. */
  rationale?: string;
  /** Wall-clock ms the sensor took. */
  ms?: number;
}

export interface SensorAdapter {
  /** Stable id used in fusion + reporting. */
  id: string;
  /** Optional prior weight 0..1 — calibrated from historical accuracy.
   *  Default 1.0 (treat as fully reliable until measured otherwise). */
  weight?: number;
  /** Run the sensor. Must never throw — return a degraded verdict instead. */
  run: (claim: string, ctx?: Record<string, unknown>) => Promise<SensorOutput> | SensorOutput;
}

export interface TruthKernelInput {
  /** The claim under test. */
  claim: string;
  /** Sensors to fan out to. Must be ≥ 1. */
  sensors: readonly SensorAdapter[];
  /** Optional context passed verbatim to every sensor. */
  ctx?: Record<string, unknown>;
  /** Hard timeout per sensor in ms. Default 5000. */
  perSensorTimeoutMs?: number;
}

export interface TruthVerdict {
  /** Fused probability the claim is true, 0..1. */
  pTrue: number;
  /** Convenience label derived from pTrue + disagreement. */
  verdict: "ACCEPTED" | "DISPUTED" | "REJECTED" | "INCONCLUSIVE";
  /** 0..1 — how much sensors disagree. High disagreement = uncertain. */
  disagreement: number;
  /** Each sensor's raw verdict. */
  sensorOutputs: SensorOutput[];
  /** When applicable, the sensor that most-strongly drove the fused score. */
  dominantSensor?: string;
  /** When applicable, the sensor whose verdict is the outlier. */
  outlierSensor?: string;
  /** Total wall-clock ms. */
  totalMs: number;
}

/** Convert a sensor verdict into a probability that the claim is true.
 *  TRUE  → confidence (clamp 0.5..1)
 *  FALSE → 1 - confidence (clamp 0..0.5)
 *  UNCERTAIN → 0.5 (no information)
 *  INAPPLICABLE → 0.5 with weight 0 (effectively removed) */
function verdictToProb(o: SensorOutput): { p: number; informational: boolean } {
  const c = Math.max(0, Math.min(1, o.confidence ?? 0));
  switch (o.verdict) {
    case "TRUE":         return { p: 0.5 + 0.5 * c, informational: true };
    case "FALSE":        return { p: 0.5 - 0.5 * c, informational: true };
    case "UNCERTAIN":    return { p: 0.5, informational: false };
    case "INAPPLICABLE": return { p: 0.5, informational: false };
    default:             return { p: 0.5, informational: false };
  }
}

/** Run one sensor with a hard timeout. Always returns a verdict — on
 *  timeout / throw, returns an UNCERTAIN sensor output so the kernel
 *  stays robust. */
async function runSensorSafe(s: SensorAdapter, claim: string, ctx: Record<string, unknown> | undefined, timeoutMs: number): Promise<SensorOutput> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      Promise.resolve(s.run(claim, ctx)),
      new Promise<SensorOutput>((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { ...result, ms: result.ms ?? Date.now() - t0 };
  } catch (e) {
    return { sensor: s.id, verdict: "UNCERTAIN", confidence: 0, rationale: `sensor failed: ${(e as Error).message?.slice(0, 80) ?? "unknown"}`, ms: Date.now() - t0 };
  }
}

/** Weighted log-odds fusion with calibrated weights.
 *  Each informational sensor contributes log(p/(1-p)) * weight; the sum
 *  becomes the fused log-odds. Convert back with sigmoid. */
function fuse(sensorOutputs: SensorOutput[], adapters: ReadonlyMap<string, SensorAdapter>): { pTrue: number; informationalCount: number } {
  let logOdds = 0;
  let informational = 0;
  for (const o of sensorOutputs) {
    const { p, informational: inf } = verdictToProb(o);
    if (!inf) continue;
    const a = adapters.get(o.sensor);
    const w = a?.weight ?? 1.0;
    // Clamp p away from {0,1} to keep log-odds finite.
    const pSafe = Math.min(0.999, Math.max(0.001, p));
    logOdds += Math.log(pSafe / (1 - pSafe)) * w;
    informational++;
  }
  if (informational === 0) return { pTrue: 0.5, informationalCount: 0 };
  const pTrue = 1 / (1 + Math.exp(-logOdds));
  return { pTrue, informationalCount: informational };
}

/** Disagreement = WEIGHTED variance of per-sensor pTrue across informational
 *  sensors, normalized to 0..1 (max weighted-variance is 0.25 when sensors
 *  split evenly). Weighting matters: a low-weight outlier shouldn't
 *  trigger DISPUTED when the high-weight sensors agree. */
function disagreementScore(sensorOutputs: SensorOutput[], adapters: ReadonlyMap<string, SensorAdapter>): number {
  const ps: Array<{ p: number; w: number }> = [];
  for (const o of sensorOutputs) {
    const { p, informational } = verdictToProb(o);
    if (!informational) continue;
    const w = adapters.get(o.sensor)?.weight ?? 1;
    if (w <= 0) continue;
    ps.push({ p, w });
  }
  if (ps.length < 2) return 0;
  const totalW = ps.reduce((acc, x) => acc + x.w, 0);
  if (totalW <= 0) return 0;
  const mean = ps.reduce((acc, x) => acc + x.p * x.w, 0) / totalW;
  const variance = ps.reduce((acc, x) => acc + x.w * (x.p - mean) ** 2, 0) / totalW;
  return Math.min(1, variance / 0.25);
}

/** Pick the dominant / outlier sensors from the informational set. */
function pickRoleSensors(sensorOutputs: SensorOutput[], adapters: ReadonlyMap<string, SensorAdapter>, pTrue: number): { dominant?: string; outlier?: string } {
  let dominantId: string | undefined;
  let dominantPull = -Infinity;
  let outlierId: string | undefined;
  let outlierDist = -1;
  for (const o of sensorOutputs) {
    const { p, informational } = verdictToProb(o);
    if (!informational) continue;
    const w = adapters.get(o.sensor)?.weight ?? 1;
    // Dominant = strongest weighted log-odds contribution aligned with consensus.
    const pSafe = Math.min(0.999, Math.max(0.001, p));
    const contribution = (pTrue > 0.5 ? Math.log(pSafe / (1 - pSafe)) : -Math.log(pSafe / (1 - pSafe))) * w;
    if (contribution > dominantPull) { dominantPull = contribution; dominantId = o.sensor; }
    // Outlier = furthest from consensus.
    const dist = Math.abs(p - pTrue);
    if (dist > outlierDist) { outlierDist = dist; outlierId = o.sensor; }
  }
  return { dominant: dominantId, outlier: outlierId };
}

/** Run the kernel: fan out → fuse → label. */
export async function checkTruth(input: TruthKernelInput): Promise<TruthVerdict> {
  if (input.sensors.length === 0) {
    return { pTrue: 0.5, verdict: "INCONCLUSIVE", disagreement: 0, sensorOutputs: [], totalMs: 0 };
  }
  const t0 = Date.now();
  const timeout = input.perSensorTimeoutMs ?? 5000;
  const adapterMap = new Map<string, SensorAdapter>();
  for (const s of input.sensors) adapterMap.set(s.id, s);
  const sensorOutputs = await Promise.all(input.sensors.map((s) => runSensorSafe(s, input.claim, input.ctx, timeout)));
  const { pTrue, informationalCount } = fuse(sensorOutputs, adapterMap);
  const disagreement = disagreementScore(sensorOutputs, adapterMap);
  const { dominant, outlier } = pickRoleSensors(sensorOutputs, adapterMap, pTrue);
  let verdict: TruthVerdict["verdict"];
  if (informationalCount === 0) {
    verdict = "INCONCLUSIVE";
  } else if (disagreement >= 0.5 && informationalCount >= 2) {
    verdict = "DISPUTED";
  } else if (pTrue >= 0.75) {
    verdict = "ACCEPTED";
  } else if (pTrue <= 0.25) {
    verdict = "REJECTED";
  } else {
    verdict = "INCONCLUSIVE";
  }
  return {
    pTrue,
    verdict,
    disagreement,
    sensorOutputs,
    dominantSensor: dominant,
    outlierSensor: outlier,
    totalMs: Date.now() - t0,
  };
}

/** Compact one-line pulse summary. */
export function formatTruthKernelPulseLine(v: TruthVerdict): string {
  return `TRUTH-KERNEL · ${v.verdict} · pTrue=${v.pTrue.toFixed(2)} · disagree=${v.disagreement.toFixed(2)} · sensors=${v.sensorOutputs.length} · ${v.totalMs}ms`;
}

/** Calibrate sensor weights from historical (sensorOutput, groundTruth) pairs.
 *  Returns a new weight map; higher weight = sensor was more often right.
 *
 *  Simple algorithm: weight = max(0.1, accuracy * 2) so a 50% sensor → 1.0,
 *  a perfect sensor → 2.0, a random sensor → 1.0. Caps at 2.0 to avoid
 *  any single sensor dominating the log-odds sum. */
export function calibrateWeights(history: ReadonlyArray<{ sensor: string; verdictWasCorrect: boolean }>): Map<string, number> {
  const tallies = new Map<string, { right: number; total: number }>();
  for (const h of history) {
    const t = tallies.get(h.sensor) ?? { right: 0, total: 0 };
    t.total++;
    if (h.verdictWasCorrect) t.right++;
    tallies.set(h.sensor, t);
  }
  const weights = new Map<string, number>();
  for (const [sensor, t] of tallies) {
    if (t.total === 0) continue;
    const acc = t.right / t.total;
    const w = Math.max(0.1, Math.min(2.0, acc * 2));
    weights.set(sensor, w);
  }
  return weights;
}
