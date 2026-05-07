/**
 * `mneme bot` — auto-comment on pull/merge requests across CI platforms.
 *
 * The pitch: you already run `mneme audit`, `mneme atrophy`, `mneme ghost`
 * etc. locally.  This module assembles their JSON outputs into a single
 * pull-request comment and posts it via the right platform's REST API
 * (GitHub / GitLab / Bitbucket).
 *
 * Vendor-neutral.  Auto-detects the CI environment and the appropriate
 * token / PR number from environment variables.  Falls back to a
 * `--dry-run` mode that prints the rendered Markdown without posting,
 * so the same code path runs offline.
 *
 * Pure-data composition: `comment.ts` is a deterministic Markdown
 * formatter.  `platforms/*` wraps `fetch` calls behind a small interface.
 */
export * from "./comment.js";
export * from "./platforms/index.js";
