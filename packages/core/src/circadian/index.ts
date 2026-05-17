/**
 * v2.19.29 — MNEME CIRCADIAN PHASE CLASSIFIER (Phase B of SYNAPSE GENESIS)
 *
 *   "Mneme เป็น organism ที่หลับและตื่นตามคุณ. 06:00 user เปิดเครื่อง →
 *    first command 0ms response (cache warm). 00:00 user หลับ →
 *    DREAMSPACE.probe + cartographer + synthesize + evolve."
 *                                          — user mandate, 2026-05-17
 *
 *   Diagnosis: v2.19.28 AUTONOMIC SCHEDULER ticks all organs on the SAME
 *   clock 24/7. That wastes resources (DREAMSPACE probing at 14:00 when
 *   user is mid-keystroke) and misses optimal phases (REFLEX cache warming
 *   at 05:50 before user opens their laptop).
 *
 *   CIRCADIAN classifies the current moment into one of 5 biological
 *   phases. Each organ subscribes to its preferred phase(s). SYNAPSE
 *   GENESIS uses this to GATE fires — a synapse only fires when its
 *   tool is "awake" in the current phase.
 *
 *   5 phases:
 *     🌅 WAKE_TRANSITION  04:00-06:00  (pre-warm caches)
 *     🌞 AWAKE            06:00-21:00  (active organs)
 *     🌆 DROWSY           21:00-23:00  (taper, prep for sleep)
 *     😴 SLEEP_NREM       23:00-02:00  (deep consolidation; PRUNE + decay)
 *     🌙 SLEEP_REM        02:00-04:00  (DREAMSPACE creative cycle)
 *
 *   Override: if recent user activity (< 5min ago) at ANY phase →
 *   forced to WAKE_TRANSITION (so sudden 03:00 commit still pre-warms).
 *
 *   Composes onto:
 *     - v2.19.29 SYNAPSE GENESIS (phase gates synapse fires)
 *     - v2.19.28 AUTONOMIC SCHEDULER (phase tunes per-organ intervals)
 *     - v2.19.25 ENDOCRINE (phase couples to melatonin level)
 *
 * Honest scope:
 *   - PURE FUNCTION classifier + gating predicate.
 *   - Phase boundaries are CONFIG (caller can override per-user chronotype).
 *   - HMAC-signed PhaseReport so cross-device sync trusts the phase.
 *   - 24/7 always-safe: malformed hourOfDay (NaN / >23) falls back to AWAKE.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const ACTIVITY_TRANSITION_WINDOW_MS = 5 * 60_000;

export type Phase = "WAKE_TRANSITION" | "AWAKE" | "DROWSY" | "SLEEP_NREM" | "SLEEP_REM";

export const PHASE_EMOJI: Record<Phase, string> = {
  WAKE_TRANSITION: "🌅",
  AWAKE: "🌞",
  DROWSY: "🌆",
  SLEEP_NREM: "😴",
  SLEEP_REM: "🌙",
};

export interface PhaseBoundaries {
  /** Hour [0,24) that WAKE_TRANSITION starts. Default 4. */
  wakeTransitionStart: number;
  /** Hour [0,24) that AWAKE starts. Default 6. */
  awakeStart: number;
  /** Hour [0,24) that DROWSY starts. Default 21. */
  drowsyStart: number;
  /** Hour [0,24) that SLEEP_NREM starts. Default 23. */
  sleepNremStart: number;
  /** Hour [0,24) that SLEEP_REM starts. Default 2 (wraps). */
  sleepRemStart: number;
}

export const DEFAULT_BOUNDARIES: Readonly<PhaseBoundaries> = Object.freeze({
  wakeTransitionStart: 4,
  awakeStart: 6,
  drowsyStart: 21,
  sleepNremStart: 23,
  sleepRemStart: 2,
});

export interface PhaseClassifyInput {
  hourOfDay: number;
  /** ms since most recent observed user activity (any kind). */
  msSinceLastActivity?: number;
  boundaries?: PhaseBoundaries;
  secret?: string;
}

