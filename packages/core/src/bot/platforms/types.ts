/**
 * Shared types for `mneme bot` platform adapters.
 */

export interface PlatformPostInput {
  /** Repo identifier — platform-specific format (e.g. "owner/repo" on GitHub). */
  repo: string | undefined;
  /** PR / MR number. */
  pr: number | undefined;
  /** API token (Bearer / PAT). */
  token: string | undefined;
  /** Markdown body to post. */
  body: string;
}

export interface PlatformPostResult {
  ok: boolean;
  /** HTTP status code, when available. */
  statusCode?: number;
  /** URL of the posted comment, when available. */
  url?: string;
  /** Human-readable error message on failure. */
  error?: string;
}

export interface PlatformContext {
  /** Repo identifier (platform-specific format). */
  repo?: string;
  /** PR / MR number, when detectable from the env. */
  pr?: number;
  /** Token, when present in the env. */
  token?: string;
}

export interface PlatformAdapter {
  name: "github" | "gitlab" | "bitbucket";
  /** True if this CI platform's signature env vars are present. */
  detect(): { matches: boolean; reason: string };
  /** Best-effort context extraction from process.env. */
  resolveContext(): PlatformContext;
  /** Post a comment.  Never throws — returns a structured result instead. */
  post(input: PlatformPostInput): Promise<PlatformPostResult>;
}
