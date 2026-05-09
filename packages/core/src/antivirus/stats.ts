/**
 * Mneme Antivirus -- runtime stats.
 *
 * Persists per-scan summaries + aggregate counters to
 * .mneme/antivirus/stats.json. The web Lab dashboard reads this file
 * to render the realtime activity feed + per-strain catch counts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AntivirusStats, ScanSummary, StrainId } from "./types.js";
import { listStrains } from "./strains.js";

const STATS_FILE = ".mneme/antivirus/stats.json";
const RECENT_SCAN_LIMIT = 50;

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme", "antivirus");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function emptyStats(): AntivirusStats {
  const byStrain = {} as Record<StrainId, { caught: number; lastCaughtAt: string | null }>;
  for (const s of listStrains()) byStrain[s.id] = { caught: 0, lastCaughtAt: null };
  return {
    totalScans: 0,
    totalClaimsExamined: 0,
    totalInfectionsCaught: 0,
    byStrain,
    byVaccine: {},
    recentScans: [],
    lastUpdate: new Date().toISOString(),
  };
}

export function readStats(repoRoot: string): AntivirusStats {
  const path = join(repoRoot, STATS_FILE);
  if (!existsSync(path)) return emptyStats();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AntivirusStats>;
    // Merge with empty defaults so newly-added strains don't crash readers.
    const empty = emptyStats();
    return {
      ...empty, ...parsed,
      byStrain: { ...empty.byStrain, ...(parsed.byStrain ?? {}) } as AntivirusStats["byStrain"],
      byVaccine: { ...(parsed.byVaccine ?? {}) },
      recentScans: parsed.recentScans ?? [],
    };
  } catch {
    return emptyStats();
  }
}

export function writeStats(repoRoot: string, s: AntivirusStats): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, STATS_FILE), JSON.stringify(s, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Record a single scan's outcome into the persistent stats file. */
export function recordScan(
  repoRoot: string,
  summary: ScanSummary,
  byStrainCaught: Record<string, number>,
): AntivirusStats {
  const s = readStats(repoRoot);
  s.totalScans += 1;
  s.totalClaimsExamined += summary.claimsExamined;
  s.totalInfectionsCaught += summary.infections;
  for (const [strain, n] of Object.entries(byStrainCaught)) {
    const slot = s.byStrain[strain as StrainId];
    if (slot) {
      slot.caught += n;
      slot.lastCaughtAt = summary.ranAt;
    }
  }
  for (const v of summary.vaccinesUsed) {
    const slot = s.byVaccine[v] ?? { invocations: 0, infections: 0 };
    slot.invocations += 1;
    s.byVaccine[v] = slot;
  }
  s.recentScans.push(summary);
  if (s.recentScans.length > RECENT_SCAN_LIMIT) {
    s.recentScans.splice(0, s.recentScans.length - RECENT_SCAN_LIMIT);
  }
  s.lastUpdate = new Date().toISOString();
  writeStats(repoRoot, s);
  return s;
}

/** Helper for tests + the lab dashboard. Computes derived metrics. */
export function deriveMetrics(s: AntivirusStats): {
  catchRate: number;       // infections / claimsExamined
  avgScanMs: number;
  topStrain: StrainId | null;
  uniqueVaccinesActive: number;
} {
  const catchRate = s.totalClaimsExamined === 0 ? 0 : s.totalInfectionsCaught / s.totalClaimsExamined;
  const avgScanMs = s.recentScans.length === 0 ? 0
    : s.recentScans.reduce((sum, r) => sum + r.totalMs, 0) / s.recentScans.length;
  let topStrain: StrainId | null = null;
  let topCount = 0;
  for (const [id, slot] of Object.entries(s.byStrain)) {
    if (slot.caught > topCount) { topCount = slot.caught; topStrain = id as StrainId; }
  }
  return { catchRate, avgScanMs, topStrain, uniqueVaccinesActive: Object.keys(s.byVaccine).length };
}