export interface PhaseReport {
  v: typeof PROTOCOL_VERSION;
  phase: Phase;
  hourOfDay: number;
  msSinceLastActivity: number | null;
  /** True if recent activity overrode the time-of-day phase. */
  activityOverride: boolean;
  reason: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CIRCADIAN_SECRET"] || `mneme-circadian-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Classify a wall-clock moment into a circadian phase. Defensive at the
 * boundary: malformed hourOfDay (NaN / negative / >=24) falls back to AWAKE.
 *
 * Priority:
 *   1. recent activity within ACTIVITY_TRANSITION_WINDOW → WAKE_TRANSITION
 *   2. otherwise, hour-of-day lookup
 */
export function classifyPhase(input: PhaseClassifyInput): PhaseReport {
  const sec = input.secret ?? defaultSecret();
  const b = input.boundaries ?? DEFAULT_BOUNDARIES;
  let hour = input.hourOfDay;
  // Defensive: clamp to safe range; NaN/non-finite → AWAKE fallback.
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) {
    const body: Omit<PhaseReport, "sig"> = {
      v: PROTOCOL_VERSION,
      phase: "AWAKE",
      hourOfDay: Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 12,
      msSinceLastActivity: input.msSinceLastActivity ?? null,
      activityOverride: false,
      reason: "malformed hourOfDay → AWAKE fallback (defensive default)",
    };
    return { ...body, sig: hmacHex(body, sec) };
  }
  hour = Math.floor(hour);
  // Activity override: any user action in the last 5 minutes nudges us into
  // WAKE_TRANSITION regardless of clock. Caches warm; daemon stays responsive.
  if (typeof input.msSinceLastActivity === "number" && input.msSinceLastActivity >= 0 && input.msSinceLastActivity < ACTIVITY_TRANSITION_WINDOW_MS) {
    const body: Omit<PhaseReport, "sig"> = {
      v: PROTOCOL_VERSION,
      phase: "WAKE_TRANSITION",
      hourOfDay: hour,
      msSinceLastActivity: input.msSinceLastActivity,
      activityOverride: true,
      reason: `recent user activity ${Math.round(input.msSinceLastActivity / 1000)}s ago → forced WAKE_TRANSITION`,
    };
    return { ...body, sig: hmacHex(body, sec) };
  }
  // Time-of-day classifier. Boundaries can wrap midnight.
  // We test in the order: REM (2-4) → WAKE (4-6) → AWAKE (6-21) → DROWSY (21-23) → NREM (23-2).
  let phase: Phase;
  let reason: string;
  if (hour >= b.sleepRemStart && hour < b.wakeTransitionStart) {
    phase = "SLEEP_REM";
    reason = `hour ${hour} in [${b.sleepRemStart},${b.wakeTransitionStart}) → REM (DREAMSPACE creative cycle)`;
  } else if (hour >= b.wakeTransitionStart && hour < b.awakeStart) {
    phase = "WAKE_TRANSITION";
    reason = `hour ${hour} in [${b.wakeTransitionStart},${b.awakeStart}) → WAKE_TRANSITION (cache pre-warm)`;
  } else if (hour >= b.awakeStart && hour < b.drowsyStart) {
    phase = "AWAKE";
    reason = `hour ${hour} in [${b.awakeStart},${b.drowsyStart}) → AWAKE (active organs)`;
  } else if (hour >= b.drowsyStart && hour < b.sleepNremStart) {
    phase = "DROWSY";
    reason = `hour ${hour} in [${b.drowsyStart},${b.sleepNremStart}) → DROWSY (taper)`;
  } else {
    // NREM wraps midnight: hour >= 23 OR hour < 2.
    phase = "SLEEP_NREM";
    reason = `hour ${hour} in [${b.sleepNremStart},${b.sleepRemStart}) wrapping midnight → NREM (deep consolidation + PRUNE)`;
  }
  const body: Omit<PhaseReport, "sig"> = {
    v: PROTOCOL_VERSION,
    phase,
    hourOfDay: hour,
    msSinceLastActivity: input.msSinceLastActivity ?? null,
    activityOverride: false,
    reason,
  };
  return { ...body, sig: hmacHex(body, sec) };
}

