/**
 * Age / vitality signal — computed directly from `git log` for accuracy.
 *
 * NOTE: we deliberately do NOT use funeral.collectEulogyStats here — as of
 * v2.150 that helper reports bornAt==diedAt (lifespan 0 days) on this repo,
 * a core bug to fix separately. Reading the first/last commit dates ourselves
 * is exact and dependency-free.
 */
import { git } from "../util.js";
import type { AgeBlock } from "../types.js";

const DAY_MS = 1000 * 60 * 60 * 24;

function humanSpan(days: number): string {
  if (days < 1) return "less than a day";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30.44);
  const parts: string[] = [];
  if (years) parts.push(`${years} year${years > 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${months > 1 ? "s" : ""}`);
  if (!years && !months) parts.push(`${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function analyzeAge(repoPath: string, now: number): AgeBlock {
  const first = git(repoPath, ["log", "--reverse", "--format=%aI", "--max-parents=0"]).split("\n")[0]?.trim()
    || git(repoPath, ["log", "--reverse", "--format=%aI"]).split("\n")[0]?.trim();
  const last = git(repoPath, ["log", "-1", "--format=%aI"]).trim();
  const totalCommits = parseInt(git(repoPath, ["rev-list", "--count", "HEAD"]).trim() || "0", 10);
  const authors = new Set(
    git(repoPath, ["log", "--format=%ae"]).split("\n").map((s) => s.trim()).filter(Boolean),
  ).size;

  if (!first || !last || totalCommits === 0) {
    return {
      bornAt: "", lastCommitAt: "", lifespan: "unknown", lifespanDays: 0,
      totalCommits: 0, totalAuthors: 0, dormant: true, vitality: "dormant",
      note: "Could not read git history.",
    };
  }

  const bornMs = Date.parse(first);
  const lastMs = Date.parse(last);
  const lifespanDays = Number.isFinite(bornMs) && Number.isFinite(lastMs) ? Math.max(0, (lastMs - bornMs) / DAY_MS) : 0;
  const monthsSince = Number.isFinite(lastMs) ? (now - lastMs) / (DAY_MS * 30.44) : 999;
  const archived = false; // we cannot know archive status from clone alone; report only what is provable
  const vitality: AgeBlock["vitality"] =
    monthsSince >= 12 ? "dormant" : monthsSince >= 4 ? "slowing" : "active";

  return {
    bornAt: first,
    lastCommitAt: last,
    lifespan: humanSpan(lifespanDays),
    lifespanDays: Math.round(lifespanDays),
    totalCommits,
    totalAuthors: authors,
    dormant: vitality === "dormant",
    vitality: archived ? "archived" : vitality,
    note:
      vitality === "active" ? "Actively maintained — recent commit activity."
      : vitality === "slowing" ? "Commit cadence is slowing (no commit in 4+ months)."
      : "Dormant — no commit in 12+ months.",
  };
}
