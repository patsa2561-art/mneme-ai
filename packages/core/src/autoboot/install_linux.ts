/**
 * v1.56.0 -- Linux auto-boot mechanisms (Plan 1, 2, 3).
 *
 * Plan 1: systemd user unit at ~/.config/systemd/user/mneme-daemon.service
 *   - `systemctl --user enable mneme-daemon.service` for auto-start.
 *   - `loginctl enable-linger $USER` so the user-unit survives logout.
 *   - Best on Fedora, Ubuntu 18+, Arch, Debian, openSUSE.
 *
 * Plan 2: crontab @reboot (universal Unix). Same as macOS.
 *
 * Plan 3: append to ~/.bashrc / ~/.profile. Fires on every login shell.
 *   Cooperative PID-lock prevents double-spawn.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo, tmpdir } from "node:os";
import type { InstallResult } from "./install_windows.js";
import { safeExec, safeExecTry } from "../util/safe_exec.js";

const UNIT_NAME = "mneme-daemon.service";
const MNEME_BLOCK_MARKER = "# >>> mneme phoenix autoboot >>>";
const MNEME_BLOCK_END = "# <<< mneme phoenix autoboot <<<";

function unitBody(nodePath: string, mnemeBin: string): string {
  return `[Unit]
Description=Mneme Phoenix Daemon (user-level wisdom layer)
After=default.target

[Service]
Type=simple
ExecStart=${nodePath} ${mnemeBin} daemon start --attached
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
}

/** Plan 1: systemd user unit. */
export function installSystemd(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const dir = join(homedir(), ".config", "systemd", "user");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = join(dir, UNIT_NAME);
    const body = unitBody(nodePath, mnemeBin);
    const drift = !existsSync(target) || readFileSync(target, "utf8") !== body;
    if (drift) writeFileSync(target, body, "utf8");
    // Reload + enable + start. Best-effort: any single failure (e.g. no DBus
    // session in a container) doesn't kill the whole install -- caller
    // falls through to Plan 2.
    safeExecTry("systemctl", ["--user", "daemon-reload"], { timeoutMs: 5000 });
    safeExecTry("systemctl", ["--user", "enable", UNIT_NAME], { timeoutMs: 5000 });
    safeExecTry("systemctl", ["--user", "start", UNIT_NAME], { timeoutMs: 5000 });
    // Lingering keeps the user unit alive after logout. Requires no root
    // on modern systemd; falls back silent on errors.
    try {
      const user = userInfo().username;
      safeExecTry("loginctl", ["enable-linger", user], { timeoutMs: 5000 });
    } catch { /* */ }
    return { mechanism: "systemd", ok: true, message: drift ? "user unit installed + enabled" : "already installed", target };
  } catch (e) {
    return { mechanism: "systemd", ok: false, message: `systemd install failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallSystemd(): InstallResult {
  try {
    const target = join(homedir(), ".config", "systemd", "user", UNIT_NAME);
    safeExecTry("systemctl", ["--user", "disable", UNIT_NAME], { timeoutMs: 5000 });
    safeExecTry("systemctl", ["--user", "stop", UNIT_NAME], { timeoutMs: 5000 });
    if (existsSync(target)) {
      unlinkSync(target);
      return { mechanism: "systemd", ok: true, message: "user unit removed", target };
    }
    return { mechanism: "systemd", ok: true, message: "not installed" };
  } catch (e) {
    return { mechanism: "systemd", ok: false, message: `systemd uninstall failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 2: crontab @reboot (re-uses macOS cron logic structurally).
 *
 * v2.4 root-cause fix: temp-file approach replaces the old `echo "..."
 * | crontab -` shell pipe — same injection vector as install_macos.ts.
 */
function writeCrontabFromString(body: string): void {
  const tmpPath = join(tmpdir(), `mneme-crontab-${process.pid}-${Date.now()}.txt`);
  writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600 });
  try {
    safeExec("crontab", [tmpPath], { timeoutMs: 5000 });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
}

function readCurrentCrontab(): string {
  const r = safeExecTry("crontab", ["-l"], { timeoutMs: 5000 });
  if (!r || r.status !== 0) return "";
  return r.stdout;
}

export function installCronReboot(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const line = `@reboot ${nodePath} ${mnemeBin} daemon start --attached`;
    const current = readCurrentCrontab();
    if (current.split("\n").some((l) => l.trim() === line.trim())) {
      return { mechanism: "cron", ok: true, message: "already in crontab", target: "user crontab" };
    }
    const merged = current.trimEnd() + (current ? "\n" : "") + line + "\n";
    writeCrontabFromString(merged);
    return { mechanism: "cron", ok: true, message: "crontab @reboot armed", target: "user crontab" };
  } catch (e) {
    return { mechanism: "cron", ok: false, message: `cron install failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallCronReboot(): InstallResult {
  try {
    const current = readCurrentCrontab();
    if (!current) return { mechanism: "cron", ok: true, message: "no crontab" };
    const lines = current.split("\n").filter((l) => !/mneme.*daemon.*start/i.test(l));
    const merged = lines.join("\n");
    writeCrontabFromString(merged);
    return { mechanism: "cron", ok: true, message: "crontab line removed" };
  } catch (e) {
    return { mechanism: "cron", ok: false, message: `cron uninstall failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 3: append to ~/.bashrc / ~/.profile. */
export function installShellRc(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const bashrc = join(homedir(), ".bashrc");
    const profile = join(homedir(), ".profile");
    const target = existsSync(bashrc) ? bashrc : profile;
    const block = [
      MNEME_BLOCK_MARKER,
      `# Mneme Phoenix Resurrection -- spawn daemon on shell login if dead.`,
      `if [ -z "$MNEME_NOAUTOBOOT" ] && ! pgrep -f "mneme.*daemon" >/dev/null 2>&1; then`,
      `  ("${nodePath}" "${mnemeBin}" daemon start --attached &) >/dev/null 2>&1`,
      `fi`,
      MNEME_BLOCK_END,
      "",
    ].join("\n");
    let existing = "";
    try { existing = readFileSync(target, "utf8"); } catch { /* */ }
    if (existing.includes(MNEME_BLOCK_MARKER)) {
      return { mechanism: "shellRc", ok: true, message: "already in shell rc", target };
    }
    appendFileSync(target, "\n" + block, "utf8");
    return { mechanism: "shellRc", ok: true, message: `appended to ${target}`, target };
  } catch (e) {
    return { mechanism: "shellRc", ok: false, message: `shell rc append failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallShellRc(): InstallResult {
  try {
    const candidates = [join(homedir(), ".bashrc"), join(homedir(), ".profile"), join(homedir(), ".zshrc")];
    let touched = "";
    for (const target of candidates) {
      if (!existsSync(target)) continue;
      const body = readFileSync(target, "utf8");
      if (!body.includes(MNEME_BLOCK_MARKER)) continue;
      const start = body.indexOf(MNEME_BLOCK_MARKER);
      const end = body.indexOf(MNEME_BLOCK_END, start);
      if (start < 0 || end < 0) continue;
      const cleaned = body.slice(0, start).replace(/\n+$/, "") + body.slice(end + MNEME_BLOCK_END.length).replace(/^\n+/, "\n");
      writeFileSync(target, cleaned, "utf8");
      touched = target;
    }
    return touched
      ? { mechanism: "shellRc", ok: true, message: "shell rc block removed", target: touched }
      : { mechanism: "shellRc", ok: true, message: "not installed" };
  } catch (e) {
    return { mechanism: "shellRc", ok: false, message: `shell rc uninstall failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

export const LINUX_INSTALLERS: Record<string, (n: string, m: string) => InstallResult> = {
  systemd: installSystemd,
  cron: installCronReboot,
  shellRc: installShellRc,
};

export const LINUX_UNINSTALLERS: Record<string, () => InstallResult> = {
  systemd: uninstallSystemd,
  cron: uninstallCronReboot,
  shellRc: uninstallShellRc,
};
