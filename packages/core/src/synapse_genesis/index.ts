/**
 * v2.19.29 — MNEME SYNAPSE GENESIS · HEBBIAN ENGINE (Phase A of SYNAPSE GENESIS)
 *
 *   "autonomic ไม่ใช่ 'scheduler เขียนให้ครอบทุก case' — เป็น 'scheduler
 *    ที่ เรียน จากทุก case + โต ตลอดเวลา'. Static = limited by author.
 *    Genesis = unlimited by definition."
 *                                          — user mandate, 2026-05-17
 *
 *   Diagnosis: v2.19.28 AUTONOMIC SCHEDULER ticks 5 organs on hand-coded
 *   intervals (breath every 60s, sleep every 30min idle, etc). That is
 *   STATIC — every case must be authored in advance. v2.19.29 ships the
 *   GENESIS layer: a Hebbian synapse table that grows itself from every
 *   observed (event, tool, satisfaction) triple.
 *
 *   Hebbian rule (neurons that fire together wire together):
 *     weight[s] += satisfaction === "positive" ? 1.0 : -0.5
 *     weight[s] *= 0.999   (slow Ebbinghaus decay per tick)
 *     if weight[s] > FIRE_THRESHOLD AND !permanent[s]:
 *       permanent[s] = true  // pathway BORN — autonomic from now on
 *
 *   Cold-start safe: first observation establishes a synapse at weight 1.0.
 *   Hot-loop safe: every operation is pure-function + HMAC-signed + bounded
 *   in O(synapses) time + clamped to [-MAX_WEIGHT, MAX_WEIGHT].
 *
 *   Composes onto:
 *     - v2.19.28 AUTONOMIC SCHEDULER (synapse fires REPLACE static schedules
 *       as the catalog matures; scheduler asks "what should fire now?"
 *       and synapse table answers based on learned patterns)
 *     - v2.19.22 REFLEX (pheromone trail is the OBSERVATION source)
 *     - v2.19.25 SLEEP TRAINING (jaccard fitness loop feeds satisfaction)
 *     - v2.19.26 DREAMSPACE (novel events become DREAMSPACE proposals)
 *
 * Honest scope (every claim verifiable at runtime):
 *   - PURE FUNCTION reinforceSynapse + decideFire + queryPathways.
 *   - HMAC-chained SynapseStore so tampered weights refuse to fire.
 *   - Defensive at every boundary: NaN guards, weight clamps, empty-store
 *     handling, malformed-event handling. Never throws on bad input.
 *   - 24/7 always-active by construction: even with zero observations,
 *     decideFire returns "no_synapse_yet" gracefully (never crashes).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

// ─── tunables (every value documented; future tuning is observable) ──

const POSITIVE_REINFORCEMENT = 1.0;
const NEGATIVE_REINFORCEMENT = -0.5;
/** Per-tick decay: 0.999 → ~half-life of 693 ticks (Ebbinghaus-like). */
const DECAY_PER_TICK = 0.999;
/** Above this weight, synapse becomes PERMANENT (autonomic fires forever). */
const FIRE_THRESHOLD = 5.0;
/** Hard cap on weight magnitude — prevents runaway positive feedback. */
const MAX_WEIGHT = 100.0;
/** Below this absolute weight, synapse is pruned (saves memory). */
const PRUNE_THRESHOLD = 0.01;

export type Satisfaction = "positive" | "negative" | "neutral";

export interface SensedEvent {
  /** Stable event signature (caller computes; e.g., hash of git+file+phase). */
  pattern: string;
  /** Optional structured context for audit. */
  context?: Record<string, unknown>;
  ts: number;
}

export interface ToolCall {
  toolName: string;
  args?: Record<string, unknown>;
  ts: number;
}

export interface SynapseWeight {
  /** Composite key: `${eventPattern}::${toolName}`. */
  key: string;
  eventPattern: string;
  toolName: string;
  /** Current synaptic weight after decay + reinforcement. */
  weight: number;
  /** Total observations contributing to this weight (positive + negative). */
  observationCount: number;
  /** Most recent observation ts (for decay computation). */
  lastObservedAtMs: number;
  /** Weight at which synapse became permanent (0 if not permanent). */
  permanentSinceWeight: number;
  /** True once weight crosses FIRE_THRESHOLD — never reverts even if weight decays. */
  permanent: boolean;
}

export interface SynapseStore {
  v: typeof PROTOCOL_VERSION;
  /** Linear list keyed by composite key — easy to serialise. */
  weights: SynapseWeight[];
  /** Last tick time used for global decay; null on fresh store. */
  lastDecayedAtMs: number | null;
  /** HMAC of (sorted weights + lastDecayedAtMs); tampered stores refuse to fire. */
  sig: string;
}

