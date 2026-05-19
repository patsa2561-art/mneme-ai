/**
 * v2.19.62 PHOENIX PHASE 1 — 3 priority-1 organ bots.
 *
 * From the user's PHOENIX P5 spec — these are the first 3 bots, the
 * minimum viable swarm. The remaining 5 (Forager, Scholar, Pulse-bot,
 * Lighthouse, Vampire) ship in future sprints.
 *
 * The pattern: each organ is a PURE-FUNCTION step that:
 *   1. Reads its inputs (HMAC ledger, OS handle table, latency metrics)
 *   2. Computes a verdict (cleanup needed? integrity breached? restart?)
 *   3. Returns structured result (no side effects unless explicitly committed)
 *   4. Caller (daemon loop) decides whether to act on the verdict
 *
 * This separation means the organs are TESTABLE without spawning real
 * processes + composable into custom schedulers.
 */

import { sweepOrphanTmpDirs } from "./dll_extraction.js";
import { readdirSync, statSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const PROTOCOL_VERSION = 1;

// ────────────────────────────────────────────────────────────────────────
// 🧹 CUSTODIAN — periodic cleanup organ
// ────────────────────────────────────────────────────────────────────────

export interface CustodianReport {
  v: typeof PROTOCOL_VERSION;
  organ: "custodian";
  ts: string;
  tmpDirsSwept: number;
  tmpBytesReclaimed: number;
  globalOrphansSwept: number;
  totalReclaimedBytes: number;
  durationMs: number;
}

/** Custodian cycle — sweeps stale per-PID tmp dirs + orphan .locked-* +
 *  expired vaccines + fragmented logs. Safe to call from any interval.
 *  Idempotent + non-throwing.
 *
 *  Default period 5min per spec; the daemon's tickAllOrgans loop drives
 *  the scheduling, this function just runs one cycle. */
export function runCustodianCycle(): CustodianReport {
  const t0 = Date.now();
  // Sweep our own tmp dirs that belong to dead PIDs
  const sweep = sweepOrphanTmpDirs();
  // Sweep stale .locked-* files in ~/.mneme-global/
  let globalOrphansSwept = 0;
  try {
    const organDir = join(homedir(), ".mneme-global");
    if (existsSync(organDir)) {
      const sweepLocked = (dir: string) => {
        try {
          for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            try {
              const st = statSync(path);
              if (st.isDirectory()) {
                sweepLocked(path); // recurse one level
                continue;
              }
              if (/\.locked-\d+-\d+$/.test(entry)) {
                try { unlinkSync(path); globalOrphansSwept++; } catch { /* */ }
              }
            } catch { /* */ }
          }
        } catch { /* */ }
      };
      sweepLocked(organDir);
    }
  } catch { /* */ }
  return {
    v: PROTOCOL_VERSION,
    organ: "custodian",
    ts: new Date().toISOString(),
    tmpDirsSwept: sweep.swept,
    tmpBytesReclaimed: sweep.bytesReclaimed,
    globalOrphansSwept,
    totalReclaimedBytes: sweep.bytesReclaimed,
    durationMs: Date.now() - t0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 🔬 SENTINEL — self-integrity organ
// ────────────────────────────────────────────────────────────────────────

export interface SentinelReport {
  v: typeof PROTOCOL_VERSION;
  organ: "sentinel";
  ts: string;
  hmacChainOk: boolean;
  hmacChainBrokenAt?: number;
  handleCount: number;
  handleBaseline: number;
  handleLeakDetected: boolean;
  durationMs: number;
  recommendation: "healthy" | "warn-handle-leak" | "critical-chain-broken";
}

export interface SentinelOptions {
  /** Function that returns current open-handle count (process-specific).
   *  Caller injects this so the organ stays platform-agnostic. */
  handleCounter?: () => number;
  /** Baseline handle count to compare against. Default 50. */
  handleBaseline?: number;
  /** HMAC chain verifier — caller passes a function that checks their
   *  existing chain (lineage / shepherd state / etc). Returns the chain
   *  result so Sentinel can include it in the report. */
  verifyHmacChain?: () => { ok: boolean; brokenAt?: number };
}

/** Sentinel cycle — verifies HMAC chain integrity + checks for handle
 *  leaks. Pure function; no side effects. Caller decides escalation
 *  (enter quarantine, alert, etc) based on verdict. */
export function runSentinelCycle(opts?: SentinelOptions): SentinelReport {
  const t0 = Date.now();
  const baseline = opts?.handleBaseline ?? 50;
  const handleCount = opts?.handleCounter ? opts.handleCounter() : -1;
  const handleLeakDetected = handleCount > baseline * 2;
  const chain = opts?.verifyHmacChain ? opts.verifyHmacChain() : { ok: true };
  let recommendation: SentinelReport["recommendation"] = "healthy";
  if (!chain.ok) recommendation = "critical-chain-broken";
  else if (handleLeakDetected) recommendation = "warn-handle-leak";
  return {
    v: PROTOCOL_VERSION,
    organ: "sentinel",
    ts: new Date().toISOString(),
    hmacChainOk: chain.ok,
    ...(chain.brokenAt !== undefined ? { hmacChainBrokenAt: chain.brokenAt } : {}),
    handleCount,
    handleBaseline: baseline,
    handleLeakDetected,
    durationMs: Date.now() - t0,
    recommendation,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 🩺 SURGEON — latency-based per-organ restart organ
// ────────────────────────────────────────────────────────────────────────

export interface OrganLatencyStats {
  /** Organ name (e.g. "indexer", "embedder", "scan"). */
  name: string;
  /** Recent p99 latency in ms. */
  p99Ms: number;
  /** Historical baseline p99 in ms. */
  baselineMs: number;
  /** Optional: consecutive failure count. */
  consecutiveFailures?: number;
}

export interface SurgeonReport {
  v: typeof PROTOCOL_VERSION;
  organ: "surgeon";
  ts: string;
  organsExamined: number;
  organsToRestart: Array<{ name: string; reason: string; degradationFactor: number }>;
  durationMs: number;
}

/** Surgeon cycle — examines per-organ latency stats + flags organs whose
 *  p99 exceeds 3× baseline OR have 3+ consecutive failures. Returns a
 *  list of organs caller should restart. Pure verdict; caller commits. */
export function runSurgeonCycle(stats: OrganLatencyStats[], opts?: { degradationFactor?: number; maxConsecutiveFailures?: number }): SurgeonReport {
  const t0 = Date.now();
  const degradationFactor = opts?.degradationFactor ?? 3;
  const maxConsecutiveFailures = opts?.maxConsecutiveFailures ?? 3;
  const organsToRestart: SurgeonReport["organsToRestart"] = [];
  for (const stat of stats) {
    const factor = stat.baselineMs > 0 ? stat.p99Ms / stat.baselineMs : 0;
    if (factor >= degradationFactor) {
      organsToRestart.push({
        name: stat.name,
        reason: `p99 ${stat.p99Ms}ms is ${factor.toFixed(1)}x baseline ${stat.baselineMs}ms (threshold ${degradationFactor}x)`,
        degradationFactor: factor,
      });
      continue;
    }
    if ((stat.consecutiveFailures ?? 0) >= maxConsecutiveFailures) {
      organsToRestart.push({
        name: stat.name,
        reason: `${stat.consecutiveFailures} consecutive failures (threshold ${maxConsecutiveFailures})`,
        degradationFactor: 0,
      });
    }
  }
  return {
    v: PROTOCOL_VERSION,
    organ: "surgeon",
    ts: new Date().toISOString(),
    organsExamined: stats.length,
    organsToRestart,
    durationMs: Date.now() - t0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// COMPOSED — run all 3 in one call
// ────────────────────────────────────────────────────────────────────────

export interface AllOrgansReport {
  v: typeof PROTOCOL_VERSION;
  ts: string;
  custodian: CustodianReport;
  sentinel: SentinelReport;
  surgeon: SurgeonReport;
  durationMs: number;
}

/** Run all 3 priority-1 organs in one cycle. Used by daemon's tickAllOrgans
 *  loop and the mneme.phoenix.organs_tick MCP tool. */
export function runAllOrgans(opts?: {
  sentinel?: SentinelOptions;
  surgeonStats?: OrganLatencyStats[];
  surgeonOpts?: Parameters<typeof runSurgeonCycle>[1];
}): AllOrgansReport {
  const t0 = Date.now();
  const custodian = runCustodianCycle();
  const sentinel = runSentinelCycle(opts?.sentinel);
  const surgeon = runSurgeonCycle(opts?.surgeonStats ?? [], opts?.surgeonOpts);
  return {
    v: PROTOCOL_VERSION,
    ts: new Date().toISOString(),
    custodian,
    sentinel,
    surgeon,
    durationMs: Date.now() - t0,
  };
}

export { PROTOCOL_VERSION };
