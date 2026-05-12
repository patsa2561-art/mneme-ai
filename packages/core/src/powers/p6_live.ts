/**
 * v1.65.0 -- POWER 6 LIVE METRIC.
 *
 * Wires the existing p6_adversarial.ts ledger into a single live
 * defense rate using REAL signal sources rather than the cold-start
 * "0% detection -- weakened" report.
 *
 * Sources:
 *   1. .mneme/attack-log.jsonl                  (operator-logged + honeypot bites)
 *   2. .mneme/synthetic-army/<class>/*.jsonl    (nightly synthetic adversarial)
 *   3. .mneme/nemesis/audit-*.jsonl             (weekly Nemesis probes)
 *   4. .mneme/apoptosis/verdicts.jsonl          (APOPTOSIS auto-vaccinations)
 *
 * Defense rate = detected / (detected + missed). Latency = median
 * (observedAt -> detectedAt). Verdict ladder unchanged from v1.48.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LiveAdversarialMetric {
  totalAttacks: number;
  detected: number;
  missed: number;
  defenseRatePct: number;
  /** Median latency between attack-observed and detection event (ms). */
  p50LatencyMs: number | null;
  /** Latest detection timestamp. */
  lastDetectionTs: string | null;
  /** Top attack categories defended. */
  topCategories: Array<{ category: string; count: number }>;
  /** Source breakdown. */
  sources: {
    operatorAndHoneypot: number;
    syntheticArmy: number;
    nemesis: number;
    apoptosisVaccines: number;
  };
  verdict: "weakened" | "baseline" | "hardened" | "antifragile";
  /** Plain-English headline. */
  headline: string;
}

interface AttackRow {
  ts?: string;
  observedAt?: string;
  category?: string;
  detected?: boolean;
  source?: string;
  detectedAt?: string;
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter((x) => x !== null);
  } catch { return []; }
}

function readJsonlDir(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      const s = statSync(p);
      if (s.isDirectory()) out.push(...readJsonlDir(p));
      else if (e.endsWith(".jsonl")) out.push(...readJsonl(p));
    } catch { /* */ }
  }
  return out;
}

export function liveAdversarialMetric(repoRoot: string): LiveAdversarialMetric {
  const operatorLog = readJsonl(join(repoRoot, ".mneme/attack-log.jsonl")) as AttackRow[];
  const syntheticEvents = readJsonlDir(join(repoRoot, ".mneme/synthetic-army")) as AttackRow[];
  const nemesisEvents = readJsonlDir(join(repoRoot, ".mneme/nemesis")) as AttackRow[];
  const apoptosisRows = readJsonl(join(repoRoot, ".mneme/apoptosis/verdicts.jsonl")) as Array<{ ts?: string; verdict?: string }>;

  // Operator/honeypot: present in log => detected (logging = defense fired).
  let detected = 0;
  let missed = 0;
  const latencies: number[] = [];
  const lastTimestamps: string[] = [];
  const categoryCounts = new Map<string, number>();

  for (const r of operatorLog) {
    detected += 1; // logged at the moment of defense
    if (r.category) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    if (r.observedAt) lastTimestamps.push(r.observedAt);
  }
  for (const r of syntheticEvents) {
    if (r.detected === false) { missed += 1; continue; }
    detected += 1;
    if (r.category) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    if (r.observedAt && r.detectedAt) {
      const dt = Date.parse(r.detectedAt) - Date.parse(r.observedAt);
      if (Number.isFinite(dt) && dt >= 0) latencies.push(dt);
    }
    if (r.observedAt) lastTimestamps.push(r.observedAt);
    if (r.detectedAt) lastTimestamps.push(r.detectedAt);
  }
  for (const r of nemesisEvents) {
    if (r.detected === false) { missed += 1; continue; }
    detected += 1;
    if (r.category) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    if (r.observedAt) lastTimestamps.push(r.observedAt);
  }
  for (const r of apoptosisRows) {
    // Each APOPTOSIS NECROTIC/APOPTOTIC verdict counts as a defended attack.
    if (r.verdict === "NECROTIC" || r.verdict === "APOPTOTIC") {
      detected += 1;
      categoryCounts.set("apoptosis-vaccine", (categoryCounts.get("apoptosis-vaccine") ?? 0) + 1);
      if (r.ts) lastTimestamps.push(r.ts);
    }
  }

  const totalAttacks = detected + missed;
  const defenseRatePct = totalAttacks === 0 ? 0 : Math.round((detected / totalAttacks) * 100);
  latencies.sort((a, b) => a - b);
  const p50LatencyMs = latencies.length === 0 ? null : latencies[Math.floor(latencies.length / 2)]!;
  lastTimestamps.sort();
  const lastDetectionTs = lastTimestamps.length === 0 ? null : lastTimestamps[lastTimestamps.length - 1]!;

  const topCategories = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let verdict: LiveAdversarialMetric["verdict"] = "weakened";
  if (defenseRatePct >= 25 && totalAttacks >= 5) verdict = "baseline";
  if (defenseRatePct >= 75 && totalAttacks >= 5) verdict = "hardened";
  if (defenseRatePct >= 95 && totalAttacks >= 10) verdict = "antifragile";

  const headline = totalAttacks === 0
    ? `No attacks logged yet. Run synthetic-army or wait for live signal.`
    : `Defended ${detected}/${totalAttacks} (${defenseRatePct}%)${p50LatencyMs !== null ? `; p50 latency ${p50LatencyMs}ms` : ""}${lastDetectionTs ? `; last ${lastDetectionTs}` : ""}.`;

  return {
    totalAttacks,
    detected,
    missed,
    defenseRatePct,
    p50LatencyMs,
    lastDetectionTs,
    topCategories,
    sources: {
      operatorAndHoneypot: operatorLog.length,
      syntheticArmy: syntheticEvents.length,
      nemesis: nemesisEvents.length,
      apoptosisVaccines: apoptosisRows.filter((r) => r.verdict === "NECROTIC" || r.verdict === "APOPTOTIC").length,
    },
    verdict,
    headline,
  };
}
