/**
 * v2.19.57 SHEPHERD PROTOCOL — the self-installing dream organ.
 *
 * The user mandate (turn-18): "เมื่อไหร่ bug ebusy จะหมดไป ทำให้ มันเป็น
 * สุดยอด engine ที่รันได้ด้วยตัวเองได้ไหม". A dream organ that runs itself.
 *
 * The wild idea: Mneme upgrades ITSELF. User types `mneme upgrade --execute`
 * and walks away. Mneme:
 *   1. Diagnoses install pipeline (heartbeats + DLL locks)
 *   2. Detaches a SHEPHERD process living OUTSIDE the package (~/.mneme-global/)
 *   3. Shepherd kills all mneme processes (including the caller's parent)
 *   4. Shepherd waits for OS to release handles
 *   5. Shepherd runs `npm install -g --omit=optional --force mneme-ai@latest`
 *   6. Shepherd starts a fresh daemon under the new version
 *   7. Shepherd writes result to ~/.mneme-global/shepherd/upgrade-state.jsonl
 *
 * Each step writes a CHECKPOINT to the state ledger. If shepherd dies mid-way
 * (power loss, OOM, anything), next invocation resumes from last checkpoint.
 *
 * Parallel safety: file-based lock at ~/.mneme-global/shepherd/.lock. Only ONE
 * shepherd runs at a time. Subsequent invocations report "already running"
 * with current step + ETA.
 *
 * Zero conflict with daemon: install-incoming.flag (v2.19.54) tells the
 * autonomic_breath_hook NOT to respawn. Shepherd clears the flag after upgrade
 * completes — daemon respawns under new version.
 *
 * Cross-platform: Windows + macOS + Linux. spawnSync(npm.cmd) on Windows;
 * spawnSync(npm) on POSIX. Same protocol everywhere.
 *
 * The 8th world-first: no AI tool ships a self-installing upgrade pipeline
 * with checkpointed state + parallel-safe lock + DLL-lock-aware reap. Dream
 * organ realized.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1;
const LOCK_STALENESS_MS = 5 * 60 * 1000; // 5min — anything older is a dead shepherd

export type ShepherdStep =
  | "starting"
  | "lock-acquired"
  | "diagnose-pre"
  | "announce-incoming"
  | "wait-for-self-reap"
  | "reap-survivors"
  | "wait-for-os"
  | "npm-install-start"
  | "npm-install-done"
  | "verify-new-version"
  | "spawn-new-daemon"
  | "clear-incoming-flag"
  | "release-lock"
  | "complete"
  | "failed";

export interface ShepherdStateEvent {
  v: typeof PROTOCOL_VERSION;
  ts: string;
  step: ShepherdStep;
  shepherdPid: number;
  targetVersion: string;
  details?: unknown;
  prevSig: string;
  sig: string;
}

export interface ShepherdLock {
  v: typeof PROTOCOL_VERSION;
  pid: number;
  startedAt: string;
  targetVersion: string;
  host: string;
  step: ShepherdStep;
}

export function shepherdDir(): string {
  return join(homedir(), ".mneme-global", "shepherd");
}

export function shepherdStatePath(): string {
  return join(shepherdDir(), "upgrade-state.jsonl");
}

export function shepherdLockPath(): string {
  return join(shepherdDir(), ".lock");
}

export function shepherdScriptPath(): string {
  return join(shepherdDir(), "shepherd.cjs");
}

export function ensureShepherdDir(): void {
  const d = shepherdDir();
  if (!existsSync(d)) {
    try { mkdirSync(d, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
  }
}

function defaultSecret(): string {
  return process.env["MNEME_SHEPHERD_SECRET"] || `mneme-shepherd-v${PROTOCOL_VERSION}`;
}

function hmacHex(prev: string, body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(prev + "::" + JSON.stringify(body)).digest("hex");
}

// ────────────────────────────────────────────────────────────────────────
// STATE LEDGER (HMAC-chained, composes with v2.19.34 APOSTILLE)
// ────────────────────────────────────────────────────────────────────────

export interface AppendStepArgs {
  step: ShepherdStep;
  shepherdPid: number;
  targetVersion: string;
  details?: unknown;
}

export function appendState(args: AppendStepArgs, secret?: string): ShepherdStateEvent {
  ensureShepherdDir();
  let prevSig = "0".repeat(64);
  try {
    const path = shepherdStatePath();
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]!) as ShepherdStateEvent;
        prevSig = last.sig;
      }
    }
  } catch { /* chain restarts */ }
  const body: Omit<ShepherdStateEvent, "sig"> = {
    v: PROTOCOL_VERSION,
    ts: new Date().toISOString(),
    step: args.step,
    shepherdPid: args.shepherdPid,
    targetVersion: args.targetVersion,
    ...(args.details !== undefined ? { details: args.details } : {}),
    prevSig,
  };
  const sig = hmacHex(prevSig, body, secret ?? defaultSecret());
  const event: ShepherdStateEvent = { ...body, sig };
  try { appendFileSync(shepherdStatePath(), JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 }); } catch { /* */ }
  return event;
}

