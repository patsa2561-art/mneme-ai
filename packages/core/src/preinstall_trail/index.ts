/**
 * v2.19.63 PHOENIX HARDENING — PREINSTALL TRAIL.
 *
 * The forensic proof v2.19.62 (and every prior release) lacked: did
 * the preinstall hook actually RUN? Did it kill the daemon? Did rename-
 * sideways succeed?
 *
 * v2.19.62 install path "passed" only because the daemon happened to
 * die from an unrelated watchdog. The user correctly called out:
 * "ไม่มีหลักฐานว่า preinstall hook ทำงานจริง". This module fixes that.
 *
 * Design:
 *   1. preinstall (inline node -e in package.json) appends entries to
 *      `~/.mneme-global/preinstall-trail.jsonl` at each step
 *   2. Each entry is HMAC-chained {v, ts, version, step, ok, details?,
 *      prevSig, sig} — tamper-detectable
 *   3. This module reads + verifies the chain
 *   4. CLI `mneme install-history` prints recent entries
 *   5. MCP `mneme.install.trail` exposes it to AI agents
 *   6. Sentinel organ verifies the chain (composes with v2.19.62 P5)
 *
 * No file refs inside the package — preinstall stays inline per ritual
 * phase 3.6 (chicken-and-egg safe). This module reads what preinstall
 * wrote, but preinstall itself never imports this code.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1;
const TRAIL_FILE = "preinstall-trail.jsonl";
const ORGAN_DIR = ".mneme-global";

/** Steps the preinstall hook records. Add new steps here when adding
 *  trail logging in the preinstall script. Names must match exactly. */
export type PreinstallStep =
  | "preinstall-start"
  | "flag-written"
  | "daemon-stop-windows"
  | "daemon-stop-posix"
  | "heartbeat-reaped"
  | "dll-renamed-sideways"
  | "dll-probe-confirmed"
  | "staging-swept"
  | "preinstall-end";

export interface TrailEntry {
  v: typeof PROTOCOL_VERSION;
  ts: string;
  /** npm package version being installed (best-effort from env). */
  version: string;
  step: PreinstallStep;
  ok: boolean;
  details?: Record<string, unknown>;
  /** Process PID that wrote this entry. */
  pid: number;
  /** HMAC of previous entry's sig (chains the trail). */
  prevSig: string;
  /** HMAC of this entry's body. */
  sig: string;
}

export interface TrailVerifyResult {
  v: typeof PROTOCOL_VERSION;
  totalEntries: number;
  chainOk: boolean;
  brokenAtIndex?: number;
  brokenReason?: string;
  /** Did we see at least one complete install (preinstall-start → preinstall-end)? */
  hasCompleteInstall: boolean;
  /** Last entry's timestamp; null if trail empty. */
  lastTs: string | null;
}

function trailPath(): string {
  return join(homedir(), ORGAN_DIR, TRAIL_FILE);
}

function ensureOrganDir(): void {
  const dir = join(homedir(), ORGAN_DIR);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch { /* BE:silent-by-design */ }
}

function defaultSecret(): string {
  return process.env["MNEME_PREINSTALL_TRAIL_SECRET"] || `mneme-preinstall-trail-v${PROTOCOL_VERSION}`;
}

function hmacHex(prev: string, body: unknown): string {
  return createHmac("sha256", defaultSecret()).update(prev + "::" + JSON.stringify(body)).digest("hex");
}

/** Read the last sig from the trail (genesis if empty). Used by the
 *  preinstall inline script and any out-of-band append. */
export function lastSig(): string {
  const path = trailPath();
  if (!existsSync(path)) return "genesis";
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) return "genesis";
    const last = JSON.parse(lines[lines.length - 1]!);
    return typeof last?.sig === "string" ? last.sig : "genesis";
  } catch {
    return "genesis";
  }
}

/** Append an entry to the trail. Used in tests + for out-of-band writes
 *  (e.g. install-organ recording the install completion). The inline
 *  preinstall script duplicates this logic since it can't import.
 *  Never throws. */
