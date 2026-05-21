/**
 * v2.21.8 — DORMANCY REGISTRY.
 *
 * Scaffolding for the v3.0 "Great Cull" with HONEST signalling. A
 * verb is dormant when it satisfies all of:
 *   - usage hits in the federated pheromone log over the lookback
 *     window are below a threshold (default: 0 hits / 90 days);
 *   - the verb is not on the curated TIER_0 whitelist (i.e. not
 *     in the v2.21.8 ATLAS Layer 0 set);
 *   - the verb has been in the catalog for at least the dormancy
 *     gestation window (default: 90 days since `since` field).
 *
 * Dormant verbs remain CALLABLE. The registry emits a tombstone
 * notice on first invoke per session — it's a UX signal, not a
 * runtime block. v3.0 will move dormant verbs to a separate
 * `mneme-archeology` npm package; users who depend on them can
 * install that package.
 *
 * This module SHIPS the primitive + tombstone renderer. The
 * empirical "dormant list" stays empty until v2.22+ pheromone
 * federation publishes enough data to defend each candidate.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ManifestCommand } from "../agent_manifest.js";

const DIR = ".mneme/dormancy";
const STATE = "shown.json";

/** Lookback + gestation windows. Match the v3.0 cull-window the
 *  v2.21.8 commit message commits to. */
export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_GESTATION_DAYS = 90;
export const DEFAULT_HIT_THRESHOLD = 0;

export interface DormancyConfig {
  lookbackDays: number;
  gestationDays: number;
  hitThreshold: number;
}

export const DEFAULTS: DormancyConfig = {
  lookbackDays: DEFAULT_LOOKBACK_DAYS,
  gestationDays: DEFAULT_GESTATION_DAYS,
  hitThreshold: DEFAULT_HIT_THRESHOLD,
};

export interface DormancyReport {
  verb: string;
  since: string;
  hits90d: number;
  reason: string;
  candidateForRemoval: boolean;
}

/** Compute a dormancy report for a verb given its catalog entry and
 *  observed pheromone hit count over the lookback window. Pure
 *  function — testable without disk. */
export function classifyDormancy(
  entry: ManifestCommand,
  hitCount: number,
  tier0: Set<string>,
  cfg: DormancyConfig = DEFAULTS,
  nowMs: number = Date.now(),
): DormancyReport {
  // Parse the `since` field (e.g. "2.21.8" or "1.0"). Verbs without a
  // dateable `since` get a non-dormant report by default — safety.
  const ageDays = approxAgeDaysFromSemver(entry.since, nowMs);
  const isTier0 = tier0.has(entry.command) || tier0.has(verbStem(entry.command));
  const belowThreshold = hitCount <= cfg.hitThreshold;
  const matured = ageDays >= cfg.gestationDays;
  const candidate = !isTier0 && belowThreshold && matured;
  const reasons: string[] = [];
  if (isTier0) reasons.push("on Tier-0 whitelist");
  else if (!belowThreshold) reasons.push(`${hitCount} pheromone hits in last ${cfg.lookbackDays}d`);
  else if (!matured) reasons.push(`introduced recently (${Math.round(ageDays)}d ago) — gestation period not elapsed`);
  else reasons.push(`${hitCount} hits in ${cfg.lookbackDays}d; ${Math.round(ageDays)}d in catalog`);
  return {
    verb: entry.command,
    since: entry.since,
    hits90d: hitCount,
    reason: reasons.join("; "),
    candidateForRemoval: candidate,
  };
}

function verbStem(cmd: string): string {
  return cmd.split(/\s+/).filter((p) => p && p !== "mneme" && !p.startsWith("<") && !p.startsWith("[") && !p.startsWith("--"))[0] ?? cmd;
}

/** Very rough age estimator: we don't have a release-date map, so the
 *  best we can do is map the major.minor segment of `since` to a known
 *  cadence (~1 minor/week observed across the project). This gives
 *  an order-of-magnitude age in days. Callers can override
 *  `nowMs` for deterministic tests. */
function approxAgeDaysFromSemver(since: string, nowMs: number): number {
  // Anchor: v2.21.0 released 2026-05-20. We convert every semver to a
  // monotonic "minor index" (major × 100 + minor) so v1.81 ranks
  // below v2.0 ranks below v2.21, regardless of within-major minor
  // counts.  Each minor ≈ 7 days from observed cadence.
  const ANCHOR_VERSION = "2.21.0";
  const ANCHOR_MS = Date.parse("2026-05-20T00:00:00Z");
  const DAYS_PER_MINOR = 7;
  const MINORS_PER_MAJOR = 100; // generous; matches the observed catalog
  const idx = (s: string): number | null => {
    const p = s.split(".").map((n) => parseInt(n, 10));
    if (p.length < 2 || p.some((n) => !Number.isFinite(n))) return null;
    return (p[0] ?? 0) * MINORS_PER_MAJOR + (p[1] ?? 0);
  };
  const targetIdx = idx(ANCHOR_VERSION)!;
  const sinceIdx = idx(since);
  if (sinceIdx === null) return DEFAULT_GESTATION_DAYS + 1;
  const minorDelta = Math.max(0, targetIdx - sinceIdx);
  const sinceAnchorOffsetDays = minorDelta * DAYS_PER_MINOR;
  const daysSinceAnchor = Math.max(0, (nowMs - ANCHOR_MS) / 86_400_000);
  return daysSinceAnchor + sinceAnchorOffsetDays;
}

// ─── Tombstone messaging ─────────────────────────────────────────────

export function renderTombstone(report: DormancyReport): string {
  return [
    "",
    "⚰  TOMBSTONE — this verb is on the v3.0 candidate-for-removal list.",
    `   Verb:           ${report.verb}`,
    `   Last 90-day:    ${report.hits90d} hits across federated pheromone data`,
    `   Reason:         ${report.reason}`,
    `   Hidden from:    \`mneme --help\` (use \`mneme --help --full\` to see)`,
    `   Status:         functional · scheduled for move to \`mneme-archeology\` npm package in v3.0`,
    `   Feedback:       https://github.com/patsa2561-art/mneme-ai/discussions`,
    "",
    `   Proceeding with the command — this notice is a UX signal, not a block.`,
    "",
  ].join("\n");
}

// ─── First-invoke notice gate (idempotent per session) ─────────────

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function statePath(repoRoot: string): string { return join(dir(repoRoot), STATE); }

interface ShownState { shown: Record<string, string> }

function load(repoRoot: string): ShownState {
  const p = statePath(repoRoot);
  if (!existsSync(p)) return { shown: {} };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { shown: {} }; }
}

function save(repoRoot: string, s: ShownState): void {
  writeFileSync(statePath(repoRoot), JSON.stringify(s, null, 2), "utf8");
}

/** Return true on the first call for this (repo, verb) tuple; subsequent
 *  calls return false. Used to avoid spamming tombstone on every invoke. */
export function shouldShowTombstone(repoRoot: string, verb: string): boolean {
  const s = load(repoRoot);
  if (s.shown[verb]) return false;
  s.shown[verb] = new Date().toISOString();
  save(repoRoot, s);
  return true;
}

/** Reset the shown registry (for testing). */
export function _resetShownForTests(repoRoot: string): void {
  save(repoRoot, { shown: {} });
}