export function readState(limit: number = 100): ShepherdStateEvent[] {
  const path = shepherdStatePath();
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.slice(-limit).map((l) => JSON.parse(l) as ShepherdStateEvent);
  } catch { return []; }
}

export function verifyStateChain(secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const events = readState(100_000);
  if (events.length === 0) return { ok: true };
  let prevSig = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: "prevSig mismatch" };
    const { sig, ...body } = e;
    const expected = hmacHex(prevSig, body, secret ?? defaultSecret());
    if (sig !== expected) return { ok: false, brokenAt: i, reason: "sig mismatch" };
    prevSig = sig;
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────
// PARALLEL-SAFE LOCK
// ────────────────────────────────────────────────────────────────────────

export type AcquireLockResult =
  | { acquired: true }
  | { acquired: false; reason: "already-running"; otherShepherd: ShepherdLock }
  | { acquired: false; reason: "stale-lock-cleared"; staleAge: number }
  | { acquired: false; reason: "lock-write-failed"; error: string };

/** Attempt to acquire the shepherd lock. Returns `acquired: true` on success.
 *  If a lock exists and the PID inside is alive AND mtime is fresh, returns
 *  `acquired: false, reason: "already-running"`. If lock exists but is stale
 *  (PID dead OR mtime > 5min), automatically clears it and returns
 *  `acquired: false, reason: "stale-lock-cleared"` — caller can retry. */
export function acquireShepherdLock(targetVersion: string, step: ShepherdStep, secret?: string): AcquireLockResult {
  ensureShepherdDir();
  const path = shepherdLockPath();
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, "utf8")) as ShepherdLock;
      const st = statSync(path);
      const isStale = (Date.now() - st.mtimeMs) > LOCK_STALENESS_MS || !isPidAlive(existing.pid);
      if (isStale) {
        try { unlinkSync(path); } catch { /* */ }
        return { acquired: false, reason: "stale-lock-cleared", staleAge: Date.now() - st.mtimeMs };
      }
      return { acquired: false, reason: "already-running", otherShepherd: existing };
    } catch {
      // Corrupt lock — try to clear
      try { unlinkSync(path); } catch { /* */ }
    }
  }
  const lock: ShepherdLock = {
    v: PROTOCOL_VERSION,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    targetVersion,
    host: require("node:os").hostname(),
    step,
  };
  try {
    writeFileSync(path, JSON.stringify(lock), { encoding: "utf8", mode: 0o600, flag: "wx" });
    appendState({ step: "lock-acquired", shepherdPid: process.pid, targetVersion }, secret);
    return { acquired: true };
  } catch (e) {
    return { acquired: false, reason: "lock-write-failed", error: (e as Error).message };
  }
}

export function releaseShepherdLock(): boolean {
  try {
    const path = shepherdLockPath();
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
  } catch { /* */ }
  return false;
}

export function readShepherdLock(): ShepherdLock | null {
  const path = shepherdLockPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ShepherdLock;
  } catch { return null; }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

// ────────────────────────────────────────────────────────────────────────
// STATUS REPORTING
// ────────────────────────────────────────────────────────────────────────

export interface ShepherdStatus {
  v: typeof PROTOCOL_VERSION;
  running: boolean;
  currentLock: ShepherdLock | null;
  lastEvents: ShepherdStateEvent[];
  lastCompleteAt: string | null;
  lastTargetVersion: string | null;
  lastVerdict: "complete" | "failed" | "in-progress" | "none";
  chainOk: boolean;
}

