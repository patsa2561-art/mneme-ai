/**
 * HOTSPOTS — behavioral code analysis (the research-grounded signal).
 *
 * Defects and maintenance cost don't spread evenly: they concentrate in files
 * that are BOTH changed often AND large/complex. This is well established —
 * code churn predicts defects (Nagappan & Ball, ICSE'05), and "hotspots" =
 * change-frequency × complexity surface the highest-ROI refactoring targets
 * (Tornhill, *Your Code as a Crime Scene*; D'Ambros & Lanza, evolutionary
 * measures). We compute it 100% deterministically:
 *
 *   change-frequency  ← `git log --name-only` over a window (no blob fetch —
 *                        works on a blobless clone; uses commit/tree metadata)
 *   complexity proxy  ← current lines-of-code of the file (HEAD blob)
 *   hotspot score     ← changeCount × loc, ranked
 *
 * The output answers "where do I refactor first?" — a question no secret scanner
 * or dependency checker answers, and one a CTO actually pays for.
 */
import { git, readText, isGitRepo } from "../util.js";
import type { HotspotsBlock } from "../types.js";
import { join } from "node:path";

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__|\.venv|target)(\/|$)/;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc|rb|php|cs|kt|swift|scala|vue|svelte)$/i;

export function analyzeHotspots(repoPath: string, now: number, windowDays = 365): HotspotsBlock {
  if (!isGitRepo(repoPath)) {
    return { windowDays, filesConsidered: 0, hotspots: [], note: "Not a git repository — hotspot history unavailable." };
  }
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  // empty pretty format → output is just the changed file paths, one per line,
  // per commit. Counting occurrences = how many commits touched each file.
  const raw = git(repoPath, ["log", "--since", since, "--no-merges", "--name-only", "--pretty=format:"]);
  if (!raw.trim()) return { windowDays, filesConsidered: 0, hotspots: [], note: "No commit activity in the window." };

  const changes = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const f = line.trim();
    if (!f || SKIP_DIR.test(f) || !CODE_EXT.test(f)) continue;
    changes.set(f, (changes.get(f) ?? 0) + 1);
  }
  if (changes.size === 0) return { windowDays, filesConsidered: 0, hotspots: [], note: "No source-file changes in the window." };

  // join change-frequency with current size (complexity proxy). Only read LOC
  // for the most-changed files (bounded work).
  const ranked = [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  const rows = ranked.map(([file, changeCount]) => {
    const txt = readText(join(repoPath, file));
    const loc = txt ? txt.split("\n").length : 0;
    return { file, changes: changeCount, loc, score: changeCount * loc };
  }).filter((r) => r.loc > 0);
  rows.sort((a, b) => b.score - a.score);

  const top = rows[0];
  return {
    windowDays,
    filesConsidered: changes.size,
    hotspots: rows.slice(0, 15),
    note: top
      ? `Hotspot: ${top.file} — changed ${top.changes}× and ${top.loc} lines. High churn × size = where defects and refactoring ROI concentrate (behavioral code analysis).`
      : "No hotspots surfaced.",
  };
}
