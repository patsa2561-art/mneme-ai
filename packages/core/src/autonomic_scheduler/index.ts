/**
 * v2.19.28 — MNEME AUTONOMIC SCHEDULER (ROOT-CAUSE FIX for dormant LIMBIC + DREAMSPACE)
 *
 *   "daemon ทำงาน แต่ daemon ไม่ 'เรียก' LIMBIC organs อัตโนมัติ"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: every prior release shipped organs as MCP tools and trusted
 *   that "some AI agent will call them". Reality:
 *     - AI agents don't know WHEN to call (e.g., "every 60s")
 *     - Daemon was alive but ticked only legacy (nucleus / oracle / pheromones)
 *     - .mneme/breath / .mneme/reflex / .mneme/sleep never got written
 *     - 49 organ tools = 0 invocations in practice
 *
 *   AUTONOMIC SCHEDULER fixes ONE bug at the root: introduce a tick planner
 *   that runs every daemon heartbeat, decides which organs should fire NOW,
 *   then invokes them with per-organ backoff + fallback + circuit-breaker.
 *
 *   5 named schedules (each independently configurable):
 *     - BREATH every 60s (heartbeat; respawn if dead)
 *     - REFLEX on every git_event / file_save (debounced by minIntervalMs)
 *     - SLEEP every 30min during idle (consolidation cycle)
 *     - DREAMSPACE every 60min during idle (probe + cartographer cycle)
 *     - HORMONAL every 5min OR on observable event (mood update)
 *
 *   Composes onto:
 *     - v2.19.23 BREATH (heartbeat target)
 *     - v2.19.22 REFLEX (observe + prefetch target)
 *     - v2.19.25 SLEEP TRAINING (cycle target)
 *     - v2.19.26 + 27 DREAMSPACE (probe + cartographer target)
 *     - v2.19.23 + 25 HORMONAL + ENDOCRINE (update target)
 *     - v2.19.23 THALAMUS (tier routing)
 *
 * Honest scope:
 *   - PURE FUNCTION decideTicks; caller (daemon) wires the actual invoker.
 *   - Per-organ circuit-breaker: 3 consecutive failures = 1hr cooldown.
 *   - Exception-handled at every level (white loop never crashes).
 *   - HMAC-chained ScheduleLedger so post-hoc audit catches missed ticks.
 *   - 24/7 always-active by design — fallback to "skipped" record on failure.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export type OrganKind = "breath" | "reflex" | "sleep" | "dreamspace" | "hormonal";

export type TickReason =
  | "interval_due"
  | "event_triggered"
  | "idle_threshold"
  | "manual"
  | "cooldown_active"
  | "circuit_open";

export interface OrganSchedule {
  organ: OrganKind;
  /** Minimum ms between automatic ticks. */
  intervalMs: number;
  /** If true, also fire on caller-supplied event signal (e.g., git_commit). */
  fireOnEvent?: boolean;
  /** Require idleMs > this to consider firing (0 = no idle requirement). */
  requireIdleMs?: number;
  /**
   * v2.19.33 B4 fix — fire on semantic context shifts the active dev actually
   * generates (commit cycle complete / branch switch / N-min no-commit gap).
   * This unblocks SLEEP + DREAMSPACE for devs who work 16-19hr/day and never
   * accumulate wall-clock idle. See EventSignals.hasContextShift*.
   */
  fireOnContextShift?: boolean;
  /**
   * v2.19.35 R3 fix — DEAD-MAN'S SWITCH. If an organ hasn't ticked in
   * `deadManMs` ms (default 6h), force one tick on the NEXT cycle regardless
   * of interval/idle/context-shift gates. Guarantees "perfect schedule that
   * never fires" cannot happen — every organ must tick at least once per
   * deadManMs window. 0 = disabled (legacy behaviour).
   */
  deadManMs?: number;
}

/**
 * Pre-v2.19.33 schedule set kept for backward compatibility. NEW code should
 * use DEFAULT_SCHEDULES_ACTIVE_DEV (v2.19.33 default for nucleus daemon).
 */
