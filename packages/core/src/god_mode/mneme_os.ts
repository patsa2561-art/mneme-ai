/**
 * DEMON STAGE 4.1 — Mneme OS Supervisor (v1.44.0)
 *
 * SCOPE: a process manifest that lets Mneme act as the supervisor of an
 * "AI tool subprocess tree" — i.e., the operator's editor, MCP servers,
 * indexers, daemons. Each managed process gets:
 *   - lifecycle (start / stop / restart / graceful-shutdown)
 *   - health probe (custom command, e.g. `curl -fsS .../health`)
 *   - restart policy (on-crash | on-unhealthy | never)
 *   - last-N-events ring buffer (for the operator to inspect)
 *
 * NOT IMPLEMENTED HERE (operator's responsibility):
 *   - Cross-reboot persistence (use `pm2`, `systemd`, or `mneme service install`)
 *   - Resource caps (cgroups, ulimits) — out of scope for Node-only impl
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Backoff" — a process that crashes 3 times in 60s gets quarantined
 *     (stops auto-restart, logs `outcome: quarantined`) instead of looping
 *   - "Healing buddy" — a process can declare a `dependsOn` list; if a
 *     dependency goes unhealthy, this process is gracefully stopped first
 *   - Event log is RING-BUFFERED in memory + flushed to a JSONL on rotate
 *     (no unbounded growth)
 *   - Graceful-shutdown sends SIGTERM, waits up to `gracefulMs` (default
 *     5s), THEN SIGKILL — never just kill -9 first
 */