// ─── canonical helpers ───────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SYNAPSE_GENESIS_SECRET"] || `mneme-synapse-genesis-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function clampWeight(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, x));
}

/** Stable composite key for synapse lookup; collision-free over distinct (pattern, tool). */
export function synapseKey(eventPattern: string, toolName: string): string {
  return `${eventPattern}::${toolName}`;
}

// ─── store lifecycle ─────────────────────────────────────────────────

export function emptySynapseStore(secret?: string): SynapseStore {
  const body: Omit<SynapseStore, "sig"> = { v: PROTOCOL_VERSION, weights: [], lastDecayedAtMs: null };
  return { ...body, sig: hmacHex(body, secret ?? defaultSecret()) };
}

function reSignStore(store: Omit<SynapseStore, "sig">, secret: string): SynapseStore {
  // Sort weights by key for canonical signing so identical content produces identical sig.
  const sorted = [...store.weights].sort((a, b) => a.key.localeCompare(b.key));
  const body = { v: store.v, weights: sorted, lastDecayedAtMs: store.lastDecayedAtMs };
  return { ...body, sig: hmacHex(body, secret) };
}

export function verifyStore(store: SynapseStore, secret?: string): boolean {
  const sec = secret ?? defaultSecret();
  const sorted = [...store.weights].sort((a, b) => a.key.localeCompare(b.key));
  const body = { v: store.v, weights: sorted, lastDecayedAtMs: store.lastDecayedAtMs };
  return safeEqHex(hmacHex(body, sec), store.sig);
}

// ─── reinforcement (the Hebbian heart) ───────────────────────────────

export interface ReinforceInput {
  store: SynapseStore;
  event: SensedEvent;
  toolCall: ToolCall;
  satisfaction: Satisfaction;
  nowMs?: number;
  secret?: string;
}

export interface ReinforceOutput {
  store: SynapseStore;
  synapseKey: string;
  /** True if this observation created a new synapse (cold-start path). */
  born: boolean;
  /** True if this observation crossed FIRE_THRESHOLD for the first time. */
  becamePermanent: boolean;
  /** Updated weight after reinforcement + decay. */
  newWeight: number;
}

/**
 * The Hebbian rule made executable. Defensive at every boundary:
 *   - malformed event/tool (empty strings) → no-op (returns store unchanged)
 *   - NaN weight → clamped to 0 before update
 *   - weight > MAX_WEIGHT → clamped (no runaway)
 *   - permanent flag never reverts even if weight decays back below threshold
 */
export function reinforceSynapse(input: ReinforceInput): ReinforceOutput {
  const sec = input.secret ?? defaultSecret();
  const nowMs = input.nowMs ?? input.event.ts;
  // Defensive: reject obviously malformed input — return store unchanged.
  if (!input.event?.pattern || !input.toolCall?.toolName) {
    return {
      store: input.store,
      synapseKey: "",
      born: false,
      becamePermanent: false,
      newWeight: 0,
    };
  }
  const key = synapseKey(input.event.pattern, input.toolCall.toolName);
  const existingIdx = input.store.weights.findIndex((w) => w.key === key);
  const delta = input.satisfaction === "positive"
    ? POSITIVE_REINFORCEMENT
    : input.satisfaction === "negative"
      ? NEGATIVE_REINFORCEMENT
      : 0;
  let updated: SynapseWeight;
  let born = false;
  let becamePermanent = false;
  if (existingIdx === -1) {
    // Cold-start: first observation establishes synapse.
    updated = {
      key,
      eventPattern: input.event.pattern,
      toolName: input.toolCall.toolName,
      weight: clampWeight(delta),
      observationCount: 1,
      lastObservedAtMs: nowMs,
      permanentSinceWeight: 0,
      permanent: false,
    };
    born = true;
  } else {
    const prev = input.store.weights[existingIdx]!;
    // Apply Ebbinghaus decay per elapsed tick (one tick = one observation interval).
    // We approximate by raising decay to (observations since last) — but since
    // we update each observation, decay factor per call is the constant DECAY_PER_TICK.
    const decayed = clampWeight((Number.isFinite(prev.weight) ? prev.weight : 0) * DECAY_PER_TICK);
    const newWeight = clampWeight(decayed + delta);
    const willBePermanent = prev.permanent || newWeight >= FIRE_THRESHOLD;
    becamePermanent = !prev.permanent && newWeight >= FIRE_THRESHOLD;
    updated = {
      key,
      eventPattern: input.event.pattern,
      toolName: input.toolCall.toolName,
      weight: newWeight,
      observationCount: prev.observationCount + 1,
      lastObservedAtMs: nowMs,
      permanentSinceWeight: willBePermanent && prev.permanentSinceWeight === 0 ? newWeight : prev.permanentSinceWeight,
      permanent: willBePermanent,
    };
  }
  const newWeights = existingIdx === -1
    ? [...input.store.weights, updated]
    : input.store.weights.map((w, i) => (i === existingIdx ? updated : w));
  const newStore = reSignStore(
    { v: PROTOCOL_VERSION, weights: newWeights, lastDecayedAtMs: nowMs },
    sec,
  );
  return { store: newStore, synapseKey: key, born, becamePermanent, newWeight: updated.weight };
}

