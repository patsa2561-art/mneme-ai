/**
 * Platform auto-detect + dispatch for `mneme bot`.
 *
 * Order of resolution:
 *   1. Explicit override (`name`).
 *   2. First adapter whose `detect()` returns matches=true.
 *   3. Null — caller must surface a friendly "no platform found" error.
 */

import { createGitHubAdapter } from "./github.js";
import { createGitLabAdapter } from "./gitlab.js";
import { createBitbucketAdapter } from "./bitbucket.js";
import type { PlatformAdapter } from "./types.js";

export type { PlatformAdapter, PlatformContext, PlatformPostInput, PlatformPostResult } from "./types.js";
export { createGitHubAdapter, parseGitHubRepo, parseGitHubPrNumber } from "./github.js";
export { createGitLabAdapter } from "./gitlab.js";
export { createBitbucketAdapter, detectBitbucketRepo } from "./bitbucket.js";

export type PlatformName = "github" | "gitlab" | "bitbucket";

export interface DetectPlatformOptions {
  /** Explicit override — skip detection. */
  name?: PlatformName;
  /** Pre-built adapters (testing seam). */
  adapters?: PlatformAdapter[];
}

/**
 * Pick the first matching platform adapter.  Pure-data — relies on each
 * adapter's `detect()` reading from `process.env` (or the test seam).
 */
export function detectPlatform(opts: DetectPlatformOptions = {}): PlatformAdapter | null {
  const adapters: PlatformAdapter[] = opts.adapters ?? [
    createGitHubAdapter(),
    createGitLabAdapter(),
    createBitbucketAdapter(),
  ];
  if (opts.name) {
    return adapters.find((a) => a.name === opts.name) ?? null;
  }
  for (const a of adapters) {
    if (a.detect().matches) return a;
  }
  return null;
}

/**
 * Build all adapters in their default order.  Useful for "show me the
 * detection table" CLI output, or for tests that want every adapter.
 */
export function buildAllAdapters(): PlatformAdapter[] {
  return [createGitHubAdapter(), createGitLabAdapter(), createBitbucketAdapter()];
}