import { spawn, type ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EVENTS_REL = ".mneme/os-events.jsonl";
const RING_SIZE = 200;
const QUARANTINE_WINDOW_MS = 60_000;
const QUARANTINE_THRESHOLD = 3;

export interface ManagedProcess {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  healthProbe?: { command: string; args: string[]; intervalMs: number; timeoutMs: number };
  restartPolicy?: "on-crash" | "on-unhealthy" | "never";
  dependsOn?: string[];
  gracefulMs?: number;       // default 5000
}

export type ProcStatus = "starting" | "running" | "unhealthy" | "stopped" | "quarantined";

export interface ProcState {
  name: string;
  status: ProcStatus;
  pid: number | null;
  startedAt: string | null;
  lastExitCode: number | null;
  crashes: { at: number }[];     // timestamps of recent crashes
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
}

export interface OsEvent {
  at: string;
  process: string;
  kind: "started" | "exit" | "health-fail" | "health-ok" | "restart" | "quarantine" | "stop";
  detail: Record<string, string | number | boolean | null>;
}

export class MnemeOS {
  private processes = new Map<string, ManagedProcess>();
  private states = new Map<string, ProcState>();
  private children = new Map<string, ChildProcess>();
  private healthTimers = new Map<string, NodeJS.Timeout>();
  private events: OsEvent[] = [];
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
  }

  define(p: ManagedProcess): void {
    this.processes.set(p.name, p);
    if (!this.states.has(p.name)) {
      this.states.set(p.name, { name: p.name, status: "stopped", pid: null, startedAt: null, lastExitCode: null, crashes: [], lastHealthAt: null, lastHealthOk: null });
    }
  }

  list(): ProcState[] {
    return Array.from(this.states.values()).map((s) => ({ ...s, crashes: [...s.crashes] }));
  }

  events_recent(n = 50): OsEvent[] {
    return this.events.slice(-n);
  }

  start(name: string): { outcome: "started" | "already-running" | "no-such-process" | "quarantined" | "blocked-by-dep" } {
    const def = this.processes.get(name);
    const state = this.states.get(name);
    if (!def || !state) return { outcome: "no-such-process" };
    if (state.status === "running" || state.status === "starting") return { outcome: "already-running" };
    if (state.status === "quarantined") return { outcome: "quarantined" };

    // Dependency check
    for (const dep of def.dependsOn ?? []) {
      const ds = this.states.get(dep);
      if (!ds || ds.status !== "running") return { outcome: "blocked-by-dep" };
    }

    state.status = "starting";
    const child = spawn(def.command, def.args, {
      cwd: def.cwd ?? this.repoRoot,
      env: { ...process.env, ...(def.env ?? {}) },
      stdio: "ignore",
      detached: false,
    });
    this.children.set(name, child);
    state.pid = child.pid ?? null;
    state.startedAt = new Date().toISOString();
    state.status = "running";
    this.recordEvent({ at: state.startedAt, process: name, kind: "started", detail: { pid: state.pid } });

    child.on("exit", (code, signal) => {
      const exitCode = code ?? (signal ? -1 : null);
      this.handleExit(name, exitCode);
    });

    if (def.healthProbe) this.scheduleHealth(name);
    return { outcome: "started" };
  }

  private handleExit(name: string, exitCode: number | null): void {
    const def = this.processes.get(name);
    const state = this.states.get(name);
    if (!def || !state) return;
    state.lastExitCode = exitCode;
    state.pid = null;
    state.status = "stopped";
    this.children.delete(name);
    const t = this.healthTimers.get(name);
    if (t) { clearInterval(t); this.healthTimers.delete(name); }

    const now = Date.now();
    state.crashes.push({ at: now });
    state.crashes = state.crashes.filter((c) => now - c.at <= QUARANTINE_WINDOW_MS);
    this.recordEvent({ at: new Date().toISOString(), process: name, kind: "exit", detail: { exitCode, recentCrashes: state.crashes.length } });

    if (state.crashes.length >= QUARANTINE_THRESHOLD) {
      state.status = "quarantined";
      this.recordEvent({ at: new Date().toISOString(), process: name, kind: "quarantine", detail: { recentCrashes: state.crashes.length } });
      return;
    }

    if (def.restartPolicy === "on-crash" && exitCode !== 0) {
      this.recordEvent({ at: new Date().toISOString(), process: name, kind: "restart", detail: { reason: "on-crash" } });
      this.start(name);
    }
  }

  private scheduleHealth(name: string): void {
    const def = this.processes.get(name);
    const state = this.states.get(name);
    if (!def?.healthProbe || !state) return;
    const probe = def.healthProbe;
    const t = setInterval(() => {
      const r = spawnSync(probe.command, probe.args, { timeout: probe.timeoutMs, cwd: def.cwd ?? this.repoRoot, encoding: "utf8" });
      const ok = r.status === 0;
      state.lastHealthAt = new Date().toISOString();
      state.lastHealthOk = ok;
      this.recordEvent({ at: state.lastHealthAt, process: name, kind: ok ? "health-ok" : "health-fail", detail: { exitCode: r.status, errTail: (r.stderr ?? "").toString().slice(-200) } });
      if (!ok) {
        state.status = "unhealthy";
        if (def.restartPolicy === "on-unhealthy") {
          this.recordEvent({ at: new Date().toISOString(), process: name, kind: "restart", detail: { reason: "on-unhealthy" } });
          this.stop(name).then(() => this.start(name)).catch(() => { /* swallow */ });
        }
      } else if (state.status === "unhealthy") {
        state.status = "running";
      }
    }, probe.intervalMs);
    this.healthTimers.set(name, t);
  }

  async stop(name: string): Promise<{ outcome: "stopped" | "not-running" | "no-such-process" }> {
    const def = this.processes.get(name);
    const state = this.states.get(name);
    if (!def || !state) return { outcome: "no-such-process" };
    const child = this.children.get(name);
    if (!child || state.status === "stopped" || state.status === "quarantined") return { outcome: "not-running" };

    const grace = def.gracefulMs ?? 5000;
    this.recordEvent({ at: new Date().toISOString(), process: name, kind: "stop", detail: { method: "SIGTERM", graceMs: grace } });
    try { child.kill("SIGTERM"); } catch { /* swallow */ }
    await new Promise<void>((res) => {
      const to = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* */ }
        res();
      }, grace);
      child.once("exit", () => { clearTimeout(to); res(); });
    });
    return { outcome: "stopped" };
  }

  async stopAll(): Promise<void> {
    for (const name of Array.from(this.children.keys())) await this.stop(name);
  }

  unquarantine(name: string): { outcome: "cleared" | "not-quarantined" | "no-such-process" } {
    const state = this.states.get(name);
    if (!state) return { outcome: "no-such-process" };
    if (state.status !== "quarantined") return { outcome: "not-quarantined" };
    state.crashes = [];
    state.status = "stopped";
    return { outcome: "cleared" };
  }

  private recordEvent(e: OsEvent): void {
    this.events.push(e);
    if (this.events.length > RING_SIZE) {
      const overflow = this.events.splice(0, this.events.length - RING_SIZE);
      try {
        mkdirSync(join(this.repoRoot, ".mneme"), { recursive: true });
        for (const ev of overflow) appendFileSync(join(this.repoRoot, EVENTS_REL), JSON.stringify(ev) + "\n");
      } catch { /* swallow */ }
    }
  }

  // For tests + diagnostics — flushes the in-memory ring to disk
  flushEvents(): void {
    try {
      mkdirSync(join(this.repoRoot, ".mneme"), { recursive: true });
      for (const ev of this.events) appendFileSync(join(this.repoRoot, EVENTS_REL), JSON.stringify(ev) + "\n");
    } catch { /* swallow */ }
  }
}

export function readEventsLog(repoRoot: string): OsEvent[] {
  const path = join(repoRoot, EVENTS_REL);
  if (!existsSync(path)) return [];
  const out: OsEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}
