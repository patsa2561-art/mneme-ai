/**
 * 🧙 PROTOPLASM — CRIU PROCESS PICKLE (Linux-only)
 *
 * Use Linux CRIU (Checkpoint/Restore In Userspace) to snapshot a live
 * process to disk + later restore including in-memory state + open FDs.
 *
 * Requirements:
 *   - Linux kernel ≥ 3.11 with CONFIG_CHECKPOINT_RESTORE=y
 *   - criu binary in PATH
 *   - CAP_SYS_ADMIN (typically requires root or container with privileges)
 *
 * On non-Linux (Windows/macOS): functions return { ok: false, reason: "unsupported_platform" }
 * No-op + warning instead of throwing.
 *
 * This module is INTENTIONALLY conservative — CRIU on its own can corrupt
 * process state if invoked carelessly (FD handles, network sockets, mmap'd
 * files). The wrapper:
 *   - probes criu availability before any call
 *   - dumps to per-PID timestamped dir
 *   - never auto-restores; restore is explicit user action
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface CriuAvailability {
  supported: boolean;
  platform: NodeJS.Platform;
  criuPath?: string;
  version?: string;
  reason?: string;
  needsRoot?: boolean;
}

export interface CriuSnapshotResult {
  ok: boolean;
  imageDir?: string;
  pid?: number;
  reason?: string;
  stderr?: string;
}

export interface CriuRestoreResult {
  ok: boolean;
  newPid?: number;
  reason?: string;
  stderr?: string;
}

export function probeCriu(): CriuAvailability {
  const plat = process.platform;
  if (plat !== "linux") {
    return { supported: false, platform: plat, reason: "CRIU is Linux-only — Windows/macOS not supported" };
  }
  try {
    const which = execSync("which criu", { encoding: "utf8" }).trim();
    if (!which) return { supported: false, platform: plat, reason: "criu binary not in PATH" };
    let version = "";
    try { version = execSync("criu --version", { encoding: "utf8" }).split("\n")[0]; } catch { /* */ }
    const isRoot = (typeof process.getuid === "function") && process.getuid() === 0;
    return { supported: true, platform: plat, criuPath: which, version, needsRoot: !isRoot };
  } catch (e) {
    return { supported: false, platform: plat, reason: (e as Error).message };
  }
}

/** Dump live process to image directory. Caller is responsible for picking
 *  pid that is safe to dump (no in-flight sockets to external services etc). */
export function snapshot(pid: number, ledgerDir: string): CriuSnapshotResult {
  const avail = probeCriu();
  if (!avail.supported) return { ok: false, reason: avail.reason ?? "unsupported" };
  const imageDir = join(ledgerDir, "criu", `pid-${pid}-${Date.now()}`);
  mkdirSync(imageDir, { recursive: true });
  const args = ["dump", "--tree", String(pid), "--images-dir", imageDir, "--shell-job"];
  const r = spawnSync("criu", args, { encoding: "utf8" });
  if (r.status !== 0) return { ok: false, imageDir, pid, reason: `criu dump exit=${r.status}`, stderr: r.stderr ?? "" };
  return { ok: true, imageDir, pid };
}

/** Restore a previously-snapshot'd process from imageDir. */
export function restore(imageDir: string): CriuRestoreResult {
  const avail = probeCriu();
  if (!avail.supported) return { ok: false, reason: avail.reason ?? "unsupported" };
  if (!existsSync(imageDir)) return { ok: false, reason: `image dir not found: ${imageDir}` };
  const r = spawnSync("criu", ["restore", "--images-dir", imageDir, "--shell-job"], { encoding: "utf8" });
  if (r.status !== 0) return { ok: false, reason: `criu restore exit=${r.status}`, stderr: r.stderr ?? "" };
  // criu restore replaces current process; newPid not available from parent perspective
  return { ok: true };
}
