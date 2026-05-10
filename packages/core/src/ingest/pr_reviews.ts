/**
 * GitHub PR review comments scraper.
 *
 * Strategy: shell out to `gh api` (the user's own gh CLI auth) so we
 * never need an API token in env. Returns issue/review/body comments
 * grouped per PR. Best-effort -- silent on failure, never blocks.
 */

import { spawnSync } from "node:child_process";
import type { IngestedChunk, IngestStats } from "./types.js";

export interface ScraperOptions {
  /** GitHub repo slug "owner/name". Auto-detected from `git remote get-url origin` if omitted. */
  repo?: string;
  /** Max PRs to scrape (newest first). Default 50. */
  maxPRs?: number;
  /** Include CLOSED + MERGED PRs (default true) or just OPEN. */
  includeClosed?: boolean;
}

function detectRepo(repoRoot: string): string | null {
  try {
    const r = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot, encoding: "utf8", timeout: 5000,
    });
    if (r.status !== 0) return null;
    const url = (r.stdout ?? "").trim();
    // Accept SSH + HTTPS forms.
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    if (m) return `${m[1]}/${m[2]}`;
    return null;
  } catch { return null; }
}

function ghAvailable(): boolean {
  try {
    const r = spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 3000 });
    return r.status === 0;
  } catch { return false; }
}

interface PRComment {
  id: number;
  user?: { login?: string };
  created_at: string;
  body?: string;
  path?: string;
  commit_id?: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  url?: string;
  html_url?: string;
}

export async function scrapePRReviews(
  repoRoot: string,
  opts: ScraperOptions = {},
): Promise<{ chunks: IngestedChunk[]; stats: IngestStats }> {
  const startedAt = new Date().toISOString();
  const stats: IngestStats = {
    source: "pr-review", fetchedCount: 0, chunkCount: 0,
    startedAt, completedAt: startedAt, errors: [],
  };
  const chunks: IngestedChunk[] = [];

  if (!ghAvailable()) {
    stats.errors.push("`gh` CLI not on PATH -- install GitHub CLI to enable PR ingest");
    stats.completedAt = new Date().toISOString();
    return { chunks, stats };
  }

  const repo = opts.repo ?? detectRepo(repoRoot);
  if (!repo) {
    stats.errors.push("Could not detect github repo from `git remote get-url origin`");
    stats.completedAt = new Date().toISOString();
    return { chunks, stats };
  }

  const maxPRs = opts.maxPRs ?? 50;
  const stateFilter = opts.includeClosed === false ? "open" : "all";

  // 1. List PRs
  let prs: PullRequest[] = [];
  try {
    const r = spawnSync("gh", [
      "api", `repos/${repo}/pulls?state=${stateFilter}&per_page=${maxPRs}`,
    ], { encoding: "utf8", timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
    if (r.status !== 0) {
      stats.errors.push(`gh api list pulls failed: ${(r.stderr ?? "").trim().slice(0, 200)}`);
      stats.completedAt = new Date().toISOString();
      return { chunks, stats };
    }
    prs = JSON.parse(r.stdout ?? "[]") as PullRequest[];
  } catch (e) {
    stats.errors.push(`gh PR list parse: ${(e as Error).message}`);
    stats.completedAt = new Date().toISOString();
    return { chunks, stats };
  }
  stats.fetchedCount = prs.length;

  // 2. Per PR, fetch review comments + issue comments.
  for (const pr of prs) {
    const prNum = pr.number;
    // review comments (line-level)
    try {
      const r = spawnSync("gh", ["api", `repos/${repo}/pulls/${prNum}/comments?per_page=100`], {
        encoding: "utf8", timeout: 15000, maxBuffer: 20 * 1024 * 1024,
      });
      if (r.status === 0) {
        const list = JSON.parse(r.stdout ?? "[]") as PRComment[];
        for (const c of list) {
          if (!c.body || c.body.trim().length < 10) continue;
          chunks.push({
            id: `pr-review:${prNum}:${c.id}`,
            source: "pr-review",
            url: pr.html_url ? `${pr.html_url}#discussion_r${c.id}` : undefined,
            text: `[PR #${prNum} review on ${c.path ?? "?"} by ${c.user?.login ?? "unknown"}]\n${c.body.trim()}`,
            author: c.user?.login,
            createdAt: c.created_at,
            refs: c.commit_id ? { commits: [c.commit_id] } : undefined,
          });
          stats.chunkCount++;
        }
      }
    } catch { /* skip PR */ }
    // top-level issue comments
    try {
      const r = spawnSync("gh", ["api", `repos/${repo}/issues/${prNum}/comments?per_page=100`], {
        encoding: "utf8", timeout: 15000, maxBuffer: 20 * 1024 * 1024,
      });
      if (r.status === 0) {
        const list = JSON.parse(r.stdout ?? "[]") as PRComment[];
        for (const c of list) {
          if (!c.body || c.body.trim().length < 10) continue;
          chunks.push({
            id: `pr-review:${prNum}:issue-${c.id}`,
            source: "pr-review",
            url: pr.html_url ? `${pr.html_url}#issuecomment-${c.id}` : undefined,
            text: `[PR #${prNum} discussion by ${c.user?.login ?? "unknown"}]\n${c.body.trim()}`,
            author: c.user?.login,
            createdAt: c.created_at,
          });
          stats.chunkCount++;
        }
      }
    } catch { /* skip PR */ }
  }

  stats.completedAt = new Date().toISOString();
  return { chunks, stats };
}
