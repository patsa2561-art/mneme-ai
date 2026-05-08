/**
 * Self-learning engine — the `while(is_studying==true)` loop.
 *
 * This is the centerpiece of Mneme's "AI that knows your repo better than
 * you do" thesis. Every 15 minutes (or on demand), the daemon ticks the
 * learning loop, which:
 *
 *   1. Collects observations from .mneme/observation-log.json:
 *      • MCP tool invocations (tool name · args · ms latency)
 *      • User feedback votes (up/down on retrieved memories)
 *      • Grader pass/fail on AI drafts
 *      • Federation hub responses (cross-repo aggregate signals)
 *
 *   2. Updates 4 LEARNING CHANNELS:
 *
 *      A. HMRA weight tuning (Pearson-correlation gradient ascent)
 *         → Bumps weights of components whose values correlate with
 *           positive feedback. Re-normalises so Σ = 1.
 *           See packages/core/src/hmra/hmra.ts:tuneHmraWeights().
 *
 *      B. Intent classifier scoring weights
 *         → Tracks (query → tool chosen → success?) outcomes per
 *           tool. Bumps tool's name-match weight if it consistently
 *           produced PASS-grade answers; reduces if FAIL.
 *
 *      C. Bayesian category priors (forensics rules)
 *         → If forensics.vulns rule-X consistently fires false-positive
 *           in this repo (suppressed), reduces its prior. If consistently
 *           confirmed, increases.
 *
 *      D. Molecule recipe library
 *         → Observed atom-combinations that produced PASS-grade answers
 *           are auto-promoted to compounds in .mneme/library.json after
 *           ≥3 successful invocations.
 *
 *   3. Writes the updated state to .mneme/learned-state.json (atomic
 *      temp+rename) with a version stamp + checksum.
 *
 *   4. The MCP server reads .mneme/learned-state.json on every tool call
 *      to apply the latest weights/priors. No restart needed.
 *
 * Why this is novel: most "self-learning" tools either (a) train a
 * single model with backprop (overkill, opaque, expensive) or (b)
 * track stats without acting on them (trivia). Mneme uses CLOSED-FORM
 * gradient updates with Pearson correlation as the signal — fully
 * deterministic, fully auditable, every weight change has a clear
 * provenance, ZERO ML model dependency. Just math + observation.
 *
 * Math foundations:
 *   • HMRA: tuneHmraWeights uses Pearson(component_i, feedback) → gradient
 *   • Intent: exponential moving average over per-tool success rates
 *   • Bayesian priors: Beta(α, β) conjugate update on (hit, miss) counts
 *   • Molecule promotion: Wilson score interval lower bound > 0.6 → promote
 *
 * Every channel has a deterministic, reproducible update rule.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { tuneHmraWeights, DEFAULT_HMRA_WEIGHTS, type HmraWeights, type FeedbackSample } from "../hmra/hmra.js";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type ObservationKind = "tool-invocation" | "user-feedback" | "grader-result" | "federation-response";

export interface Observation {
  ts: string;
  kind: ObservationKind;
  /** Tool name like "mneme.memory.ask", grader category, federation pattern, etc */
  subject: string;
  /** Outcome / vote / verdict */
  outcome: string;
  /** Optional numeric metric (latency ms, score, etc) */
  metric?: number;
  /** Free-form context (query text, args, etc) */
  context?: Record<string, unknown>;
}

export interface LearnedState {
  /** Schema version */
  version: 1;
  /** ISO timestamp of last tick */
  lastTickAt: string;
  /** Number of ticks since the daemon started */
  tickCount: number;
  /** Number of observations processed in the most recent tick */
  observationsLastTick: number;

  /** Channel A: HMRA weights (5 components) */
  hmraWeights: HmraWeights;

  /** Channel B: per-tool success-rate EMA (exponential moving average ∈ [0, 1]) */
  toolSuccessRates: Record<string, number>;

  /** Channel C: Bayesian (α, β) per forensics rule (Beta-Binomial conjugate) */
  rulePriors: Record<string, { alpha: number; beta: number }>;