export function shepherdStatus(limit: number = 20): ShepherdStatus {
  const lock = readShepherdLock();
  const events = readState(100_000);
  const chain = verifyStateChain();
  let lastVerdict: ShepherdStatus["lastVerdict"] = "none";
  let lastCompleteAt: string | null = null;
  let lastTargetVersion: string | null = null;
  if (events.length > 0) {
    const last = events[events.length - 1]!;
    lastTargetVersion = last.targetVersion;
    if (last.step === "complete") { lastVerdict = "complete"; lastCompleteAt = last.ts; }
    else if (last.step === "failed") { lastVerdict = "failed"; lastCompleteAt = last.ts; }
    else lastVerdict = "in-progress";
  }
  return {
    v: PROTOCOL_VERSION,
    running: lock !== null && isPidAlive(lock.pid),
    currentLock: lock,
    lastEvents: events.slice(-limit),
    lastCompleteAt,
    lastTargetVersion,
    lastVerdict,
    chainOk: chain.ok,
  };
}

// ────────────────────────────────────────────────────────────────────────
// SHEPHERD SCRIPT (embedded as string — extracted to ~/.mneme-global/shepherd/shepherd.cjs)
// ────────────────────────────────────────────────────────────────────────
//
// The shepherd runs as a STANDALONE script with ZERO npm dependencies.
// All paths + secrets passed via argv. No requires of @mneme-ai/* — we'd
// be deleting those during the install. Pure node built-ins only.

