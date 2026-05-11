/**
 * v1.56.0 -- Windows auto-boot mechanisms (Plan 1, 2, 3).
 *
 * All three are designed to be idempotent + silent + recoverable:
 *   - schtasks: scheduled task triggered "at logon" for the current user,
 *     no UAC prompt (runs in limited-rights session, same as the user's
 *     interactive desktop). Survives reboots; daemon respawns on every
 *     logon. Works on Win 7/8/10/11, 32 + 64 bit.
 *   - startupFolder: drops a .cmd file in the user's Startup folder.
 *     Fires on every logon. No admin rights, no UAC. Works on any
 *     Windows that has a Start Menu (every version since Win 95).
 *   - registryRun: writes HKCU\...\Run, the oldest user-level autostart
 *     hook. Works on every Windows. Per-user, no admin.
 *
 * Idempotent: each install checks if the entry already exists before
 * writing. Re-installing produces no side effect.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallResult {
  mechanism: string;
  ok: boolean;
  message: string;
  /** Path / registry key written, when applicable. */
  target?: string;
}

const TASK_NAME = "MnemeDaemon";
const REGISTRY_NAME = "MnemeDaemon";
const STARTUP_FILE = "mneme-daemon.cmd";

/** Generate the daemon command line. Uses the npm global bin path. */
function daemonCommand(nodePath: string, mnemeBin: string): string {
  return `"${nodePath}" "${mnemeBin}" daemon start --attached`;
}

/** Plan 1: Scheduled Task at logon (most reliable on modern Windows). */
export function installSchtasks(nodePath: string, mnemeBin: string): InstallResult {
  try {
    // Check if already exists -- query returns non-zero when missing.
    try {
      execSync(`schtasks /Query /TN "${TASK_NAME}"`, { stdio: ["ignore", "ignore", "ignore"] });
      return { mechanism: "schtasks", ok: true, message: "already installed", target: TASK_NAME };
    } catch { /* not installed yet -- continue */ }

    const cmd = daemonCommand(nodePath, mnemeBin);
    // /F = force overwrite; /SC ONLOGON = trigger on user logon; /RL LIMITED = no UAC.
    execSync(`schtasks /Create /TN "${TASK_NAME}" /TR ${cmd.replace(/"/g, '\\"')} /SC ONLOGON /RL LIMITED /F`, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5000,
    });
    return { mechanism: "schtasks", ok: true, message: "scheduled task armed for logon", target: TASK_NAME };
  } catch (e) {
    return { mechanism: "schtasks", ok: false, message: `schtasks failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallSchtasks(): InstallResult {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: ["ignore", "ignore", "ignore"] });
    return { mechanism: "schtasks", ok: true, message: "removed" };
  } catch {
    return { mechanism: "schtasks", ok: true, message: "not installed (nothing to remove)" };
  }
}

/** Plan 2: Startup folder .cmd shortcut. */
export function installStartupFolder(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const startupDir = join(process.env["APPDATA"] ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    if (!existsSync(startupDir)) {
      try { mkdirSync(startupDir, { recursive: true }); } catch { /* */ }
    }
    const target = join(startupDir, STARTUP_FILE);
    const cmd = daemonCommand(nodePath, mnemeBin);
    // /B = no window, start the daemon detached so logon doesn't wait on it.
    const body = `@echo off\nstart "" /B ${cmd}\n`;
    if (existsSync(target)) {
      const existing = readFileSync(target, "utf8");
      if (existing.includes(cmd)) {
        return { mechanism: "startupFolder", ok: true, message: "already installed", target };
      }
    }
    writeFileSync(target, body, "utf8");
    return { mechanism: "startupFolder", ok: true, message: "startup folder script written", target };
  } catch (e) {
    return { mechanism: "startupFolder", ok: false, message: `startupFolder failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallStartupFolder(): InstallResult {
  try {
    const target = join(process.env["APPDATA"] ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_FILE);
    if (existsSync(target)) {
      execSync(`del "${target}"`, { stdio: ["ignore", "ignore", "ignore"] });
      return { mechanism: "startupFolder", ok: true, message: "removed", target };
    }
    return { mechanism: "startupFolder", ok: true, message: "not installed" };
  } catch (e) {
    return { mechanism: "startupFolder", ok: false, message: `delete failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 3: HKCU Registry Run key. */
export function installRegistryRun(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const value = daemonCommand(nodePath, mnemeBin);
    // Check if already set.
    try {
      const r = execSync(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${REGISTRY_NAME}"`, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      });
      if (r.includes(value)) {
        return { mechanism: "registryRun", ok: true, message: "already installed", target: `HKCU\\Run\\${REGISTRY_NAME}` };
      }
    } catch { /* not set */ }

    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${REGISTRY_NAME}" /t REG_SZ /d "${value.replace(/"/g, '\\"')}" /f`, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5000,
    });
    return { mechanism: "registryRun", ok: true, message: "HKCU Run key set", target: `HKCU\\Run\\${REGISTRY_NAME}` };
  } catch (e) {
    return { mechanism: "registryRun", ok: false, message: `registry failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallRegistryRun(): InstallResult {
  try {
    execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${REGISTRY_NAME}" /f`, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return { mechanism: "registryRun", ok: true, message: "removed" };
  } catch {
    return { mechanism: "registryRun", ok: true, message: "not installed" };
  }
}

export const WINDOWS_INSTALLERS: Record<string, (n: string, m: string) => InstallResult> = {
  schtasks: installSchtasks,
  startupFolder: installStartupFolder,
  registryRun: installRegistryRun,
};

export const WINDOWS_UNINSTALLERS: Record<string, () => InstallResult> = {
  schtasks: uninstallSchtasks,
  startupFolder: uninstallStartupFolder,
  registryRun: uninstallRegistryRun,
};
