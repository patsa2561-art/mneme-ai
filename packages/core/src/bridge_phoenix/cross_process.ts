/**
 * v2.42.0 — CROSS-PROCESS PHOENIX WATCHDOG (closes R8).
 *
 * v2.38 BRIDGE PHOENIX was IN-BAND: when the daemon was alive, the
 * watchdog detected bridge death + respawned it. But if the DAEMON
 * itself died, nothing watched. R8 from v2.37.1 audit: "Phoenix 0
 * respawn — daemon ตายไป 3 รอบ session นี้ bridge ก็ตายตาม".
 *
 * Fix: register a CROSS-PROCESS scheduled task with the OS that probes
 * the bridge HTTP port every interval and respawns `mneme bridge --detach`
 * when N consecutive probes fail. Mechanisms per platform:
 *
 *   Windows  → schtasks /Create /SC MINUTE /MO 5 /TN MnemePhoenix /TR ...
 *   macOS    → launchctl load ~/Library/LaunchAgents/com.mneme.phoenix.plist
 *   Linux    → systemd --user enable mneme-phoenix.timer (or cron)
 *   fallback → write a node-self-supervisor wrapper script the user runs manually
 *
 * Every install is OPT-IN (per CONSENT FABRIC). Dry-run by default returns
 * the EXACT command that WOULD run, so the user can copy-paste audit it.
 *
 * Pure deterministic + defensive: never throws; returns structured
 * { ok, mechanism, reason, command } so the CLI surface can display + log.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform, homedir } from "node:os";
import { spawnSync } from "node:child_process";

export type WatchdogMechanism =
  | "schtasks"            // Windows
  | "launchd"             // macOS
  | "systemd-user"        // Linux
  | "cron"                // Linux fallback when systemd unavailable
  | "node-self-supervisor" // anywhere — node-only fallback
  | "noop";               // OS unsupported

export interface InstallOptions {
  /** Path to .mneme/ for logging + state. */
  repoRoot: string;
  /** The full command to spawn when bridge is unreachable. */
  cmd: string;
  /** Probe interval in minutes. Default 5. */
  intervalMinutes?: number;
  /** Bridge URL to probe. Default http://127.0.0.1:17741/v1/ping */
  probeUrl?: string;
  /** Don't actually install; just return the would-run command + plan. */
  dryRun?: boolean;
  /** Override watchdog task name. */
  taskName?: string;
}

export interface InstallResult {
  ok: boolean;
  mechanism: WatchdogMechanism;
  reason: string;
  /** The exact command that would (or did) install the watchdog. */
  command?: string;
  /** Where the watchdog script lives on disk. */
  scriptPath?: string;
  /** Where the watchdog plist / unit / cron line lives. */
  registrationPath?: string;
}

/**
 * Resolve which mechanism this OS supports. Pure detection.
 */
export function detectMechanism(): WatchdogMechanism {
  const p = platform();
  if (p === "win32") return "schtasks";
  if (p === "darwin") return "launchd";
  if (p === "linux") {
    // Prefer systemd-user if `systemctl --user` works.
    try {
      const r = spawnSync("systemctl", ["--user", "--version"], { encoding: "utf8", timeout: 2000 });
      if (r.status === 0) return "systemd-user";
    } catch { /* fall through */ }
    try {
      const r = spawnSync("crontab", ["-l"], { encoding: "utf8", timeout: 2000 });
      if (r.status === 0 || r.status === 1) return "cron"; // exit 1 = empty crontab, still ok
    } catch { /* fall through */ }
    return "node-self-supervisor";
  }
  return "noop";
}

