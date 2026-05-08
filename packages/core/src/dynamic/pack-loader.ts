/**
 * Pack loader — read YAML packs from disk, validate, register.
 *
 * Sources, in priority order (later overrides earlier when ids collide):
 *   1. Bundled packs at <core>/packs/*.yml
 *   2. User packs at ~/.mneme/packs/*.yml
 *   3. Repo packs at <repo>/.mneme/packs/*.yml
 *
 * Design:
 *   • Loader is PURE: takes a file path or a YAML string, returns
 *     a structured result (no global state).
 *   • Caller (registry) handles aggregation across sources.
 *   • Errors are STRUCTURED — they include the source file, the
 *     YAML line number when available, and the Zod path.
 *   • One bad pack does NOT prevent other packs from loading.
 *
 * No dynamic code execution. Pack files are parsed as YAML data only.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as YAML from "yaml";
import { validatePack, type Pack, type PackValidationError } from "./pack-schema.js";

export interface PackLoadSuccess {
  ok: true;
  pack: Pack;
  source: string;
}

export interface PackLoadFailure {
  ok: false;
  source: string;
  /** Phase where failure occurred. */
  phase: "read" | "yaml-parse" | "schema-validate";
  /** Human-readable summary. */
  message: string;
  /** Detailed schema errors when phase=schema-validate. */
  errors?: PackValidationError[];
}

export type PackLoadResult = PackLoadSuccess | PackLoadFailure;

/**
 * Load a single pack from a YAML string.
 *
 * Pure function — no I/O. Useful for testing + for in-memory packs
 * (e.g. fetched from a registry over the network in future).
 */
export function loadPackFromString(yamlText: string, source = "<inline>"): PackLoadResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlText);
  } catch (err) {
    return {
      ok: false,
      source,
      phase: "yaml-parse",
      message: `Failed to parse YAML: ${(err as Error).message}`,
    };
  }
  // Empty file (parsed === null/undefined) = no pack data at all → yaml-parse phase.
  // Non-empty but wrong shape (array, scalar, etc.) → schema-validate so the user
  // sees the standard structured Zod error trail instead of a generic message.
  if (parsed === null || parsed === undefined) {
    return {
      ok: false,
      source,
      phase: "yaml-parse",
      message: "YAML file is empty or contains only null",
    };
  }
  const validated = validatePack(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      source,
      phase: "schema-validate",
      message: `Schema validation failed (${validated.errors.length} issue${validated.errors.length === 1 ? "" : "s"})`,
      errors: validated.errors,
    };
  }
  return { ok: true, pack: validated.pack, source };
}

/**
 * Load a single pack from a file path. Wraps loadPackFromString with
 * filesystem read + structured error reporting.
 */
export function loadPackFromFile(path: string): PackLoadResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return {
      ok: false,
      source: path,
      phase: "read",
      message: `Cannot read pack file: ${(err as Error).message}`,
    };
  }
  return loadPackFromString(text, path);
}

/**
 * List candidate pack files in a directory. Returns absolute paths.
 *
 * Looks for files matching *.yml or *.yaml (case-insensitive). Returns
 * empty array if directory doesn't exist or isn't readable. NEVER throws.
 */
export function listPackFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const name of entries) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isFile()) out.push(full);
  }
  return out.sort();
}

/**
 * Standard Mneme pack-search paths. Override via env vars for tests.
 *
 *   MNEME_BUNDLED_PACKS_DIR   — default: <core>/packs (resolved at runtime)
 *   MNEME_USER_PACKS_DIR      — default: ~/.mneme/packs
 *   MNEME_REPO_PACKS_DIR_NAME — relative dir under repo root, default ".mneme/packs"
 */
export interface PackSearchPaths {
  bundled?: string;
  user: string;
  repo: string;
}

export function getDefaultPackSearchPaths(repoRoot: string, bundledDirOverride?: string): PackSearchPaths {
  return {
    bundled: process.env["MNEME_BUNDLED_PACKS_DIR"] ?? bundledDirOverride,
    user: process.env["MNEME_USER_PACKS_DIR"] ?? join(homedir(), ".mneme", "packs"),
    repo: join(repoRoot, process.env["MNEME_REPO_PACKS_DIR_NAME"] ?? ".mneme", "packs"),
  };
}

export interface RegistryLoadResult {
  packs: Pack[];
  failures: PackLoadFailure[];
  /** Sources visited (debug aid). */
  sourcesScanned: string[];
}

/**
 * Load every pack discoverable from the standard search paths.
 *
 * Resolution rules:
 *   • Same pack id from multiple sources → repo overrides user overrides bundled.
 *   • Failures DON'T block successful packs from loading.
 *   • Returns the full failure list so the caller can surface them.
 *
 * NEVER throws.
 */
export function loadAllPacks(paths: PackSearchPaths): RegistryLoadResult {
  const seen = new Map<string, { pack: Pack; source: string; priority: number }>();
  const failures: PackLoadFailure[] = [];
  const sourcesScanned: string[] = [];

  // Priority: bundled (0) < user (1) < repo (2). Higher priority wins.
  const sources: Array<{ dir: string | undefined; priority: number }> = [
    { dir: paths.bundled, priority: 0 },
    { dir: paths.user, priority: 1 },
    { dir: paths.repo, priority: 2 },
  ];

  for (const { dir, priority } of sources) {
    if (!dir) continue;
    sourcesScanned.push(dir);
    const files = listPackFiles(dir);
    for (const file of files) {
      const result = loadPackFromFile(file);
      if (!result.ok) {
        failures.push(result);
        continue;
      }
      const existing = seen.get(result.pack.id);
      if (!existing || priority >= existing.priority) {
        seen.set(result.pack.id, { pack: result.pack, source: file, priority });
      }
    }
  }

  return {
    packs: Array.from(seen.values()).map((v) => v.pack),
    failures,
    sourcesScanned,
  };
}
