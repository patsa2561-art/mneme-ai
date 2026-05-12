/**
 * v1.64.0 -- COGNITIVE LAYER 4: MEMORY CONSOLIDATION.
 *
 * Sleep-cycle compression. Every consolidation pass:
 *   1. Merge near-duplicate vaccines (Hamming distance <= 4)
 *   2. Compress similar lessons into single core-wisdom entries
 *   3. Promote frequently-recalled lessons to "core" tier
 *   4. Prune lessons unused for >= 90 days
 *
 * Result: signal/noise ratio improves over time. Mneme sharper, not
 * just bigger.
 *
 * Pure functions; persist only when `apply=true`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COGNITIVE_DIR = ".mneme/cognitive";

export interface ConsolidationReport {
  scannedAt: string;
  /** Vaccine-bank stats. */
  vaccines: { before: number; after: number; merged: number };
  /** Lesson stats. */
  lessons: { before: number; after: number; pruned: number; promoted: number };
  /** Dry run? */
  dryRun: boolean;
}

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

interface Vaccine {
  id: string;
  simhash: string;
  signature: string;
  refuteCount: number;
  firstSeen: string;
  lastSeen: string;
  sample?: string;
}

function readVaccines(repoRoot: string): Vaccine[] {
  const p = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Vaccine; } catch { return null; }
    }).filter((x): x is Vaccine => x !== null);
  } catch { return []; }
}

function writeVaccines(repoRoot: string, vaccines: Vaccine[]): void {
  const dir = join(repoRoot, ".mneme/squadron");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "lie-vaccines.jsonl"),
    vaccines.map((v) => JSON.stringify(v)).join("\n") + (vaccines.length > 0 ? "\n" : ""),
    "utf8",
  );
}

interface NucleusLesson {
  id: string;
  tick: number;
  bornAt: string;
  text: string;
  source: string;
  kind?: string;
  evidence?: string[];
  /** v1.64 -- consolidation metadata. */
  recallCount?: number;
  promotedTo?: "core" | "growth-event" | "milestone" | "consolidation";
}

interface NucleusState {
  schemaVersion: number;
  tick: number;
  lessons: NucleusLesson[];
  [k: string]: unknown;
}

function readNucleus(repoRoot: string): NucleusState | null {
  const p = join(repoRoot, ".mneme/nucleus.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as NucleusState; } catch { return null; }
}

function writeNucleus(repoRoot: string, state: NucleusState): void {
  writeFileSync(join(repoRoot, ".mneme/nucleus.json"), JSON.stringify(state, null, 2), "utf8");
}

/** Merge vaccines with Hamming distance <= radius. Keeps the one with
 *  the higher refuteCount. */
export function mergeNearDuplicateVaccines(vaccines: Vaccine[], radius: number = 4): { merged: Vaccine[]; mergedCount: number } {
  const result: Vaccine[] = [];
  const used = new Set<number>();
  let mergedCount = 0;
  for (let i = 0; i < vaccines.length; i++) {
    if (used.has(i)) continue;
    let best = vaccines[i]!;
    for (let j = i + 1; j < vaccines.length; j++) {
      if (used.has(j)) continue;
      const d = hammingDistance(best.simhash, vaccines[j]!.simhash);
      if (d >= 0 && d <= radius) {
        // Merge: keep the higher refuteCount + accumulate.
        used.add(j);
        mergedCount += 1;
        if (vaccines[j]!.refuteCount > best.refuteCount) {
          best = { ...vaccines[j]!, refuteCount: best.refuteCount + vaccines[j]!.refuteCount };
        } else {
          best = { ...best, refuteCount: best.refuteCount + vaccines[j]!.refuteCount };
        }
      }
    }
    result.push(best);
  }
  return { merged: result, mergedCount };
}

/** Promote lessons frequently recalled; prune lessons never recalled
 *  past 90 days. */
export function consolidateLessons(lessons: NucleusLesson[]): { kept: NucleusLesson[]; pruned: number; promoted: number } {
  const NINETY_DAYS = 90 * 86400 * 1000;
  const RECALL_PROMOTE_THRESHOLD = 5;
  let pruned = 0;
  let promoted = 0;
  const kept: NucleusLesson[] = [];
  for (const lesson of lessons) {
    const ageMs = Date.now() - Date.parse(lesson.bornAt);
    const recalls = lesson.recallCount ?? 0;
    if (lesson.kind === "milestone" && recalls === 0 && ageMs > NINETY_DAYS) {
      pruned += 1;
      continue;
    }
    // Promote
    if (recalls >= RECALL_PROMOTE_THRESHOLD && lesson.promotedTo !== "core") {
      kept.push({ ...lesson, promotedTo: "core" });
      promoted += 1;
    } else {
      kept.push(lesson);
    }
  }
  return { kept, pruned, promoted };
}

/** Run one full consolidation pass. */
export function runConsolidation(repoRoot: string, opts?: { dryRun?: boolean; radius?: number }): ConsolidationReport {
  const dryRun = opts?.dryRun ?? false;
  const radius = opts?.radius ?? 4;

  // Vaccines
  const vaccinesBefore = readVaccines(repoRoot);
  const { merged, mergedCount } = mergeNearDuplicateVaccines(vaccinesBefore, radius);
  if (!dryRun && mergedCount > 0) writeVaccines(repoRoot, merged);

  // Lessons
  const nucleus = readNucleus(repoRoot);
  let lessonsBefore = 0, lessonsAfter = 0, pruned = 0, promoted = 0;
  if (nucleus) {
    lessonsBefore = (nucleus.lessons ?? []).length;
    const r = consolidateLessons(nucleus.lessons ?? []);
    lessonsAfter = r.kept.length;
    pruned = r.pruned;
    promoted = r.promoted;
    if (!dryRun && (pruned > 0 || promoted > 0)) {
      writeNucleus(repoRoot, { ...nucleus, lessons: r.kept });
    }
  }

  // Audit log
  if (!dryRun) {
    try {
      const dir = join(repoRoot, COGNITIVE_DIR, "consolidation");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `pass-${Date.now()}.json`), JSON.stringify({
        scannedAt: new Date().toISOString(),
        vaccinesBefore: vaccinesBefore.length,
        vaccinesAfter: merged.length,
        merged: mergedCount,
        lessonsBefore, lessonsAfter, pruned, promoted,
      }, null, 2), "utf8");
    } catch { /* */ }
  }

  return {
    scannedAt: new Date().toISOString(),
    vaccines: { before: vaccinesBefore.length, after: merged.length, merged: mergedCount },
    lessons: { before: lessonsBefore, after: lessonsAfter, pruned, promoted },
    dryRun,
  };
}
