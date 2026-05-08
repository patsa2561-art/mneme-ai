/**
 * Tribal-knowledge fetcher.
 *
 * Pure-function bridge between the augmentation layer and Mneme's existing
 * data sources (git history, atrophy index, forensics incidents, repo
 * constitution). Caller passes in the data they have access to; this
 * module composes it into the AugmentationInput shape.
 *
 * Why a separate module: keeps augmentation.ts pure (no I/O, easy to
 * test) AND lets MCP dispatch wire real Mneme stores into augmentation
 * without coupling the augmentation logic to those stores.
 *
 * Each fetch* helper is independently testable + accepts pre-fetched
 * raw data so we never hit the file-system or DB inside this module.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AugmentationInput,
  PathExpertise,
  DeprecationFact,
  IncidentFact,
  ConstitutionRuleFact,
} from "./augmentation.js";
import type { CodeSearchHit } from "./query-engine.js";

// ─── Git-blame derived: expert author per path ───────────────────────

export interface GitBlameRecord {
  path: string;
  author: string;
  /** ISO date of last commit touching this path. */
  lastTouchedAt: string;
}

/** Compute days-since-last-touch from a git-blame ISO date. */
export function daysSince(isoDate: string, now: number = Date.now()): number {
  const t = new Date(isoDate).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400_000));
}

/**
 * Run `git log -1 --format=%an|%aI <path>` for each path. NEVER throws.
 * Refuses paths with shell metacharacters (defense-in-depth).
 */
