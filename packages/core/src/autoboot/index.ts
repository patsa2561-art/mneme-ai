/**
 * v1.56.0 -- PHOENIX RESURRECTION PROTOCOL · orchestrator.
 *
 * Three core public surfaces:
 *
 *   installAutoBoot(opts)   -- arms 1 to 3 mechanisms (TRIPLE-WITNESS mode by default).
 *   uninstallAutoBoot()     -- removes all installed mechanisms.
 *   autoBootStatus()        -- diagnoses which mechanisms are currently armed.
 *
 * THE TRIPLE-WITNESS CHEAT.
 *
 * Most installers pick ONE mechanism. If that mechanism is blocked (corp
 * IT, hardened container, missing dependency) the daemon never resurrects.
 * Phoenix installs ALL THREE mechanisms simultaneously. On boot, ALL of
 * them try to spawn the daemon. The first one to succeed acquires the
 * PID lock (`.mneme/daemon.pid`); the others see the lock + exit cleanly.
 *
 *   3 plans armed → P(daemon resurrects) = 1 - (failure rate)^3
 *
 * If each individual mechanism has a 5% failure rate independently
 * (corp policy / disk full / permission anomaly), 3-witness yields
 * 0.05^3 = 0.0125% = 99.99% effective resurrection rate. The "cheat" is
 * that we don't trust any single mechanism -- we let them race.
 *
 * Idempotent: re-running installAutoBoot detects already-installed
 * entries and reports them as such. Safe to call from
 * `mneme upgrade --force` on every release.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { probe, type Platform, type ProbeResult } from "./probe.js";
import { WINDOWS_INSTALLERS, WINDOWS_UNINSTALLERS } from "./install_windows.js";
import { MACOS_INSTALLERS, MACOS_UNINSTALLERS } from "./install_macos.js";
import { LINUX_INSTALLERS, LINUX_UNINSTALLERS } from "./install_linux.js";
import type { InstallResult } from "./install_windows.js";

export interface InstallOptions {
  /** Absolute path to node binary. Defaults to `process.execPath`. */
  nodePath?: string;
  /** Absolute path to the mneme CLI entry. Required (cross-platform path
   *  detection is brittle in npm-global locations). */
  mnemeBin: string;
  /** "triple" arms every available mechanism; "first-success" stops after
   *  the first successful install. Default "triple" for max resilience. */
  mode?: "triple" | "first-success";
  /** Path to .mneme/ for audit-log writes. Optional; when omitted the
   *  audit log entry is skipped. */
  repoRoot?: string;
}

export interface InstallSummary {
  platform: Platform;
  plan: string[];
  results: InstallResult[];
  /** True when at least one mechanism is now armed. */
  armed: boolean;
  /** The mechanism keys that succeeded. */
  armedMechanisms: string[];
  /** Probability estimate of successful resurrection given the
   *  mechanisms armed and an assumed 5% per-mechanism failure rate.
   *  Surfaces the math behind the triple-witness cheat. */
  estimatedResurrectionProbability: number;
}

function pickInstallers(platform: Platform): Record<string, (n: string, m: string) => InstallResult> {
  switch (platform) {
    case "windows": return WINDOWS_INSTALLERS;
    case "macos": return MACOS_INSTALLERS;
    case "linux": return LINUX_INSTALLERS;
    default: return {};
  }
}

function pickUninstallers(platform: Platform): Record<string, () => InstallResult> {
  switch (platform) {
    case "windows": return WINDOWS_UNINSTALLERS;
    case "macos": return MACOS_UNINSTALLERS;
    case "linux": return LINUX_UNINSTALLERS;
    default: return {};
  }
}

/** Triple-witness probability. Given n mechanisms with assumed 5%
 *  independent failure rate, returns the joint success probability. */
function tripleWitnessProb(nArmed: number): number {
  if (nArmed === 0) return 0;
  return 1 - Math.pow(0.05, nArmed);
}

