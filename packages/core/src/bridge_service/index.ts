/**
 * v2.19.89 — BRIDGE SERVICE (cross-platform auto-start on login).
 *
 * Registers `mneme bridge --detach` as an OS service that fires on
 * every user login.  After `mneme bridge service install` the user
 * NEVER has to type a Mneme command again — bridge auto-revives on
 * reboot, log-in, sleep-wake.  Pure boot-time persistence.
 *
 *   Windows  schtasks /create /tn "MnemeBridge" /sc onlogon
 *   macOS    ~/Library/LaunchAgents/dev.mneme.bridge.plist + launchctl load
 *   Linux    ~/.config/systemd/user/mneme-bridge.service + systemctl --user enable
 *
 * NO admin / sudo required — all three paths are USER-scope. Mneme
 * never asks the user for elevated privileges; if a path needs sudo
 * we surface the manual command instead.
 *
 * Composes with:
 *   - mneme bridge --detach (the long-running process the service spawns)
 *   - .mneme/bridge.json beacon (so the service knows where it bound)
 *   - port-ladder rendezvous (so it picks a free port automatically)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, hostname } from "node:os";
import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";

const TASK_NAME = "MnemeBridge";
const PLIST_LABEL = "dev.mneme.bridge";
const SYSTEMD_UNIT = "mneme-bridge.service";

export type Platform = "windows" | "macos" | "linux";
export type ServiceState = "installed" | "running" | "not-installed" | "error";

export interface ServiceStatus {
  platform: Platform;
  installed: boolean;
  running: boolean;
  method: string;        // "schtasks" / "launchd" / "systemd-user"
  unitPath?: string;     // where the service file lives
  detail: string;        // plain-English summary
  reinstallHint?: string;
}

export interface InstallResult {
  ok: boolean;
  platform: Platform;
  method: string;
  unitPath?: string;
  detail: string;
  manualFallback?: string;
}

function detectPlatform(): Platform {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

function resolveBin(): string {
  // Walk up from this compiled file (.../packages/core/dist/bridge_service/index.js)
  // to the CLI bin.
  const here = new URL(import.meta.url).pathname;
  // Try a sibling `packages/cli/bin/mneme.js` first.
  const root = here.replace(/[\\/]packages[\\/]core[\\/](dist|src)[\\/]bridge_service[\\/]index\.[jt]s$/, "");
  const norm = process.platform === "win32" && root.startsWith("/") ? root.slice(1) : root;
  const cliBin = join(norm, "packages", "cli", "bin", "mneme.js");
  if (existsSync(cliBin)) return cliBin;
  // Otherwise try the global install path Node sees on PATH.
  return "mneme";
}

function nodeBin(): string {
  // execPath always points at the current node binary; the spawned
  // service must use the SAME version so dynamic-import paths resolve.
  return process.execPath;
}

function tryExec(cmd: string, opts: ExecSyncOptionsWithStringEncoding = { encoding: "utf8" }): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout: (stdout || "").toString().trim(), stderr: "" };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return {
      ok: false,
      stdout: err.stdout ? err.stdout.toString().trim() : "",
      stderr: err.stderr ? err.stderr.toString().trim() : (err.message ?? ""),
    };
  }
}

// ─── Windows: schtasks ─────────────────────────────────────────────────

function installWindows(): InstallResult {
  const node = nodeBin();
  const cli = resolveBin();
  // /sc onlogon runs once per session start — exactly what we want for
  // a per-user bridge.  /rl LIMITED keeps it user-scope (no UAC prompt).
  const action = `"${node}" "${cli}" bridge --detach`;
  const cmd = `schtasks /Create /F /TN "${TASK_NAME}" /SC ONLOGON /RL LIMITED /TR ${JSON.stringify(action)}`;
  const r = tryExec(cmd);
  if (r.ok) {
    return {
      ok: true, platform: "windows", method: "schtasks",
      unitPath: `Task Scheduler · ${TASK_NAME}`,
      detail: "Registered as a Windows scheduled task that runs at every user logon.",
    };
  }
  return {
    ok: false, platform: "windows", method: "schtasks",
    detail: `schtasks failed: ${r.stderr || r.stdout}`,
    manualFallback: cmd,
  };
}

function uninstallWindows(): InstallResult {
  const r = tryExec(`schtasks /Delete /F /TN "${TASK_NAME}"`);
  return {
    ok: r.ok, platform: "windows", method: "schtasks",
    detail: r.ok ? "Scheduled task removed." : `schtasks delete failed: ${r.stderr || r.stdout}`,
  };
}

function statusWindows(): ServiceStatus {
  const r = tryExec(`schtasks /Query /TN "${TASK_NAME}" /FO CSV /NH`);
  if (!r.ok) {
    return { platform: "windows", installed: false, running: false, method: "schtasks", detail: "Scheduled task not registered." };
  }
  // r.stdout = "task,nextRun,status"; the third column = state
  const cols = r.stdout.split(",").map((c) => c.replace(/^"|"$/g, ""));
  const stateRaw = cols[2] || "";
  const running = /Running/i.test(stateRaw);
  return {
    platform: "windows", installed: true, running,
    method: "schtasks",
    unitPath: `Task Scheduler · ${TASK_NAME}`,
    detail: `Scheduled task '${TASK_NAME}' is registered (state: ${stateRaw}).`,
  };
}

// ─── macOS: launchd ────────────────────────────────────────────────────

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
}

function renderPlist(): string {
  const node = nodeBin();
  const cli = resolveBin();
  const logDir = join(homedir(), ".mneme");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>bridge</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logDir}/bridge.log</string>
  <key>StandardErrorPath</key><string>${logDir}/bridge.log</string>
  <key>WorkingDirectory</key><string>${homedir()}</string>
</dict>
</plist>
`;
}

function installMacos(): InstallResult {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = plistPath();
  writeFileSync(p, renderPlist(), "utf8");
  const r = tryExec(`launchctl load -w "${p}"`);
  return {
    ok: r.ok, platform: "macos", method: "launchd", unitPath: p,
    detail: r.ok
      ? "Registered as a launchd LaunchAgent that runs at login + auto-restarts if killed."
      : `launchctl load failed: ${r.stderr || r.stdout}`,
    manualFallback: r.ok ? undefined : `launchctl load -w "${p}"`,
  };
}

function uninstallMacos(): InstallResult {
  const p = plistPath();
  if (!existsSync(p)) return { ok: true, platform: "macos", method: "launchd", detail: "Already not installed." };
  tryExec(`launchctl unload "${p}"`);
  try { unlinkSync(p); } catch { /* */ }
  return { ok: true, platform: "macos", method: "launchd", detail: "LaunchAgent removed." };
}

