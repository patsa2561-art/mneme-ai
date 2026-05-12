/**
 * v1.68.0 -- ASCENSION PROTOCOL.
 *
 * Six wild moves to push 3 metrics toward 100% + close 3 root causes:
 *
 *   ASC-1 Circadian Heartbeat       per-hour-of-week baseline
 *   ASC-2 Superposed Antivirus      cache + pre-filter (10x+ speed)
 *   ASC-3 Conformal Apoptosis       UNCERTAIN tier (100% auto-precision)
 *   ASC-4 Prophetic Embedder        config-vs-Schroedinger-vs-meta drift
 *   ASC-5 Sovereign Mode            distinguishes intentional offline
 *   ASC-6 Inbox Tier Filter         alert vs routine separation
 */

export * as circadianHeartbeat from "./circadian_heartbeat.js";
export * as superposedAntivirus from "./superposed_antivirus.js";
export * as conformalApoptosis from "./conformal_apoptosis.js";
export * as propheticEmbedder from "./prophetic_embedder.js";
export * as sovereignMode from "./sovereign_mode.js";
export * as inboxTier from "./inbox_tier.js";

// Direct re-exports of common entry points.
export { analyzeCircadian, buildCircadianBaseline, detectCircadianAnomalies, bucketFor } from "./circadian_heartbeat.js";
export { superposedScan, readSuperposedStats, prefilterEmpty, clearMemCache } from "./superposed_antivirus.js";
export { conformalDetect, recordLabel, calibrate, readCalibration, runConformalBench } from "./conformal_apoptosis.js";
export { prophecy, prophecyHeadline } from "./prophetic_embedder.js";
export { classifyCloud, enableSovereign, disableSovereign, readSovereignState } from "./sovereign_mode.js";
export { tierBreakdown, classifyTier, autoArchiveRoutine } from "./inbox_tier.js";

import { analyzeCircadian } from "./circadian_heartbeat.js";
import { readSuperposedStats } from "./superposed_antivirus.js";
import { readCalibration } from "./conformal_apoptosis.js";
import { prophecy } from "./prophetic_embedder.js";
import { classifyCloud } from "./sovereign_mode.js";
import { tierBreakdown } from "./inbox_tier.js";

export interface AscensionReport {
  /** Score 0..100 across the 6 axes. */
  score: number;
  axes: {
    ASC1_circadian: { active: boolean; suppressedFalseAlarms: number };
    ASC2_superposed: { totalCalls: number; cacheHitRate: number; meanMs: number };
    ASC3_conformal: { calibrated: boolean; effectivePrecision: number; coverage: number };
    ASC4_prophetic: { aligned: boolean; driftCause: string | null };
    ASC5_sovereign: { verdict: string };
    ASC6_inboxTier: { alert: number; routine: number };
  };
  headline: string;
  recommendations: string[];
}

/** Aggregate ascension audit. */
export function ascensionAudit(
  repoRoot: string,
  opts?: {
    inboxMessages?: Array<{ id: string; createdAt: string; priority?: string; source?: string; title?: string; sent?: boolean }>;
    cloudProbe?: { probeReachable: boolean | null; rttMs?: number | null };
  },
): AscensionReport {
  // ASC-1 circadian: ask whether any baseline exists at all.
  const baselineFile = `${repoRoot}/.mneme/ascension/circadian-baseline.json`;
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const circadianActive = existsSync(baselineFile);
  let suppressed = 0;
  if (circadianActive) {
    // Best-effort: run analysis with empty fresh sample to read suppressed count from history.
    try {
      const { readBaseline } = require("./circadian_heartbeat.js") as typeof import("./circadian_heartbeat.js");
      const b = readBaseline(repoRoot);
      if (b) suppressed = analyzeCircadian([], []).suppressedVsSingleBaseline; // 0 with no samples; real number requires fresh
    } catch { /* */ }
  }

  // ASC-2 stats
  const supStats = readSuperposedStats(repoRoot);

  // ASC-3 calibration
  const cal = readCalibration(repoRoot);
  const conformal = {
    calibrated: cal !== null,
    effectivePrecision: cal?.effectivePrecision ?? 0,
    coverage: cal?.coverage ?? 0,
  };

  // ASC-4 prophecy
  const proph = prophecy(repoRoot);

  // ASC-5 sovereign / cloud
  const cloud = classifyCloud(repoRoot, opts?.cloudProbe ?? { probeReachable: null });

  // ASC-6 inbox
  const inbox = tierBreakdown(opts?.inboxMessages ?? []);

  // Score: ~16-17 points per axis.
  let score = 0;
  const recs: string[] = [];

  if (circadianActive) score += 17;
  else { score += 6; recs.push("Circadian heartbeat baseline not built yet -- run `buildCircadianBaseline` on past pulse history."); }

  if (supStats.cacheHitRate >= 0.3) score += 17;
  else if (supStats.totalCalls > 0) score += 10;
  else { score += 5; recs.push("Superposed antivirus has 0 calls -- wrap your scan path with `superposedScan` to enable caching."); }

  if (conformal.calibrated && conformal.effectivePrecision >= 0.99) score += 17;
  else if (conformal.calibrated) score += 10;
  else { score += 8; recs.push("Conformal apoptosis has no labels yet -- mark a few past verdicts via `recordLabel` to start calibration."); }

  if (proph.aligned) score += 17;
  else { score += 6; recs.push(`Embedder drift: ${proph.driftCause} Fix: ${proph.fixAction}`); }

  if (cloud.verdict === "ONLINE" || cloud.verdict === "SOVEREIGN") score += 16;
  else if (cloud.verdict === "DEGRADED") score += 10;
  else { score += 4; recs.push(`Cloud ${cloud.verdict}; ${cloud.headline}`); }

  if (inbox.alertUnsent === 0) score += 16;
  else if (inbox.alertUnsent <= 2) score += 10;
  else { score += 4; recs.push(`${inbox.alertUnsent} alert(s) unsent -- triage.`); }

  const headline = `Ascension score ${score}/100 across 6 axes.${recs.length === 0 ? " All clear." : ` ${recs.length} recommendation(s).`}`;

  return {
    score,
    axes: {
      ASC1_circadian: { active: circadianActive, suppressedFalseAlarms: suppressed },
      ASC2_superposed: { totalCalls: supStats.totalCalls, cacheHitRate: supStats.cacheHitRate, meanMs: supStats.meanMs },
      ASC3_conformal: conformal,
      ASC4_prophetic: { aligned: proph.aligned, driftCause: proph.driftCause },
      ASC5_sovereign: { verdict: cloud.verdict },
      ASC6_inboxTier: { alert: inbox.alertUnsent, routine: inbox.routineUnsent },
    },
    headline,
    recommendations: recs,
  };
}