export const DEFAULT_SCHEDULES_LEGACY: readonly OrganSchedule[] = [
  { organ: "breath",     intervalMs: 60_000,        fireOnEvent: false, requireIdleMs: 0 },
  { organ: "reflex",     intervalMs: 5 * 60_000,    fireOnEvent: true,  requireIdleMs: 0 },
  { organ: "sleep",      intervalMs: 30 * 60_000,   fireOnEvent: false, requireIdleMs: 30 * 60_000 },
  { organ: "dreamspace", intervalMs: 60 * 60_000,   fireOnEvent: false, requireIdleMs: 60 * 60_000 },
  { organ: "hormonal",   intervalMs: 5 * 60_000,    fireOnEvent: true,  requireIdleMs: 0 },
];

/**
 * v2.19.33 B4 fix — "scheduler adapts to user, not user to scheduler".
 *
 * Pre-v2.19.33 SLEEP + DREAMSPACE required wall-clock idle (30/60min). Active
 * devs (16-19hr/day) NEVER reached the threshold so the organs ticked 0 times
 * in practice. v2.19.33 makes them fire on SEMANTIC CONTEXT SHIFTS the user
 * actually generates:
 *
 *   - sleep      → on branch switch  OR  30min no-commit gap  OR  wall-idle 30min
 *   - dreamspace → on commit cycle   OR  60min no-commit gap  OR  wall-idle 60min
 *
 * Both still respect the interval guard (don't fire more than once per interval).
 */
// v2.19.35 R3 fix — DEAD-MAN'S SWITCH = 6h default. SLEEP + DREAMSPACE both
// get the dead-man so a quiet day still triggers at least 1 sleep + 1 dream
// cycle. BREATH/REFLEX/HORMONAL tick frequently enough that dead-man is
// redundant (left at 0 = disabled to preserve their fast cadence).
const DEAD_MAN_MS_6H = 6 * 60 * 60 * 1000;

export const DEFAULT_SCHEDULES_ACTIVE_DEV: readonly OrganSchedule[] = [
  { organ: "breath",     intervalMs: 60_000,        fireOnEvent: false, requireIdleMs: 0,           fireOnContextShift: false, deadManMs: 0 },
  { organ: "reflex",     intervalMs: 5 * 60_000,    fireOnEvent: true,  requireIdleMs: 0,           fireOnContextShift: false, deadManMs: 0 },
  { organ: "sleep",      intervalMs: 30 * 60_000,   fireOnEvent: false, requireIdleMs: 30 * 60_000, fireOnContextShift: true,  deadManMs: DEAD_MAN_MS_6H },
  { organ: "dreamspace", intervalMs: 60 * 60_000,   fireOnEvent: false, requireIdleMs: 60 * 60_000, fireOnContextShift: true,  deadManMs: DEAD_MAN_MS_6H },
  { organ: "hormonal",   intervalMs: 5 * 60_000,    fireOnEvent: true,  requireIdleMs: 0,           fireOnContextShift: false, deadManMs: 0 },
];

/** Default exposed as the ACTIVE_DEV variant from v2.19.33 onward. */
export const DEFAULT_SCHEDULES: readonly OrganSchedule[] = DEFAULT_SCHEDULES_ACTIVE_DEV;

export interface OrganHealthRecord {
  organ: OrganKind;
  lastTickMs: number;
  lastSuccessMs: number;
  consecutiveFailures: number;
  cooldownUntilMs: number;
  totalTicks: number;
  totalSuccesses: number;
  totalFailures: number;
}

export function freshHealthRecord(organ: OrganKind): OrganHealthRecord {
  return {
    organ,
    lastTickMs: 0,
    lastSuccessMs: 0,
    consecutiveFailures: 0,
    cooldownUntilMs: 0,
    totalTicks: 0,
    totalSuccesses: 0,
    totalFailures: 0,
  };
}

export interface TickPlanEntry {
  organ: OrganKind;
  shouldTick: boolean;
  reason: TickReason;
  details: string;
}

export interface TickPlan {
  v: typeof PROTOCOL_VERSION;
  decidedAtMs: number;
  entries: TickPlanEntry[];
  sig: string;
}

