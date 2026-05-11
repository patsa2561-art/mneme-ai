/**
 * v1.56.0 -- macOS auto-boot mechanisms (Plan 1, 2, 3).
 *
 * Plan 1: LaunchAgent plist at ~/Library/LaunchAgents/ai.mneme.daemon.plist
 *   - Loaded via `launchctl load`. KeepAlive=true so the daemon
 *     auto-restarts if killed. Works on every macOS since 10.4.
 *   - User-level (no root), survives reboot via launchd.
 *
 * Plan 2: crontab @reboot
 *   - `crontab -l` + append + `crontab -` re-install. Universal Unix.
 *   - Some hardened mac configs disable cron; fall through to Plan 3.
 *
 * Plan 3: append to ~/.zshrc or ~/.bash_profile
 *   - Fires on every shell start. Not ideal (multiple shells = multiple
 *     spawn attempts; PID-lock cooperative startup handles the race).
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { InstallResult } from "./install_windows.js";

const PLIST_LABEL = "ai.mneme.daemon";
const PLIST_NAME = `${PLIST_LABEL}.plist`;
const MNEME_BLOCK_MARKER = "# >>> mneme phoenix autoboot >>>";
const MNEME_BLOCK_END = "# <<< mneme phoenix autoboot <<<";

function plistBody(nodePath: string, mnemeBin: string, logDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${mnemeBin}</string>
    <string>daemon</string>
    <string>start</string>
    <string>--attached</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "mneme-daemon.stdout.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "mneme-daemon.stderr.log")}</string>
</dict>
</plist>
`;
}

/** Plan 1: LaunchAgent plist. */
export function installLaunchAgent(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const dir = join(homedir(), "Library", "LaunchAgents");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = join(dir, PLIST_NAME);
    const logDir = join(homedir(), "Library", "Logs", "mneme");
    if (!existsSync(logDir)) {
      try { mkdirSync(logDir, { recursive: true }); } catch { /* */ }
    }
    const body = plistBody(nodePath, mnemeBin, logDir);
    if (existsSync(target)) {
      const existing = readFileSync(target, "utf8");
      if (existing === body) {
        // Reload anyway in case launchd dropped it on a previous session.
        try { execSync(`launchctl load -w "${target}"`, { stdio: ["ignore", "ignore", "ignore"] }); } catch { /* */ }
        return { mechanism: "launchctl", ok: true, message: "already installed", target };
      }
      // Body drift -- unload + rewrite.
      try { execSync(`launchctl unload "${target}"`, { stdio: ["ignore", "ignore", "ignore"] }); } catch { /* */ }
    }
    writeFileSync(target, body, "utf8");
    execSync(`launchctl load -w "${target}"`, { stdio: ["ignore", "ignore", "pipe"], timeout: 5000 });
    return { mechanism: "launchctl", ok: true, message: "LaunchAgent installed + loaded", target };
  } catch (e) {
    return { mechanism: "launchctl", ok: false, message: `launchctl failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallLaunchAgent(): InstallResult {
  try {
    const target = join(homedir(), "Library", "LaunchAgents", PLIST_NAME);
    if (existsSync(target)) {
      try { execSync(`launchctl unload "${target}"`, { stdio: ["ignore", "ignore", "ignore"] }); } catch { /* */ }
      execSync(`rm -f "${target}"`, { stdio: ["ignore", "ignore", "ignore"] });
      return { mechanism: "launchctl", ok: true, message: "removed", target };
    }
    return { mechanism: "launchctl", ok: true, message: "not installed" };
  } catch (e) {
    return { mechanism: "launchctl", ok: false, message: `uninstall failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 2: crontab @reboot. */
export function installCronReboot(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const line = `@reboot ${nodePath} ${mnemeBin} daemon start --attached`;
    let current = "";
    try {
      current = execSync(`crontab -l 2>/dev/null`, { encoding: "utf8" });
    } catch { /* empty crontab is fine */ }
    if (current.split("\n").some((l) => l.trim() === line.trim())) {
      return { mechanism: "cron", ok: true, message: "already in crontab", target: "@reboot line" };
    }
    const merged = current.trimEnd() + (current ? "\n" : "") + line + "\n";
    // Pipe to crontab -
    execSync(`echo "${merged.replace(/"/g, '\\"')}" | crontab -`, {
      shell: "/bin/bash",
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5000,
    });
    return { mechanism: "cron", ok: true, message: "crontab @reboot armed", target: "user crontab" };
  } catch (e) {
    return { mechanism: "cron", ok: false, message: `cron install failed: ${(e as Error).message.slice(0, 100)}` };
  }
}

export function uninstallCronReboot(): InstallResult {
  try {
    let current = "";
    try { current = execSync(`crontab -l 2>/dev/null`, { encoding: "utf8" }); } catch { return { mechanism: "cron", ok: true, message: "no crontab" }; }
    const lines = current.split("\n").filter((l) => !/mneme.*daemon.*start/i.test(l));
    const merged = lines.join("\n");
    execSync(`echo "${merged.replace(/"/g, '\\"')}" | crontab -`, { shell: "/bin/bash", stdio: ["ignore", "ignore", "pipe"] });
    return { mechanism: "cron", ok: true, message: "crontab line removed" };
  } catch (e) {
    return { mechanism: "cron", ok: false, message: `cron uninstall failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Plan 3: append to ~/.zshrc or ~/.bash_profile. */
export function installShellRc(nodePath: string, mnemeBin: string): InstallResult {
  try {
    const zshrc = join(process.env["ZDOTDIR"] ?? homedir(), ".zshrc");
    const bashProfile = join(homedir(), ".bash_profile");
    const target = existsSync(zshrc) ? zshrc : bashProfile;
    const block = [
      MNEME_BLOCK_MARKER,
      `# Mneme Phoenix Resurrection Protocol -- silent daemon spawn on shell start.`,
      `# Cooperative PID-lock prevents double-spawn when multiple shells open at once.`,
      `if ! pgrep -f "mneme.*daemon" >/dev/null 2>&1; then`,
      `  ("${nodePath}" "${mnemeBin}" daemon start --attached &) >/dev/null 2>&1`,
      `fi`,
      MNEME_BLOCK_END,
      "",
    ].join("\n");
    let existing = "";
    try { existing = readFileSync(target, "utf8"); } catch { /* file may not exist */ }
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
    const candidates = [join(homedir(), ".zshrc"), join(homedir(), ".bash_profile"), join(homedir(), ".bashrc"), join(homedir(), ".profile")];
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

export const MACOS_INSTALLERS: Record<string, (n: string, m: string) => InstallResult> = {
  launchctl: installLaunchAgent,
  cron: installCronReboot,
  shellRc: installShellRc,
};

export const MACOS_UNINSTALLERS: Record<string, () => InstallResult> = {
  launchctl: uninstallLaunchAgent,
  cron: uninstallCronReboot,
  shellRc: uninstallShellRc,
};
