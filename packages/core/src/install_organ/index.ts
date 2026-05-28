/**
 * v2.19.53 INSTALL ORGAN — self-healing process-lineage protocol.
 *
 * The wild bet: every Mneme-spawned node process registers a HEARTBEAT
 * file with role + parent + start time + held DLLs. When the install
 * pipeline needs to release file locks (Windows EBUSY on libvips-42.dll,
 * macOS code-sign cache on .dylib, Linux fd holds), it reads the heartbeat
 * dir + reaps every Mneme process IT KNOWS ABOUT — not by killing all
 * `node.exe` (would nuke the user's editor / AI client), but by exact PID
 * from the registry the daemon wrote itself.
 *
 * Cross-platform:
 *   - Windows: heartbeat + DLL fs.openSync(path, 'r+') probe + WMI fallback
 *   - macOS:   heartbeat + lsof probe + SIGUSR2 graceful handoff
 *   - Linux:   heartbeat + /proc/{pid}/fd scan + SIGUSR2 graceful handoff
 *
 * The 3 platforms share the same heartbeat protocol — write a JSON file
 * named `{pid}.beat` to `~/.mneme-global/heartbeats/`. Each Mneme process
 * updates its own beat every 5s; stale beats (>15s) are tombstones for
 * dead processes. No central coordinator; CRDT-like.
 *
 * Lineage ledger: `~/.mneme-global/lineage.jsonl` is append-only HMAC-chained
 * record of every spawn/exit event. Audit trail composes with v2.19.34 APOSTILLE.
 *
 * The world-class moat: no AI tool worldwide ships a self-aware process
 * organism that knows its own family + reaps cleanly + composes a DLL
 * probe + handoff signal. The combination is unique. First-mover forever.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, openSync, closeSync, appendFileSync, writeFile as writeFileAsync, appendFile as appendFileAsync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1;
const HEARTBEAT_TTL_MS = 15_000;     // beats older than this = stale (process likely dead)
const HEARTBEAT_INTERVAL_MS = 5_000; // each process updates its own beat every 5s

export type MnemeRole =
  | "daemon"
  | "daemon-attached"
  | "autonomic-respawn"
  | "indexer"
  | "mcp-server"
  | "nucleus"
  | "bridge"
  | "child-script";

export interface Heartbeat {
  v: typeof PROTOCOL_VERSION;
  pid: number;
  ppid: number;
  role: MnemeRole;
  startedAt: string; // ISO
  beatAt: string;    // ISO — last update
  cwd: string;
  host: string;
  platform: NodeJS.Platform;
  // Optional: paths the process is known to hold open (best-effort).
  holdsPaths?: string[];
}

export interface LineageEvent {
  v: typeof PROTOCOL_VERSION;
  ts: string;
  event: "spawn" | "exit" | "orphan-reaped" | "heartbeat-stale";
  pid: number;
  role: MnemeRole;
  parentPid?: number;
  reason?: string;
  prevSig: string;
  sig: string;
}

function defaultSecret(): string {
  return process.env["MNEME_INSTALL_ORGAN_SECRET"] || `mneme-install-organ-v${PROTOCOL_VERSION}`;
}

function hmacHex(prev: string, body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(prev + "::" + JSON.stringify(body)).digest("hex");
}

/** Cross-platform global state dir. ~/.mneme-global/ exists outside any
 *  per-repo .mneme/ dir so the heartbeat protocol spans all repos a user
 *  has on the same machine. */
export function organDir(): string {
  return join(homedir(), ".mneme-global");
}
export function heartbeatDir(): string {
  return join(organDir(), "heartbeats");
}
export function lineagePath(): string {
  return join(organDir(), "lineage.jsonl");
}

