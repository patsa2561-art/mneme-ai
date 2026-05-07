/**
 * GitLab MR comment integration for `mneme bot`.
 *
 * Posts to `/projects/:id/merge_requests/:iid/notes` using a GitLab PAT
 * via the `PRIVATE-TOKEN` header.
 *
 * GitLab's CI exposes `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`, and either
 * `GITLAB_TOKEN` (custom) or `CI_JOB_TOKEN` (project-scoped, MR API may
 * be limited).  We surface a clear error if no usable token is present.
 */

import type { PlatformAdapter, PlatformPostInput, PlatformPostResult } from "./types.js";

export interface GitLabAdapterDeps {
  fetcher?: typeof fetch;
  /** Override the API base — useful for self-hosted GitLab. */
  apiBase?: string;
}

export function createGitLabAdapter(deps: GitLabAdapterDeps = {}): PlatformAdapter {
  const fetcher = deps.fetcher ?? globalThis.fetch;
  const apiBase = (
    deps.apiBase ?? process.env.CI_API_V4_URL ?? "https://gitlab.com/api/v4"
  ).replace(/\/+$/, "");

  return {
    name: "gitlab",
    detect(): { matches: boolean; reason: string } {
      if (process.env.GITLAB_CI === "true") return { matches: true, reason: "GITLAB_CI=true" };
      if (process.env.CI_PROJECT_ID) return { matches: true, reason: "CI_PROJECT_ID set" };
      return { matches: false, reason: "GITLAB_CI not set" };
    },
    resolveContext() {
      const prRaw =
        process.env.CI_MERGE_REQUEST_IID ?? process.env.GITLAB_MR_IID ?? undefined;
      const pr = prRaw !== undefined && prRaw !== "" ? Number(prRaw) : undefined;
      return {
        repo: process.env.CI_PROJECT_ID ?? process.env.CI_PROJECT_PATH ?? undefined,
        pr: Number.isFinite(pr) ? (pr as number) : undefined,
        token: process.env.GITLAB_TOKEN ?? process.env.CI_JOB_TOKEN ?? undefined,
      };
    },
    async post(input: PlatformPostInput): Promise<PlatformPostResult> {
      if (!input.repo) {
        return { ok: false, error: "GitLab project id missing — set CI_PROJECT_ID or pass --repo" };
      }
      if (!input.pr) {
        return { ok: false, error: "MR IID missing — set CI_MERGE_REQUEST_IID or pass --pr" };
      }
      if (!input.token) {
        return {
          ok: false,
          error: "GITLAB_TOKEN missing — set the env var or pass --dry-run to skip posting",
        };
      }
      const projectId = encodeURIComponent(input.repo);
      const url = `${apiBase}/projects/${projectId}/merge_requests/${input.pr}/notes`;
      try {
        const res = await fetcher(url, {
          method: "POST",
          headers: {
            "PRIVATE-TOKEN": input.token,
            "Content-Type": "application/json",
            "User-Agent": "mneme-ai-bot",
          },
          body: JSON.stringify({ body: input.body }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            statusCode: res.status,
            error: `GitLab API ${res.status}: ${text.slice(0, 200)}`,
          };
        }
        const json = (await res.json().catch(() => ({}))) as { id?: number };
        return {
          ok: true,
          statusCode: res.status,
          url: json.id ? `${apiBase}/projects/${projectId}/merge_requests/${input.pr}#note_${json.id}` : undefined,
        };
      } catch (err) {
        return { ok: false, error: `network error: ${(err as Error).message}` };
      }
    },
  };
}
