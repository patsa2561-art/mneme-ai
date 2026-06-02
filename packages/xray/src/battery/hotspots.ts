/**
 * HOTSPOTS — behavioral code analysis (the research-grounded signal).
 *
 * Defects and maintenance cost don't spread evenly: they concentrate in files
 * that are BOTH changed often AND large/complex. This is well established —
 * code churn predicts defects (Nagappan & Ball, ICSE'05), and "hotspots" =
 * change-frequency × complexity surface the highest-ROI refactoring targets
 * (Tornhill, *Your Code as a Crime Scene*; D'Ambros & Lanza). We compute it
 * 100% deterministically:
 *
 *   change-frequency  ← `git log --name-only` over a window (no blob fetch —
 *                        works on a blobless clone; uses commit/tree metadata)
 *   complexity proxy  ← current lines-of-code of the file (HEAD blob)
 *   hotspot score     ← changeCount × loc, ranked
 *   expert            ← the author with the most commits to the file (who to ask)
 *   trend             ← commits per time bucket (oldest→newest), for a sparkline
 */
import { git, readText, isGitRepo } from "../util.js";
import type { HotspotsBlock } from "../types.js";
import { join } from "node:path";

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__|\.venv|target)(\/|$)/;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc|rb|php|cs|kt|swift|scala|vue|svelte)$/i;

export function analyzeHotspots(repoPath: string, now: number, windowDays = 365): HotspotsBlock {
  if (!isGitRepo(repoPath)) {
    return { windowDays, filesConsidered: 0, hotspots: [], trend: [], note: "Not a git repository — hotspot history unavailable." };
  }
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  // per commit: "C<TAB><email>" then changed file paths. One pass → change
  // frequency per file + the dominant author per file (the "expert").
  const raw = git(repoPath, ["log", "--since", since, "--no-merges", "--name-only", "--pretty=format:C%x09%ae"]);
  if (!raw.trim()) return { windowDays, filesConsidered: 0, hotspots: [], trend: [], note: "No commit activity in the window." };

  const changes = new Map<string, number>();
  const authorsByFile = new Map<string, Map<string, number>>();
  let curAuthor = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("C\t")) { curAuthor = line.slice(2).trim(); continue; }
    const f = line.trim();
    if (!f || SKIP_DIR.test(f) || !CODE_EXT.test(f)) continue;
    changes.set(f, (changes.get(f) ?? 0) + 1);
    if (curAuthor) {
      let m = authorsByFile.get(f); if (!m) { m = new Map(); authorsByFile.set(f, m); }
      m.set(curAuthor, (m.get(curAuthor) ?? 0) + 1);
    }
  }
  if (changes.size === 0) return { windowDays, filesConsidered: 0, hotspots: [], trend: [], note: "No source-file changes in the window." };

  const ranked = [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  const rows = ranked.map(([file, changeCount]) => {
    const txt = readText(join(repoPath, file));
    const loc = txt ? txt.split("\n").length : 0;
    const m = authorsByFile.get(file);
    let expert = "", top = 0, authors = 0;
    if (m) { authors = m.size; for (const [a, c] of m) if (c > top) { top = c; expert = a; } }
    return { file, changes: changeCount, loc, score: changeCount * loc, expert, authors };
  }).filter((r) => r.loc > 0);
  rows.sort((a, b) => b.score - a.score);

  // trend: commits per equal bucket over the window (oldest → newest)
  const BUCKETS = 8;
  const trend = new Array<number>(BUCKETS).fill(0);
  const winMs = windowDays * 86_400_000;
  const tsRaw = git(repoPath, ["log", "--since", since, "--no-merges", "--pretty=format:%ct"]);
  for (const l of tsRaw.split("\n")) {
    const sec = parseInt(l.trim(), 10);
    if (!Number.isFinite(sec)) continue;
    const ageMs = now - sec * 1000;
    let idx = BUCKETS - 1 - Math.floor((ageMs / winMs) * BUCKETS);
    if (idx < 0) idx = 0; if (idx > BUCKETS - 1) idx = BUCKETS - 1;
    trend[idx]++;
  }

  const top = rows[0];
  return {
    windowDays,
    filesConsidered: changes.size,
    hotspots: rows.slice(0, 15),
    trend,
    note: top
      ? `Hotspot: ${top.file} — changed ${top.changes}× and ${top.loc} lines${top.expert ? ` (ask: ${top.expert})` : ""}. High churn × size = where defects and refactoring ROI concentrate.`
      : "No hotspots surfaced.",
  };
}