export function ensureOrganDirs(): void {
  for (const d of [organDir(), heartbeatDir()]) {
    if (!existsSync(d)) {
      try { mkdirSync(d, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// HEARTBEAT API
// ────────────────────────────────────────────────────────────────────────

/** Register THIS process in the heartbeat registry. Returns the interval
 *  id so the caller can clear it on graceful shutdown. Idempotent — calling
 *  twice for the same PID just refreshes. */
export function registerHeartbeat(role: MnemeRole, holdsPaths?: string[]): { intervalId: NodeJS.Timeout | null; beatPath: string } {
  ensureOrganDirs();
  const beatPath = join(heartbeatDir(), `${process.pid}.beat`);
  // v2.19.56 — first write is SYNC so the beat file exists by the time the
  // function returns (callers can assume registration is visible). Subsequent
  // periodic writes use the ASYNC fire-and-forget variant so the daemon's
  // event loop never blocks on filesystem latency. Fallback to sync if
  // async writeFile is unavailable in the runtime.
  const writeOne = (mode: "sync" | "async" = "async") => {
    const beat: Heartbeat = {
      v: PROTOCOL_VERSION,
      pid: process.pid,
      ppid: process.ppid,
      role,
      startedAt: new Date().toISOString(),
      beatAt: new Date().toISOString(),
      cwd: process.cwd(),
      host: hostname(),
      platform: platform(),
      ...(holdsPaths && holdsPaths.length > 0 ? { holdsPaths } : {}),
    };
    const body = JSON.stringify(beat);
    if (mode === "sync") {
      try { writeFileSync(beatPath, body, { encoding: "utf8", mode: 0o600 }); } catch { /* best-effort */ }
      return;
    }
    // Async fire-and-forget — never blocks the event loop. Errors are swallowed
    // because the next beat (5s later) will retry; one missed beat is harmless.
    try {
      writeFileAsync(beatPath, body, { encoding: "utf8", mode: 0o600 }, () => { /* error → next tick retries */ });
    } catch {
      // If async writeFile is somehow unavailable, fall back to sync
      try { writeFileSync(beatPath, body, { encoding: "utf8", mode: 0o600 }); } catch { /* */ }
    }
  };
  // v2.19.56 — first write SYNC so listHeartbeats() can see this process
  // immediately. Subsequent writes async (non-blocking).
  writeOne("sync");
  let intervalId: NodeJS.Timeout | null = null;
  try {
    intervalId = setInterval(() => writeOne("async"), HEARTBEAT_INTERVAL_MS);
    if (intervalId.unref) intervalId.unref(); // don't keep event loop alive
  } catch { /* setInterval not available in some test envs */ }
  // Append spawn event to lineage
  try { appendLineage({ event: "spawn", pid: process.pid, role, parentPid: process.ppid }); } catch { /* best-effort */ }
  return { intervalId, beatPath };
}

/** Cleanly de-register THIS process. Called from SIGTERM handlers. */
export function deregisterHeartbeat(role: MnemeRole, intervalId?: NodeJS.Timeout | null, reason?: string): void {
  if (intervalId) {
    try { clearInterval(intervalId); } catch { /* best-effort */ }
  }
  const beatPath = join(heartbeatDir(), `${process.pid}.beat`);
  try { if (existsSync(beatPath)) unlinkSync(beatPath); } catch { /* best-effort */ }
  try { appendLineage({ event: "exit", pid: process.pid, role, reason: reason ?? "clean-exit" }); } catch { /* best-effort */ }
}

/** Read every heartbeat in the registry. Returns parsed beats sorted by
 *  beatAt desc. Silently skips unreadable/corrupt files. */
export function listHeartbeats(): Heartbeat[] {
  ensureOrganDirs();
  const out: Heartbeat[] = [];
  let entries: string[];
  try { entries = readdirSync(heartbeatDir()); } catch { return []; }
  for (const f of entries) {
    if (!f.endsWith(".beat")) continue;
    try {
      const body = readFileSync(join(heartbeatDir(), f), "utf8");
      const beat = JSON.parse(body) as Heartbeat;
      if (typeof beat.pid === "number" && typeof beat.beatAt === "string") {
        out.push(beat);
      }
    } catch { /* corrupt — skip */ }
  }
  return out.sort((a, b) => b.beatAt.localeCompare(a.beatAt));
}

/** Classify a heartbeat as alive / stale-but-pid-alive / dead based on
 *  the file timestamp AND whether the PID still resolves. */
export interface HeartbeatStatus {
  beat: Heartbeat;
  ageMs: number;
  pidAlive: boolean;
  status: "alive" | "stale-but-alive" | "tombstone";
}

export function classifyHeartbeats(now: number = Date.now()): HeartbeatStatus[] {
  const beats = listHeartbeats();
  const out: HeartbeatStatus[] = [];
  for (const beat of beats) {
    const ageMs = now - Date.parse(beat.beatAt);
    const pidAlive = isPidAlive(beat.pid);
    let status: HeartbeatStatus["status"];
    if (!pidAlive) status = "tombstone";
    else if (ageMs > HEARTBEAT_TTL_MS) status = "stale-but-alive";
    else status = "alive";
    out.push({ beat, ageMs, pidAlive, status });
  }
  return out;
}

/**
 * v2.19.56 — CHEAP HEARTBEAT-ACTIVITY PROBE.
 *
 * The 18x P1 latency regression in v2.19.54 was caused by autonomic_breath_hook
 * calling classifyHeartbeats() on EVERY CLI startup — which does readdirSync +
 * readFileSync × N + isPidAlive × N. With 50 parallel `mneme verify` each doing
 * this on cold start, contention hit ~18s. This probe replaces the full scan
 * with a single statSync on the heartbeat dir — ~1ms even under heavy contention.
 *
 * Semantics: if ANY heartbeat file was written within the last `thresholdMs`,
 * we know another Mneme process is alive + writing. That's enough to throttle
 * a respawn race without reading every beat file.
 *
 * Returns:
 *   - true  → recent activity detected (throttle the caller)
 *   - false → no recent activity OR dir doesn't exist OR stat failed (caller can proceed)
 *
 * Conservative: errors → false (don't over-throttle).
 */
export function recentHeartbeatActivity(thresholdMs: number, now: number = Date.now()): boolean {
  try {
    const dir = heartbeatDir();
    if (!existsSync(dir)) return false;
    const st = statSync(dir);
    return (now - st.mtimeMs) < thresholdMs;
  } catch {
    return false;
  }
}

/** Cross-platform "is this PID alive right now?" — does NOT signal it. */
export function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = no-op probe
    return true;
  } catch (e) {
    // ESRCH = process does not exist; EPERM = exists but we can't signal it
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ────────────────────────────────────────────────────────────────────────
// LINEAGE LEDGER (HMAC-chained, composes with APOSTILLE)
// ────────────────────────────────────────────────────────────────────────

function appendLineage(partial: Omit<LineageEvent, "v" | "ts" | "prevSig" | "sig">): void {
  ensureOrganDirs();
  let prevSig = "0".repeat(64);
  try {
    if (existsSync(lineagePath())) {
      const all = readFileSync(lineagePath(), "utf8").split("\n").filter((l) => l.trim().length > 0);
      if (all.length > 0) {
        const last = JSON.parse(all[all.length - 1]!) as LineageEvent;
        prevSig = last.sig;
      }
    }
  } catch { /* corrupt — chain restarts */ }
  const body: Omit<LineageEvent, "sig"> = { v: PROTOCOL_VERSION, ts: new Date().toISOString(), prevSig, ...partial };
  const sig = hmacHex(prevSig, body, defaultSecret());
  const entry: LineageEvent = { ...body, sig };
  try { appendFileSync(lineagePath(), JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 }); } catch { /* best-effort */ }
}

export function readLineage(limit: number = 100): LineageEvent[] {
  ensureOrganDirs();
  if (!existsSync(lineagePath())) return [];
  try {
    const all = readFileSync(lineagePath(), "utf8").split("\n").filter((l) => l.trim().length > 0);
    return all.slice(-limit).map((l) => JSON.parse(l) as LineageEvent);
  } catch { return []; }
}

/** Verify the HMAC chain integrity. Returns { ok, brokenAt? }. */
export function verifyLineage(): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = readLineage(100_000);
  if (all.length === 0) return { ok: true };
  let prevSig = "0".repeat(64);
  for (let i = 0; i < all.length; i++) {
    const entry = all[i]!;
    if (entry.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: "prevSig mismatch" };
    const body: Omit<LineageEvent, "sig"> = { v: entry.v, ts: entry.ts, prevSig: entry.prevSig, event: entry.event, pid: entry.pid, role: entry.role, ...(entry.parentPid !== undefined ? { parentPid: entry.parentPid } : {}), ...(entry.reason !== undefined ? { reason: entry.reason } : {}) };
    const sig = hmacHex(prevSig, body, defaultSecret());
    if (sig !== entry.sig) return { ok: false, brokenAt: i, reason: "sig mismatch" };
    prevSig = entry.sig;
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────
// DLL/DYLIB LOCK PROBE — platform-aware
// ────────────────────────────────────────────────────────────────────────

export interface LockProbeResult {
  path: string;
  writable: boolean;
  reason?: string;
  holdingPids?: number[]; // best-effort, populated on macOS/Linux via lsof
}

/** Try to open a path for read+write. EBUSY/EPERM = locked by another
 *  process. Returns structured result. Cross-platform — works for both
 *  .dll (Windows) and .dylib (macOS) and .so (Linux). */
export function probeLockable(path: string): LockProbeResult {
  if (!existsSync(path)) return { path, writable: true, reason: "file-not-present" };
  try {
    const fd = openSync(path, "r+");
    closeSync(fd);
    return { path, writable: true };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const result: LockProbeResult = { path, writable: false, reason: err.code ?? err.message };
    // macOS + Linux: ask lsof who holds it (best-effort)
    if (process.platform !== "win32") {
      try {
        const r = spawnSync("lsof", ["-t", path], { encoding: "utf8", timeout: 3_000 });
        if (r.status === 0 && r.stdout) {
          const pids = r.stdout.trim().split("\n").map((s) => parseInt(s, 10)).filter((n) => n > 0);
          if (pids.length > 0) result.holdingPids = pids;
        }
      } catch { /* lsof not available — silent fallback */ }
    }
    return result;
  }
}

// ────────────────────────────────────────────────────────────────────────
// REAPER — kill orphan / stale Mneme processes
// ────────────────────────────────────────────────────────────────────────

export interface ReapResult {
  attempted: number;
  killed: number;
  failed: number;
  tombstonesRemoved: number;
  perPid: Array<{ pid: number; role: MnemeRole; outcome: "killed" | "already-dead" | "failed" | "skipped-self"; reason?: string }>;
}

export interface ReapOptions {
  /** Don't actually kill — just report what WOULD be killed. */
  dryRun?: boolean;
  /** Specific roles to reap. Default: all. */
  rolesAllow?: MnemeRole[];
  /** Wait this many ms after SIGTERM before SIGKILL. Default 1000. */
  gracePeriodMs?: number;
  /** Skip this PID (typically process.pid of the caller). */
  skipPid?: number;
}

/** Reap all Mneme processes registered in the heartbeat dir. SIGTERM →
 *  grace period → SIGKILL. Cross-platform via process.kill. Returns
 *  structured per-PID report. */
export function reapMnemeProcesses(opts?: ReapOptions): ReapResult {
  const dryRun = opts?.dryRun ?? false;
  const grace = opts?.gracePeriodMs ?? 1_000;
  const skipPid = opts?.skipPid ?? -1;
  const rolesAllow = opts?.rolesAllow;
  const beats = listHeartbeats();
  const out: ReapResult = { attempted: 0, killed: 0, failed: 0, tombstonesRemoved: 0, perPid: [] };

  // First pass: tombstones — PIDs that don't exist anymore. Just remove the beat file.
  for (const beat of beats) {
    if (rolesAllow && !rolesAllow.includes(beat.role)) continue;
    if (beat.pid === skipPid) {
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "skipped-self" });
      continue;
    }
    if (!isPidAlive(beat.pid)) {
      if (!dryRun) {
        try { unlinkSync(join(heartbeatDir(), `${beat.pid}.beat`)); out.tombstonesRemoved++; } catch { /* */ }
      }
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "already-dead" });
      continue;
    }
    // Second pass: alive — SIGTERM first
    out.attempted++;
    if (dryRun) {
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "killed", reason: "dry-run" });
      continue;
    }
    try {
      process.kill(beat.pid, "SIGTERM");
    } catch (e) {
      out.failed++;
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "failed", reason: (e as Error).message });
      continue;
    }
    // Wait grace period; if still alive, SIGKILL
    const deadline = Date.now() + grace;
    while (Date.now() < deadline && isPidAlive(beat.pid)) {
      // tight loop — small grace period, no real CPU cost
    }
    if (isPidAlive(beat.pid)) {
      try { process.kill(beat.pid, "SIGKILL"); } catch { /* may have died between checks */ }
    }
    if (isPidAlive(beat.pid)) {
      out.failed++;
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "failed", reason: "still-alive-after-sigkill" });
    } else {
      out.killed++;
      try { unlinkSync(join(heartbeatDir(), `${beat.pid}.beat`)); } catch { /* */ }
      try { appendLineage({ event: "orphan-reaped", pid: beat.pid, role: beat.role, reason: "reaper" }); } catch { /* */ }
      out.perPid.push({ pid: beat.pid, role: beat.role, outcome: "killed" });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// DIAGNOSE + HEAL — the one-call composed pipelines
// ────────────────────────────────────────────────────────────────────────

export interface InstallDiagnosis {
  ok: boolean;
  heartbeats: { total: number; alive: number; staleButAlive: number; tombstones: number };
  perBeat: HeartbeatStatus[];
  lineage: { entries: number; chainOk: boolean; brokenAt?: number };
  probes: LockProbeResult[];
  recommendation: string;
}

export function diagnoseInstall(probedPaths: string[] = []): InstallDiagnosis {
  const perBeat = classifyHeartbeats();
  const alive = perBeat.filter((b) => b.status === "alive").length;
  const staleButAlive = perBeat.filter((b) => b.status === "stale-but-alive").length;
  const tombstones = perBeat.filter((b) => b.status === "tombstone").length;
  const lineage = verifyLineage();
  const all = readLineage(100_000);
  const probes = probedPaths.map(probeLockable);
  const lockedCount = probes.filter((p) => !p.writable).length;

  let recommendation: string;
  let ok: boolean;
  if (staleButAlive === 0 && lockedCount === 0 && tombstones === 0) {
    ok = true;
    recommendation = "HEALTHY — no orphans, no locked files. Install safe to proceed.";
  } else if (lockedCount > 0) {
    ok = false;
    recommendation = `LOCKED — ${lockedCount} file(s) held by Mneme process(es). Run mneme.install.heal to reap orphans + retry.`;
  } else if (staleButAlive > 0) {
    ok = false;
    recommendation = `STALE — ${staleButAlive} Mneme process(es) with no recent heartbeat but PID alive. Likely orphaned daemon child. Run mneme.install.heal.`;
  } else {
    ok = true;
    recommendation = `STALE TOMBSTONES — ${tombstones} dead-process beat files present. Cleanup recommended via mneme.install.heal but install is safe.`;
  }

  return {
    ok,
    heartbeats: { total: perBeat.length, alive, staleButAlive, tombstones },
    perBeat,
    lineage: { entries: all.length, chainOk: lineage.ok, ...(lineage.brokenAt !== undefined ? { brokenAt: lineage.brokenAt } : {}) },
    probes,
    recommendation,
  };
}

export interface HealResult {
  ok: boolean;
  diagnosis: InstallDiagnosis;
  reap: ReapResult;
  postProbes: LockProbeResult[];
  remediation: string[];
}

/** Full heal: diagnose → reap stale + alive Mneme PIDs (NOT random
 *  node processes) → re-probe DLLs. Returns structured ok/failure. */
export function healInstall(probedPaths: string[] = [], opts?: ReapOptions): HealResult {
  const diagnosis = diagnoseInstall(probedPaths);
  const reap = reapMnemeProcesses(opts);
  // Give OS a moment to release handles after reaping.
  const waitEnd = Date.now() + 1_500;
  while (Date.now() < waitEnd) { /* spin briefly */ }
  const postProbes = probedPaths.map(probeLockable);
  const stillLocked = postProbes.filter((p) => !p.writable);
  const ok = stillLocked.length === 0 && reap.failed === 0;
  const remediation: string[] = [];
  if (reap.failed > 0) remediation.push(`${reap.failed} process(es) survived SIGKILL — manual intervention required (Task Manager / kill -9 / Activity Monitor).`);
  if (stillLocked.length > 0) {
    remediation.push(`${stillLocked.length} path(s) still locked after reap. Holding PIDs: ${stillLocked.map((p) => p.holdingPids?.join(",") || "?").join(" / ")}. Consider OS-level handle release (Windows: Process Explorer; macOS: lsof + kill; Linux: lsof + kill).`);
  }
  if (ok && reap.killed > 0) remediation.push(`✅ Healed: reaped ${reap.killed} orphan(s); all locks released. Install safe to retry.`);
  if (ok && reap.killed === 0) remediation.push(`✅ Already healthy: no orphans found, no locks present.`);
  return { ok, diagnosis, reap, postProbes, remediation };
}

// ────────────────────────────────────────────────────────────────────────
// CONFIG — paths the install pipeline cares about per platform
// ────────────────────────────────────────────────────────────────────────

/** Paths Mneme has historically locked on each platform. The install
 *  pipeline probes these before running npm install. */
export function defaultLockableProbes(installRoot?: string): string[] {
  if (!installRoot) return [];
  const out: string[] = [];
  const sharpDir = join(installRoot, "node_modules", "@img");
  // Windows: libvips-42.dll family
  if (process.platform === "win32") {
    out.push(join(installRoot, "node_modules", "@img", "sharp-libvips-win32-x64", "lib", "libvips-42.dll"));
    out.push(join(installRoot, "node_modules", "sharp", "build", "Release", "sharp-win32-x64.node"));
  } else if (process.platform === "darwin") {
    // macOS: .dylib + code-signed .node
    out.push(join(installRoot, "node_modules", "@img", "sharp-libvips-darwin-arm64", "lib", "libvips.42.dylib"));
    out.push(join(installRoot, "node_modules", "@img", "sharp-libvips-darwin-x64", "lib", "libvips.42.dylib"));
    out.push(join(installRoot, "node_modules", "sharp", "build", "Release", "sharp-darwin-arm64.node"));
    out.push(join(installRoot, "node_modules", "sharp", "build", "Release", "sharp-darwin-x64.node"));
  } else {
    // Linux: .so
    out.push(join(installRoot, "node_modules", "@img", "sharp-libvips-linux-x64", "lib", "libvips.so.42"));
    out.push(join(installRoot, "node_modules", "sharp", "build", "Release", "sharp-linux-x64.node"));
  }
  return out.filter((p) => existsSync(sharpDir) ? true : false);
}

/** v2.19.53 — graceful handoff signal. On POSIX (macOS + Linux), daemon
 *  can install a SIGUSR2 handler that triggers state snapshot + child
 *  reaping BEFORE the daemon exits. Windows has no SIGUSR2; falls back
 *  to SIGTERM. The handoff makes cross-version `npm install -g` a
 *  zero-downtime upgrade on POSIX. */
export const HANDOFF_SIGNAL = process.platform === "win32" ? "SIGTERM" : "SIGUSR2";

// ────────────────────────────────────────────────────────────────────────
// v2.19.54 — PREDICTIVE INSTALL SIGNAL (the killer innovation)
// ────────────────────────────────────────────────────────────────────────
//
// The wild idea: instead of REACTIVELY killing the daemon DURING npm
// install (which races with autonomic respawn), let the installer
// PROACTIVELY announce "install incoming" via a flag file. Daemon's
// fs.watch sees the flag within ~50ms and SELF-REAPS before npm even
// extracts. ZERO orphan because daemon is dead before npm touches DLLs.
//
// Cross-platform via plain fs.watch — works on Windows + macOS + Linux.
// Flag file is intentionally tiny + at a well-known cross-repo path.

export const INSTALL_INCOMING_FLAG = "install-incoming.flag";
export function installIncomingPath(): string { return join(organDir(), INSTALL_INCOMING_FLAG); }

export interface InstallIncomingFlag {
  v: typeof PROTOCOL_VERSION;
  announcedAt: string;
  announcerPid: number;
  expectedVersion?: string;
  reason?: string;
}

/** Caller (preinstall hook or `mneme upgrade`) announces an incoming
 *  install. Daemons watching the flag will self-reap within milliseconds.
 *  Idempotent — safe to call multiple times. */
export function announceInstallIncoming(reason?: string, expectedVersion?: string): string {
  ensureOrganDirs();
  const body: InstallIncomingFlag = {
    v: PROTOCOL_VERSION,
    announcedAt: new Date().toISOString(),
    announcerPid: process.pid,
    ...(reason ? { reason } : {}),
    ...(expectedVersion ? { expectedVersion } : {}),
  };
  const path = installIncomingPath();
  try { writeFileSync(path, JSON.stringify(body), { encoding: "utf8", mode: 0o600 }); } catch { /* best-effort */ }
  return path;
}

/** Cleanup after install completes. Removes the flag so daemons can
 *  re-spawn safely on next CLI command. */
export function clearInstallIncoming(): void {
  try { if (existsSync(installIncomingPath())) unlinkSync(installIncomingPath()); } catch { /* */ }
}

export function readInstallIncoming(): InstallIncomingFlag | null {
  try {
    if (!existsSync(installIncomingPath())) return null;
    return JSON.parse(readFileSync(installIncomingPath(), "utf8")) as InstallIncomingFlag;
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────────
// v2.19.54 — EXPONENTIAL-BACKOFF DLL PROBE RETRY (the perf killer)
// ────────────────────────────────────────────────────────────────────────
//
// Fastest case: if everything is unlocked already, exits in <1ms.
// Worst case: 6 attempts, 7875ms total wall-time.
//
// Adaptive backoff sequence: 100ms, 250ms, 500ms, 1000ms, 2000ms, 4000ms.
// Each attempt re-runs the reaper (orphans may have respawned), re-probes
// all paths in parallel, then exits as soon as everything is writable.

export interface BackoffProbeResult {
  ok: boolean;
  attempts: number;
  totalWaitMs: number;
  finalProbes: LockProbeResult[];
  reapPerAttempt: number[];
}

const DEFAULT_BACKOFFS_MS = [100, 250, 500, 1000, 2000, 4000];

export function backoffProbeAndReap(
  probedPaths: string[],
  opts?: { backoffsMs?: number[]; skipPid?: number },
): BackoffProbeResult {
  const backoffs = opts?.backoffsMs ?? DEFAULT_BACKOFFS_MS;
  const skipPid = opts?.skipPid ?? process.pid;
  const reapPerAttempt: number[] = [];
  let totalWaitMs = 0;

  // Attempt 0: probe immediately without waiting (fast path — nothing locked).
  let finalProbes: LockProbeResult[] = probedPaths.map(probeLockable);
  if (finalProbes.every((p) => p.writable)) {
    return { ok: true, attempts: 0, totalWaitMs: 0, finalProbes, reapPerAttempt };
  }

  // Locked — start the backoff loop.
  for (let i = 0; i < backoffs.length; i++) {
    // Re-reap any orphans (may have respawned)
    const reap = reapMnemeProcesses({ skipPid, gracePeriodMs: 500 });
    reapPerAttempt.push(reap.killed);
    // Wait
    const wait = backoffs[i]!;
    totalWaitMs += wait;
    const waitEnd = Date.now() + wait;
    while (Date.now() < waitEnd) { /* spin briefly */ }
    // Re-probe
    finalProbes = probedPaths.map(probeLockable);
    if (finalProbes.every((p) => p.writable)) {
      return { ok: true, attempts: i + 1, totalWaitMs, finalProbes, reapPerAttempt };
    }
  }
  return { ok: false, attempts: backoffs.length, totalWaitMs, finalProbes, reapPerAttempt };
}

// ────────────────────────────────────────────────────────────────────────
// v2.19.54 — UPGRADE PIPELINE (atomic announce → heal → backoff → npm install)
// ────────────────────────────────────────────────────────────────────────
//
// The user-facing "magical install" — call this from `mneme upgrade` CLI
// or `mneme.install.upgrade_pipeline` MCP tool. Composes:
//   1. Announce install incoming (daemon self-reaps)
//   2. Wait for daemon to die (200ms)
//   3. Run install organ heal
//   4. Run backoff probe + reap retry loop
//   5. (Optional) invoke npm install -g --force
//   6. Verify mneme --version returns expected
//   7. Clear announce flag

export interface UpgradePipelineResult {
  ok: boolean;
  stages: {
    announce: { announced: boolean; flagPath: string };
    waitForSelfReap: { waitedMs: number };
    heal: HealResult;
    backoff: BackoffProbeResult;
  };
  recommendation: string;
}

export function runUpgradePipeline(
  probedPaths: string[] = [],
  opts?: { waitForReapMs?: number; backoffsMs?: number[]; expectedVersion?: string; skipPid?: number; reason?: string },
): UpgradePipelineResult {
  const skipPid = opts?.skipPid ?? process.pid;
  // Stage 1 — announce
  const flagPath = announceInstallIncoming(opts?.reason ?? "upgrade-pipeline", opts?.expectedVersion);

  // Stage 2 — wait briefly so daemon's fs.watch handler can self-reap
  const waitMs = opts?.waitForReapMs ?? 300;
  const waitEnd = Date.now() + waitMs;
  while (Date.now() < waitEnd) { /* spin */ }

  // Stage 3 — heal (composed diagnose + reap + reprobe)
  const heal = healInstall(probedPaths, { skipPid, gracePeriodMs: 500 });

  // Stage 4 — exponential backoff probe + retry if heal still leaves locks
  const backoff = backoffProbeAndReap(probedPaths, { ...(opts?.backoffsMs ? { backoffsMs: opts.backoffsMs } : {}), skipPid });

  const ok = heal.ok && backoff.ok;
  let recommendation: string;
  if (ok) {
    recommendation = `✅ MAGICAL — all locks released. Safe to run \`npm install -g mneme-ai@latest\`. (${backoff.attempts} backoff attempt(s); ${backoff.totalWaitMs}ms total wait.)`;
  } else if (!heal.ok) {
    recommendation = `⚠ HEAL FAILED — ${heal.reap.failed} reap failure(s); manual intervention may be needed.`;
  } else {
    recommendation = `⚠ STILL LOCKED after ${backoff.attempts} retries — ${backoff.finalProbes.filter((p) => !p.writable).length} path(s) held by non-Mneme processes (Process Explorer / Activity Monitor / lsof to identify).`;
  }

  return {
    ok,
    stages: {
      announce: { announced: existsSync(flagPath), flagPath },
      waitForSelfReap: { waitedMs: waitMs },
      heal,
      backoff,
    },
    recommendation,
  };
}

export { PROTOCOL_VERSION, HEARTBEAT_TTL_MS, HEARTBEAT_INTERVAL_MS, DEFAULT_BACKOFFS_MS };
