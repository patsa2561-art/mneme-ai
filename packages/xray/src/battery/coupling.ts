/**
 * CHANGE-COUPLING (temporal coupling) — files that keep changing together.
 *
 * Research: logical/evolutionary coupling (Gall et al.; D'Ambros & Lanza;
 * Zimmermann et al. "mining version histories to guide changes"). Two files
 * that change together far more often than chance share a HIDDEN dependency the
 * type system can't see — the classic "I fixed A but forgot B" bug source.
 *
 * Deterministic: from `git log --name-only` (commit/tree metadata; no blob
 * fetch). confidence(A,B) = coChanges / min(changes(A), changes(B)).
 * "hidden" = the two files live in different directories (non-obvious coupling).
 */
import { git, isGitRepo } from "../util.js";
import type { CouplingBlock } from "../types.js";

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__|\.venv|target)(\/|$)/;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc|rb|php|cs|kt|swift|scala|vue|svelte)$/i;
const dir = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

export function analyzeCoupling(repoPath: string, now: number, windowDays = 365): CouplingBlock {
  if (!isGitRepo(repoPath)) return { windowDays, pairs: [], note: "Not a git repository — coupling history unavailable." };
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  // \x01 between commits → recover each commit's changed-file set
  const raw = git(repoPath, ["log", "--since", since, "--no-merges", "--name-only", "--pretty=format:%x01"]);
  if (!raw.trim()) return { windowDays, pairs: [], note: "No commit activity in the window." };

  const fileCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const block of raw.split("\x01")) {
    const files = [...new Set(block.split("\n").map((s) => s.trim()).filter((f) => f && !SKIP_DIR.test(f) && CODE_EXT.test(f)))];
    for (const f of files) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    if (files.length < 2 || files.length > 40) continue; // skip lone + sweeping commits for pairing
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = files[i] < files[j] ? files[i] + "\x00" + files[j] : files[j] + "\x00" + files[i];
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  }

  const pairs: CouplingBlock["pairs"] = [];
  for (const [k, co] of pairCount) {
    if (co < 5) continue; // need support
    const [a, b] = k.split("\x00");
    const conf = co / Math.min(fileCount.get(a) ?? co, fileCount.get(b) ?? co);
    if (conf < 0.5) continue; // need strength
    pairs.push({ a, b, coChanges: co, confidence: Math.round(conf * 100) / 100, hidden: dir(a) !== dir(b) });
  }
  // hidden (cross-dir) coupling first — that's the surprising, valuable kind
  pairs.sort((x, y) => Number(y.hidden) - Number(x.hidden) || y.confidence - x.confidence || y.coChanges - x.coChanges);

  const top = pairs[0];
  return {
    windowDays,
    pairs: pairs.slice(0, 15),
    note: top
      ? `${top.a} ⇄ ${top.b} change together ${Math.round(top.confidence * 100)}% of the time${top.hidden ? " across different directories (hidden dependency)" : ""}.`
      : "No strong change-coupling detected.",
  };
}
