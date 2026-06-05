/**
 * CODE STABILITY — how much of this repo's work actually SURVIVED.
 *
 * The showcase signal nobody else puts on a repo report: from git history alone,
 * how many commits were later REVERTED or HOTFIXED (explicit `git revert` = proof;
 * a same-file regression repair within N days = a labelled weaker signal), and which
 * files churn-and-revert the most (the unstable hot zones). Deterministic, no LLM.
 *
 * Built on the shipped @mneme-ai/core revert_radar engine (revertGauntlet=100).
 */
import { git, isGitRepo } from "../util.js";
import { revertRadar } from "@mneme-ai/core";
import type { StabilityBlock } from "../types.js";

export function analyzeStability(repoPath: string, now: number, windowDays = 365): StabilityBlock {
  if (!isGitRepo(repoPath)) return { windowDays, commits: 0, didNotSurvive: 0, explicitReverts: 0, hotfixSignals: 0, survivalPct: 100, unstableFiles: [], note: "Not a git repository — stability history unavailable." };
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const raw = git(repoPath, ["log", "--since", since, "--no-merges", "--pretty=format:%x01%H%x1f%ct%x1f%s%x1f%b%x02", "--name-only"]);
  const commits: revertRadar.CommitLite[] = [];
  for (const block of String(raw).split("\x01").filter(Boolean)) {
    const [head = "", filesPart = ""] = block.split("\x02");
    const [sha = "", ct = "0", subject = "", body = ""] = head.split("\x1f");
    if (!sha) continue;
    const files = filesPart.split("\n").map((s) => s.trim()).filter(Boolean);
    commits.push({ sha, subject, body, agent: "unknown", files, ts: (Number(ct) || 0) * 1000 });
  }
  if (!commits.length) return { windowDays, commits: 0, didNotSurvive: 0, explicitReverts: 0, hotfixSignals: 0, survivalPct: 100, unstableFiles: [], note: "No commits in the window." };

  const reverts = revertRadar.detectReverts(commits, { windowDays: 30 });
  const undone = new Set(reverts.map((r) => r.sha));
  const explicitReverts = new Set(reverts.filter((r) => r.kind === "explicit-revert").map((r) => r.sha)).size;
  const hotfixSignals = reverts.filter((r) => r.kind === "hotfix-window").length;
  // unstable files: how often a file belonged to a commit that got undone
  const fileHits = new Map<string, number>();
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  for (const sha of undone) { for (const f of (bySha.get(sha)?.files ?? [])) fileHits.set(f, (fileHits.get(f) ?? 0) + 1); }
  const unstableFiles = [...fileHits.entries()].map(([file, reverts]) => ({ file, reverts })).sort((a, b) => b.reverts - a.reverts || a.file.localeCompare(b.file)).slice(0, 6);
  const survivalPct = Math.round(((commits.length - undone.size) / commits.length) * 100);
  return {
    windowDays, commits: commits.length, didNotSurvive: undone.size, explicitReverts, hotfixSignals, survivalPct, unstableFiles,
    note: undone.size ? `${undone.size} of ${commits.length} recent commits were later reverted/hotfixed (${survivalPct}% survived). Explicit reverts are proof; hotfix-window is a weaker signal.` : `All ${commits.length} recent commits survived — no reverts/hotfixes detected.`,
  };
}