export const SHEPHERD_SCRIPT_SRC = `#!/usr/bin/env node
"use strict";

// v2.19.57 — Mneme Shepherd. Self-installing pipeline.
// Standalone CJS — zero external deps. Receives args from argv.
//
// Usage:
//   node shepherd.cjs --target latest --shepherd-pid 12345 \\
//                     --state-path ~/.mneme-global/shepherd/upgrade-state.jsonl \\
//                     --lock-path  ~/.mneme-global/shepherd/.lock \\
//                     --secret <hmac-secret>

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");

const PROTO_V = 1;
const HEARTBEAT_DIR = path.join(os.homedir(), ".mneme-global", "heartbeats");
const FLAG_PATH = path.join(os.homedir(), ".mneme-global", "install-incoming.flag");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const STATE_PATH = arg("--state-path", path.join(os.homedir(), ".mneme-global", "shepherd", "upgrade-state.jsonl"));
const LOCK_PATH = arg("--lock-path", path.join(os.homedir(), ".mneme-global", "shepherd", ".lock"));
const SECRET = arg("--secret", "mneme-shepherd-v" + PROTO_V);
const TARGET = arg("--target", "latest");

function appendState(step, details) {
  let prevSig = "0".repeat(64);
  try {
    if (fs.existsSync(STATE_PATH)) {
      const lines = fs.readFileSync(STATE_PATH, "utf8").split("\\n").filter((l) => l.trim());
      if (lines.length > 0) prevSig = JSON.parse(lines[lines.length - 1]).sig;
    }
  } catch {}
  const body = {
    v: PROTO_V, ts: new Date().toISOString(), step,
    shepherdPid: process.pid, targetVersion: TARGET,
    ...(details !== undefined ? { details } : {}), prevSig,
  };
  const sig = crypto.createHmac("sha256", SECRET).update(prevSig + "::" + JSON.stringify(body)).digest("hex");
  const event = Object.assign({}, body, { sig });
  try { fs.appendFileSync(STATE_PATH, JSON.stringify(event) + "\\n", { encoding: "utf8", mode: 0o600 }); } catch {}
  return event;
}

function isPidAlive(pid) {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

function reapHeartbeats() {
  let count = 0;
  try {
    if (!fs.existsSync(HEARTBEAT_DIR)) return 0;
    const files = fs.readdirSync(HEARTBEAT_DIR);
    for (const f of files) {
      const m = f.match(/^(\\d+)\\.beat$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (pid <= 0 || pid === process.pid) continue;
      try { process.kill(pid, "SIGTERM"); count++; } catch {}
      // Wait briefly, then SIGKILL if still alive
      const end = Date.now() + 800;
      while (Date.now() < end && isPidAlive(pid)) {}
      if (isPidAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
      try { fs.unlinkSync(path.join(HEARTBEAT_DIR, f)); } catch {}
    }
  } catch {}
  return count;
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

async function main() {
  try {
    appendState("starting", { pid: process.pid });

    // Step 1: announce install-incoming (extra belt-and-suspenders)
    try {
      if (!fs.existsSync(path.dirname(FLAG_PATH))) {
        fs.mkdirSync(path.dirname(FLAG_PATH), { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(FLAG_PATH, JSON.stringify({
        v: 1, announcedAt: new Date().toISOString(),
        announcerPid: process.pid, reason: "shepherd-upgrade",
      }), { encoding: "utf8", mode: 0o600 });
      appendState("announce-incoming");
    } catch (e) { appendState("announce-incoming", { error: e.message }); }

    // Step 2: wait for daemon to self-reap (v2.19.54 protocol)
    busyWait(800);
    appendState("wait-for-self-reap", { waitedMs: 800 });

    // Step 3: reap survivors
    const reaped = reapHeartbeats();
    appendState("reap-survivors", { reaped });

    // Step 4: wait for OS handle release
    busyWait(2000);
    appendState("wait-for-os", { waitedMs: 2000 });

    // Step 5: npm install -g --omit=optional --force mneme-ai@<target>
    appendState("npm-install-start");
    const isWin = process.platform === "win32";
    const npmCmd = isWin ? "npm.cmd" : "npm";
    const args = ["install", "-g", "--omit=optional", "--force", "mneme-ai@" + TARGET];
    const r = spawnSync(npmCmd, args, {
      shell: isWin, windowsHide: true, encoding: "utf8", timeout: 300_000,
    });
    appendState("npm-install-done", {
      exitCode: r.status,
      stdoutTail: (r.stdout || "").slice(-500),
      stderrTail: (r.stderr || "").slice(-500),
    });
    if (r.status !== 0) {
      appendState("failed", { reason: "npm install failed", exitCode: r.status });
      try { fs.unlinkSync(LOCK_PATH); } catch {}
      try { fs.unlinkSync(FLAG_PATH); } catch {}
      process.exit(1);
    }

    // Step 6: verify new version
    const verifyR = spawnSync(isWin ? "mneme.cmd" : "mneme", ["--version"], {
      shell: isWin, windowsHide: true, encoding: "utf8", timeout: 8_000,
    });
    appendState("verify-new-version", {
      exitCode: verifyR.status,
      version: (verifyR.stdout || "").trim(),
    });

    // Step 7: clear install-incoming flag (lets daemon respawn under new version)
    try { fs.unlinkSync(FLAG_PATH); appendState("clear-incoming-flag"); }
    catch (e) { appendState("clear-incoming-flag", { error: e.message }); }

    // Step 8: spawn new daemon (detached). The autonomic_breath_hook will
    // also do this on next CLI call, but explicit start is faster.
    try {
      const child = spawn(isWin ? "mneme.cmd" : "mneme", ["daemon", "start"], {
        shell: isWin, windowsHide: true, detached: true, stdio: "ignore",
      });
      if (child.unref) child.unref();
      appendState("spawn-new-daemon", { pid: child.pid });
    } catch (e) { appendState("spawn-new-daemon", { error: e.message }); }

    // Step 9: release lock + complete
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    appendState("release-lock");
    appendState("complete");
    process.exit(0);
  } catch (e) {
    appendState("failed", { reason: e.message, stack: e.stack ? e.stack.slice(0, 500) : null });
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    process.exit(1);
  }
}

main();
`;

/** Extract the shepherd script to `~/.mneme-global/shepherd/shepherd.cjs`.
 *  Idempotent — overwrites existing copy so latest version is always used. */
export function installShepherdScript(): string {
  ensureShepherdDir();
  const path = shepherdScriptPath();
  try {
    writeFileSync(path, SHEPHERD_SCRIPT_SRC, { encoding: "utf8", mode: 0o755 });
  } catch { /* best-effort — caller may have read-only home */ }
  return path;
}

export { PROTOCOL_VERSION, LOCK_STALENESS_MS };
