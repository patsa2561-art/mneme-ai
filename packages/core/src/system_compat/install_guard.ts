/**
 * v2.9.2 -- INSTALL GUARD.
 *
 *   Windows EBUSY on libvips-cpp-8.17.3.dll during `npm install -g mneme-ai`
 *   means an old Mneme daemon (or any node process from a prior session)
 *   is still holding the DLL even after `mneme daemon stop`. The CLI
 *   reports "Daemon: not running" because its heartbeat file is stale,
 *   but the OS still has the file handle open.
 *
 *   This module:
 *   1. Enumerates running node processes whose command line mentions
 *      "mneme" (cli, mcp server, daemon, sharp consumers).
 *   2. Sends a polite SIGTERM (Unix) / taskkill /PID (Windows).
 *      After 1.5s grace, escalates to SIGKILL / taskkill /F.
 *   3. Waits another 1s for Windows to release the DLL file lock.
 *
 *   Used by mneme.system.upgrade BEFORE `npm install -g mneme-ai@latest`
 *   so the EBUSY race window closes structurally.
 *
 *   Never throws — every step is best-effort. Returns a structured report
 *   the AI agent can render for the user.
 */

import { safeExecTry, safeExec } from "../util/safe_exec.js";

export interface OrphanProcess {
  pid: number;
  /** Best-effort command-line excerpt for the AI to surface to the user. */
  commandLine: string;
}

export interface InstallGuardReport {
  platform: NodeJS.Platform;
  /** Processes we identified as Mneme-related. */
  orphans: OrphanProcess[];
  /** Successful kills. */
  killed: number[];
  /** PIDs that resisted both SIGTERM + SIGKILL. */
  resisted: number[];
  /** Total wall-clock ms spent in the guard. */
  ms: number;
  /** True when ALL orphans were cleared OR there were none to begin with. */
  ok: boolean;
  /** User-readable summary. */
  summary: string;
}

const MNEME_PROC_FRAGMENTS = ["mneme", "mneme-ai", "mneme.cmd", "mneme.js"];

function looksLikeMnemeProcess(commandLine: string): boolean {
  const lc = commandLine.toLowerCase();
  // Match any fragment, but EXCLUDE the upgrade process itself (which is
  // the one calling this function — `node`/`npm` running `npm install`).
  if (!MNEME_PROC_FRAGMENTS.some((f) => lc.includes(f))) return false;
  if (lc.includes("npm install") || lc.includes("npm-cli.js install")) return false;
  return true;
}

