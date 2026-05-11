/**
 * MNEME service uninstall (v1.28.2) — cross-platform removal of the
 * boot-service that the ghost-sniper auto-boot may have installed.
 *
 * Mirrors the install side in `packages/cli/src/commands/mnemeiosis.ts`
 * (schtasks ONLOGON / systemd --user / launchd LaunchAgent) but lives
 * in core so the comprehensive `mneme uninstall` command can remove
 * everything in one pass without forking a subprocess.
 *
 * NEVER throws. Each removal step returns a structured result so the
 * caller can present a wisdom-style "X removed, Y was already gone"
 * report to the user.
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

export interface ServiceRemovalResult {
  /** What we attempted to remove (description). */
  artifact: string;
  /** Path/identifier of the artifact (the file or task name). */
  identifier: string;
  /** Outcome. */
  status: "removed" | "not-installed" | "failed";
  /** Human-readable detail (error message on failed, etc.). */
  detail?: string;
}

const WIN_TASK_NAME = "MnemeNucleusDaemon";
const LINUX_UNIT_NAME = "mneme-nucleus.service";
const MACOS_LABEL = "ai.mneme.nucleus";

function shellRun(cmd: string): { ok: boolean; stderr: string } {
  try {
    const isWin = platform() === "win32";
    const r = isWin
      ? spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
    if (r.status !== 0) return { ok: false, stderr: (r.stderr || r.stdout || "non-zero exit").trim() };
    return { ok: true, stderr: "" };
  } catch (e) {
    return { ok: false, stderr: (e as Error).message };
  }
}

/** Remove the platform-native boot service. Returns one result per
 *  artifact attempted. Always non-throwing; "not-installed" is fine. */
export function removeBootService(): ServiceRemovalResult[] {
  const plat = platform();
  if (plat === "win32") return removeWindowsTask();
  if (plat === "linux") return removeLinuxUserUnit();
  if (plat === "darwin") return removeMacosLaunchAgent();
  return [{
    artifact: "boot service",
    identifier: plat,
    status: "not-installed",
    detail: `unsupported platform "${plat}" -- nothing to remove`,
  }];
}

function removeWindowsTask(): ServiceRemovalResult[] {
  // Probe first so we report not-installed accurately.
  const probe = shellRun(`schtasks /Query /TN "${WIN_TASK_NAME}"`);
  if (!probe.ok && /cannot find|does not exist/i.test(probe.stderr)) {
    return [{
      artifact: "Windows scheduled task",
      identifier: WIN_TASK_NAME,
      status: "not-installed",
    }];
  }
  const del = shellRun(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F`);
  return [{
    artifact: "Windows scheduled task",
    identifier: WIN_TASK_NAME,
    status: del.ok ? "removed" : "failed",
    detail: del.ok ? undefined : del.stderr,
  }];
}

function removeLinuxUserUnit(): ServiceRemovalResult[] {
  const userDir = join(homedir(), ".config", "systemd", "user");
  const unitPath = join(userDir, LINUX_UNIT_NAME);
  if (!existsSync(unitPath)) {
    return [{
      artifact: "systemd user-unit",
      identifier: unitPath,
      status: "not-installed",
    }];
  }
  // Best-effort stop+disable; ignore failures since the file removal is
  // the load-bearing step.
  shellRun(`systemctl --user stop ${LINUX_UNIT_NAME} 2>/dev/null; systemctl --user disable ${LINUX_UNIT_NAME} 2>/dev/null`);
  try {
    unlinkSync(unitPath);
    return [{
      artifact: "systemd user-unit",
      identifier: unitPath,
      status: "removed",
    }];
  } catch (e) {
    return [{
      artifact: "systemd user-unit",
      identifier: unitPath,
      status: "failed",
      detail: (e as Error).message,
    }];
  }
}

function removeMacosLaunchAgent(): ServiceRemovalResult[] {
  const dir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(dir, `${MACOS_LABEL}.plist`);
  if (!existsSync(plistPath)) {
    return [{
      artifact: "launchd LaunchAgent",
      identifier: plistPath,
      status: "not-installed",
    }];
  }
  shellRun(`launchctl unload "${plistPath}" 2>/dev/null`);
  try {
    unlinkSync(plistPath);
    return [{
      artifact: "launchd LaunchAgent",
      identifier: plistPath,
      status: "removed",
    }];
  } catch (e) {
    return [{
      artifact: "launchd LaunchAgent",
      identifier: plistPath,
      status: "failed",
      detail: (e as Error).message,
    }];
  }
}

/** Remove the auto-boot marker file (so a future re-install fires the
 *  one-time service install again). */
export function removeAutoBootMarker(homeDir: string = homedir()): ServiceRemovalResult {
  const path = join(homeDir, ".mneme-auto-service-attempted");
  if (!existsSync(path)) {
    return { artifact: "auto-boot marker", identifier: path, status: "not-installed" };
  }
  try {
    unlinkSync(path);
    return { artifact: "auto-boot marker", identifier: path, status: "removed" };
  } catch (e) {
    return { artifact: "auto-boot marker", identifier: path, status: "failed", detail: (e as Error).message };
  }
}
