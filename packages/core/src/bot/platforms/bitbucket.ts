/**
 * Bitbucket PR comment integration for `mneme bot`.
 *
 * Bitbucket Cloud REST API:
 *   POST /2.0/repositories/:workspace/:slug/pullrequests/:id/comments
 * with `{ "content": { "raw": <markdown> } }`.
 *
 * Auth uses Basic auth: `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`,
 * or a Bearer token (`BITBUCKET_TOKEN`) for OAuth.  We accept either.
 */

import type { PlatformAdapter, PlatformPostInput, PlatformPostResult } from "./types.js";

/** Pick up Bitbucket Pipelines' standard env vars. */
export function detectBitbucketRepo(): string | undefined {
  const ws = process.env.BITBUCKET_WORKSPACE;
  const slug = process.env.BITBUCKET_REPO_SLUG;
  if (ws && slug) return `${ws}/${slug}`;
  return process.env.BITBUCKET_REPO_FULL_NAME;
}

export interface BitbucketAdapterDeps {
  fetcher?: typeof fetch;
  apiBase?: string;
}

export function createBitbucketAdapter(deps: BitbucketAdapterDeps = {}): PlatformAdapter {
  const fetcher = deps.fetcher ?? globalThis.fetch;
  const apiBase = (deps.apiBase ?? "https://api.bitbucket.org/2.0").replace(/\/+$/, "");

  return {
    name: "bitbucket",
    detect(): { matches: boolean; reason: string } {
      if (process.env.BITBUCKET_BUILD_NUMBER) {
        return { matches: true, reason: "BITBUCKET_BUILD_NUMBER set" };
      }
      if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG) {
        return { matches: true, reason: "BITBUCKET_WORKSPACE + BITBUCKET_REPO_SLUG set" };
      }
      return { matches: false, reason: "BITBUCKET_BUILD_NUMBER not set" };
    },
    resolveContext() {
      const prRaw = process.env.BITBUCKET_PR_ID ?? undefined;
      const pr = prRaw !== undefined && prRaw !== "" ? Number(prRaw) : undefined;
      return {
        repo: detectBitbucketRepo(),
        pr: Number.isFinite(pr) ? (pr as number) : undefined,
        token:
          process.env.BITBUCKET_TOKEN ??
          (process.env.BITBUCKET_USERNAME && process.env.BITBUCKET_APP_PASSWORD
            ? `${process.env.BITBUCKET_USERNAME}:${process.env.BITBUCKET_APP_PASSWORD}`
            : undefined),
      };
    },
    async post(input: PlatformPostInput): Promise<PlatformPostResult> {
      if (!input.repo) {
        return { ok: false, error: "Bitbucket repo missing — expected workspace/slug, set BITBUCKET_WORKSPACE + BITBUCKET_REPO_SLUG or pass --repo" };
      }
      if (!input.pr) {
        return { ok: false, error: "PR ID missing — set BITBUCKET_PR_ID or pass --pr" };
      }
      if (!input.token) {
        return {
          ok: false,
          error: "BITBUCKET_TOKEN missing (or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD) — set the env vars or pass --dry-run to skip posting",
        };
      }
      const url = `${apiBase}/repositories/${input.repo}/pullrequests/${input.pr}/comments`;
      const auth = input.token.includes(":")
        ? `Basic ${Buffer.from(input.token, "utf8").toString("base64")}`
        : `Bearer ${input.token}`;
      try {
        const res = await fetcher(url, {
          method: "POST",
          headers: {
            "Authorization": auth,
            "Content-Type": "application/json",
            "User-Agent": "mneme-ai-bot",
            "Accept": "application/json",
          },
          body: JSON.stringify({ content: { raw: input.body } }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            statusCode: res.status,
            error: `Bitbucket API ${res.status}: ${text.slice(0, 200)}`,
          };
        }
        const json = (await res.json().catch(() => ({}))) as { id?: number; links?: { html?: { href?: string } } };
        return { ok: true, statusCode: res.status, url: json.links?.html?.href };
      } catch (err) {
        return { ok: false, error: `network error: ${(err as Error).message}` };
      }
    },
  };
}
