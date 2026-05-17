/**
 * v2.19.25 — MNEME ENDOCRINE (extends v2.19.23 HORMONAL)
 *
 *   "Mneme อ่าน mood signals (commit tone, time-of-day, idle pattern,
 *    error frequency) → ผลิต 'hormones' ที่ทุก organ ฟัง → behavior
 *    ทั้งระบบเปลี่ยน"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.23 HORMONAL ships 3 generic signals (focus /
 *   fatigue / mood) — useful but abstract. The user wants the named
 *   biological vocabulary that maps DIRECTLY to behavior:
 *     - CORTISOL (stress)   → reflex calmer, daemon quieter
 *     - DOPAMINE (flow)     → reflex strengthens current pattern
 *     - MELATONIN (rest)    → deep dream cycle, suppress all
 *     - OXYTOCIN (social)   → surface TRINITY + CONFESSIONAL
 *
 *   ENDOCRINE adds 4 NAMED hormones with explicit source detectors +
 *   cross-organ effect ladder. Each hormone has its own decay
 *   constant + clamped to [0,1]. Sources are pure-function classifiers
 *   over commit messages / clock / streak signals.
 *
 *   Composes onto v2.19.23 HORMONAL (HormonalState is parallel; both
 *   coexist — generic and named — caller picks abstraction level).
 *
 * Honest scope:
 *   - PURE FUNCTION classifiers + state update. Caller hooks the actual
 *     signal sources (commit msg / shell error code / system clock /
 *     idle detect).
 *   - Hormone levels are CORRELATION not CAUSATION; the cross-organ
 *     "effects" are POLICIES, applied by each organ at its own pace.
 *   - HMAC-chained ledger so daemon can audit hormone evolution over
 *     time + roll back if a misclassified signal spikes a hormone wrongly.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const CLAMP = (x: number) => Math.max(0, Math.min(1, x));

export type Hormone = "cortisol" | "dopamine" | "melatonin" | "oxytocin";

export interface EndocrineState {
  v: typeof PROTOCOL_VERSION;
  /** stress: 0..1; high = system anxious */
  cortisol: number;
  /** flow: 0..1; high = system in deep work / streak */
  dopamine: number;
  /** rest: 0..1; high = late night / sleep approaching */
  melatonin: number;
  /** social: 0..1; high = collaborative session */
  oxytocin: number;
  ts: number;
}

/** Raw signals the caller observes from the environment. */
export interface EndocrineSignals {
  /** Commit message text (last commit). Used by cortisol + oxytocin. */
  commitMessage?: string;
  /** Error count in the last 15-minute window. Used by cortisol. */
  errorCountWindow?: number;
  /** Local hour of day (0..23). Used by cortisol + melatonin. */
  hourOfDay?: number;
  /** Streak count of consecutive successful commits (used by dopamine). */
  greenStreakCount?: number;
  /** Streak count of consecutive test passes (used by dopamine). */
  testPassStreakCount?: number;
  /** Idle milliseconds since last user activity. Used by melatonin. */
  idleMs?: number;
  /** Does the commit have Co-Authored-By? Used by oxytocin. */
  hasCoAuthor?: boolean;
  /** Number of distinct authors touching the file this hour. Used by oxytocin. */
  distinctAuthorsHour?: number;
  /** ms since previous endocrine update — drives natural decay. */
  elapsedMs: number;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_ENDOCRINE_SECRET"] || `mneme-endocrine-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function neutralEndocrineState(ts = 0): EndocrineState {
  return { v: PROTOCOL_VERSION, cortisol: 0, dopamine: 0, melatonin: 0, oxytocin: 0, ts };
}

// ─── source detectors (pure functions over signal) ──────────────────

/**
 * CORTISOL spikes from:
 *   - Stress keywords in commit msg (case-insensitive):
 *     fuck / damn / finally / broken / wtf / fix-fix / hotfix / rollback
 *   - Error count > 3 in 15-min window
 *   - Late-night activity (22:00..03:00)
 */
export function detectCortisolDelta(signals: EndocrineSignals): number {
  let delta = 0;
  if (signals.commitMessage) {
    const m = signals.commitMessage.toLowerCase();
    if (/\b(fuck|damn|finally|broken|wtf|fix[\s-]?fix|hotfix|rollback)\b/.test(m)) delta += 0.18;
  }
  if (typeof signals.errorCountWindow === "number" && signals.errorCountWindow > 3) {
    delta += Math.min(0.25, signals.errorCountWindow * 0.04);
  }
  if (typeof signals.hourOfDay === "number") {
    const h = signals.hourOfDay;
    if (h >= 22 || h <= 3) delta += 0.08;
  }
  return delta;
}

/**
 * DOPAMINE spikes from:
 *   - greenStreakCount >= 5 consecutive successful commits
 *   - testPassStreakCount >= 5
 *   - No errors in the last window
 */