export function fetchGitBlameRecords(
  paths: string[],
  repoRoot: string,
): GitBlameRecord[] {
  const out: GitBlameRecord[] = [];
  const META = /[;&|`$<>()\\\n\r"']/;
  for (const p of paths) {
    if (META.test(p)) continue;
    const r = spawnSync(
      "git",
      ["log", "-1", "--format=%an%x09%aI", "--", p],
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    );
    if (r.error || r.status !== 0) continue;
    const line = String(r.stdout ?? "").trim().split("\n")[0];
    if (!line) continue;
    const [author, lastTouchedAt] = line.split("\t");
    if (!author || !lastTouchedAt) continue;
    out.push({ path: p, author, lastTouchedAt });
  }
  return out;
}

// ─── Atrophy data — reads from .mneme/atrophy.json if present ────────

export interface AtrophyEntry {
  path: string;
  /** Atrophy score 0..100. Higher = more stale expertise. */
  atrophyScore: number;
  /** Canonical expert (highest commit count or maintainer). */
  expert: string;
  daysSinceLastTouch?: number;
}

export function fetchAtrophyEntries(repoRoot: string): AtrophyEntry[] {
  const path = join(repoRoot, ".mneme", "atrophy.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { records?: AtrophyEntry[] };
    if (Array.isArray(raw.records)) return raw.records;
    if (Array.isArray(raw)) return raw as AtrophyEntry[];
    return [];
  } catch {
    return [];
  }
}

// ─── Forensics incidents — reads .mneme/incidents.json if present ────

export interface ForensicsIncident {
  title: string;
  reportedAt: string;
  affectedPaths: string[];
}

export function fetchForensicsIncidents(repoRoot: string): ForensicsIncident[] {
  const path = join(repoRoot, ".mneme", "incidents.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { incidents?: ForensicsIncident[] };
    if (Array.isArray(raw.incidents)) return raw.incidents;
    if (Array.isArray(raw)) return raw as ForensicsIncident[];
    return [];
  } catch {
    return [];
  }
}

// ─── Constitution rules — reads .mneme/constitution.json if present ──

export interface ConstitutionRecord {
  id: string;
  severity: "must-not" | "must" | "should" | "consider";
  rule: string;
  source: string;
  /** Optional file paths the rule explicitly applies to. */
  applicablePaths?: string[];
}

export function fetchConstitutionRules(repoRoot: string): ConstitutionRecord[] {
  const path = join(repoRoot, ".mneme", "constitution.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { rules?: ConstitutionRecord[] };
    if (Array.isArray(raw.rules)) return raw.rules;
    if (Array.isArray(raw)) return raw as ConstitutionRecord[];
    return [];
  } catch {
    return [];
  }
}

// ─── Deprecations — reads .mneme/deprecations.json if present ────────

export interface DeprecationRecord {
  path: string;
  canonical: string;
  deprecatedInCommit: string;
  reason: string;
}

export function fetchDeprecations(repoRoot: string): DeprecationRecord[] {
  const path = join(repoRoot, ".mneme", "deprecations.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { deprecations?: DeprecationRecord[] };
    if (Array.isArray(raw.deprecations)) return raw.deprecations;
    if (Array.isArray(raw)) return raw as DeprecationRecord[];
    return [];
  } catch {
    return [];
  }
}

// ─── Composer ────────────────────────────────────────────────────────

export interface BuildAugmentationInputArgs {
  hits: CodeSearchHit[];
  repoRoot: string;
  /** When provided, skip the filesystem reads and use the injected data
   *  directly. Useful for tests + for callers that already have the data. */
  injected?: {
    blame?: GitBlameRecord[];
    atrophy?: AtrophyEntry[];
    incidents?: ForensicsIncident[];
    rules?: ConstitutionRecord[];
    deprecations?: DeprecationRecord[];
  };
}

/**
 * Build a real AugmentationInput by composing data from Mneme's existing
 * stores (or injected fixtures).
 *
 * Behavior:
 *   • Computes per-path expertise = atrophy score + git-blame author
 *     + days-since-last-touch
 *   • Filters incidents/deprecations to ones whose paths appear in `hits`
 *   • Filters constitution rules to ones whose `applicablePaths` overlap
 *     with hit paths (or includes everything if no applicablePaths)
 *
 * NEVER throws. Returns an AugmentationInput safe to feed to
 * augmentDescription().
 */
export function buildAugmentationInput(args: BuildAugmentationInputArgs): AugmentationInput {
  const hitPaths = new Set(args.hits.map((h) => h.path));
  const hitPathArr = Array.from(hitPaths);

  const blame = args.injected?.blame ?? fetchGitBlameRecords(hitPathArr, args.repoRoot);
  const atrophy = args.injected?.atrophy ?? fetchAtrophyEntries(args.repoRoot);
  const incidents = args.injected?.incidents ?? fetchForensicsIncidents(args.repoRoot);
  const rules = args.injected?.rules ?? fetchConstitutionRules(args.repoRoot);
  const deprecations = args.injected?.deprecations ?? fetchDeprecations(args.repoRoot);

  // Build per-path expertise: prefer atrophy data; fall back to git-blame.
  const expertiseByPath = new Map<string, PathExpertise>();
  for (const a of atrophy) {
    if (!hitPaths.has(a.path)) continue;
    expertiseByPath.set(a.path, {
      path: a.path,
      expert: a.expert,
      atrophyScore: a.atrophyScore,
      daysSinceLastTouch: a.daysSinceLastTouch ?? 0,
    });
  }
  for (const b of blame) {
    if (!hitPaths.has(b.path)) continue;
    if (expertiseByPath.has(b.path)) continue; // atrophy wins
    expertiseByPath.set(b.path, {
      path: b.path,
      expert: b.author,
      atrophyScore: 0,
      daysSinceLastTouch: daysSince(b.lastTouchedAt),
    });
  }

  const expertise: PathExpertise[] = Array.from(expertiseByPath.values());

  // Filter deprecations to hits
  const dep: DeprecationFact[] = deprecations
    .filter((d) => hitPaths.has(d.path))
    .map((d) => ({
      path: d.path,
      canonical: d.canonical,
      deprecatedInCommit: d.deprecatedInCommit,
      reason: d.reason,
    }));

  // Filter incidents that touch any hit path
  const inc: IncidentFact[] = incidents
    .filter((i) => i.affectedPaths.some((p) => hitPaths.has(p)))
    .map((i) => ({
      affectedPaths: i.affectedPaths,
      title: i.title,
      reportedAt: i.reportedAt,
    }));

  // Filter rules: include rules with no applicablePaths (apply globally)
  // OR rules whose applicablePaths overlap with hit paths.
  const applicableRules: ConstitutionRuleFact[] = rules
    .filter((r) => {
      if (!r.applicablePaths || r.applicablePaths.length === 0) return true;
      return r.applicablePaths.some((p) => hitPaths.has(p));
    })
    .map((r) => ({ id: r.id, severity: r.severity, rule: r.rule, source: r.source }));

  return {
    hits: args.hits,
    expertise,
    deprecations: dep,
    incidents: inc,
    applicableRules,
  };
}
