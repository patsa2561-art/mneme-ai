/**
 * v1.64.0 -- COGNITIVE LAYER 3: CURIOSITY ENGINE.
 *
 * Daemon-idle gap detector. Scan the wisdom stack, find areas where
 * Mneme has DATA but no DEFENSE (commits about X but no vaccines)
 * or VICE VERSA. Generate test claims that probe the gap. Either:
 *  - the claim grounds (Mneme adds it to its known-truths)
 *  - the claim refutes (Mneme emits a new vaccine)
 *
 * Either way: a gap closes. Mneme gets smarter on its own.
 *
 * NO LLM. Heuristic gap scan over .mneme/squadron + .mneme/forecast +
 * .mneme/whisper.
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

const COGNITIVE_DIR = ".mneme/cognitive";

export interface CuriosityGap {
  /** Stable id for the gap. */
  id: string;
  /** Plain-English description. */
  description: string;
  /** Where in the wisdom stack the gap was detected. */
  source: "commit-no-vaccine" | "vaccine-no-test" | "forecast-no-trend" | "whisper-no-import" | "stale-area";
  /** Suggested test claim that would probe this gap. */
  suggestedProbe: string;
  /** Priority 0..1. */
  priority: number;
}

export interface CuriosityScan {
  gaps: CuriosityGap[];
  scannedAt: string;
  totalGaps: number;
  highPriority: number;
}

function tokenize(s: string): string[] {
  return Array.from(new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4),
  ));
}

function readRecentCommitSubjects(repoRoot: string, max = 100): string[] {
  // v2.4: spawnSync via safeExecTry (no shell). `max` validated by JS type system as a number.
  const r = safeExecTry("git", ["-C", repoRoot, "log", `--max-count=${max}`, "--pretty=format:%s"], { timeoutMs: 3000 });
  if (r?.status !== 0) return [];
  return r.stdout.split("\n").filter(Boolean);
}

function readVaccineSamples(repoRoot: string): string[] {
  const p = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return (JSON.parse(l) as { sample?: string }).sample ?? ""; } catch { return ""; }
    }).filter(Boolean);
  } catch { return []; }
}

function readForecastClaims(repoRoot: string): string[] {
  const p = join(repoRoot, ".mneme/forecast/forecasts.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return (JSON.parse(l) as { claim?: string }).claim ?? ""; } catch { return ""; }
    }).filter(Boolean);
  } catch { return []; }
}

/** Find the top areas with many commits but no vaccines defending them. */
function findCommitGaps(repoRoot: string): CuriosityGap[] {
  const subjects = readRecentCommitSubjects(repoRoot, 100);
  const vaccines = readVaccineSamples(repoRoot);
  const vaccineTokens = new Set<string>();
  for (const v of vaccines) for (const t of tokenize(v)) vaccineTokens.add(t);
  const commitTopics = new Map<string, number>();
  for (const subj of subjects) {
    for (const t of tokenize(subj)) {
      if (t.length < 5) continue;
      commitTopics.set(t, (commitTopics.get(t) ?? 0) + 1);
    }
  }
  const gaps: CuriosityGap[] = [];
  const sorted = [...commitTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [topic, count] of sorted) {
    if (vaccineTokens.has(topic)) continue;
    const priority = Math.min(1, count / 10);
    gaps.push({
      id: `gap-commit-${topic.slice(0, 16)}`,
      description: `${count} recent commit(s) about "${topic}" but no vaccine defending against fab claims in this area`,
      source: "commit-no-vaccine",
      suggestedProbe: `is "${topic}" in this codebase implemented correctly`,
      priority,
    });
  }
  return gaps;
}

/** Find forecasts that have only ONE sample (no trend yet). */
function findForecastGaps(repoRoot: string): CuriosityGap[] {
  const claims = readForecastClaims(repoRoot);
  const counts = new Map<string, number>();
  for (const c of claims) {
    const key = tokenize(c).slice(0, 3).join("-");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const gaps: CuriosityGap[] = [];
  for (const [key, count] of counts) {
    if (count >= 2) continue;
    gaps.push({
      id: `gap-forecast-${key.slice(0, 16)}`,
      description: `Only ${count} forecast(s) recorded for area "${key}"; cannot compute trend yet`,
      source: "forecast-no-trend",
      suggestedProbe: `run a second forecast on a claim mentioning "${key}"`,
      priority: 0.3,
    });
  }
  return gaps.slice(0, 5);
}

/** Detect stale areas: high commit-count topics with no recent forecasts. */
function findStaleAreas(repoRoot: string): CuriosityGap[] {
  const subjects = readRecentCommitSubjects(repoRoot, 200);
  const forecastClaims = readForecastClaims(repoRoot);
  const forecastTokens = new Set<string>();
  for (const c of forecastClaims) for (const t of tokenize(c)) forecastTokens.add(t);
  const commitTopics = new Map<string, number>();
  for (const subj of subjects) {
    for (const t of tokenize(subj)) {
      if (t.length < 6) continue;
      commitTopics.set(t, (commitTopics.get(t) ?? 0) + 1);
    }
  }
  const gaps: CuriosityGap[] = [];
  const sorted = [...commitTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [topic, count] of sorted) {
    if (forecastTokens.has(topic) || count < 3) continue;
    gaps.push({
      id: `gap-stale-${topic.slice(0, 16)}`,
      description: `Active area "${topic}" (${count} commits) has no forecast coverage`,
      source: "stale-area",
      suggestedProbe: `forecast regression risk for next change touching "${topic}"`,
      priority: Math.min(1, count / 8),
    });
  }
  return gaps;
}

/** Scan all wisdom layers for gaps. */
export function scanGaps(repoRoot: string): CuriosityScan {
  const allGaps = [
    ...findCommitGaps(repoRoot),
    ...findForecastGaps(repoRoot),
    ...findStaleAreas(repoRoot),
  ];
  // Dedup by id.
  const seen = new Set<string>();
  const unique = allGaps.filter((g) => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
  unique.sort((a, b) => b.priority - a.priority);
  return {
    gaps: unique,
    scannedAt: new Date().toISOString(),
    totalGaps: unique.length,
    highPriority: unique.filter((g) => g.priority >= 0.6).length,
  };
}

/** Log a probe that was actually executed in response to a gap. */
export function logProbeExecution(repoRoot: string, gapId: string, outcome: "grounded" | "refuted" | "limbo"): void {
  try {
    const dir = join(repoRoot, COGNITIVE_DIR, "curiosity");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "probes.jsonl"), JSON.stringify({
      ts: new Date().toISOString(), gapId, outcome,
    }) + "\n", "utf8");
  } catch { /* */ }
}