/** Install one or more auto-boot mechanisms. */
export function installAutoBoot(opts: InstallOptions): InstallSummary {
  const nodePath = opts.nodePath ?? process.execPath;
  const mnemeBin = opts.mnemeBin;
  const mode = opts.mode ?? "triple";
  const p: ProbeResult = probe();
  const installers = pickInstallers(p.platform);
  const results: InstallResult[] = [];

  for (const mech of p.plan) {
    const installer = installers[mech];
    if (!installer) continue;
    const r = installer(nodePath, mnemeBin);
    results.push(r);
    if (mode === "first-success" && r.ok && /armed|installed|already/.test(r.message)) break;
  }

  const armedMechanisms = results.filter((r) => r.ok).map((r) => r.mechanism);
  const armed = armedMechanisms.length > 0;
  const probSuccess = tripleWitnessProb(armedMechanisms.length);

  // Audit log -- best-effort. Captures every install attempt for the
  // resurrection-event log so we can verify the install on next boot.
  if (opts.repoRoot) {
    try {
      const dir = join(opts.repoRoot, ".mneme", "autoboot");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tagFile = join(dir, "installed.json");
      writeFileSync(tagFile, JSON.stringify({
        platform: p.platform,
        installedAt: new Date().toISOString(),
        mechanisms: armedMechanisms,
        nodePath, mnemeBin,
        probSuccess,
      }, null, 2), "utf8");
      appendFileSync(join(dir, "audit.jsonl"), JSON.stringify({
        ts: new Date().toISOString(), event: "install", platform: p.platform, results,
      }) + "\n", "utf8");
    } catch { /* */ }
  }

  return {
    platform: p.platform,
    plan: p.plan,
    results,
    armed,
    armedMechanisms,
    estimatedResurrectionProbability: probSuccess,
  };
}

/** Remove every installed mechanism. */
export function uninstallAutoBoot(opts?: { repoRoot?: string }): InstallSummary {
  const p = probe();
  const uninstallers = pickUninstallers(p.platform);
  const results: InstallResult[] = [];
  for (const mech of p.plan) {
    const u = uninstallers[mech];
    if (!u) continue;
    results.push(u());
  }
  if (opts?.repoRoot) {
    try {
      const dir = join(opts.repoRoot, ".mneme", "autoboot");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "audit.jsonl"), JSON.stringify({
        ts: new Date().toISOString(), event: "uninstall", platform: p.platform, results,
      }) + "\n", "utf8");
    } catch { /* */ }
  }
  return {
    platform: p.platform,
    plan: p.plan,
    results,
    armed: false,
    armedMechanisms: [],
    estimatedResurrectionProbability: 0,
  };
}

export interface StatusReport {
  platform: Platform;
  capabilities: ProbeResult["capabilities"];
  plan: string[];
  /** Inferred from the install tag file written on last install. */
  lastInstall: { installedAt: string; mechanisms: string[]; probSuccess: number } | null;
  /** Daemon currently running? */
  daemonRunning: boolean;
}

/** Read-only diagnostic. Does NOT modify any state. */
export function autoBootStatus(repoRoot?: string): StatusReport {
  const p = probe();
  let lastInstall: StatusReport["lastInstall"] = null;
  if (repoRoot) {
    const tag = join(repoRoot, ".mneme", "autoboot", "installed.json");
    if (existsSync(tag)) {
      try {
        const parsed = JSON.parse(readFileSync(tag, "utf8"));
        lastInstall = {
          installedAt: parsed.installedAt,
          mechanisms: parsed.mechanisms ?? [],
          probSuccess: parsed.probSuccess ?? 0,
        };
      } catch { /* */ }
    }
  }
  // Best-effort daemon detection via .mneme/daemon.pid.
  let daemonRunning = false;
  if (repoRoot) {
    const pidFile = join(repoRoot, ".mneme", "daemon.pid");
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
        if (Number.isFinite(pid)) {
          try { process.kill(pid, 0); daemonRunning = true; } catch { daemonRunning = false; }
        }
      } catch { /* */ }
    }
  }
  return {
    platform: p.platform,
    capabilities: p.capabilities,
    plan: p.plan,
    lastInstall,
    daemonRunning,
  };
}

export { probe } from "./probe.js";
export type { Platform, ProbeResult } from "./probe.js";
export type { InstallResult } from "./install_windows.js";
