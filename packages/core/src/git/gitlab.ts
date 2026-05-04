/**
 * GitLab MR + issue body fetcher.
 *
 * Mirrors GitHubAdapter but speaks the GitLab REST v4 API. Same job: hydrate
 * commits with rich PR/issue text so retrieval has real "why" to chew on.
 *
 * Auth: read GITLAB_TOKEN from env, or accept it via opts.token. The token
 * never touches disk — process memory only.
 *
 * Rate limiting: GitLab.com allows 2,000 req/min authenticated. Self-hosted
 * varies. We respect Retry-After + exponential backoff on 429/5xx.
 *
 * Notes:
 *   - GitLab calls them "Merge Requests" (MR), not "Pull Requests".
 *   - Project ID can be a numeric id OR a URL-encoded path "owner%2Frepo".
 *   - GitLab subgroups are common (e.g. `group/sub/repo`) — we URL-encode the
 *     full path so they work without configuration.
 */
import type { Commit } from "../types.js";

export interface GitLabFetchOptions {
  /** owner/repo or owner/group/repo (will be URL-encoded). */
  projectPath: string;
  /** Personal access token (api scope). Read from GITLAB_TOKEN if absent. */
  token?: string;
  /** Override base URL for self-hosted. Default https://gitlab.com. */
  baseUrl?: string;
  /** Concurrent request cap. Default 4. */
  concurrency?: number;
  /** Per-request timeout (ms). Default 15_000. */
  timeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface MergeRequestInfo {
  iid: number;
  title: string;
  description: string;
  url: string;
  state: string;
  mergedAt?: string;
}

export interface GitLabIssueInfo {
  iid: number;
  title: string;
  description: string;
  url: string;
  state: string;
}

const DEFAULT_BASE = "https://gitlab.com";

export class GitLabAdapter {
  readonly source = "gitlab" as const;

  private readonly base: string;
  private readonly token?: string;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly projectPath: string;
  private readonly encodedPath: string;

  constructor(opts: GitLabFetchOptions) {
    if (!opts.projectPath) {
      throw new Error("GitLabAdapter requires { projectPath } (e.g. 'group/repo')");
    }
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.token = opts.token ?? process.env["GITLAB_TOKEN"];
    this.concurrency = Math.max(1, opts.concurrency ?? 4);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.projectPath = opts.projectPath.replace(/^\//, "").replace(/\.git$/, "");
    this.encodedPath = encodeURIComponent(this.projectPath);
  }

  async fetchMergeRequest(iid: number): Promise<MergeRequestInfo | null> {
    const json = await this.request<any>(
      `/api/v4/projects/${this.encodedPath}/merge_requests/${iid}`,
    );
    if (!json || isNotFound(json)) return null;
    return {
      iid: Number(json.iid),
      title: String(json.title ?? ""),
      description: String(json.description ?? ""),
      url: String(json.web_url ?? ""),
      state: String(json.state ?? ""),
      mergedAt: json.merged_at ?? undefined,
    };
  }

  async fetchIssue(iid: number): Promise<GitLabIssueInfo | null> {
    const json = await this.request<any>(
      `/api/v4/projects/${this.encodedPath}/issues/${iid}`,
    );
    if (!json || isNotFound(json)) return null;
    return {
      iid: Number(json.iid),
      title: String(json.title ?? ""),
      description: String(json.description ?? ""),
      url: String(json.web_url ?? ""),
      state: String(json.state ?? ""),
    };
  }

  /**
   * Hydrate commits in place. Skips commits without `prNumber` or with `prBody`.
   * In GitLab terminology `prNumber` actually means MR `iid`.
   */
  async hydrateCommits(
    commits: Commit[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
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
              const mr = await this.fetchMergeRequest(c.prNumber!);
              if (mr) {
                c.prTitle = mr.title;
                c.prBody = mr.description;
              }
            } catch {
              // best-effort hydration
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
      accept: "application/json",
      "user-agent": "mneme/0.1",
    };
    if (this.token) headers["private-token"] = this.token;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) {
          throw new Error(`GitLab API ${res.status} on ${path} after ${attempt} retries`);
        }
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        await sleep(backoffMs);
        return this.request(path, attempt + 1);
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitLab API ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isNotFound(json: any): boolean {
  if (!json || typeof json !== "object") return false;
  const msg = String(json.message ?? "").toLowerCase();
  return msg.includes("not found") || msg === "404";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
