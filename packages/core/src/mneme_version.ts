/**
 * Resolve the running Mneme version from disk (package.json), with the
 * env-var as a secondary source. NEVER falls back to a hard-coded
 * string -- those bit-rot the moment a new version ships.
 *
 * Bug history:
 *   - v1.43 bug #5: MCP server reporting "1.27.9" while CLI shows "1.43.0"
 *     (fixed by walking up for @mneme-ai/core package.json).
 *   - v2.19.41 N4: `mneme system upgrade --json '{"mode":"check"}'`
 *     reported current=0.0.0 because env was empty AND resolver only
 *     accepted @mneme-ai/core name. When MCP server runs from npm-global
 *     install, packages/mcp is a sibling of core under node_modules, not
 *     a parent -- walking up never found a "@mneme-ai/core" package.json.
 *
 * v2.19.43 lookup order (robust against npm-global install where sibling
 * packages don't have core as a parent):
 *   1. process.env.npm_package_version (set when launched via `npm run`)
 *   2. Walk up from this module's directory for ANY package.json whose
 *      name matches the Mneme family (@mneme-ai/{core,mcp,cli,embeddings,
 *      correlator}, or the umbrella mneme-ai). All 5 ship lock-step.
 *   3. Walk up for any package.json with a Mneme-shaped name (covers
 *      future families we add).
 *   4. Final fallback: literal "0.0.0-unknown" so the bad value is OBVIOUS.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

const MNEME_FAMILY = new Set([
  "@mneme-ai/core",
  "@mneme-ai/mcp",
  "@mneme-ai/cli",
  "@mneme-ai/embeddings",
  "@mneme-ai/correlator",
  "mneme-ai",
]);

function walkUpForPackageJson(startDir: string, accept: (name: string | undefined) => boolean): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; version?: string };
        if (typeof parsed.version === "string" && /^\d+\.\d+\.\d+/.test(parsed.version) && accept(parsed.name)) {
          return parsed.version;
        }
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveMnemeVersion(): string {
  if (cached) return cached;

  // 1) env var (npm run only)
  const env = process.env["npm_package_version"];
  if (env && /^\d+\.\d+\.\d+/.test(env)) {
    cached = env;
    return env;
  }

  // 2) walk up for ANY Mneme-family package.json
  try {
    const here = fileURLToPath(import.meta.url);
    const startDir = dirname(here);
    const familyHit = walkUpForPackageJson(startDir, (name) => !!name && MNEME_FAMILY.has(name));
    if (familyHit) { cached = familyHit; return familyHit; }

    // 3) widen the net to any Mneme-shaped name
    const anyHit = walkUpForPackageJson(startDir, (name) => !!name && (name.startsWith("@mneme-ai/") || name === "mneme-ai" || name === "mneme"));
    if (anyHit) { cached = anyHit; return anyHit; }
  } catch { /* fall through */ }

  cached = "0.0.0-unknown";
  return cached;
}

/** For tests: clear the memoized value so a re-read happens. */
export function _resetMnemeVersionCache(): void { cached = null; }
