/**
 * Bus-factor signal — knowledge concentration from git authorship.
 * Pure computation over `git log` (deterministic given repo state). For each
 * file: the share of its commits held by its single top author. A file with
 * one dominant author is fragile (knowledge dies if that person leaves).
 */
import { git, isGitRepo } from "../util.js";
import type { BusFactorBlock } from "../types.js";

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage)(\/|$)/;
const DOMINANCE = 0.8; // a file is "single-owner" when its top author holds >= 80% of its commits

export function analyzeBusFactor(repoPath: string): BusFactorBlock {
  if (!isGitRepo(repoPath)) return emptyBlock("Not a git repository — authorship/bus-factor signals unavailable.");
  // One line per (commit, file): "<authorEmail>\t<file>". --no-renames keeps paths stable.
  const raw = git(repoPath, [
    "log", "--no-merges", "--pretty=format:C%H%x09%ae", "--name-only", "-n", "4000",
  ]);
  if (!raw.trim()) {
    return emptyBlock("No commit history available.");
  }

  const fileAuthors = new Map<string, Map<string, number>>(); // file -> author -> commits
  const authorCommits = new Map<string, number>(); // author -> total commits
  const allAuthors = new Set<string>();
  let curAuthor = "";
  let totalCommits = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("C")) {
      const tab = line.indexOf("\t");
      curAuthor = tab >= 0 ? line.slice(tab + 1).trim() : "";
      if (curAuthor) {
        allAuthors.add(curAuthor);
        authorCommits.set(curAuthor, (authorCommits.get(curAuthor) ?? 0) + 1);
        totalCommits++;
      }
      continue;
    }
    const file = line.trim();
    if (!file || SKIP_DIR.test(file) || !curAuthor) continue;
    let m = fileAuthors.get(file);
    if (!m) { m = new Map(); fileAuthors.set(file, m); }
    m.set(curAuthor, (m.get(curAuthor) ?? 0) + 1);
  }

  if (totalCommits === 0) return emptyBlock("No authored commits found.");

  let singleOwner = 0;
  const fragile: BusFactorBlock["fragileFiles"] = [];
  for (const [file, m] of fileAuthors) {
    let top = 0, sum = 0;
    for (const c of m.values()) { sum += c; if (c > top) top = c; }
    if (sum < 3) continue; // ignore barely-touched files
    const share = top / sum;
    if (share >= DOMINANCE) {
      singleOwner++;
      fragile.push({ file, topAuthorShare: Math.round(share * 100) / 100, commits: sum });
    }
  }
  fragile.sort((a, b) => b.commits - a.commits);

  const consideredFiles = [...fileAuthors.values()].filter((m) => [...m.values()].reduce((s, c) => s + c, 0) >= 3).length;
  const topContributor = Math.max(0, ...authorCommits.values());
  const topShare = totalCommits > 0 ? topContributor / totalCommits : 0;

  // bus factor ≈ how many top authors it takes to cover 50% of commits.
  const sorted = [...authorCommits.values()].sort((a, b) => b - a);
  let cum = 0, busFactor = 0;
  for (const c of sorted) { cum += c; busFactor++; if (cum >= totalCommits * 0.5) break; }

  return {
    authors: allAuthors.size,
    singleOwnerFilePct: consideredFiles > 0 ? Math.round((singleOwner / consideredFiles) * 1000) / 10 : 0,
    fragileFiles: fragile.slice(0, 15),
    topContributorShare: Math.round(topShare * 1000) / 10,
    busFactor,
    note:
      busFactor <= 1
        ? "Bus factor 1 — a single person dominates this codebase. High key-person risk."
        : `${allAuthors.size} authors; ${singleOwner} files are single-owner (>=80% one author).`,
  };
}

function emptyBlock(note: string): BusFactorBlock {
  return { authors: 0, singleOwnerFilePct: 0, fragileFiles: [], topContributorShare: 0, busFactor: 0, note };
}