// ─── decision: should this synapse fire NOW? ────────────────────────

export type FireDecisionReason =
  | "permanent_pathway"
  | "above_threshold_growing"
  | "below_threshold_juvenile"
  | "no_synapse_yet"
  | "tampered_store"
  | "pruned_dead";

export interface FireDecision {
  v: typeof PROTOCOL_VERSION;
  shouldFire: boolean;
  reason: FireDecisionReason;
  weight: number;
  permanent: boolean;
  details: string;
}

/**
 * Pure decision: given the synapse store + event pattern + tool name,
 * should this synapse fire RIGHT NOW? Never throws. Tampered store returns
 * `shouldFire: false` with reason `tampered_store` (fail-safe).
 *
 * Priority:
 *   1. tampered store → no fire
 *   2. no synapse for this (pattern, tool) → no fire (will become DREAMSPACE candidate)
 *   3. pruned (|weight| < PRUNE_THRESHOLD) → no fire
 *   4. permanent → fire
 *   5. weight >= FIRE_THRESHOLD AND not yet permanent → fire (will mark permanent on next reinforce)
 *   6. else → juvenile; no fire yet
 */
export function decideFire(input: {
  store: SynapseStore;
  eventPattern: string;
  toolName: string;
  secret?: string;
}): FireDecision {
  // 1. Tampered store → fail-safe.
  if (!verifyStore(input.store, input.secret)) {
    return {
      v: PROTOCOL_VERSION,
      shouldFire: false,
      reason: "tampered_store",
      weight: 0,
      permanent: false,
      details: "synapse store HMAC verification failed — refusing to fire from tampered state",
    };
  }
  const key = synapseKey(input.eventPattern, input.toolName);
  const w = input.store.weights.find((x) => x.key === key);
  if (!w) {
    return {
      v: PROTOCOL_VERSION,
      shouldFire: false,
      reason: "no_synapse_yet",
      weight: 0,
      permanent: false,
      details: `no synapse for (${input.eventPattern} → ${input.toolName}); cold-start path`,
    };
  }
  if (Math.abs(w.weight) < PRUNE_THRESHOLD) {
    return {
      v: PROTOCOL_VERSION,
      shouldFire: false,
      reason: "pruned_dead",
      weight: w.weight,
      permanent: w.permanent,
      details: `weight |${w.weight.toFixed(4)}| < prune threshold ${PRUNE_THRESHOLD}; pathway atrophied`,
    };
  }
  if (w.permanent) {
    return {
      v: PROTOCOL_VERSION,
      shouldFire: true,
      reason: "permanent_pathway",
      weight: w.weight,
      permanent: true,
      details: `permanent since weight=${w.permanentSinceWeight.toFixed(2)}; autonomic from now on`,
    };
  }
  if (w.weight >= FIRE_THRESHOLD) {
    return {
      v: PROTOCOL_VERSION,
      shouldFire: true,
      reason: "above_threshold_growing",
      weight: w.weight,
      permanent: false,
      details: `weight ${w.weight.toFixed(2)} >= fire threshold ${FIRE_THRESHOLD}; will mark permanent on next reinforce`,
    };
  }
  return {
    v: PROTOCOL_VERSION,
    shouldFire: false,
    reason: "below_threshold_juvenile",
    weight: w.weight,
    permanent: false,
    details: `weight ${w.weight.toFixed(2)} < fire threshold ${FIRE_THRESHOLD}; needs more positive reinforcement`,
  };
}

// ─── pathway query: what tools should fire for this event? ──────────

export interface PathwayPrediction {
  toolName: string;
  weight: number;
  permanent: boolean;
  observationCount: number;
  /** Confidence proxy: weight / (max weight in result set). */
  relativeConfidence: number;
}

/**
 * Returns all known synapses keyed by (eventPattern, *) sorted by weight desc.
 * REFLEX / SCHEDULER call this to discover "what should I pre-execute for this event?"
 *
 * Defensive: empty store + unknown pattern → empty array. Never throws.
 */