export function appendEntry(step: PreinstallStep, ok: boolean, opts?: { version?: string; details?: Record<string, unknown> }): TrailEntry | null {
  try {
    ensureOrganDir();
    const prevSig = lastSig();
    const body = {
      v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
      ts: new Date().toISOString(),
      version: opts?.version ?? process.env["npm_package_version"] ?? "unknown",
      step,
      ok,
      ...(opts?.details ? { details: opts.details } : {}),
      pid: process.pid,
      prevSig,
    };
    const sig = hmacHex(prevSig, body);
    const entry: TrailEntry = { ...body, sig };
    appendFileSync(trailPath(), JSON.stringify(entry) + "\n", "utf8");
    return entry;
  } catch {
    return null;
  }
}

/** Read all trail entries. Returns empty array on missing/unreadable file. */
export function readTrail(): TrailEntry[] {
  const path = trailPath();
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const out: TrailEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?.v === PROTOCOL_VERSION && typeof parsed.step === "string" && typeof parsed.sig === "string") {
          out.push(parsed as TrailEntry);
        }
      } catch { /* skip malformed line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** Verify the HMAC chain of the entire trail. Returns structured result. */
export function verifyTrail(): TrailVerifyResult {
  const entries = readTrail();
  if (entries.length === 0) {
    return { v: PROTOCOL_VERSION, totalEntries: 0, chainOk: true, hasCompleteInstall: false, lastTs: null };
  }
  let prevSig = "genesis";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.prevSig !== prevSig) {
      return {
        v: PROTOCOL_VERSION,
        totalEntries: entries.length,
        chainOk: false,
        brokenAtIndex: i,
        brokenReason: `prevSig mismatch at index ${i}: expected ${prevSig.slice(0, 12)}…, got ${e.prevSig.slice(0, 12)}…`,
        hasCompleteInstall: false,
        lastTs: entries[entries.length - 1]!.ts,
      };
    }
    const { sig: _sig, ...body } = e;
    const expectedSig = hmacHex(prevSig, body);
    if (expectedSig !== e.sig) {
      return {
        v: PROTOCOL_VERSION,
        totalEntries: entries.length,
        chainOk: false,
        brokenAtIndex: i,
        brokenReason: `sig mismatch at index ${i}: expected ${expectedSig.slice(0, 12)}…, got ${e.sig.slice(0, 12)}…`,
        hasCompleteInstall: false,
        lastTs: entries[entries.length - 1]!.ts,
      };
    }
    prevSig = e.sig;
  }
  const hasCompleteInstall = entries.some((e) => e.step === "preinstall-start") &&
                              entries.some((e) => e.step === "preinstall-end");
  return {
    v: PROTOCOL_VERSION,
    totalEntries: entries.length,
    chainOk: true,
    hasCompleteInstall,
    lastTs: entries[entries.length - 1]!.ts,
  };
}

/** Filter entries to the most recent complete install (last block from
 *  preinstall-start to preinstall-end, or the tail if no end). Useful
 *  for the CLI install-history command. */
export function recentInstall(): TrailEntry[] {
  const entries = readTrail();
  if (entries.length === 0) return [];
  let startIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.step === "preinstall-start") {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return entries.slice(-10); // No start found, return tail
  return entries.slice(startIdx);
}

/** Summarize the trail: total installs, last verdict, broken-chain status. */
export interface TrailSummary {
  v: typeof PROTOCOL_VERSION;
  totalEntries: number;
  installAttempts: number;
  completedInstalls: number;
  lastInstallVersion: string | null;
  lastInstallOk: boolean | null;
  lastInstallTs: string | null;
  chainOk: boolean;
}

export function summarize(): TrailSummary {
  const entries = readTrail();
  const verify = verifyTrail();
  const starts = entries.filter((e) => e.step === "preinstall-start");
  const ends = entries.filter((e) => e.step === "preinstall-end");
  const lastEnd = ends.length > 0 ? ends[ends.length - 1]! : null;
  return {
    v: PROTOCOL_VERSION,
    totalEntries: entries.length,
    installAttempts: starts.length,
    completedInstalls: ends.length,
    lastInstallVersion: lastEnd?.version ?? null,
    lastInstallOk: lastEnd?.ok ?? null,
    lastInstallTs: lastEnd?.ts ?? null,
    chainOk: verify.chainOk,
  };
}

/** Test-only: clear the trail. Never call in production. */
export function _clearTrailForTests(): void {
  const path = trailPath();
  try {
    if (existsSync(path)) {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(path);
    }
  } catch { /* */ }
}

export { PROTOCOL_VERSION, trailPath };
