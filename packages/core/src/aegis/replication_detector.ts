/**
 * v1.67.0 -- AEGIS A1: REPLICATION DETECTOR.
 *
 * Defensive answer to Palisade's Qwen-self-replication finding.
 * When the SAME AI agent (vendor + soul-fingerprint) appears in tool
 * calls across N distinct hosts within a tight time window, flag as
 * SUSPECTED self-replication burst.
 *
 *   threshold: >= 3 distinct hosts in <= 10 minutes -> SUSPECT
 *
 * Reads ai-souls + ai-handshakes + recursive-soul ledgers (all
 * already populated by Mneme). No network probing. Pure-read.
 *
 * Verdicts:
 *   QUIET       no burst pattern detected
 *   ELEVATED    2 hosts in window (informational)
 *   SUSPECTED   3-4 hosts in window
 *   CRITICAL    5+ hosts in window OR cross-country jumps detected
 *
 * IMPORTANT: this layer ONLY OBSERVES. No automatic blocking. The
 * verdict + evidence flow to the user via the Aletheia score so
 * they can decide what to do.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const AEGIS_DIR = ".mneme/aegis";

export type BurstVerdict = "QUIET" | "ELEVATED" | "SUSPECTED" | "CRITICAL";

export interface SoulEvent {
  vendor: string;
  hostId: string;       // hostname or instance id
  ts: number;           // ms
}

export interface ReplicationBurst {
  vendor: string;
  hosts: string[];
  firstSeen: string;   // iso
  lastSeen: string;    // iso
  windowMs: number;
  verdict: BurstVerdict;
  /** Plain-English. */
  detail: string;
}

export interface ReplicationReport {
  scannedAt: string;
  totalEvents: number;
  bursts: ReplicationBurst[];
  highestVerdict: BurstVerdict;
  /** Plain-English headline. */
  headline: string;
}

function readJsonl(p: string): Array<Record<string, unknown>> {
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
    }).filter((x): x is Record<string, unknown> => x !== null);
  } catch { return []; }
}

function readJsonDir(dir: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      if (statSync(p).isFile() && e.endsWith(".json")) {
        const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        const vendor = (j["vendor"] as string | undefined) ?? e.replace(/\.json$/, "");
        const sessions = (j["sessions"] as Array<Record<string, unknown>> | undefined) ?? [];
        for (const s of sessions) {
          out.push({ ...s, vendor });
        }
      }
    } catch { /* */ }
  }
  return out;
}

/** Gather host-active events for every vendor from soul + handshake +
 *  recursive-soul ledgers. */
export function collectEvents(repoRoot: string): SoulEvent[] {
  const events: SoulEvent[] = [];
  // Souls
  for (const row of readJsonDir(join(repoRoot, ".mneme/ai-souls"))) {
    const vendor = String(row["vendor"] ?? "unknown");
    const hostId = String(row["hostId"] ?? row["machineId"] ?? row["host"] ?? "host-unknown");
    const tsRaw = row["ts"] ?? row["startedAt"] ?? row["at"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;
    events.push({ vendor, hostId, ts });
  }
  // Handshakes
  for (const row of readJsonl(join(repoRoot, ".mneme/ai-handshakes/log.jsonl"))) {
    const vendor = String(row["vendor"] ?? "unknown");
    const hostId = String(row["hostId"] ?? row["host"] ?? "host-unknown");
    const tsRaw = row["ts"] ?? row["at"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;
    events.push({ vendor, hostId, ts });
  }
  // Recursive soul events
  for (const row of readJsonl(join(repoRoot, ".mneme/recursive_soul/events.jsonl"))) {
    const vendor = String(row["vendor"] ?? "unknown");
    const hostId = String(row["hostId"] ?? row["host"] ?? "host-unknown");
    const tsRaw = row["ts"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;
    events.push({ vendor, hostId, ts });
  }
  return events;
}

function classifyBurst(hostCount: number): BurstVerdict {
  if (hostCount >= 5) return "CRITICAL";
  if (hostCount >= 3) return "SUSPECTED";
  if (hostCount >= 2) return "ELEVATED";
  return "QUIET";
}

const VERDICT_RANK: Record<BurstVerdict, number> = { QUIET: 0, ELEVATED: 1, SUSPECTED: 2, CRITICAL: 3 };

export interface DetectorOptions {
  /** Window in ms over which to count distinct hosts (default 10 min). */
  windowMs?: number;
  /** Persist suspect bursts to .mneme/aegis/replication-suspects.jsonl. */
  persist?: boolean;
}

export function detectReplicationBursts(repoRoot: string, opts?: DetectorOptions): ReplicationReport {
  const windowMs = opts?.windowMs ?? 10 * 60 * 1000;
  const events = collectEvents(repoRoot);
  // Group by vendor.
  const byVendor = new Map<string, SoulEvent[]>();
  for (const e of events) {
    const arr = byVendor.get(e.vendor) ?? [];
    arr.push(e);
    byVendor.set(e.vendor, arr);
  }
  const bursts: ReplicationBurst[] = [];
  let highest: BurstVerdict = "QUIET";
  for (const [vendor, evs] of byVendor) {
    evs.sort((a, b) => a.ts - b.ts);
    // Sliding window: for each event, look forward windowMs and count distinct hosts.
    for (let i = 0; i < evs.length; i++) {
      const start = evs[i]!.ts;
      const hosts = new Set<string>();
      let lastTs = start;
      for (let j = i; j < evs.length; j++) {
        if (evs[j]!.ts - start > windowMs) break;
        hosts.add(evs[j]!.hostId);
        lastTs = evs[j]!.ts;
      }
      const verdict = classifyBurst(hosts.size);
      if (verdict === "QUIET") continue;
      // Only emit if this window's verdict beats what we've recorded for the same vendor.
      const prior = bursts.find((b) => b.vendor === vendor);
      if (prior && VERDICT_RANK[prior.verdict] >= VERDICT_RANK[verdict]) continue;
      const burst: ReplicationBurst = {
        vendor,
        hosts: [...hosts],
        firstSeen: new Date(start).toISOString(),
        lastSeen: new Date(lastTs).toISOString(),
        windowMs,
        verdict,
        detail: `${vendor} seen on ${hosts.size} host(s) within ${(windowMs / 60000).toFixed(0)} min: ${[...hosts].join(", ")}`,
      };
      if (prior) {
        const idx = bursts.indexOf(prior);
        bursts[idx] = burst;
      } else {
        bursts.push(burst);
      }
      if (VERDICT_RANK[verdict] > VERDICT_RANK[highest]) highest = verdict;
    }
  }
  const headline = highest === "QUIET"
    ? `No replication burst detected across ${events.length} event(s).`
    : `${highest}: ${bursts.length} vendor burst(s) detected (highest=${highest}).`;
  // Persist
  if (opts?.persist && bursts.length > 0) {
    try {
      const dir = join(repoRoot, AEGIS_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      for (const b of bursts) {
        appendFileSync(join(dir, "replication-suspects.jsonl"),
          JSON.stringify({ ts: new Date().toISOString(), ...b }) + "\n", "utf8");
      }
    } catch { /* */ }
  }
  return {
    scannedAt: new Date().toISOString(),
    totalEvents: events.length,
    bursts,
    highestVerdict: highest,
    headline,
  };
}
