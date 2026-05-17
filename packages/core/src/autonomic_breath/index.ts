/**
 * v2.19.23 — MNEME AUTONOMIC BREATH (G1 killer · organ #1 of LIMBIC)
 *
 *   "Pulse says 'daemon=running' but status says 'not running' — info
 *    drift. DREAMS / CONSEQUENCE / NEGEV / AUTO-ACTION ทั้งหมดไม่หมุน
 *    เพราะไม่มี scheduler. user ที่ install Mneme แล้วไม่รู้ว่าต้อง
 *    `mneme daemon start` — ใช้แค่ pull-only features."
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: human ไม่ต้อง "คิด" ว่าจะหายใจ. Mneme ทุก function เหมือน
 *   กล้ามเนื้อ — ต้องคิดเองว่าจะใช้ตอนไหน. 90/100 features ค้าง.
 *
 *   Fix at SOURCE: every `mneme <cmd>` invocation does a 50ms silent
 *   PID heartbeat check. Dead → respawn BEFORE the real command runs.
 *   User never has to know `mneme daemon start` exists.
 *
 *   Composes onto packages/cli/src/commands/daemon.ts (existing PID file
 *   + isAlive + spawn detached + writeFileSync PID). This module is
 *   pure-function decision logic; the CLI bin file does the actual
 *   spawn + fs work. Same separation as v2.19.21 SNN AUTO-PROMOTE.
 *
 * Honest scope:
 *   - DECIDES, never SPAWNS. Caller (CLI bin) does the spawn.
 *   - Silent on success (user sees nothing); LOUD on respawn-failed
 *     (caller decides what to print, but action is reported as 'failed').
 *   - Heartbeat budget: 50ms default. Caller times out their own
 *     `process.kill(pid, 0)` if needed.
 *   - HMAC-chained ledger of every (check, action, outcome) so the daemon
 *     can audit "how often was I dead when user invoked me?"
 *   - Multi-platform decisions (windowsHide / detached / stdio) are
 *     hints; CLI implements them.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_HEARTBEAT_BUDGET_MS = 50;
const DEFAULT_RESPAWN_BUDGET_MS = 500;
const STALE_PID_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type BreathAction = "already_alive" | "respawned" | "stale_pid_cleaned" | "no_pid_file" | "failed";

export interface BreathProbe {
  /** Caller-side: did `process.kill(pid, 0)` succeed? */
  pidIsAlive: boolean;
  /** Caller-side: does the PID file exist? */
  pidFileExists: boolean;
  /** Caller-side: PID value read from file (NaN if absent). */
  pid: number;
  /** Caller-side: mtime of PID file in ms epoch (0 if absent). */
  pidFileMtimeMs: number;
  /** Caller's current wall-clock in ms epoch. */
  nowMs: number;
}

export interface BreathDecision {
  v: typeof PROTOCOL_VERSION;
  shouldRespawn: boolean;
  shouldCleanStalePidFile: boolean;
  reason: string;
  /** Suggested spawn budget — caller raises a timeout against this. */
  respawnBudgetMs: number;
  /** Caller decision: hide window on Windows? Daemon is silent service. */
  windowsHide: boolean;
  /** Caller decision: detach from parent so daemon survives shell close. */
  detached: boolean;
  /** Caller decision: ignore stdio so user doesn't see daemon output. */
  silentStdio: boolean;
}

export interface BreathOutcome {
  action: BreathAction;
  ms: number;
  errorMessage?: string;
}

export interface BreathRecord {
  v: typeof PROTOCOL_VERSION;
  ts: number;
  probe: BreathProbe;
  decision: BreathDecision;
  outcome: BreathOutcome;
  prevSig: string | null;
  sig: string;
}

export interface BreathLedger {
  v: typeof PROTOCOL_VERSION;
  records: BreathRecord[];
}

// ─── canonical helpers ────────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_BREATH_SECRET"] || `mneme-autonomic-breath-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

// ─── decision logic ───────────────────────────────────────────────────

/**
 * Decide whether the daemon needs respawning given a heartbeat probe.
 *
 * Rules:
 *   - no pid file at all → respawn (with reason: no_pid_file)
 *   - pid file present + alive → no respawn (already_alive)
 *   - pid file present + dead + pid file is fresh (<30 days) →
 *     respawn + clean stale pid (likely crash)
 *   - pid file present + dead + pid file is stale (>30 days) →
 *     respawn + clean stale pid (old workspace; safe to restart)
 *
 * Returns a structured decision; caller acts on it.
 */
