/**
 * GitHub PR comment integration for `mneme bot`.
 *
 * Uses `fetch` (Node 18+ built-in).  No SDK dependency.  Posts a comment
 * via `POST /repos/:owner/:repo/issues/:number/comments`.
 */

import type { PlatformPostInput, PlatformPostResult, PlatformAdapter } from "./types.js";

/**
 * Parse a `GITHUB_REPOSITORY` value (`owner/repo`) into its parts.
 * Returns null on malformed input — caller decides how to surface the error.
 */
export function parseGitHubRepo(repo: string | undefined): { owner: string; name: string } | null {
  if (!repo) return null;
  const m = repo.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1]!, name: m[2]! };
}

/**
 * Resolve the PR number from a `GITHUB_REF` value.  PR refs look like
 * `refs/pull/123/merge` or `refs/pull/123/head`.  Returns null if the ref
 * isn't a PR ref.
 */
export function parseGitHubPrNumber(ref: string | undefined): number | null {
  if (!ref) return null;
  const m = ref.match(/^refs\/pull\/(\d+)\/(merge|head)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export interface GitHubAdapterDeps {
  /** Injectable for tests; defaults to globalThis.fetch. */
  fetcher?: typeof fetch;
  /** Override the API base — useful for GitHub Enterprise. */
  apiBase?: string;
}

export function createGitHubAdapter(deps: GitHubAdapterDeps = {}): PlatformAdapter {
  const fetcher = deps.fetcher ?? globalThis.fetch;
  const apiBase = (deps.apiBase ?? process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");

  return {
    name: "github",
    detect(): { matches: boolean; reason: string } {
      if (process.env.GITHUB_ACTIONS === "true") return { matches: true, reason: "GITHUB_ACTIONS=true" };
      if (process.env.GITHUB_REPOSITORY) return { matches: true, reason: "GITHUB_REPOSITORY set" };
      return { matches: false, reason: "GITHUB_ACTIONS not set" };
    },
    resolveContext() {
      return {
        repo: process.env.GITHUB_REPOSITORY,
        pr: parseGitHubPrNumber(process.env.GITHUB_REF) ?? undefined,
        token: process.env.GITHUB_TOKEN,
      };
    },
    async post(input: PlatformPostInput): Promise<PlatformPostResult> {
      const parsed = parseGitHubRepo(input.repo);
      if (!parsed) {
        return { ok: false, error: `invalid GitHub repo: ${input.repo ?? "(missing)"}` };
      }
      if (!input.pr) {
        return { ok: false, error: "PR number missing — set --pr or run inside a pull_request event" };
      }
      if (!input.token) {
        return {
          ok: false,
          error: "GITHUB_TOKEN missing — set the env var or pass --dry-run to skip posting",
        };
      }
      const url = `${apiBase}/repos/${parsed.owner}/${parsed.name}/issues/${input.pr}/comments`;
      try {
        const res = await fetcher(url, {
          method: "POST",
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${input.token}`,
            "Content-Type": "application/json",
            "User-Agent": "mneme-ai-bot",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ body: input.body }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            statusCode: res.status,
            error: `GitHub API ${res.status}: ${text.slice(0, 200)}`,
          };
        }
        const json = (await res.json().catch(() => ({}))) as { html_url?: string };
        return { ok: true, statusCode: res.status, url: json.html_url };
      } catch (err) {
        return { ok: false, error: `network error: ${(err as Error).message}` };
      }
    },
  };
}