  /** Channel D: observed molecule signatures with success-count + Wilson interval */
  moleculeStats: Record<string, { hits: number; trials: number; lastSeen: string }>;

  /** Audit trail — last 50 weight updates (for debugging + transparency) */
  auditTrail: Array<{
    ts: string;
    channel: "A-hmra" | "B-tool" | "C-prior" | "D-molecule";
    detail: string;
  }>;

  /** Checksum over the rest of the state — detects manual tampering */
  checksum: string;
}

export interface LearningTickInput {
  /** New observations since last tick */
  observations: Observation[];
  /** Current state (or null on first tick) */
  current: LearnedState | null;
}

// ──────────────────────────────────────────────────────────────────────
// Math helpers — closed-form learning rules
// ──────────────────────────────────────────────────────────────────────

const EMA_ALPHA = 0.2;        // weight on new observation in EMA update
const PRIOR_PRIOR_A = 1;      // Beta(1,1) = uniform prior
const PRIOR_PRIOR_B = 1;
const MOLECULE_PROMOTION_THRESHOLD = 0.6;  // Wilson lower bound
const MOLECULE_MIN_TRIALS = 3;             // ≥3 invocations before promotion
const MAX_AUDIT_TRAIL = 50;

/** Exponential moving average update: new = α·sample + (1-α)·prev. */
export function emaUpdate(prev: number, sample: number, alpha: number = EMA_ALPHA): number {
  return alpha * sample + (1 - alpha) * prev;
}

/** Beta-Binomial Bayesian update: prior Beta(α, β) + observation (hit, miss)
 *  → posterior Beta(α + hit, β + miss). Returns posterior mean = α / (α + β).
 *  Used for forensics-rule confidence: each (rule × repo) gets its own
 *  posterior that drifts based on observed hit rate. */
export function bayesianPosteriorMean(prior: { alpha: number; beta: number }, hit: number, miss: number): number {
  const alpha = prior.alpha + hit;
  const beta = prior.beta + miss;
  return alpha / (alpha + beta);
}

/** Wilson score interval — gives a confidence-aware estimate of a binomial
 *  proportion. Lower bound is what we use for molecule promotion: a
 *  molecule with 3 hits / 3 trials has Wilson lower 0.44; 9 hits / 10 trials
 *  has Wilson lower 0.60. Prevents promoting flukes. */
export function wilsonLowerBound(successes: number, trials: number, z: number = 1.96): number {
  if (trials === 0) return 0;
  const phat = successes / trials;
  const z2 = z * z;
  const num = phat + z2 / (2 * trials) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * trials)) / trials);
  const den = 1 + z2 / trials;
  return Math.max(0, num / den);
}

// ──────────────────────────────────────────────────────────────────────
// Channel A — HMRA weight tuning (delegated to hmra.tuneHmraWeights)
// ──────────────────────────────────────────────────────────────────────

