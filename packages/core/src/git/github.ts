/**
 * GitHub PR + issue body fetcher.
 *
 * The single biggest accuracy improvement for archeology questions: most of
 * the WHY behind a commit lives in the PR description, not the commit message.
 * This module hydrates each commit's pr_title / pr_body / issue_body fields
 * by calling the GitHub REST API.
 *
 * Auth: read GITHUB_TOKEN from env, or accept it via opts.token. The token
 * is never persisted; it lives in process memory only.
 *
 * Rate limiting: GitHub allows 5,000 req/hr authenticated, 60/hr anonymous.
 * We respect Retry-After + use exponential backoff on 429/5xx.
 */
import type { Commit } from "../types.js";

export interface GitHubFetchOptions {
  owner: string;
  repo: string;
  /** Personal access token. If absent, uses anonymous (60 req/hr cap). */
  token?: string;
  /** Override base URL for GitHub Enterprise. Default https://api.github.com. */
  baseUrl?: string;
  /** Concurrent request cap. Default 4. */
  concurrency?: number;
  /** Per-request timeout (ms). Default 15000. */
  timeoutMs?: number;
  /** Optional progress callback. */
  onProgress?: (done: number, total: number) => void;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  mergedAt?: string;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
}

const DEFAULT_BASE = "https://api.github.com";

export class GitHubAdapter {
  private readonly base: string;
  private readonly token?: string;
  private readonly concurrency: number;
  private readonly timeoutMs: number;

  constructor(opts: GitHubFetchOptions) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.token = opts.token ?? process.env["GITHUB_TOKEN"];
    this.concurrency = Math.max(1, opts.concurrency ?? 4);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (!opts.owner || !opts.repo) {
      throw new Error("GitHubAdapter requires { owner, repo }");
    }
    this.owner = opts.owner;
    this.repo = opts.repo;
  }

  private readonly owner: string;
  private readonly repo: string;

  async fetchPullRequest(num: number): Promise<PullRequestInfo | null> {
    const json = await this.request<any>(`/repos/${this.owner}/${this.repo}/pulls/${num}`);
    if (!json || json.message === "Not Found") return null;
    return {
      number: json.number,
      title: json.title ?? "",
      body: json.body ?? "",
      url: json.html_url ?? "",
      state: json.state ?? "",
      mergedAt: json.merged_at ?? undefined,
    };
  }

  async fetchIssue(num: number): Promise<IssueInfo | null> {
    const json = await this.request<any>(`/repos/${this.owner}/${this.repo}/issues/${num}`);
    if (!json || json.message === "Not Found") return null;
    return {
      number: json.number,
      title: json.title ?? "",
      body: json.body ?? "",
      url: json.html_url ?? "",
      state: json.state ?? "",
    };
  }

  /**
   * Hydrate an array of commits with PR title/body in place.
   * Skips commits that already have prBody, or have no prNumber.
   */
  async hydrateCommits(commits: Commit[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const targets = commits.filter((c) => c.prNumber && !c.prBody);
    let done = 0;
    const queue = [...targets];
    const workers: Promise<void>[] = [];
    for (let w = 0; w < this.concurrency; w++) {
      workers.push(
        (async () => {
          while (queue.length) {
            const c = queue.shift();
            if (!c) break;
            try {
              const pr = await this.fetchPullRequest(c.prNumber!);
              if (pr) {
                c.prTitle = pr.title;
                c.prBody = pr.body;
              }
            } catch {
              // best-effort hydration; skip failures, keep going
            }
            done++;
            onProgress?.(done, targets.length);
          }
        })(),
      );
    }
    await Promise.all(workers);
  }

  private async request<T>(path: string, attempt = 0): Promise<T | null> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "mneme/0.1",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) {
          throw new Error(`GitHub API ${res.status} on ${path} after ${attempt} retries`);
        }
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        await sleep(backoffMs);
        return this.request(path, attempt + 1);
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
