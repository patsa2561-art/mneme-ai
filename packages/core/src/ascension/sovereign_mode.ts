/**
 * v1.68.0 -- ASCENSION ASC-5: SOVEREIGN MODE.
 *
 * Distinguishes BROKEN-OFFLINE from BY-DESIGN-OFFLINE for the cloud
 * probe. When the user has intentionally turned off the cloud
 * (e.g. destroyed DO droplet, set MNEME_SOVEREIGN=1), the pulse
 * should label this SOVEREIGN MODE, not "cloud unreachable error".
 *
 * State sources (any one triggers SOVEREIGN):
 *   - env MNEME_SOVEREIGN=1
 *   - .mneme/sovereign-mode.json -> { enabled: true, reason: "..." }
 *
 * Verdicts:
 *   SOVEREIGN   intentional offline (no cloud needed)
 *   ONLINE      cloud reachable
 *   DEGRADED    cloud reachable but slow / partial
 *   OFFLINE     cloud SHOULD be reachable but isn't (broken)
 *   UNKNOWN     not probed yet
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ASC_DIR = ".mneme/ascension";
const STATE_FILE = ".mneme/sovereign-mode.json";

export type SovereignVerdict = "SOVEREIGN" | "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";

export interface SovereignState {
  enabled: boolean;
  reason: string;
  enabledAt: string;
}

export interface SovereignReport {
  verdict: SovereignVerdict;
  enabledByUser: boolean;
  reason: string | null;
  /** Plain-English headline; safe to surface in pulse. */
  headline: string;
}

function statePath(repoRoot: string): string {
  return join(repoRoot, STATE_FILE);
}

export function readSovereignState(repoRoot: string): SovereignState | null {
  const p = statePath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as SovereignState; } catch { return null; }
}

function envSovereign(): boolean {
  const v = process.env["MNEME_SOVEREIGN"];
  return v === "1" || v === "true" || v === "yes";
}

/** Enable sovereign mode -- intentional offline. */
export function enableSovereign(repoRoot: string, reason: string): SovereignState {
  const state: SovereignState = {
    enabled: true,
    reason,
    enabledAt: new Date().toISOString(),
  };
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(repoRoot), JSON.stringify(state, null, 2) + "\n", "utf8");
  return state;
}

/** Disable sovereign mode (allow cloud probes to label OFFLINE again). */
export function disableSovereign(repoRoot: string): void {
  const p = statePath(repoRoot);
  if (existsSync(p)) {
    try {
      const s = readSovereignState(repoRoot);
      if (s) writeFileSync(p, JSON.stringify({ ...s, enabled: false }, null, 2) + "\n", "utf8");
    } catch { /* */ }
  }
}

export interface CloudProbeInput {
  /** Did the upstream probe complete successfully? */
  probeReachable: boolean | null;
  /** Round-trip latency in ms (when reachable). */
  rttMs?: number | null;
}

/** Classify the cloud state into a SOVEREIGN-aware verdict. */
export function classifyCloud(repoRoot: string, probe: CloudProbeInput): SovereignReport {
  const persisted = readSovereignState(repoRoot);
  const enabledByUser = envSovereign() || (persisted?.enabled === true);
  const reason = enabledByUser ? (process.env["MNEME_SOVEREIGN"] ? "env MNEME_SOVEREIGN=1" : (persisted?.reason ?? "user opted-in")) : null;

  // Sovereign mode short-circuits any "OFFLINE" alarm.
  if (enabledByUser) {
    return {
      verdict: "SOVEREIGN",
      enabledByUser: true,
      reason,
      headline: `Cloud SOVEREIGN MODE (${reason ?? "intentional offline"}). Local-first; no degradation.`,
    };
  }
  if (probe.probeReachable === null) {
    return { verdict: "UNKNOWN", enabledByUser: false, reason: null, headline: "Cloud probe not run yet." };
  }
  if (probe.probeReachable === false) {
    return { verdict: "OFFLINE", enabledByUser: false, reason: null, headline: "Cloud OFFLINE -- upstream unreachable. Consider enabling SOVEREIGN MODE if intentional." };
  }
  // Reachable; classify by latency.
  const rtt = probe.rttMs ?? 0;
  if (rtt >= 2000) {
    return { verdict: "DEGRADED", enabledByUser: false, reason: null, headline: `Cloud DEGRADED -- RTT ${rtt}ms (slow).` };
  }
  return { verdict: "ONLINE", enabledByUser: false, reason: null, headline: `Cloud ONLINE${rtt > 0 ? ` (RTT ${rtt}ms)` : ""}.` };
}