export function detectDopamineDelta(signals: EndocrineSignals): number {
  let delta = 0;
  if (typeof signals.greenStreakCount === "number" && signals.greenStreakCount >= 5) {
    delta += Math.min(0.2, (signals.greenStreakCount - 4) * 0.04);
  }
  if (typeof signals.testPassStreakCount === "number" && signals.testPassStreakCount >= 5) {
    delta += Math.min(0.15, (signals.testPassStreakCount - 4) * 0.03);
  }
  if (typeof signals.errorCountWindow === "number" && signals.errorCountWindow === 0) {
    delta += 0.05;
  }
  return delta;
}

/**
 * MELATONIN spikes from:
 *   - Late local hour (22:00 onwards; peaks at 02:00)
 *   - Sustained idle (>15min)
 */
export function detectMelatoninDelta(signals: EndocrineSignals): number {
  let delta = 0;
  if (typeof signals.hourOfDay === "number") {
    const h = signals.hourOfDay;
    // Peak melatonin around 02:00; high from 22:00 to 06:00.
    if (h >= 22) delta += (h - 21) * 0.04;
    else if (h <= 5) delta += (6 - h) * 0.04;
  }
  if (typeof signals.idleMs === "number" && signals.idleMs >= 15 * 60_000) {
    delta += Math.min(0.2, (signals.idleMs / (15 * 60_000)) * 0.06);
  }
  return delta;
}

/**
 * OXYTOCIN spikes from:
 *   - Co-Authored-By trailer in commit message
 *   - distinctAuthorsHour >= 2 (pair / mob session)
 */
export function detectOxytocinDelta(signals: EndocrineSignals): number {
  let delta = 0;
  if (signals.hasCoAuthor) delta += 0.2;
  if (signals.commitMessage && /co-authored-by:/i.test(signals.commitMessage)) delta += 0.1;
  if (typeof signals.distinctAuthorsHour === "number" && signals.distinctAuthorsHour >= 2) {
    delta += Math.min(0.15, (signals.distinctAuthorsHour - 1) * 0.05);
  }
  return delta;
}

/**
 * Half-life decay per hormone (different time constants reflect biology):
 *   cortisol  — fast decay (stress passes)
 *   dopamine  — fast decay (flow is fragile)
 *   melatonin — slow decay (sleep pressure builds + releases gradually)
 *   oxytocin  — medium decay (social warmth lingers)
 */
const HALF_LIFE_MIN: Record<Hormone, number> = {
  cortisol: 30,
  dopamine: 20,
  melatonin: 90,
  oxytocin: 60,
};

function decayFactor(elapsedMs: number, halfLifeMin: number): number {
  const minutes = elapsedMs / 60_000;
  // Standard half-life decay: x * 0.5^(t/h)
  return Math.pow(0.5, minutes / halfLifeMin);
}

/** Evolve endocrine state given new signals + elapsed time. */
export function produceFromSignals(input: {
  state: EndocrineState;
  signals: EndocrineSignals;
  nowMs?: number;
}): EndocrineState {
  const decayed = {
    cortisol: input.state.cortisol * decayFactor(input.signals.elapsedMs, HALF_LIFE_MIN.cortisol),
    dopamine: input.state.dopamine * decayFactor(input.signals.elapsedMs, HALF_LIFE_MIN.dopamine),
    melatonin: input.state.melatonin * decayFactor(input.signals.elapsedMs, HALF_LIFE_MIN.melatonin),
    oxytocin: input.state.oxytocin * decayFactor(input.signals.elapsedMs, HALF_LIFE_MIN.oxytocin),
  };
  return {
    v: PROTOCOL_VERSION,
    cortisol: CLAMP(decayed.cortisol + detectCortisolDelta(input.signals)),
    dopamine: CLAMP(decayed.dopamine + detectDopamineDelta(input.signals)),
    melatonin: CLAMP(decayed.melatonin + detectMelatoninDelta(input.signals)),
    oxytocin: CLAMP(decayed.oxytocin + detectOxytocinDelta(input.signals)),
    ts: input.nowMs ?? input.state.ts + input.signals.elapsedMs,
  };
}

// ─── cross-organ effect ladder ──────────────────────────────────────

export interface CrossOrganEffects {
  /** REFLEX: 0..1; high = aggressive (lots of predictions); low = calm. */
  reflexAggressiveness: number;
  /** Daemon notification volume: 0..1; high = quiet; low = chatty. */
  daemonQuietness: number;
  /** DREAM cycle depth: 0..1; high = deep consolidation; low = light. */
  dreamCycleDepth: number;
  /** Suppress non-critical notifications? */
  notificationsSuppressed: boolean;
  /** Surface TRINITY VOTE + CONFESSIONAL on next ambiguous decision? */
  surfaceTrinityAndConfessional: boolean;
  /** One-line summary describing the dominant hormone state. */
  dominantMood: string;
}