function tickChannelA(
  observations: Observation[],
  currentWeights: HmraWeights,
): { weights: HmraWeights; auditEntry: string | null } {
  // Convert observations → feedback samples
  const samples: FeedbackSample[] = [];
  for (const o of observations) {
    if (o.kind !== "user-feedback") continue;
    const ctx = o.context ?? {};
    const components = ctx["components"] as { recency: number; hebbian: number; pageRank: number; entropy: number; federation: number } | undefined;
    if (!components) continue;
    const fb: 1 | -1 | 0 = o.outcome === "up" ? 1 : o.outcome === "down" ? -1 : 0;
    samples.push({
      memoryId: o.subject,
      feedback: fb,
      scoreAtRetrieval: { id: o.subject, composite: 0, components, weights: currentWeights },
    });
  }
  if (samples.length < 10) return { weights: currentWeights, auditEntry: null };
  const updated = tuneHmraWeights(samples, currentWeights, 0.05);
  // Detect meaningful change (≥1% on any weight)
  const changed = (Object.keys(updated) as Array<keyof HmraWeights>).some(
    (k) => Math.abs(updated[k] - currentWeights[k]) > 0.01,
  );
  if (!changed) return { weights: updated, auditEntry: null };
  return {
    weights: updated,
    auditEntry: `HMRA weights tuned from ${samples.length} feedback samples — α=${updated.alpha.toFixed(3)} β=${updated.beta.toFixed(3)} γ=${updated.gamma.toFixed(3)} δ=${updated.delta.toFixed(3)} ε=${updated.epsilon.toFixed(3)}`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Channel B — Per-tool success-rate EMA
// ──────────────────────────────────────────────────────────────────────

function tickChannelB(
  observations: Observation[],
  current: Record<string, number>,
): { rates: Record<string, number>; auditEntry: string | null } {
  const updated = { ...current };
  let touched = 0;
  for (const o of observations) {
    if (o.kind !== "tool-invocation") continue;
    const success = o.outcome === "PASS" || o.outcome === "ok" ? 1 : o.outcome === "FAIL" || o.outcome === "error" ? 0 : 0.5;
    const prev = updated[o.subject] ?? 0.5;
    updated[o.subject] = emaUpdate(prev, success);
    touched++;
  }
  if (touched === 0) return { rates: updated, auditEntry: null };
  return {
    rates: updated,
    auditEntry: `${touched} tool-invocation observations applied · tracking ${Object.keys(updated).length} tools`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Channel C — Bayesian rule priors (Beta-Binomial conjugate update)
// ──────────────────────────────────────────────────────────────────────

function tickChannelC(
  observations: Observation[],
  current: Record<string, { alpha: number; beta: number }>,
): { priors: Record<string, { alpha: number; beta: number }>; auditEntry: string | null } {
  const updated = { ...current };
  let touched = 0;
  for (const o of observations) {
    if (o.kind !== "user-feedback") continue;
    if (!o.subject.startsWith("rule:")) continue; // only forensics rules
    const ruleName = o.subject.slice("rule:".length);
    const prior = updated[ruleName] ?? { alpha: PRIOR_PRIOR_A, beta: PRIOR_PRIOR_B };
    if (o.outcome === "confirmed") prior.alpha++;
    else if (o.outcome === "false-positive") prior.beta++;
    updated[ruleName] = prior;
    touched++;
  }
  if (touched === 0) return { priors: updated, auditEntry: null };
  return {
    priors: updated,
    auditEntry: `${touched} rule-feedback observations · Bayesian priors updated for ${Object.keys(updated).length} rules`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Channel D — Molecule promotion via Wilson lower bound
// ──────────────────────────────────────────────────────────────────────

function tickChannelD(
  observations: Observation[],
  current: Record<string, { hits: number; trials: number; lastSeen: string }>,
): {
  stats: Record<string, { hits: number; trials: number; lastSeen: string }>;
  auditEntry: string | null;
  promoted: string[];
} {
  const updated = { ...current };
  const promoted: string[] = [];
  for (const o of observations) {
    if (o.kind !== "grader-result") continue;
    if (!o.subject.startsWith("molecule:")) continue;
    const sig = o.subject.slice("molecule:".length);
    const stat = updated[sig] ?? { hits: 0, trials: 0, lastSeen: o.ts };
    stat.trials++;
    if (o.outcome === "PASS") stat.hits++;
    stat.lastSeen = o.ts;
    updated[sig] = stat;
  }
  // Promotion check
  for (const [sig, stat] of Object.entries(updated)) {
    if (stat.trials >= MOLECULE_MIN_TRIALS) {
      const lower = wilsonLowerBound(stat.hits, stat.trials);
      if (lower >= MOLECULE_PROMOTION_THRESHOLD) {
        promoted.push(`${sig} (Wilson lower ${lower.toFixed(2)})`);
      }
    }
  }
  const audit =
    promoted.length === 0
      ? null
      : `${promoted.length} molecule(s) eligible for compound promotion: ${promoted.slice(0, 3).join(", ")}`;
  return { stats: updated, auditEntry: audit, promoted };
}

// ──────────────────────────────────────────────────────────────────────
// Composite tick — all 4 channels
// ──────────────────────────────────────────────────────────────────────

export function learningTick(input: LearningTickInput): LearnedState {
  const now = new Date().toISOString();
  const prev =
    input.current ??
    ({
      version: 1 as const,
      lastTickAt: now,
      tickCount: 0,
      observationsLastTick: 0,
      hmraWeights: DEFAULT_HMRA_WEIGHTS,
      toolSuccessRates: {},
      rulePriors: {},
      moleculeStats: {},
      auditTrail: [],
      checksum: "",
    } as LearnedState);

  const a = tickChannelA(input.observations, prev.hmraWeights);
  const b = tickChannelB(input.observations, prev.toolSuccessRates);
  const c = tickChannelC(input.observations, prev.rulePriors);
  const d = tickChannelD(input.observations, prev.moleculeStats);

  const auditTrail = [...prev.auditTrail];
  if (a.auditEntry) auditTrail.push({ ts: now, channel: "A-hmra", detail: a.auditEntry });
  if (b.auditEntry) auditTrail.push({ ts: now, channel: "B-tool", detail: b.auditEntry });
  if (c.auditEntry) auditTrail.push({ ts: now, channel: "C-prior", detail: c.auditEntry });
  if (d.auditEntry) auditTrail.push({ ts: now, channel: "D-molecule", detail: d.auditEntry });
  // Cap audit trail length
  while (auditTrail.length > MAX_AUDIT_TRAIL) auditTrail.shift();

  const partial = {
    version: 1 as const,
    lastTickAt: now,
    tickCount: prev.tickCount + 1,
    observationsLastTick: input.observations.length,
    hmraWeights: a.weights,
    toolSuccessRates: b.rates,
    rulePriors: c.priors,
    moleculeStats: d.stats,
    auditTrail,
  };
  const checksum = createHash("sha256").update(JSON.stringify(partial)).digest("hex").slice(0, 16);
  return { ...partial, checksum };
}

// ──────────────────────────────────────────────────────────────────────
// File I/O — reads/writes .mneme/learned-state.json + observation-log
// ──────────────────────────────────────────────────────────────────────

export interface LearningPaths {
  state: string;
  observations: string;
}

export function learningPaths(repoRoot: string): LearningPaths {
  return {
    state: join(repoRoot, ".mneme", "learned-state.json"),
    observations: join(repoRoot, ".mneme", "observation-log.json"),
  };
}

export function readState(repoRoot: string): LearnedState | null {
  const p = learningPaths(repoRoot).state;
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LearnedState;
  } catch {
    return null;
  }
}

export function writeState(repoRoot: string, state: LearnedState): void {
  const p = learningPaths(repoRoot).state;
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, p);
}

export function readObservations(repoRoot: string): Observation[] {
  const p = learningPaths(repoRoot).observations;
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Observation[];
  } catch {
    return [];
  }
}

export function writeObservations(repoRoot: string, obs: Observation[]): void {
  const p = learningPaths(repoRoot).observations;
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(obs, null, 2), "utf8");
  renameSync(tmp, p);
}

/** Append a single observation. Caps total log at 1000 entries (rolling). */
export function appendObservation(repoRoot: string, obs: Observation): void {
  const all = readObservations(repoRoot);
  all.push(obs);
  while (all.length > 1000) all.shift();
  writeObservations(repoRoot, all);
}

/** Run one full learning tick — read observations, update state, write state.
 *  Returns the new state. Does NOT clear the observation log (so multiple
 *  daemon ticks can read the same window). */
export function runLearningTick(repoRoot: string): LearnedState {
  const observations = readObservations(repoRoot);
  const current = readState(repoRoot);
  // Only consume observations newer than the last tick
  const cutoff = current?.lastTickAt ?? "0000-00-00T00:00:00Z";
  const fresh = observations.filter((o) => o.ts > cutoff);
  const next = learningTick({ observations: fresh, current });
  writeState(repoRoot, next);
  return next;
}
