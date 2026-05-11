/**
 * Resolve the running Mneme version from disk (package.json), with the
 * env-var as a secondary source. NEVER falls back to a hard-coded
 * string -- those bit-rot the moment a new version ships (root cause
 * of bug #5: MCP server reporting "1.27.9" while CLI shows "1.43.0").
 *
 * Lookup order:
 *   1. process.env.npm_package_version (set when launched via `npm run`)
 *   2. Walk up from this module's directory looking for `package.json`
 *      with `"name": "@mneme-ai/core"`. That's the source of truth.
 *   3. Final fallback: literal string "0.0.0-unknown" -- chosen so it's
 *      OBVIOUSLY wrong when surfaced, instead of silently outdated.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function resolveMnemeVersion(): string {
  if (cached) return cached;
  const env = process.env["npm_package_version"];
  if (env && /^\d+\.\d+\.\d+/.test(env)) {
    cached = env;
    return env;
  }
  try {
    const here = fileURLToPath(import.meta.url);
    let dir = dirname(here);
    for (let i = 0; i < 10; i++) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; version?: string };
        if (parsed.name === "@mneme-ai/core" && typeof parsed.version === "string") {
          cached = parsed.version;
          return parsed.version;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  cached = "0.0.0-unknown";
  return cached;
}

/** For tests: clear the memoized value so a re-read happens. */
export function _resetMnemeVersionCache(): void { cached = null; }