/**
 * Hormones → organ behavior. Pure function over current state.
 *
 *   - cortisol high → reflex calmer (less aggressive); daemon quieter; suppress notifications
 *   - dopamine high → reflex strengthens current pattern (aggressive surface advanced tools)
 *   - melatonin high → deep dream cycle; SUPPRESS notifications (let user rest)
 *   - oxytocin high → surface TRINITY + CONFESSIONAL (collaboration tools)
 */
export function crossOrganEffects(state: EndocrineState): CrossOrganEffects {
  // Baseline 0.5; adjusted by hormone balance.
  let aggressiveness = 0.5;
  aggressiveness -= state.cortisol * 0.4; // stress calms
  aggressiveness += state.dopamine * 0.4; // flow energises
  aggressiveness -= state.melatonin * 0.3; // sleep calms
  aggressiveness = CLAMP(aggressiveness);

  let quietness = 0.3;
  quietness += state.cortisol * 0.4;       // stress → quiet
  quietness += state.melatonin * 0.5;      // sleep → very quiet
  quietness -= state.dopamine * 0.2;       // flow → slightly chatty
  quietness = CLAMP(quietness);

  const dreamDepth = CLAMP(0.3 + state.melatonin * 0.7);

  const notificationsSuppressed = state.melatonin >= 0.6 || state.cortisol >= 0.7;
  const surfaceTrinityAndConfessional = state.oxytocin >= 0.4;

  // Dominant mood
  const levels: Array<[Hormone, number]> = [
    ["cortisol", state.cortisol], ["dopamine", state.dopamine],
    ["melatonin", state.melatonin], ["oxytocin", state.oxytocin],
  ];
  levels.sort((a, b) => b[1] - a[1]);
  const top = levels[0]!;
  const dominantMood = top[1] < 0.2 ? "calm baseline" : `${top[0]} dominant (${top[1].toFixed(2)})`;

  return {
    reflexAggressiveness: aggressiveness,
    daemonQuietness: quietness,
    dreamCycleDepth: dreamDepth,
    notificationsSuppressed,
    surfaceTrinityAndConfessional,
    dominantMood,
  };
}

// ─── HMAC-chained ledger ────────────────────────────────────────────

export interface EndocrineRecord {
  v: typeof PROTOCOL_VERSION;
  ts: number;
  state: EndocrineState;
  signals: EndocrineSignals;
  prevSig: string | null;
  sig: string;
}

export interface EndocrineLedger {
  v: typeof PROTOCOL_VERSION;
  records: EndocrineRecord[];
}

export function emptyEndocrineLedger(): EndocrineLedger {
  return { v: PROTOCOL_VERSION, records: [] };
}

export function recordEndocrine(input: {
  ledger: EndocrineLedger;
  state: EndocrineState;
  signals: EndocrineSignals;
  nowMs?: number;
  secret?: string;
}): EndocrineLedger {
  const prev = input.ledger.records[input.ledger.records.length - 1];
  const body: Omit<EndocrineRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    ts: input.nowMs ?? input.state.ts,
    state: input.state,
    signals: input.signals,
    prevSig: prev ? prev.sig : null,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] };
}

export function verifyEndocrineLedger(ledger: EndocrineLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
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

export function formatEndocrineLine(s: EndocrineState): string {
  return `🧪 ENDOCRINE · 🩸${s.cortisol.toFixed(2)} · ⚡${s.dopamine.toFixed(2)} · 🌙${s.melatonin.toFixed(2)} · 💞${s.oxytocin.toFixed(2)}`;
}

export function listHormoneInfo(): Array<{ hormone: Hormone; emoji: string; sources: string[]; effects: string[] }> {
  return [
    {
      hormone: "cortisol",
      emoji: "🩸",
      sources: ["stress keywords in commit msg", "error count > 3 in 15min", "hour 22:00-03:00 (late night)"],
      effects: ["reflex calmer", "daemon quieter", "notifications suppressed at >= 0.7"],
    },
    {
      hormone: "dopamine",
      emoji: "⚡",
      sources: ["green commit streak >= 5", "test pass streak >= 5", "zero errors window"],
      effects: ["reflex aggressive surface advanced tools", "slightly chattier daemon"],
    },
    {
      hormone: "melatonin",
      emoji: "🌙",
      sources: ["late local hour (22:00 onwards)", "early-morning (00:00-06:00)", "idle > 15min"],
      effects: ["deep dream cycle", "very quiet daemon", "notifications suppressed at >= 0.6"],
    },
    {
      hormone: "oxytocin",
      emoji: "💞",
      sources: ["Co-Authored-By trailer", "distinct authors >= 2 in hour"],
      effects: ["surface TRINITY VOTE + CONFESSIONAL", "multi-vendor consensus"],
    },
  ];
}