function enumerateWindowsNodeProcesses(): OrphanProcess[] {
  // wmic is deprecated on Win11 but still ships; PowerShell Get-CimInstance
  // is the modern replacement. Try wmic first (faster), fall through to PS.
  const out: OrphanProcess[] = [];
  const r = safeExecTry("wmic", ["process", "where", "name='node.exe'", "get", "ProcessId,CommandLine", "/format:csv"], { timeoutMs: 5000 });
  if (r && r.status === 0 && r.stdout.includes("ProcessId")) {
    for (const line of r.stdout.split("\n")) {
      const parts = line.split(",");
      if (parts.length < 3) continue;
      const cmdLine = parts.slice(1, -1).join(",").trim();
      const pidStr = parts[parts.length - 1]!.trim();
      const pid = parseInt(pidStr, 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (looksLikeMnemeProcess(cmdLine)) out.push({ pid, commandLine: cmdLine.slice(0, 120) });
    }
    return out;
  }
  // PowerShell fallback
  const ps = safeExecTry("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { timeoutMs: 8000 });
  if (ps && ps.status === 0) {
    try {
      const parsed = JSON.parse(ps.stdout) as { ProcessId: number; CommandLine?: string } | Array<{ ProcessId: number; CommandLine?: string }>;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        const cmdLine = item.CommandLine ?? "";
        if (looksLikeMnemeProcess(cmdLine)) out.push({ pid: item.ProcessId, commandLine: cmdLine.slice(0, 120) });
      }
    } catch { /* BE:silent-by-design — fall through */ }
  }
  return out;
}

function enumerateUnixNodeProcesses(): OrphanProcess[] {
  const out: OrphanProcess[] = [];
  const r = safeExecTry("ps", ["-axww", "-o", "pid=,command="], { timeoutMs: 5000 });
  if (!r || r.status !== 0) return out;
  for (const line of r.stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = parseInt(m[1]!, 10);
    const cmdLine = m[2]!;
    if (!cmdLine.includes("node")) continue;
    if (looksLikeMnemeProcess(cmdLine)) out.push({ pid, commandLine: cmdLine.slice(0, 120) });
  }
  return out;
}

function killProcess(pid: number, platform: NodeJS.Platform, force: boolean): boolean {
  if (pid === process.pid) return true; // never kill ourselves
  if (platform === "win32") {
    const args = force ? ["/F", "/PID", String(pid)] : ["/PID", String(pid)];
    const r = safeExecTry("taskkill", args, { timeoutMs: 3000 });
    return r != null && r.status === 0;
  }
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch { return false; }
}

function processStillAlive(pid: number, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    const r = safeExecTry("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeoutMs: 3000 });
    if (!r) return false;
    return r.status === 0 && r.stdout.toLowerCase().includes(".exe");
  }
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kill orphan Mneme-related node processes BEFORE running npm install.
 *  Safe to call multiple times — idempotent. Never throws.
 *
 *  Returns a structured report the AI agent should surface to the user
 *  so they know what was killed and whether the upgrade can proceed. */
export async function clearInstallLocks(): Promise<InstallGuardReport> {
  const t0 = Date.now();
  const platform = process.platform;
  const orphans = platform === "win32"
    ? enumerateWindowsNodeProcesses()
    : enumerateUnixNodeProcesses();

  const killed: number[] = [];
  const resisted: number[] = [];

  if (orphans.length === 0) {
    return {
      platform, orphans, killed, resisted, ms: Date.now() - t0, ok: true,
      summary: "no Mneme-related orphan processes; install is safe",
    };
  }

  // Phase 1 — polite kill
  for (const o of orphans) killProcess(o.pid, platform, false);
  await sleep(1500);

  // Phase 2 — force kill survivors
  for (const o of orphans) {
    if (processStillAlive(o.pid, platform)) {
      killProcess(o.pid, platform, true);
    }
  }
  // Phase 3 — Windows DLL handle release grace
  if (platform === "win32") await sleep(1000);

  // Phase 4 — final tally
  for (const o of orphans) {
    if (processStillAlive(o.pid, platform)) resisted.push(o.pid);
    else killed.push(o.pid);
  }

  const ok = resisted.length === 0;
  const summary = ok
    ? `killed ${killed.length} Mneme-related node process(es); install lock cleared`
    : `killed ${killed.length}; ${resisted.length} process(es) resisted SIGKILL — user may need to close VS Code / terminal manually`;
  return { platform, orphans, killed, resisted, ms: Date.now() - t0, ok, summary };
}

/** Run install-locks clear + then the npm install command. Returns BOTH reports
 *  so the AI agent surfaces a complete diagnosis to the user if anything fails. */
export async function safeInstall(installCmd: string, installArgs: readonly string[], opts: { timeoutMs?: number } = {}): Promise<{
  guard: InstallGuardReport;
  install: { ok: boolean; status: number | null; stdout: string; stderr: string; ms: number };
}> {
  const guard = await clearInstallLocks();
  const t0 = Date.now();
  try {
    const r = safeExec(installCmd, installArgs, { timeoutMs: opts.timeoutMs ?? 5 * 60_000 });
    return {
      guard,
      install: { ok: r.status === 0, status: r.status, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000), ms: Date.now() - t0 },
    };
  } catch (e) {
    return {
      guard,
      install: { ok: false, status: null, stdout: "", stderr: (e as Error).message.slice(0, 400), ms: Date.now() - t0 },
    };
  }
}

/** Pulse-line summary for the AI agent's wisdom field. */
export function formatInstallGuardPulseLine(r: InstallGuardReport): string {
  return `INSTALL-GUARD · ${r.ok ? "OK" : "RESIST"} · orphans=${r.orphans.length} killed=${r.killed.length} resisted=${r.resisted.length} · ${r.ms}ms`;
}
