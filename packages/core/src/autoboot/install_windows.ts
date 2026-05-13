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

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { safeExec, safeExecTry } from "../util/safe_exec.js";

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

/** Path to the shim script the Scheduled Task invokes. We point
 *  schtasks at a single .cmd shim file so we sidestep the notorious
 *  /TR quoting bug (paths-with-spaces inside a quoted argument are
 *  treated as multiple positional args by schtasks itself, even with
 *  proper escaping). The shim has no spaces in its path, so schtasks
 *  is happy. */
function schtasksShimPath(): string {
  // Per-user shim, no admin needed.
  return join(homedir(), ".mneme-phoenix-shim.cmd");
}

/** Plan 1: Scheduled Task at logon (most reliable on modern Windows). */
export function installSchtasks(nodePath: string, mnemeBin: string): InstallResult {
  try {
    // Check if already exists -- query returns non-zero when missing.
    // v2.4: spawnSync with argv array; no shell, no template interpolation.
    const queryResult = safeExecTry("schtasks", ["/Query", "/TN", TASK_NAME], { timeoutMs: 5000 });
    if (queryResult?.status === 0) {
      return { mechanism: "schtasks", ok: true, message: "already installed", target: TASK_NAME };
    }

    // Write a tiny .cmd shim with the full daemon command. schtasks /TR
    // gets the shim path (no spaces -> no quoting hell). The shim itself
    // handles quoting the node + mneme paths in cmd.exe-native syntax.
    const shim = schtasksShimPath();
    const shimBody = [
      "@echo off",
      `start "" /B "${nodePath}" "${mnemeBin}" daemon start --attached`,
    ].join("\r\n") + "\r\n";
    writeFileSync(shim, shimBody, { encoding: "utf8" });

    // Attempt 1: /RL LIMITED (no UAC). Some corp policies reject this.
    // Attempt 2: default rights (HIGHEST -- still no UAC for current user
    // tasks on most Win10/11). Both run AS CURRENT USER via /RU %USERNAME%.
    const user = process.env["USERNAME"] ?? "";
    const baseArgs = ["/Create", "/TN", TASK_NAME, "/TR", shim, "/SC", "ONLOGON", "/F"];
    if (user) { baseArgs.push("/RU", user); }
    let r = spawnSync("schtasks", [...baseArgs, "/RL", "LIMITED"], { stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
    if (r.status !== 0) {
      // Retry without /RL LIMITED -- some installs require default rights.
      r = spawnSync("schtasks", baseArgs, { stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
    }
    if (r.status !== 0) {
      const err = (r.stderr?.toString() ?? "").trim() || (r.stdout?.toString() ?? "").trim() || `exit ${r.status}`;
      return { mechanism: "schtasks", ok: false, message: `schtasks failed: ${err.slice(0, 120)}` };
    }
    return { mechanism: "schtasks", ok: true, message: "scheduled task armed for logon (via shim)", target: TASK_NAME };
  } catch (e) {
    return { mechanism: "schtasks", ok: false, message: `schtasks failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallSchtasks(): InstallResult {
  try {
    const r = safeExecTry("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"], { timeoutMs: 5000 });
    if (r && r.status === 0) return { mechanism: "schtasks", ok: true, message: "removed" };
    return { mechanism: "schtasks", ok: true, message: "not installed (nothing to remove)" };
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
      // v2.4: prefer Node's fs.unlinkSync over shelling out to `del`. No
      // string interpolation; no shell metacharacter risk.
      try { unlinkSync(target); } catch { /* best-effort */ }
      return { mechanism: "startupFolder", ok: true, message: "removed", target };
    }
    return { mechanism: "startupFolder", ok: true, message: "not installed" };
  } catch (e) {
    return { mechanism: "startupFolder", ok: false, message: `delete failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 3: HKCU Registry Run key. */
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export function installRegistryRun(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const value = daemonCommand(nodePath, mnemeBin);
    // v2.4: spawnSync argv array; REGISTRY_NAME + value pass as separate
    // argv elements, never composed into a shell template.
    const queryResult = safeExecTry("reg", ["query", RUN_KEY, "/v", REGISTRY_NAME], { timeoutMs: 5000 });
    if (queryResult?.status === 0 && queryResult.stdout.includes(value)) {
      return { mechanism: "registryRun", ok: true, message: "already installed", target: `HKCU\\Run\\${REGISTRY_NAME}` };
    }

    safeExec("reg", ["add", RUN_KEY, "/v", REGISTRY_NAME, "/t", "REG_SZ", "/d", value, "/f"], { timeoutMs: 5000 });
    return { mechanism: "registryRun", ok: true, message: "HKCU Run key set", target: `HKCU\\Run\\${REGISTRY_NAME}` };
  } catch (e) {
    return { mechanism: "registryRun", ok: false, message: `registry failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallRegistryRun(): InstallResult {
  try {
    safeExecTry("reg", ["delete", RUN_KEY, "/v", REGISTRY_NAME, "/f"], {
      timeoutMs: 5000,
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