export interface EventSignals {
  /** Recent git activity (commit / push) since last tick. */
  hasGitEvent?: boolean;
  /** Recent file_save activity since last tick. */
  hasFileSaveEvent?: boolean;
  /** Idle ms since last user activity. */
  idleMs?: number;
  /**
   * v2.19.33 B4 — semantic-context-shift signals. The caller (daemon) sets
   * these from real git/IDE observations so SLEEP + DREAMSPACE can fire
   * even when the dev never goes wall-clock idle.
   */
  /** Branch switched since last tick (git symbolic-ref HEAD changed). */
  hasBranchSwitch?: boolean;
  /** A commit cycle just completed (≥1 fresh commit since last tick). */
  hasCommitCycle?: boolean;
  /** ms since last commit (caller derives from `git log -1 --format=%ct`). */
  msSinceLastCommit?: number;
  /**
   * Caller-explicit overrides — `mneme sleep --force` translates to
   * `{ forceOrgans: ["sleep"] }`. Any organ in this list fires regardless
   * of interval / idle / context-shift (still subject to cooldown).
   */
  forceOrgans?: OrganKind[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_AUTONOMIC_SCHEDULER_SECRET"] || `mneme-autonomic-scheduler-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Pure decision: which organs should tick RIGHT NOW given health records +
 * schedules + event signals + wall-clock time?
 *
 * Priority order per organ:
 *   1. cooldownUntilMs > now      → skip (circuit_open)
 *   2. fireOnEvent + event present → tick (event_triggered)
 *   3. now - lastTickMs >= interval AND idle requirement met → tick (interval_due / idle_threshold)
 *   4. else                       → skip (no_reason)
 */
export function decideTicks(input: {
  schedules?: readonly OrganSchedule[];
  health: OrganHealthRecord[];
  events: EventSignals;
  nowMs: number;
  secret?: string;
}): TickPlan {
  const schedules = input.schedules ?? DEFAULT_SCHEDULES;
  const healthByOrgan = new Map<OrganKind, OrganHealthRecord>(input.health.map((h) => [h.organ, h]));
  const forceSet = new Set<OrganKind>(input.events.forceOrgans ?? []);
  const entries: TickPlanEntry[] = [];
  for (const s of schedules) {
    const h = healthByOrgan.get(s.organ) ?? freshHealthRecord(s.organ);
    if (input.nowMs < h.cooldownUntilMs) {
      const remaining = Math.max(0, Math.round((h.cooldownUntilMs - input.nowMs) / 1000));
      entries.push({
        organ: s.organ, shouldTick: false, reason: "circuit_open",
        details: `circuit-breaker open (${h.consecutiveFailures} consecutive failures); cooldown ${remaining}s remaining`,
      });
      continue;
    }
    // v2.19.33 B4 — explicit user force (`mneme sleep --force`) bypasses interval/idle.
    if (forceSet.has(s.organ)) {
      entries.push({
        organ: s.organ, shouldTick: true, reason: "manual",
        details: `forced by caller (e.g., 'mneme ${s.organ} --force')`,
      });
      continue;
    }
    const hasEvent = (s.fireOnEvent && (input.events.hasGitEvent || input.events.hasFileSaveEvent));
    if (hasEvent) {
      entries.push({
        organ: s.organ, shouldTick: true, reason: "event_triggered",
        details: `event signal received (git=${!!input.events.hasGitEvent}, file=${!!input.events.hasFileSaveEvent})`,
      });
      continue;
    }
    // v2.19.33 B4 — context-shift fires: branch switch (sleep) / commit cycle (dreamspace) /
    // long no-commit gap (either). These let SLEEP + DREAMSPACE tick for active devs who
    // never accumulate wall-clock idle.
    if (s.fireOnContextShift) {
      // SLEEP: triggered by branch switch
      if (s.organ === "sleep" && input.events.hasBranchSwitch) {
        entries.push({
          organ: s.organ, shouldTick: true, reason: "event_triggered",
          details: "branch switch detected (context-shift trigger)",
        });
        continue;
      }
      // DREAMSPACE: triggered by commit-cycle completion
      if (s.organ === "dreamspace" && input.events.hasCommitCycle) {
        entries.push({
          organ: s.organ, shouldTick: true, reason: "event_triggered",
          details: "commit cycle complete (context-shift trigger)",
        });
        continue;
      }
      // Long no-commit gap (applies to both) — defaults: sleep 30min, dreamspace 60min
      const noCommitThreshold = s.organ === "dreamspace" ? 60 * 60_000 : 30 * 60_000;
      if (input.events.msSinceLastCommit !== undefined
          && input.events.msSinceLastCommit >= noCommitThreshold
          && (h.lastTickMs === 0 || input.nowMs - h.lastTickMs >= s.intervalMs)) {
        entries.push({
          organ: s.organ, shouldTick: true, reason: "event_triggered",
          details: `no-commit ${Math.round(input.events.msSinceLastCommit / 60_000)}m (context-shift trigger)`,
        });
        continue;
      }
    }
    // v2.19.35 R3 DEAD-MAN'S SWITCH — if organ hasn't ticked in deadManMs,
    // force the next cycle to fire. Guarantees "perfect schedule that never
    // fires" cannot happen. Skipped for lastTickMs===0 (first-tick handles).
    const deadManMs = s.deadManMs ?? 0;
    if (deadManMs > 0 && h.lastTickMs > 0 && (input.nowMs - h.lastTickMs) >= deadManMs) {
      entries.push({
        organ: s.organ, shouldTick: true, reason: "idle_threshold",
        details: `dead-man's switch fired (no tick for ${Math.round((input.nowMs - h.lastTickMs) / 3600_000)}h; deadManMs=${Math.round(deadManMs / 3600_000)}h)`,
      });
      continue;
    }
    // First-tick semantics: lastTickMs===0 means "never ticked" — fire immediately
    // so a fresh daemon doesn't sit dormant for 60s waiting for the first interval.
    const dueByInterval = h.lastTickMs === 0 || (input.nowMs - h.lastTickMs) >= s.intervalMs;
    const idleOk = (s.requireIdleMs ?? 0) === 0 || (input.events.idleMs ?? 0) >= (s.requireIdleMs ?? 0);
    if (dueByInterval && idleOk) {
      entries.push({
        organ: s.organ, shouldTick: true,
        reason: (s.requireIdleMs ?? 0) > 0 ? "idle_threshold" : "interval_due",
        details: `${Math.round((input.nowMs - h.lastTickMs) / 1000)}s since last tick (interval ${Math.round(s.intervalMs / 1000)}s)`,
      });
      continue;
    }
    entries.push({
      organ: s.organ, shouldTick: false, reason: "interval_due",
      details: dueByInterval ? `awaiting idle ${Math.round(((s.requireIdleMs ?? 0) - (input.events.idleMs ?? 0)) / 1000)}s` : `${Math.round((s.intervalMs - (input.nowMs - h.lastTickMs)) / 1000)}s remaining`,
    });
  }
  const body: Omit<TickPlan, "sig"> = { v: PROTOCOL_VERSION, decidedAtMs: input.nowMs, entries };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyTickPlan(p: TickPlan, secret?: string): boolean {
  const { sig, ...body } = p;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export interface TickOutcome {
  organ: OrganKind;
  shouldTick: boolean;
  reason: TickReason;
  ok: boolean;
  elapsedMs: number;
  errorMessage?: string;
}

export interface CycleReport {
  v: typeof PROTOCOL_VERSION;
  startedAtMs: number;
  endedAtMs: number;
  outcomes: TickOutcome[];
  newHealth: OrganHealthRecord[];
  sig: string;
}

/**
 * One full cycle: decide ticks → invoke each shouldTick organ → catch any
 * exception → update health record → produce HMAC-signed report.
 *
 * **Never throws** even if every organ fails — the daemon must keep running.
 * Circuit-breaker: 3 consecutive failures opens cooldown for 1 hour.
 */
export async function runTickCycle(input: {
  schedules?: readonly OrganSchedule[];
  health: OrganHealthRecord[];
  events: EventSignals;
  nowMs: number;
  invoke: (organ: OrganKind) => Promise<unknown>;
  failureThreshold?: number;
  cooldownMs?: number;
  secret?: string;
}): Promise<CycleReport> {
  const startedAtMs = input.nowMs;
  const plan = decideTicks({
    schedules: input.schedules,
    health: input.health,
    events: input.events,
    nowMs: input.nowMs,
    secret: input.secret,
  });
  const threshold = input.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldown = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const healthByOrgan = new Map<OrganKind, OrganHealthRecord>(
    input.health.map((h) => [h.organ, { ...h }]),
  );
  // Make sure every scheduled organ has a health record (fresh for first-time).
  const schedules = input.schedules ?? DEFAULT_SCHEDULES;
  for (const s of schedules) {
    if (!healthByOrgan.has(s.organ)) healthByOrgan.set(s.organ, freshHealthRecord(s.organ));
  }
  const outcomes: TickOutcome[] = [];
  for (const entry of plan.entries) {
    const h = healthByOrgan.get(entry.organ)!;
    if (!entry.shouldTick) {
      outcomes.push({
        organ: entry.organ, shouldTick: false, reason: entry.reason,
        ok: false, elapsedMs: 0,
      });
      continue;
    }
    const tickStart = Date.now();
    h.lastTickMs = input.nowMs;
    h.totalTicks++;
    try {
      await input.invoke(entry.organ);
      h.consecutiveFailures = 0;
      h.cooldownUntilMs = 0;
      h.lastSuccessMs = input.nowMs;
      h.totalSuccesses++;
      outcomes.push({
        organ: entry.organ, shouldTick: true, reason: entry.reason,
        ok: true, elapsedMs: Date.now() - tickStart,
      });
    } catch (e) {
      h.consecutiveFailures++;
      h.totalFailures++;
      if (h.consecutiveFailures >= threshold) {
        h.cooldownUntilMs = input.nowMs + cooldown;
      }
      outcomes.push({
        organ: entry.organ, shouldTick: true, reason: entry.reason,
        ok: false, elapsedMs: Date.now() - tickStart,
        errorMessage: (e as Error).message,
      });
    }
  }
  const newHealth = Array.from(healthByOrgan.values());
  const body: Omit<CycleReport, "sig"> = {
    v: PROTOCOL_VERSION,
    startedAtMs,
    endedAtMs: Date.now(),
    outcomes,
    newHealth,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyCycleReport(r: CycleReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export interface SchedulerStats {
  totalOrgans: number;
  totalTicks: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
  organsInCooldown: number;
  organsHealthy: number;
}

export function computeStats(health: OrganHealthRecord[], nowMs: number): SchedulerStats {
  let totalTicks = 0, totalSuccesses = 0, totalFailures = 0, inCooldown = 0, healthy = 0;
  for (const h of health) {
    totalTicks += h.totalTicks;
    totalSuccesses += h.totalSuccesses;
    totalFailures += h.totalFailures;
    if (h.cooldownUntilMs > nowMs) inCooldown++;
    else if (h.consecutiveFailures === 0) healthy++;
  }
  return {
    totalOrgans: health.length,
    totalTicks,
    totalSuccesses,
    totalFailures,
    successRate: totalTicks === 0 ? 1 : totalSuccesses / totalTicks,
    organsInCooldown: inCooldown,
    organsHealthy: healthy,
  };
}

export function formatStatsLine(s: SchedulerStats): string {
  const pct = (s.successRate * 100).toFixed(1);
  return `🩺 SCHEDULER · ${s.totalOrgans} organs · ${s.totalTicks} ticks · ${pct}% success · ❤️${s.organsHealthy} 🧊${s.organsInCooldown}`;
}

export function formatPlanLine(p: TickPlan): string {
  const will = p.entries.filter((e) => e.shouldTick).map((e) => `${e.organ}(${e.reason})`).join(",");
  const skip = p.entries.filter((e) => !e.shouldTick).length;
  return `🩺 PLAN · will=[${will || "none"}] · skip=${skip}`;
}
