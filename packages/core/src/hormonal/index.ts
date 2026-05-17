/**
 * v2.19.23 — MNEME HORMONAL (organ #6 of LIMBIC) · slow signal across all organs
 *
 *   "mood / focus / fatigue ปรับ behavior ทั้งระบบ"
 *
 *   Diagnosis: every organ has its own tunables (BREATH heartbeat budget,
 *   REFLEX prefetch budget, DREAM idle threshold, NEGEV token budget).
 *   Without a meta-signal, every organ tunes itself in isolation — system
 *   never adapts to "AI agent is hitting a lot of errors today; slow
 *   down" or "user is in a deep flow; minimize interruptions".
 *
 *   Fix: HORMONAL ships 3 slow-changing signals (focus / fatigue / mood)
 *   that every organ reads. Caller updates the state from observation
 *   feeds (error rate raises fatigue; cache hit raises mood; rapid
 *   commits raise focus). Every organ exposes a tunable that takes
 *   HormonalState as an optional argument.
 *
 *   Composes onto:
 *     - v2.19.23 BREATH (heartbeatBudgetMs reads fatigue)
 *     - v2.19.22 REFLEX (prefetch budgetMs reads focus)
 *     - v2.19.23 THALAMUS (dream threshold reads mood)
 *     - v2.19.13 NEGEV (token-tax intensity reads fatigue)
 *
 * Honest scope:
 *   - 3 signals, each 0..1 clamped.
 *   - HMAC-chained ledger for tamper-evident state evolution.
 *   - Adjustments are LINEAR + DETERMINISTIC; no ML.
 *   - This is METADATA, not state-machine. Caller updates frequency at
 *     own cadence (e.g., daemon every 60s).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_DECAY_PER_MIN = 0.02;
const CLAMP = (x: number) => Math.max(0, Math.min(1, x));

export interface HormonalState {
  v: typeof PROTOCOL_VERSION;
  /** 0..1 — high = user is in deep work; minimize interruptions. */
  focus: number;
  /** 0..1 — high = AI agent / daemon hitting errors; slow down. */
  fatigue: number;
  /** 0..1 — high = recent cache hits + successful commits; lean forward. */
  mood: number;
  /** ms since epoch of last update. */
  ts: number;
}

export interface HormonalObservation {
  /** +1 per cache hit; -0.5 per cache miss. */
  cacheHit?: boolean;
  /** Raises fatigue by 0.05. */
  toolError?: boolean;
  /** Raises mood by 0.02. */
  successfulCommit?: boolean;
  /** Raises focus by 0.05 per rapid action (>2 actions/min). */
  rapidAction?: boolean;
  /** ms since previous update; used for natural decay. */
  elapsedMs: number;
}

export interface HormonalRecord {
  v: typeof PROTOCOL_VERSION;
  ts: number;
  state: HormonalState;
  observation: HormonalObservation;
  prevSig: string | null;
  sig: string;
}

export interface HormonalLedger {
  v: typeof PROTOCOL_VERSION;
  records: HormonalRecord[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_HORMONAL_SECRET"] || `mneme-hormonal-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function neutralState(ts = 0): HormonalState {
  return { v: PROTOCOL_VERSION, focus: 0.5, fatigue: 0.0, mood: 0.5, ts };
}

/**
 * Apply an observation to evolve the hormonal state. Each signal decays
 * naturally toward 0.5 (focus / mood) or 0.0 (fatigue) at
 * DEFAULT_DECAY_PER_MIN; observation deltas are added after decay.
 */
export function updateHormones(input: {
  state: HormonalState;
  observation: HormonalObservation;
  decayPerMin?: number;
  nowMs?: number;
}): HormonalState {
  const decay = input.decayPerMin ?? DEFAULT_DECAY_PER_MIN;
  const minutes = input.observation.elapsedMs / 60_000;
  const decayAmount = decay * minutes;
  // Natural decay toward baselines
  let focus = input.state.focus + (0.5 - input.state.focus) * Math.min(1, decayAmount);
  let fatigue = input.state.fatigue + (0.0 - input.state.fatigue) * Math.min(1, decayAmount);
  let mood = input.state.mood + (0.5 - input.state.mood) * Math.min(1, decayAmount);
  // Observation deltas
  if (input.observation.cacheHit === true) mood += 0.05;
  if (input.observation.cacheHit === false) mood -= 0.025;
  if (input.observation.toolError) fatigue += 0.05;
  if (input.observation.successfulCommit) mood += 0.02;
  if (input.observation.rapidAction) focus += 0.05;
  return {
    v: PROTOCOL_VERSION,
    focus: CLAMP(focus),
    fatigue: CLAMP(fatigue),
    mood: CLAMP(mood),
    ts: input.nowMs ?? input.state.ts + input.observation.elapsedMs,
  };
}

export interface TunedConfig {
  /** BREATH: heartbeat check budget; high fatigue -> longer. */
  breathHeartbeatMs: number;
  /** REFLEX: prefetch budget; high focus -> shorter (don't interrupt). */
  reflexPrefetchBudgetMs: number;
  /** THALAMUS: idle threshold for dream tier; high mood -> shorter (work harder). */
  dreamIdleThresholdMs: number;
  /** NEGEV: token-tax intensity; high fatigue -> stricter. */
  negevTaxMultiplier: number;
}

export function tuneFromHormones(state: HormonalState): TunedConfig {
  return {
    breathHeartbeatMs: Math.round(50 + state.fatigue * 150),                  // 50..200
    reflexPrefetchBudgetMs: Math.round(200 - state.focus * 100),              // 200..100
    dreamIdleThresholdMs: Math.round(30 * 60_000 - state.mood * 20 * 60_000), // 30min..10min
    negevTaxMultiplier: 1 + state.fatigue * 0.5,                              // 1.0..1.5
  };
}

export function emptyLedger(): HormonalLedger {
  return { v: PROTOCOL_VERSION, records: [] };
}

export function recordHormonal(input: {
  ledger: HormonalLedger;
  state: HormonalState;
  observation: HormonalObservation;
  nowMs?: number;
  secret?: string;
}): HormonalLedger {
  const prev = input.ledger.records[input.ledger.records.length - 1];
  const body: Omit<HormonalRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    ts: input.nowMs ?? input.state.ts,
    state: input.state,
    observation: input.observation,
    prevSig: prev ? prev.sig : null,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] };
}

export function verifyLedger(ledger: HormonalLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < ledger.records.length; i++) {
    const r = ledger.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    if (!safeEqHex(hmacHex(body, sec), sig)) return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    prevSig = sig;
  }
  return { ok: true };
}

export function formatHormonalLine(s: HormonalState): string {
  return `💊 HORMONAL · focus=${s.focus.toFixed(2)} · fatigue=${s.fatigue.toFixed(2)} · mood=${s.mood.toFixed(2)}`;
}
