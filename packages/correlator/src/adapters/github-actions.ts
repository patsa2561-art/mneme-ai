/**
 * GitHub Actions failure adapter.
 *
 *   GET /repos/{owner}/{repo}/actions/runs?status=failure&per_page=100
 *
 * Maps each failed workflow run to an `Incident`. Useful for repos that don't
 * have a paid observability stack but DO have CI: a failed deploy or test run
 * IS an incident.
 *
 *   • title:      workflow name + run number + head commit subject
 *   • occurredAt: run.run_started_at
 *   • severity:   "error" (always — these are red CI runs)
 *   • affectedFiles: pulled from the run's commit if available
 *   • url:        run.html_url
 */
import type { Incident, correlate as CorrelateNS } from "@mneme-ai/core";

export interface GitHubActionsAdapterOptions {
  owner: string;
  repo: string;
  /** Token with `actions:read` and `contents:read`. Use a fine-grained PAT or installation token. */
  token: string;
  baseUrl?: string;
  /** Cap on runs fetched. Default 1000. */
  maxRuns?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** Filter to a single workflow file (e.g. "deploy.yml"). */
  workflow?: string;
}

const DEFAULT_BASE = "https://api.github.com";

export class GitHubActionsAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "github" as const;

  private readonly base: string;
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly maxRuns: number;
  private readonly timeoutMs: number;
  private readonly workflow?: string;

  constructor(opts: GitHubActionsAdapterOptions) {
    if (!opts.owner) throw new Error("GitHubActionsAdapter requires owner");
    if (!opts.repo) throw new Error("GitHubActionsAdapter requires repo");
    if (!opts.token) throw new Error("GitHubActionsAdapter requires token");
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.token = opts.token;
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.maxRuns = Math.max(1, opts.maxRuns ?? 1000);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.workflow = opts.workflow;
  }

  async fetch(opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    const params = new URLSearchParams({
      status: "failure",
      per_page: "100",
    });
    if (opts.since) params.set("created", `>=${opts.since}`);

    const path = this.workflow
      ? `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(this.workflow)}/runs`
      : `/repos/${this.owner}/${this.repo}/actions/runs`;

    const out: Incident[] = [];
    let page = 1;
    while (out.length < this.maxRuns) {
      const url = `${this.base}${path}?${params.toString()}&page=${page}`;
      const json = await this.request<GhRunsResponse>(url);
      if (!json || !json.workflow_runs?.length) break;
      for (const run of json.workflow_runs) {
        out.push(this.mapRun(run));
        if (out.length >= this.maxRuns) break;
      }
      if (json.workflow_runs.length < 100) break;
      page++;
    }
    return out;
  }

  private async request<T>(url: string, attempt = 0): Promise<T | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "mneme/0.1",
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error(`GitHub API ${res.status} after ${attempt} retries`);
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        await new Promise((r) => setTimeout(r, backoff));
        return this.request(url, attempt + 1);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GitHub API ${res.status}: ${txt.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapRun(run: GhRun): Incident {
    const id = `github-actions:${run.id}`;
    const title = `${run.name} #${run.run_number}: ${run.display_title ?? "(no title)"}`;
    const affectedFiles: string[] = [];
    if (run.head_commit?.message) {
      // Heuristic: if the commit message references files, pull them out.
      const m = run.head_commit.message.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php)/g);
      if (m) affectedFiles.push(...m);
    }
    return {
      id,
      source: "github",
      externalId: String(run.id),
      title: title.slice(0, 240),
      occurredAt: run.run_started_at ?? run.created_at,
      severity: "error",
      affectedFiles: affectedFiles.length ? Array.from(new Set(affectedFiles)) : undefined,
      url: run.html_url,
      metadata: {
        workflow: run.name,
        runNumber: run.run_number,
        headBranch: run.head_branch,
        headSha: run.head_sha,
        event: run.event,
      },
    };
  }
}

interface GhRunsResponse {
  total_count?: number;
  workflow_runs: GhRun[];
}

interface GhRun {
  id: number;
  name: string;
  display_title?: string;
  run_number: number;
  status?: string;
  conclusion?: string;
  head_branch: string;
  head_sha: string;
  event?: string;
  run_started_at?: string;
  created_at: string;
  html_url: string;
  head_commit?: { message?: string };
}