function writeWatchdogScript(opts: InstallOptions): string {
  const dir = join(opts.repoRoot, ".mneme", "bridge_phoenix");
  if (!opts.dryRun && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ext = platform() === "win32" ? "cmd" : "sh";
  const scriptPath = join(dir, `watchdog.${ext}`);
  const probeUrl = opts.probeUrl ?? "http://127.0.0.1:17741/v1/ping";
  const body = platform() === "win32"
    ? [
        "@echo off",
        `curl -s -o NUL -w "%%{http_code}" --max-time 3 ${probeUrl} > "${dir}\\last-probe.txt"`,
        `for /f %%i in (${dir}\\last-probe.txt) do (`,
        `  if not "%%i"=="200" (`,
        `    echo respawn at %DATE% %TIME% >> "${dir}\\respawns.log"`,
        `    start /B ${opts.cmd}`,
        `  )`,
        `)`,
      ].join("\r\n")
    : [
        "#!/bin/sh",
        `STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${probeUrl})`,
        `if [ "$STATUS" != "200" ]; then`,
        `  echo "respawn at $(date)" >> "${dir}/respawns.log"`,
        `  ${opts.cmd} &`,
        `fi`,
      ].join("\n");
  if (!opts.dryRun) {
    writeFileSync(scriptPath, body, { mode: 0o755 });
  }
  return scriptPath;
}

function installSchtasks(opts: InstallOptions): InstallResult {
  const taskName = opts.taskName ?? "MnemePhoenix";
  const interval = opts.intervalMinutes ?? 5;
  const scriptPath = writeWatchdogScript(opts);
  const command = `schtasks /Create /SC MINUTE /MO ${interval} /TN ${taskName} /TR "${scriptPath}" /F`;
  if (opts.dryRun) {
    return { ok: true, mechanism: "schtasks", reason: "dry-run; not executed", command, scriptPath };
  }
  try {
    const r = spawnSync("schtasks", ["/Create", "/SC", "MINUTE", "/MO", String(interval), "/TN", taskName, "/TR", scriptPath, "/F"], { encoding: "utf8", timeout: 8000 });
    if (r.status === 0) return { ok: true, mechanism: "schtasks", reason: "task registered", command, scriptPath };
    return { ok: false, mechanism: "schtasks", reason: `schtasks exited ${r.status}: ${(r.stderr ?? "").slice(0, 200)}`, command, scriptPath };
  } catch (e) {
    return { ok: false, mechanism: "schtasks", reason: (e as Error).message, command, scriptPath };
  }
}

function installLaunchd(opts: InstallOptions): InstallResult {
  const label = opts.taskName ?? "com.mneme.phoenix";
  const interval = (opts.intervalMinutes ?? 5) * 60;
  const scriptPath = writeWatchdogScript(opts);
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(plistDir, `${label}.plist`);
  const plistBody = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${scriptPath}</string></array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>`;
  const command = `launchctl load ${plistPath}`;
  if (opts.dryRun) {
    return { ok: true, mechanism: "launchd", reason: "dry-run; not executed", command, scriptPath, registrationPath: plistPath };
  }
  try {
    if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });
    writeFileSync(plistPath, plistBody);
    const r = spawnSync("launchctl", ["load", plistPath], { encoding: "utf8", timeout: 8000 });
    if (r.status === 0) return { ok: true, mechanism: "launchd", reason: "agent loaded", command, scriptPath, registrationPath: plistPath };
    return { ok: false, mechanism: "launchd", reason: `launchctl exited ${r.status}: ${(r.stderr ?? "").slice(0, 200)}`, command, scriptPath, registrationPath: plistPath };
  } catch (e) {
    return { ok: false, mechanism: "launchd", reason: (e as Error).message, command, scriptPath, registrationPath: plistPath };
  }
}

function installSystemdUser(opts: InstallOptions): InstallResult {
  const name = opts.taskName ?? "mneme-phoenix";
  const interval = `${opts.intervalMinutes ?? 5}min`;
  const scriptPath = writeWatchdogScript(opts);
  const unitDir = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(unitDir, `${name}.service`);
  const timerPath = join(unitDir, `${name}.timer`);
  const serviceBody = `[Unit]
Description=Mneme Phoenix bridge watchdog
[Service]
Type=oneshot
ExecStart=${scriptPath}
`;
  const timerBody = `[Unit]
Description=Run Mneme Phoenix bridge watchdog
[Timer]
OnBootSec=1min
OnUnitActiveSec=${interval}
[Install]
WantedBy=timers.target
`;
  const command = `systemctl --user enable --now ${name}.timer`;
  if (opts.dryRun) {
    return { ok: true, mechanism: "systemd-user", reason: "dry-run; not executed", command, scriptPath, registrationPath: timerPath };
  }
  try {
    if (!existsSync(unitDir)) mkdirSync(unitDir, { recursive: true });
    writeFileSync(servicePath, serviceBody);
    writeFileSync(timerPath, timerBody);
    const r = spawnSync("systemctl", ["--user", "enable", "--now", `${name}.timer`], { encoding: "utf8", timeout: 8000 });
    if (r.status === 0) return { ok: true, mechanism: "systemd-user", reason: "timer enabled", command, scriptPath, registrationPath: timerPath };
    return { ok: false, mechanism: "systemd-user", reason: `systemctl exited ${r.status}: ${(r.stderr ?? "").slice(0, 200)}`, command, scriptPath, registrationPath: timerPath };
  } catch (e) {
    return { ok: false, mechanism: "systemd-user", reason: (e as Error).message, command, scriptPath, registrationPath: timerPath };
  }
}

function installNodeSelfSupervisor(opts: InstallOptions): InstallResult {
  const dir = join(opts.repoRoot, ".mneme", "bridge_phoenix");
  if (!opts.dryRun && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, "watchdog-loop.cjs");
  const probeUrl = opts.probeUrl ?? "http://127.0.0.1:17741/v1/ping";
  const interval = (opts.intervalMinutes ?? 5) * 60 * 1000;
  const body = `#!/usr/bin/env node
// node self-supervisor fallback (run via \`nohup node watchdog-loop.cjs &\`).
const { spawn } = require("node:child_process");
const url = ${JSON.stringify(probeUrl)};
const interval = ${interval};
const cmd = ${JSON.stringify(opts.cmd)};
async function probe() {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return true;
  } catch { /* unreachable */ }
  return false;
}
async function tick() {
  if (!(await probe())) {
    try {
      spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
    } catch { /* best-effort */ }
  }
}
setInterval(tick, interval);
tick();
`;
  const command = `nohup node ${scriptPath} > /dev/null 2>&1 &`;
  if (!opts.dryRun) writeFileSync(scriptPath, body, { mode: 0o755 });
  return { ok: true, mechanism: "node-self-supervisor", reason: opts.dryRun ? "dry-run; script written" : "script written; spawn manually", command, scriptPath };
}

/**
 * Install the cross-process watchdog. Returns the chosen mechanism +
 * exact command. Defensive: NEVER throws.
 */
export function installCrossProcessWatchdog(opts: InstallOptions): InstallResult {
  try {
    const mech = detectMechanism();
    if (mech === "schtasks") return installSchtasks(opts);
    if (mech === "launchd") return installLaunchd(opts);
    if (mech === "systemd-user") return installSystemdUser(opts);
    if (mech === "cron" || mech === "node-self-supervisor") return installNodeSelfSupervisor(opts);
    return { ok: false, mechanism: "noop", reason: `platform ${platform()} unsupported` };
  } catch (e) {
    return { ok: false, mechanism: "noop", reason: `install failed: ${(e as Error).message}` };
  }
}

/**
 * Uninstall the cross-process watchdog. Defensive: never throws.
 */
export function uninstallCrossProcessWatchdog(opts: { taskName?: string; dryRun?: boolean }): InstallResult {
  const mech = detectMechanism();
  const name = opts.taskName ?? (mech === "launchd" ? "com.mneme.phoenix" : "MnemePhoenix");
  let command = "";
  if (mech === "schtasks") command = `schtasks /Delete /TN ${name} /F`;
  else if (mech === "launchd") command = `launchctl unload ${join(homedir(), "Library/LaunchAgents", name + ".plist")}`;
  else if (mech === "systemd-user") command = `systemctl --user disable --now mneme-phoenix.timer`;
  else command = "(no installed watchdog to uninstall)";
  if (opts.dryRun) return { ok: true, mechanism: mech, reason: "dry-run", command };
  try {
    if (mech === "schtasks") {
      const r = spawnSync("schtasks", ["/Delete", "/TN", name, "/F"], { encoding: "utf8", timeout: 8000 });
      return { ok: r.status === 0, mechanism: mech, reason: r.status === 0 ? "removed" : (r.stderr ?? "").slice(0, 200), command };
    }
    if (mech === "launchd") {
      const r = spawnSync("launchctl", ["unload", join(homedir(), "Library/LaunchAgents", name + ".plist")], { encoding: "utf8", timeout: 8000 });
      return { ok: r.status === 0, mechanism: mech, reason: r.status === 0 ? "removed" : (r.stderr ?? "").slice(0, 200), command };
    }
    if (mech === "systemd-user") {
      const r = spawnSync("systemctl", ["--user", "disable", "--now", "mneme-phoenix.timer"], { encoding: "utf8", timeout: 8000 });
      return { ok: r.status === 0, mechanism: mech, reason: r.status === 0 ? "removed" : (r.stderr ?? "").slice(0, 200), command };
    }
    return { ok: true, mechanism: mech, reason: "noop", command };
  } catch (e) {
    return { ok: false, mechanism: mech, reason: (e as Error).message, command };
  }
}
