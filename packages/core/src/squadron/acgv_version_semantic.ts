/**
 * v2.36.0 — ACGV Layer 0d: VERSION-SEMANTIC DETECTOR.
 *
 * Closes audit-card bug #1: `mneme verify "Mneme v2.28.1 introduces X"`
 * → REFUTED 57% when repo has moved on to v2.35.0+. The verifier was
 * "correct" but the semantics were wrong — the claim is HISTORICAL,
 * not a present-tense assertion about the current state. Refuting it
 * by comparing against the current state is a category error.
 *
 * Layer 0d scans for `Mneme vN.M.P` / `version N.M.P` patterns + compares
 * to the currently installed version. Three classes:
 *
 *   current   — claim version == installed version   → pass through normally
 *   historical — claim version <  installed          → HISTORICAL_CLAIM caveat
 *                                                      + advisory verdict
 *   future    — claim version >  installed          → FUTURE_VERSION_CLAIM caveat
 *                                                      + needs-data verdict
 *
 * No regex on version-less claims — pure no-op when no version pattern
 * matches, so this layer is invisible for the 99% case.
 *
 * Wrapped in defensive try/catch — version parsing failures NEVER
 * throw, they downgrade to "unknown" + skip the layer.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type VersionClass = "current" | "historical" | "future" | "unknown";

export interface VersionMatch {
  /** Original substring (e.g. "v2.28.1" or "2.28.1"). */
  matched: string;
  /** Parsed major.minor.patch as a tuple. */
  major: number;
  minor: number;
  patch: number;
  /** Position in claim. */
  index: number;
}

export interface VersionSemanticVerdict {
  /** Did we find any version pattern at all? */
  matched: boolean;
  /** All version matches in the claim. */
  matches: VersionMatch[];
  /** Currently installed Mneme version (read from package.json). null = couldn't read. */
  installedVersion: string | null;
  /** Dominant class across all matches (worst-first: future > historical > current > unknown). */
  classification: VersionClass;
  /** Plain-English reason. */
  reason: string;
}

// Matches "v1.2.3", "version 1.2.3", "Mneme v1.2.3", "Mneme 1.2.3"
// Word-boundary on left + lookahead on right so we don't match middle of longer hex.
const VERSION_RX = /(?<![\w.])(?:[Vv]|version\s+|[Mm]neme\s+v?)?\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])/g;

function safeReadInstalledVersion(repoRoot: string): string | null {
  // Try multiple candidate paths in priority order so we cover both
  // npm-installed + monorepo + global-link scenarios.
  const candidates = [
    join(repoRoot, "node_modules", "mneme-ai", "package.json"),
    join(repoRoot, "package.json"),
    join(repoRoot, "packages", "cli", "package.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const obj = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
      // Only accept package.json entries that look like Mneme's.
      if (typeof obj.version !== "string") continue;
      if (obj.name && !/(^|@)mneme-ai|^@mneme-ai\//.test(obj.name)) continue;
      return obj.version;
    } catch { /* try next */ }
  }
  return null;
}

function compareVersions(a: VersionMatch, b: { major: number; minor: number; patch: number }): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function classifyMatch(m: VersionMatch, installed: string | null): VersionClass {
  if (!installed) return "unknown";
  const parts = installed.split(".").map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "unknown";
  const cmp = compareVersions(m, { major: parts[0]!, minor: parts[1]!, patch: parts[2]! });
  if (cmp === 0) return "current";
  return cmp < 0 ? "historical" : "future";
}

export function detectVersionSemantic(claim: string, repoRoot: string): VersionSemanticVerdict {
  try {
    const installed = safeReadInstalledVersion(repoRoot);
    const matches: VersionMatch[] = [];
    for (const m of claim.matchAll(VERSION_RX)) {
      const major = parseInt(m[1]!, 10);
      const minor = parseInt(m[2]!, 10);
      const patch = parseInt(m[3]!, 10);
      if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) continue;
      matches.push({ matched: m[0]!.trim(), major, minor, patch, index: m.index ?? 0 });
    }
    if (matches.length === 0) {
      return {
        matched: false, matches: [], installedVersion: installed,
        classification: "unknown",
        reason: "no version pattern detected in claim",
      };
    }
    // Compute classes per match, pick worst (most concerning class).
    const classes = matches.map((m) => classifyMatch(m, installed));
    let dominant: VersionClass = "unknown";
    if (classes.includes("future")) dominant = "future";
    else if (classes.includes("historical")) dominant = "historical";
    else if (classes.includes("current")) dominant = "current";
    return {
      matched: true,
      matches,
      installedVersion: installed,
      classification: dominant,
      reason: dominant === "historical"
        ? `claim cites version(s) PAST → installed ${installed} ahead; refuting against current state would be a category error`
        : dominant === "future"
        ? `claim cites version(s) AHEAD → installed ${installed} is older; cannot verify against state that doesn't exist yet`
        : dominant === "current"
        ? `claim cites current version ${installed}`
        : `unable to determine installed version`,
    };
  } catch (e) {
    // Defensive — version parsing must NEVER throw to the caller.
    return {
      matched: false, matches: [], installedVersion: null,
      classification: "unknown",
      reason: `version-semantic detector error (safe fallback): ${(e as Error).message}`,
    };
  }
}