function statusMacos(): ServiceStatus {
  const p = plistPath();
  if (!existsSync(p)) return { platform: "macos", installed: false, running: false, method: "launchd", detail: "LaunchAgent plist not present." };
  const r = tryExec(`launchctl list ${PLIST_LABEL}`);
  const running = r.ok && /PID/.test(r.stdout);
  return {
    platform: "macos", installed: true, running,
    method: "launchd", unitPath: p,
    detail: running
      ? `LaunchAgent '${PLIST_LABEL}' loaded and running.`
      : `LaunchAgent '${PLIST_LABEL}' installed but not currently loaded.`,
    reinstallHint: running ? undefined : `launchctl load -w "${p}"`,
  };
}

// ─── Linux: systemd --user ─────────────────────────────────────────────

function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function renderSystemdUnit(): string {
  const node = nodeBin();
  const cli = resolveBin();
  return `[Unit]
Description=Mneme Bridge (polygraph) - per-user
After=default.target

[Service]
Type=simple
ExecStart=${node} ${cli} bridge
Restart=on-failure
RestartSec=5
StandardOutput=append:${homedir()}/.mneme/bridge.log
StandardError=append:${homedir()}/.mneme/bridge.log

[Install]
WantedBy=default.target
`;
}

function installLinux(): InstallResult {
  const dir = join(homedir(), ".config", "systemd", "user");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = systemdUnitPath();
  writeFileSync(p, renderSystemdUnit(), "utf8");
  const a = tryExec("systemctl --user daemon-reload");
  const b = tryExec(`systemctl --user enable --now ${SYSTEMD_UNIT}`);
  return {
    ok: b.ok, platform: "linux", method: "systemd-user", unitPath: p,
    detail: b.ok
      ? `Registered as a systemd --user service. Restart-on-failure, auto-starts on login.`
      : `systemctl enable failed: ${b.stderr || b.stdout}. (daemon-reload: ${a.ok ? "ok" : a.stderr})`,
    manualFallback: b.ok ? undefined : `systemctl --user daemon-reload && systemctl --user enable --now ${SYSTEMD_UNIT}`,
  };
}

function uninstallLinux(): InstallResult {
  tryExec(`systemctl --user disable --now ${SYSTEMD_UNIT}`);
  const p = systemdUnitPath();
  try { unlinkSync(p); } catch { /* */ }
  tryExec("systemctl --user daemon-reload");
  return { ok: true, platform: "linux", method: "systemd-user", detail: "systemd unit removed." };
}

function statusLinux(): ServiceStatus {
  const p = systemdUnitPath();
  if (!existsSync(p)) return { platform: "linux", installed: false, running: false, method: "systemd-user", detail: "systemd unit not present." };
  const a = tryExec(`systemctl --user is-active ${SYSTEMD_UNIT}`);
  const running = a.ok && a.stdout.trim() === "active";
  return {
    platform: "linux", installed: true, running,
    method: "systemd-user", unitPath: p,
    detail: running
      ? `systemd unit '${SYSTEMD_UNIT}' is active.`
      : `systemd unit installed but not active (state: ${a.stdout}).`,
    reinstallHint: running ? undefined : `systemctl --user start ${SYSTEMD_UNIT}`,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export function installBridgeService(): InstallResult {
  const p = detectPlatform();
  if (p === "windows") return installWindows();
  if (p === "macos")   return installMacos();
  return installLinux();
}

export function uninstallBridgeService(): InstallResult {
  const p = detectPlatform();
  if (p === "windows") return uninstallWindows();
  if (p === "macos")   return uninstallMacos();
  return uninstallLinux();
}

export function bridgeServiceStatus(): ServiceStatus {
  const p = detectPlatform();
  if (p === "windows") return statusWindows();
  if (p === "macos")   return statusMacos();
  return statusLinux();
}

/** Hostname tag used by the dashboard to identify the machine that
 *  registered the service.  Convenience exposure of os.hostname(). */
export function machineLabel(): string {
  try { return hostname(); } catch { return "this-machine"; }
}
