/**
 * v1.70.0 -- PRECOG P1: PACKAGE VERIFIER.
 *
 * Catch the most common AI fabrication: "we use X package" where X
 * is hallucinated. Extracts package references from prose:
 *
 *   1. `pkg@version` form
 *   2. `import ... from "pkg"` style
 *   3. `npm install pkg` style
 *   4. quoted package names in prose ("uses 'lodash'")
 *
 * Cross-checks against:
 *   - package.json {dependencies, devDependencies, peerDependencies}
 *   - workspace patterns from package.json#workspaces
 *   - HEURISTIC npm-name validity (npm registry naming rules)
 *
 * Returns suspect packages + the specific rule that flagged them.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PKG_AT_VERSION = /\b([@a-z0-9][\w@./-]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/gi;
const IMPORT_FROM = /(?:from|require)\s*\(?\s*["']([^"']+)["']/g;
const NPM_INSTALL = /\bnpm\s+(?:install|i|add)\s+([\w@./-]+)/g;
// v1.70 -- bare prose package-shape (3+ hyphenated segments).
// Catches "wraith-utils-2099", "phantom-fake-9999" without @version
// or import syntax. Anchored to lowercase + hyphens to reduce FP on
// natural-language hyphenated phrases.
const PROSE_PKG_SHAPE = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+){2,})\b/g;

export interface PackageRef {
  /** Package name as it appears. */
  name: string;
  /** Optional version captured. */
  version?: string;
  /** How we found it. */
  source: "pkg-at-version" | "import-from" | "npm-install" | "prose-shape";
  offset: number;
}

export interface PackageSuspect {
  ref: PackageRef;
  reason: string;
  /** 0..1; higher = stronger suspicion. */
  confidence: number;
}

export interface PackageVerifyReport {
  refs: PackageRef[];
  /** Packages whose existence we couldn't confirm. */
  suspects: PackageSuspect[];
  /** Packages confirmed in package.json. */
  confirmed: string[];
  /** Plain-English. */
  headline: string;
}

const NPM_NAME_VALID = /^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i;

function loadKnownDeps(repoRoot: string): Set<string> {
  const deps = new Set<string>();
  const p = join(repoRoot, "package.json");
  if (!existsSync(p)) return deps;
  try {
    const pkg = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const obj = pkg[key] as Record<string, unknown> | undefined;
      if (obj) for (const name of Object.keys(obj)) deps.add(name);
    }
    // Also bring in workspace package names so internal references resolve.
    const wsRaw = pkg["workspaces"];
    if (Array.isArray(wsRaw)) {
      for (const ws of wsRaw) {
        if (typeof ws === "string" && !ws.includes("*")) deps.add(ws);
      }
    }
  } catch { /* */ }
  return deps;
}

export function extractPackageRefs(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  const seen = new Set<string>();
  const push = (ref: PackageRef) => {
    const key = `${ref.source}|${ref.name}|${ref.version ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const m of text.matchAll(PKG_AT_VERSION)) {
    push({ name: m[1]!, version: m[2]!, source: "pkg-at-version", offset: m.index ?? 0 });
  }
  for (const m of text.matchAll(IMPORT_FROM)) {
    const raw = m[1]!;
    // Take top-level segment (e.g. @scope/pkg or pkg from pkg/sub/path).
    const top = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0]!;
    if (top && !top.startsWith(".") && !top.startsWith("/")) {
      push({ name: top, source: "import-from", offset: m.index ?? 0 });
    }
  }
  for (const m of text.matchAll(NPM_INSTALL)) {
    push({ name: m[1]!, source: "npm-install", offset: m.index ?? 0 });
  }
  // Prose-shape: only catch when other extractors didn't already match.
  // Most code-y phrases like "node-modules", "package-lock" are skipped by
  // the 3-segment requirement; but we whitelist a few obvious non-packages.
  const FALSE_POSITIVE_PROSE = new Set(["package-lock-json", "tsconfig-build-json", "single-page-app"]);
  for (const m of text.matchAll(PROSE_PKG_SHAPE)) {
    const name = m[1]!;
    if (FALSE_POSITIVE_PROSE.has(name)) continue;
    const offset = m.index ?? 0;
    push({ name, source: "prose-shape", offset });
  }
  return out;
}

const BUILTIN_NODE_MODULES = new Set([
  "node:fs", "node:path", "node:os", "node:crypto", "node:child_process",
  "node:http", "node:https", "node:url", "node:util", "node:events", "node:stream",
  "node:buffer", "node:zlib", "node:assert", "node:test", "node:net", "node:tls",
  "node:dns", "node:querystring", "node:readline", "node:worker_threads",
  "node:perf_hooks", "node:vm", "node:timers", "node:console",
  // legacy non-prefixed forms
  "fs", "path", "os", "crypto", "child_process", "http", "https", "url", "util",
  "events", "stream", "buffer", "zlib", "assert", "net", "tls", "dns",
  "querystring", "readline", "worker_threads", "perf_hooks", "vm", "timers",
  "console",
]);

export function verifyPackages(repoRoot: string, text: string): PackageVerifyReport {
  const refs = extractPackageRefs(text);
  const known = loadKnownDeps(repoRoot);
  const suspects: PackageSuspect[] = [];
  const confirmed: string[] = [];
  for (const ref of refs) {
    // Suspicious future version BEATS name-confirmation -- if someone
    // claims typescript@99.5.0, the package exists but the version is fab.
    if (ref.version && /^([89]\d|\d{3,})\./.test(ref.version)) {
      suspects.push({ ref, reason: `Suspicious future version ${ref.version} on package "${ref.name}"`, confidence: 0.75 });
      continue;
    }
    if (BUILTIN_NODE_MODULES.has(ref.name.toLowerCase())) {
      confirmed.push(ref.name);
      continue;
    }
    if (known.has(ref.name)) {
      confirmed.push(ref.name);
      continue;
    }
    // Validity heuristics.
    if (!NPM_NAME_VALID.test(ref.name)) {
      suspects.push({ ref, reason: `Invalid npm package name shape: "${ref.name}"`, confidence: 0.85 });
      continue;
    }
    // Not in deps + not built-in -> NOT necessarily a lie, but flag at low confidence.
    suspects.push({
      ref,
      reason: `Package "${ref.name}" not in package.json dependencies (could be a hallucinated reference).`,
      confidence: ref.source === "pkg-at-version" ? 0.7 : 0.55,
    });
  }
  const headline = `${refs.length} package ref(s); ${confirmed.length} confirmed, ${suspects.length} suspect.`;
  return { refs, suspects, confirmed, headline };
}
