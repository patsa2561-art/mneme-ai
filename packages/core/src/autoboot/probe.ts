/**
 * v1.56.0 -- PHOENIX RESURRECTION PROTOCOL: capability probe.
 *
 * Before we install any auto-boot mechanism we test what's actually
 * available on this host. Capability-based, not OS-version-based --
 * a stripped-down Windows Server, a corporate-locked Mac, a Linux
 * container without systemd, all get the BEST available mechanism
 * + silent fallback to the next.
 *
 * The probe is read-only + idempotent. Running it twice produces
 * the same result. No filesystem writes, no process spawns beyond
 * `which X` / `where X` style checks.
 *
 * Result is a Capability map that the orchestrator consumes:
 *
 *   Windows:
 *     - schtasks       (Plan 1 -- scheduled task at logon)
 *     - startupFolder  (Plan 2 -- shortcut in user's Startup folder)
 *     - registryRun    (Plan 3 -- HKCU\...\Run key)
 *   macOS:
 *     - launchctl      (Plan 1 -- LaunchAgent plist + load)
 *     - cron           (Plan 2 -- crontab @reboot)
 *     - shellRc        (Plan 3 -- append to ~/.zshrc / ~/.bash_profile)
 *   Linux:
 *     - systemd        (Plan 1 -- user unit + enable-linger)
 *     - cron           (Plan 2 -- crontab @reboot)
 *     - shellRc        (Plan 3 -- append to ~/.bashrc / ~/.profile)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Platform = "windows" | "macos" | "linux" | "unknown";

export interface Capability {
  available: boolean;
  /** Human-readable reason it's available or not. */
  reason: string;
}

export interface ProbeResult {
  platform: Platform;
  /** All probed mechanisms by name. */
  capabilities: Record<string, Capability>;
  /** Ordered list of mechanism keys, best-first. The orchestrator tries
   *  them in order until one succeeds. */
  plan: string[];
}

/** Detect the host OS. Returns "unknown" rather than throwing so the
 *  orchestrator can fall back to a no-op rather than crashing. */
export function detectPlatform(): Platform {
  switch (process.platform) {
    case "win32": return "windows";
    case "darwin": return "macos";
    case "linux": return "linux";
    case "freebsd": return "linux"; // close-enough; systemd / cron path applies
    default: return "unknown";
  }
}

/** True if a command exists on PATH. Cross-platform: uses `where` on
 *  Windows and `which` elsewhere. Both exit non-zero when not found. */
function hasCommand(cmd: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: ["ignore", "ignore", "ignore"], timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Probe Windows mechanisms. */
function probeWindows(): Record<string, Capability> {
  const out: Record<string, Capability> = {};
  out.schtasks = hasCommand("schtasks")
    ? { available: true, reason: "schtasks.exe present" }
    : { available: false, reason: "schtasks.exe not on PATH" };

  // Startup folder always exists for an interactive user account.
  const startupFolder = join(process.env["APPDATA"] ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  out.startupFolder = existsSync(startupFolder)
    ? { available: true, reason: `${startupFolder} writable` }
    : { available: false, reason: "no Startup folder for current user" };

  // Registry Run key -- always writable via reg.exe on Windows.
  out.registryRun = hasCommand("reg")
    ? { available: true, reason: "reg.exe present" }
    : { available: false, reason: "reg.exe not on PATH" };

  return out;
}

/** Probe macOS mechanisms. */
function probeMacOS(): Record<string, Capability> {
  const out: Record<string, Capability> = {};
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  out.launchctl = hasCommand("launchctl")
    ? { available: true, reason: `launchctl present, ${launchAgentsDir} target` }
    : { available: false, reason: "launchctl not available" };
  out.cron = hasCommand("crontab")
    ? { available: true, reason: "crontab present" }
    : { available: false, reason: "crontab not installed" };

  const shellRc = process.env["ZDOTDIR"]
    ? join(process.env["ZDOTDIR"], ".zshrc")
    : join(homedir(), ".zshrc");
  out.shellRc = existsSync(shellRc) || existsSync(join(homedir(), ".bash_profile"))
    ? { available: true, reason: `shell rc writable (${shellRc} or ~/.bash_profile)` }
    : { available: true, reason: "will create ~/.zshrc if missing" }; // always-true last resort

  return out;
}

/** Probe Linux mechanisms. */
function probeLinux(): Record<string, Capability> {
  const out: Record<string, Capability> = {};
  out.systemd = hasCommand("systemctl")
    ? { available: true, reason: "systemctl present (user unit + enable-linger)" }
    : { available: false, reason: "systemctl not available (likely musl / busybox base)" };
  out.cron = hasCommand("crontab")
    ? { available: true, reason: "crontab present" }
    : { available: false, reason: "crontab not installed" };

  const bashrc = join(homedir(), ".bashrc");
  const profile = join(homedir(), ".profile");
  out.shellRc = existsSync(bashrc) || existsSync(profile)
    ? { available: true, reason: "shell rc writable (~/.bashrc or ~/.profile)" }
    : { available: true, reason: "will create ~/.profile if missing" };

  return out;
}

/** Build the ordered plan -- best mechanism first, fall through to the
 *  next on failure. Mechanisms that probe as unavailable are filtered
 *  out so the orchestrator doesn't waste a turn on them. */
function buildPlan(platform: Platform, caps: Record<string, Capability>): string[] {
  const order: Record<Platform, string[]> = {
    windows: ["schtasks", "startupFolder", "registryRun"],
    macos: ["launchctl", "cron", "shellRc"],
    linux: ["systemd", "cron", "shellRc"],
    unknown: [],
  };
  return order[platform].filter((m) => caps[m]?.available === true);
}

/** Run the full probe. Pure read-only function. */
export function probe(): ProbeResult {
  const platform = detectPlatform();
  let capabilities: Record<string, Capability>;
  switch (platform) {
    case "windows": capabilities = probeWindows(); break;
    case "macos": capabilities = probeMacOS(); break;
    case "linux": capabilities = probeLinux(); break;
    default: capabilities = {};
  }
  const plan = buildPlan(platform, capabilities);
  return { platform, capabilities, plan };
}