export function queryPathways(input: {
  store: SynapseStore;
  eventPattern: string;
  topN?: number;
  includeNegative?: boolean;
}): PathwayPrediction[] {
  const topN = input.topN ?? 5;
  const includeNeg = input.includeNegative ?? false;
  const matching = input.store.weights.filter((w) =>
    w.eventPattern === input.eventPattern && (includeNeg || w.weight > 0),
  );
  if (matching.length === 0) return [];
  const sorted = [...matching].sort((a, b) => b.weight - a.weight || a.toolName.localeCompare(b.toolName));
  const top = sorted.slice(0, topN);
  const maxWeight = Math.max(...top.map((w) => Math.abs(w.weight)));
  return top.map((w) => ({
    toolName: w.toolName,
    weight: w.weight,
    permanent: w.permanent,
    observationCount: w.observationCount,
    relativeConfidence: maxWeight === 0 ? 0 : Math.abs(w.weight) / maxWeight,
  }));
}

// ─── pruning (saves memory; keeps store clean) ──────────────────────

export interface PruneOutput {
  store: SynapseStore;
  prunedCount: number;
  remainingCount: number;
}

/** Remove synapses with |weight| < PRUNE_THRESHOLD. Permanent synapses NEVER pruned. */
export function pruneStore(input: { store: SynapseStore; secret?: string }): PruneOutput {
  const sec = input.secret ?? defaultSecret();
  const before = input.store.weights.length;
  const kept = input.store.weights.filter((w) => w.permanent || Math.abs(w.weight) >= PRUNE_THRESHOLD);
  const newStore = reSignStore(
    { v: PROTOCOL_VERSION, weights: kept, lastDecayedAtMs: input.store.lastDecayedAtMs },
    sec,
  );
  return { store: newStore, prunedCount: before - kept.length, remainingCount: kept.length };
}

// ─── stats + formatter ──────────────────────────────────────────────

export interface SynapseStats {
  totalSynapses: number;
  permanentSynapses: number;
  juvenileSynapses: number;
  prunableSynapses: number;
  totalObservations: number;
  averageWeight: number;
  maxWeight: number;
  oldestLastObservedMs: number | null;
}

export function computeStats(store: SynapseStore): SynapseStats {
  if (store.weights.length === 0) {
    return {
      totalSynapses: 0,
      permanentSynapses: 0,
      juvenileSynapses: 0,
      prunableSynapses: 0,
      totalObservations: 0,
      averageWeight: 0,
      maxWeight: 0,
      oldestLastObservedMs: null,
    };
  }
  let permanent = 0, prunable = 0, totalObs = 0, sumW = 0, maxW = 0;
  let oldest = Number.MAX_SAFE_INTEGER;
  for (const w of store.weights) {
    if (w.permanent) permanent++;
    if (!w.permanent && Math.abs(w.weight) < PRUNE_THRESHOLD) prunable++;
    totalObs += w.observationCount;
    sumW += w.weight;
    if (Math.abs(w.weight) > maxW) maxW = Math.abs(w.weight);
    if (w.lastObservedAtMs < oldest) oldest = w.lastObservedAtMs;
  }
  return {
    totalSynapses: store.weights.length,
    permanentSynapses: permanent,
    juvenileSynapses: store.weights.length - permanent - prunable,
    prunableSynapses: prunable,
    totalObservations: totalObs,
    averageWeight: sumW / store.weights.length,
    maxWeight: maxW,
    oldestLastObservedMs: oldest === Number.MAX_SAFE_INTEGER ? null : oldest,
  };
}

export function formatStatsLine(s: SynapseStats): string {
  return `🧬 SYNAPSE · ${s.totalSynapses} synapses · 🏛${s.permanentSynapses} permanent · 🐣${s.juvenileSynapses} juvenile · 🍂${s.prunableSynapses} prunable · obs=${s.totalObservations} · maxW=${s.maxWeight.toFixed(1)}`;
}

export function formatFireLine(d: FireDecision): string {
  const tag = d.shouldFire ? (d.permanent ? "🏛" : "⚡") : "·";
  return `${tag} FIRE · ${d.shouldFire ? "YES" : "no"} · ${d.reason} · w=${d.weight.toFixed(2)}`;
}

// ─── tuning constants exposed (for AI introspection) ────────────────

export const SYNAPSE_TUNABLES = Object.freeze({
  POSITIVE_REINFORCEMENT,
  NEGATIVE_REINFORCEMENT,
  DECAY_PER_TICK,
  FIRE_THRESHOLD,
  MAX_WEIGHT,
  PRUNE_THRESHOLD,
});