export function verifyPhaseReport(r: PhaseReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

// ─── per-tool phase preference map ──────────────────────────────────

/**
 * Each tool family declares its preferred phase(s). Phases the tool does
 * NOT appear in → CIRCADIAN gates the fire (returns shouldFire=false).
 *
 * Wildcards: "*" matches any phase (always-active).
 *
 * Caller (daemon) can override per-deployment; this is the WORLD-CLASS
 * default based on autonomic biology of each organ.
 */
export const DEFAULT_PHASE_PREFERENCE: ReadonlyMap<string, readonly Phase[]> = new Map<string, readonly Phase[]>([
  // BREATH always alive (autonomic, heart-like)
  ["mneme.breath.*", ["AWAKE", "WAKE_TRANSITION", "DROWSY", "SLEEP_NREM", "SLEEP_REM"]],
  // REFLEX warm during active phases + pre-wake
  ["mneme.reflex.*", ["AWAKE", "WAKE_TRANSITION", "DROWSY"]],
  // Bug prophet + audit only during awake (cognitive load)
  ["mneme.bug_prophet.*", ["AWAKE"]],
  ["mneme.forensics.*", ["AWAKE"]],
  ["mneme.apoptosis.*", ["AWAKE"]],
  // Sleep training + DREAMSPACE consolidation only during sleep
  ["mneme.sleep.*", ["SLEEP_NREM", "SLEEP_REM"]],
  ["mneme.dreamspace.*", ["SLEEP_REM"]],
  ["mneme.hippocampus.*", ["SLEEP_NREM", "SLEEP_REM"]],
  // Hormonal slow signals — best around phase transitions
  ["mneme.hormonal.*", ["DROWSY", "WAKE_TRANSITION", "AWAKE"]],
  ["mneme.endocrine.*", ["DROWSY", "WAKE_TRANSITION", "AWAKE"]],
  // SYNAPSE prune during deep sleep only (cleanup phase)
  ["mneme.synapse.prune", ["SLEEP_NREM"]],
  // PROBE + CARTOGRAPHER ideal during REM (low-cost experimentation)
  ["mneme.dreamspace.probe_*", ["SLEEP_REM"]],
  ["mneme.dreamspace.map_*", ["SLEEP_REM", "WAKE_TRANSITION"]],
  // Default fall-through: AWAKE only (safe conservative default)
]);

export interface GatingDecision {
  v: typeof PROTOCOL_VERSION;
  toolName: string;
  currentPhase: Phase;
  shouldFire: boolean;
  matchedRule: string | null;
  reason: string;
}

/**
 * Pure decision: should this tool fire NOW given the current phase?
 *
 * Match strategy:
 *   1. exact match (e.g., "mneme.synapse.prune")
 *   2. family wildcard (e.g., "mneme.reflex.*")
 *   3. action wildcard within family (e.g., "mneme.dreamspace.probe_*")
 *   4. fallback → AWAKE-only (safe conservative default)
 *
 * Defensive: tools with empty toolName → shouldFire=false (never crashes).
 */
export function decideGating(input: {
  toolName: string;
  currentPhase: Phase;
  preferenceMap?: ReadonlyMap<string, readonly Phase[]>;
}): GatingDecision {
  const map = input.preferenceMap ?? DEFAULT_PHASE_PREFERENCE;
  if (!input.toolName || typeof input.toolName !== "string") {
    return {
      v: PROTOCOL_VERSION,
      toolName: input.toolName ?? "",
      currentPhase: input.currentPhase,
      shouldFire: false,
      matchedRule: null,
      reason: "empty toolName → no fire (defensive)",
    };
  }
  // 1. exact match
  if (map.has(input.toolName)) {
    const phases = map.get(input.toolName)!;
    const ok = phases.includes(input.currentPhase);
    return {
      v: PROTOCOL_VERSION,
      toolName: input.toolName,
      currentPhase: input.currentPhase,
      shouldFire: ok,
      matchedRule: input.toolName,
      reason: `exact match ${input.toolName}; allowed=${phases.join(",")} ${ok ? "✓" : "✗"}`,
    };
  }
  // 2. wildcard scan (action-suffix wildcard first, then family wildcard)
  const parts = input.toolName.split(".");
  if (parts.length === 3) {
    // try "mneme.<family>.<actionPrefix>_*"
    const familyPrefix = `${parts[0]}.${parts[1]}.`;
    for (const [rule, phases] of map) {
      if (rule.startsWith(familyPrefix) && rule.endsWith("*")) {
        const ruleAction = rule.slice(familyPrefix.length, -1); // strip prefix + trailing *
        if (ruleAction === "" || parts[2]!.startsWith(ruleAction)) {
          const ok = phases.includes(input.currentPhase);
          return {
            v: PROTOCOL_VERSION,
            toolName: input.toolName,
            currentPhase: input.currentPhase,
            shouldFire: ok,
            matchedRule: rule,
            reason: `wildcard ${rule}; allowed=${phases.join(",")} ${ok ? "✓" : "✗"}`,
          };
        }
      }
    }
  }
  // 4. fallback — AWAKE only
  const fallbackOk = input.currentPhase === "AWAKE";
  return {
    v: PROTOCOL_VERSION,
    toolName: input.toolName,
    currentPhase: input.currentPhase,
    shouldFire: fallbackOk,
    matchedRule: null,
    reason: `no rule matched; fallback AWAKE-only ${fallbackOk ? "✓" : "✗"}`,
  };
}

export function formatPhaseLine(r: PhaseReport): string {
  return `${PHASE_EMOJI[r.phase]} CIRCADIAN · ${r.phase} · hour=${r.hourOfDay}${r.activityOverride ? " (activity override)" : ""}`;
}

export function formatGatingLine(d: GatingDecision): string {
  const tag = d.shouldFire ? "✓" : "✗";
  return `${tag} GATE · ${d.toolName} in ${d.currentPhase} → ${d.shouldFire ? "fire" : "wait"} (${d.matchedRule ?? "fallback"})`;
}

export const CIRCADIAN_TUNABLES = Object.freeze({
  ACTIVITY_TRANSITION_WINDOW_MS,
  DEFAULT_BOUNDARIES,
});
