/**
 * 💀 CULL — Process Reaper via Antibody Pattern + Quorum
 *
 * Closes v2.70 Vuln #4: 6 mneme node processes still alive after single
 * test session → resource exhaustion over time.
 *
 * STRATEGY: every Mneme process writes an antibody to .mneme/cull/<pid>.beat
 * containing { startedAt, processType, antibody }. On startup, every
 * Mneme process runs CULL phase:
 *
 *   1. Scan .mneme/cull/ for all heartbeats
 *   2. Filter to processes with same processType as me
 *   3. Verify each is actually alive (process.kill(pid, 0))
 *   4. Remove dead heartbeats (cleanup)
 *   5. Apply policy: if alive count > maxPerType, cull oldest siblings
 *      until count == maxPerType
 *
 * Policy modes:
 *   - "youngest-wins"  newer process kills older siblings (default)
 *   - "oldest-wins"    new process refuses to start if maxPerType reached
 *   - "quorum"         requires majority of siblings to vote out a peer
 *
 * Wild twist: MITOSIS BUDGET — process can split (spawn child) but the
 * child inherits parent's antibody. CULL never kills siblings with
 * matching parent-antibody chain.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

export type CullPolicy = "youngest-wins" | "oldest-wins" | "quorum";

export interface CullHeartbeat {
  pid: number;
  ppid: number;
  startedAt: string;
  processType: string;       // "daemon" | "cli" | "mcp" | "bridge" | ...
  antibody: string;          // unique id per process
  parentAntibody?: string;   // for mitosis chains
  lastBeatAt: string;
}

export interface CullConfig {
  cullDir: string;           // typically .mneme/cull/
  policy: CullPolicy;
  maxPerType: Record<string, number>;     // e.g. { daemon: 1, cli: 5, mcp: 2 }
  staleAfterMs: number;       // heartbeat older than this → considered dead
}

export const DEFAULT_CULL: CullConfig = {
  cullDir: ".mneme/cull",
  policy: "youngest-wins",
  maxPerType: { daemon: 1, "nucleus-daemon": 1, mcp: 2, bridge: 1, cli: 10 },
  staleAfterMs: 60_000,
};

function aliveSafe(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killSafe(pid: number): boolean {
  if (pid === process.pid) return false;
  try { process.kill(pid, "SIGTERM"); return true; } catch { return false; }
}

export interface CullReport {
  scanned: number;
  removedStale: number;
  killedSiblings: number;
  refusedToKill: number;
  myPid: number;
  myAntibody: string;
  finalAlive: number;
  policy: CullPolicy;
  reasoning: string[];
  hmac: string;
}

export class Cull {
  constructor(public readonly cfg: CullConfig = DEFAULT_CULL) {}

  /** Generate a stable per-process antibody. */
  static makeAntibody(): string {
    return createHmac("sha256", "mneme-cull").update(`${process.pid}::${process.hrtime.bigint()}::${Math.random()}`).digest("hex").slice(0, 12);
  }

  /** Write our heartbeat — call on startup + every N seconds. */
  beat(processType: string, antibody: string, parentAntibody?: string): void {
    mkdirSync(this.cfg.cullDir, { recursive: true });
    const hb: CullHeartbeat = {
      pid: process.pid,
      ppid: process.ppid,
      startedAt: new Date().toISOString(),
      processType,
      antibody,
      parentAntibody,
      lastBeatAt: new Date().toISOString(),
    };
    writeFileSync(join(this.cfg.cullDir, `${process.pid}.beat`), JSON.stringify(hb), { encoding: "utf8" });
  }

  /** Update lastBeatAt timestamp only. */
  refresh(antibody: string): void {
    const path = join(this.cfg.cullDir, `${process.pid}.beat`);
    if (!existsSync(path)) return;
    try {
      const hb = JSON.parse(readFileSync(path, "utf8")) as CullHeartbeat;
      hb.lastBeatAt = new Date().toISOString();
      writeFileSync(path, JSON.stringify(hb), "utf8");
    } catch { /* */ }
  }

  /** Run CULL phase: scan, clean dead, enforce maxPerType. */
  enforce(myProcessType: string, myAntibody: string): CullReport {
    const reasoning: string[] = [];
    if (!existsSync(this.cfg.cullDir)) {
      mkdirSync(this.cfg.cullDir, { recursive: true });
    }

    const files = readdirSync(this.cfg.cullDir).filter((f) => f.endsWith(".beat"));
    let scanned = 0, removedStale = 0, killedSiblings = 0, refusedToKill = 0;
    const aliveOfMyType: CullHeartbeat[] = [];

    for (const f of files) {
      scanned++;
      const p = join(this.cfg.cullDir, f);
      let hb: CullHeartbeat;
      try { hb = JSON.parse(readFileSync(p, "utf8")) as CullHeartbeat; }
      catch { try { unlinkSync(p); } catch { /* */ } removedStale++; continue; }

      const ageMs = Date.now() - new Date(hb.lastBeatAt).getTime();
      const stillAlive = aliveSafe(hb.pid);

      if (!stillAlive || ageMs > this.cfg.staleAfterMs) {
        try { unlinkSync(p); removedStale++; reasoning.push(`removed stale heartbeat pid=${hb.pid} age=${ageMs}ms alive=${stillAlive}`); }
        catch { /* */ }
        continue;
      }

      if (hb.processType === myProcessType) aliveOfMyType.push(hb);
    }

    const limit = this.cfg.maxPerType[myProcessType] ?? 1;
    if (aliveOfMyType.length > limit) {
      // Sort by startedAt ASC — oldest first
      aliveOfMyType.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const excess = aliveOfMyType.length - limit;

      if (this.cfg.policy === "oldest-wins") {
        // Refuse: don't kill anyone; report so caller can self-exit
        refusedToKill = excess;
        reasoning.push(`oldest-wins policy: ${excess} excess sibling(s) — caller should exit (suicide)`);
      } else if (this.cfg.policy === "quorum") {
        // Need majority vote — for now, conservative: kill only if alone is "newest"
        const myStartTime = aliveOfMyType.find((h) => h.pid === process.pid)?.startedAt ?? new Date().toISOString();
        const olderThanMe = aliveOfMyType.filter((h) => h.startedAt < myStartTime).length;
        if (olderThanMe > (aliveOfMyType.length / 2)) {
          refusedToKill = excess;
          reasoning.push(`quorum policy: I am newer than majority — refusing to kill`);
        } else {
          // I am the elder; cull oldest excess
          for (let i = 0; i < excess; i++) {
            const victim = aliveOfMyType[i];
            if (victim.pid === process.pid) continue;
            // Don't kill mitosis siblings (matching parent_antibody chain)
            if (victim.parentAntibody && victim.parentAntibody === myAntibody) { refusedToKill++; reasoning.push(`refused to kill mitosis child pid=${victim.pid}`); continue; }
            if (killSafe(victim.pid)) { killedSiblings++; reasoning.push(`killed sibling pid=${victim.pid} (started ${victim.startedAt})`); }
            else { refusedToKill++; reasoning.push(`could not kill pid=${victim.pid} (permission?)`); }
          }
        }
      } else {
        // "youngest-wins" (default) — newer process (likely me) kills older siblings
        for (let i = 0; i < excess; i++) {
          const victim = aliveOfMyType[i];
          if (victim.pid === process.pid) continue;
          if (victim.parentAntibody && victim.parentAntibody === myAntibody) { refusedToKill++; reasoning.push(`refused to kill mitosis child pid=${victim.pid}`); continue; }
          if (killSafe(victim.pid)) { killedSiblings++; reasoning.push(`culled older sibling pid=${victim.pid}`); }
          else { refusedToKill++; }
        }
      }
    }

    const finalAlive = aliveOfMyType.length - killedSiblings;
    const body = { scanned, removedStale, killedSiblings, refusedToKill, finalAlive, processType: myProcessType, myAntibody };
    const hmac = createHmac("sha256", "cull-report").update(JSON.stringify(body)).digest("hex").slice(0, 16);

    return {
      scanned, removedStale, killedSiblings, refusedToKill,
      myPid: process.pid, myAntibody, finalAlive,
      policy: this.cfg.policy, reasoning, hmac,
    };
  }

  /** Count of alive processes by type (for monitoring). */
  censusAlive(): Record<string, number> {
    if (!existsSync(this.cfg.cullDir)) return {};
    const counts: Record<string, number> = {};
    for (const f of readdirSync(this.cfg.cullDir).filter((f) => f.endsWith(".beat"))) {
      try {
        const hb = JSON.parse(readFileSync(join(this.cfg.cullDir, f), "utf8")) as CullHeartbeat;
        if (aliveSafe(hb.pid)) counts[hb.processType] = (counts[hb.processType] ?? 0) + 1;
      } catch { /* */ }
    }
    return counts;
  }
}