export function decideBreath(input: {
  probe: BreathProbe;
  respawnBudgetMs?: number;
  windowsHide?: boolean;
  detached?: boolean;
  silentStdio?: boolean;
}): BreathDecision {
  const respawnBudgetMs = input.respawnBudgetMs ?? DEFAULT_RESPAWN_BUDGET_MS;
  const windowsHide = input.windowsHide ?? true;
  const detached = input.detached ?? true;
  const silentStdio = input.silentStdio ?? true;
  let shouldRespawn = false;
  let shouldClean = false;
  let reason: string;
  if (!input.probe.pidFileExists) {
    shouldRespawn = true;
    reason = "no_pid_file: daemon never started or pid was cleaned";
  } else if (input.probe.pidIsAlive) {
    shouldRespawn = false;
    reason = `already_alive: pid=${input.probe.pid} responding to kill(0)`;
  } else {
    shouldRespawn = true;
    shouldClean = true;
    const ageMs = input.probe.nowMs - input.probe.pidFileMtimeMs;
    if (ageMs > STALE_PID_THRESHOLD_MS) {
      reason = `stale_pid: file age ${Math.round(ageMs / 86400000)}d > ${Math.round(STALE_PID_THRESHOLD_MS / 86400000)}d threshold`;
    } else {
      reason = `dead_pid: pid=${input.probe.pid} not alive (likely crash); pid file fresh`;
    }
  }
  return {
    v: PROTOCOL_VERSION,
    shouldRespawn,
    shouldCleanStalePidFile: shouldClean,
    reason,
    respawnBudgetMs,
    windowsHide,
    detached,
    silentStdio,
  };
}

/**
 * Returns the suggested heartbeat budget for the caller to use. Pure;
 * returns the constant. Exposed so callers can adjust under HORMONAL
 * state (high fatigue → longer interval).
 */
export function heartbeatBudgetMs(opts?: { hormonal?: { fatigue?: number } }): number {
  const f = Math.max(0, Math.min(1, opts?.hormonal?.fatigue ?? 0));
  // Linear scaling: 0 fatigue → 50ms; 1 fatigue → 200ms (back off when system is loaded).
  return Math.round(DEFAULT_HEARTBEAT_BUDGET_MS + f * 150);
}

// ─── ledger ───────────────────────────────────────────────────────────

export function emptyLedger(): BreathLedger {
  return { v: PROTOCOL_VERSION, records: [] };
}

export function recordBreath(input: {
  ledger: BreathLedger;
  probe: BreathProbe;
  decision: BreathDecision;
  outcome: BreathOutcome;
  nowMs?: number;
  secret?: string;
}): BreathLedger {
  const prev = input.ledger.records[input.ledger.records.length - 1];
  const body: Omit<BreathRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    ts: input.nowMs ?? input.probe.nowMs,
    probe: input.probe,
    decision: input.decision,
    outcome: input.outcome,
    prevSig: prev ? prev.sig : null,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] };
}

export function verifyLedger(ledger: BreathLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
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

export interface BreathStats {
  totalChecks: number;
  alreadyAlive: number;
  respawned: number;
  staleCleaned: number;
  failed: number;
  /** alreadyAlive / total — daemon was up when called. 1.0 = always up. */
  uptimeRatio: number;
}

export function computeStats(ledger: BreathLedger): BreathStats {
  let alreadyAlive = 0, respawned = 0, staleCleaned = 0, failed = 0;
  for (const r of ledger.records) {
    if (r.outcome.action === "already_alive") alreadyAlive++;
    else if (r.outcome.action === "respawned") respawned++;
    else if (r.outcome.action === "stale_pid_cleaned") staleCleaned++;
    else if (r.outcome.action === "failed") failed++;
  }
  const total = ledger.records.length;
  return {
    totalChecks: total,
    alreadyAlive,
    respawned,
    staleCleaned,
    failed,
    uptimeRatio: total === 0 ? 1 : alreadyAlive / total,
  };
}

export function formatBreathLine(d: BreathDecision, o: BreathOutcome): string {
  const tag = o.action === "already_alive" ? "🫁" : o.action === "respawned" ? "🌱" : o.action === "failed" ? "💀" : "🧹";
  return `${tag} BREATH · ${o.action} · ${o.ms}ms · ${d.reason}`;
}
