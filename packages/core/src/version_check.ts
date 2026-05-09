/**
 * Version-check — non-blocking npm registry probe with 24h cache.
 *
 * Called at MCP server boot (fire-and-forget) so the welcome contract +
 * resource surface know whether a newer version of `mneme-ai` is
 * available. The check NEVER throws — network failures, registry
 * downtime, malformed responses all degrade gracefully to "unknown".
 *
 * Cache: `.mneme/version-check.json` keyed by current local version.
 * Result is reused for 24 hours to avoid hammering the registry on
 * every MCP server restart.
 *
 * Privacy: only an outbound GET to registry.npmjs.org/mneme-ai/latest.
 * No telemetry, no IP-of-user-leaked-on-purpose, no auth headers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pushInbox, deterministicId } from "./inbox.js";

const CACHE_FILE = ".mneme/version-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = "https://registry.npmjs.org/mneme-ai/latest";
const REQUEST_TIMEOUT_MS = 6000;

export interface VersionCheckResult {
  /** Current locally-installed version. */
  current: string;
  /** Latest version on npm registry — null if check failed. */
  latest: string | null;
  /** True iff `latest > current` (semver compare). */
  updateAvailable: boolean;
  /** ISO timestamp when this check was performed (or last cached). */
  lastChecked: string;
  /** True if this result came from cache. */
  fromCache: boolean;
  /** Reason if check failed. */
  failureReason?: string;
}

interface CachedRecord {
  current: string;
  latest: string | null;
  lastChecked: string;
  failureReason?: string;
}

function readCache(repoRoot: string): CachedRecord | null {
  const path = join(repoRoot, CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedRecord;
  } catch {
    return null;
  }
}

function writeCache(repoRoot: string, rec: CachedRecord): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(repoRoot, CACHE_FILE), JSON.stringify(rec, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

function cacheIsFresh(rec: CachedRecord): boolean {
  const age = Date.now() - Date.parse(rec.lastChecked);
  return Number.isFinite(age) && age < CACHE_TTL_MS;
}

/** Compare two semver-shaped strings — true if `a > b`.
 *  Handles MAJOR.MINOR.PATCH plus optional pre-release suffix. */
export function semverGt(a: string, b: string): boolean {
  const parse = (v: string): { core: number[]; pre: string | null } => {
    const cleaned = v.trim().replace(/^v/, "");
    const m = /^(\d+)\.(\d+)\.(\d+)([-+].+)?$/.exec(cleaned);
    if (!m) return { core: [0, 0, 0], pre: null };
    return {
      core: [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)],
      pre: m[4] ?? null,
    };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    const aa = A.core[i] ?? 0;
    const bb = B.core[i] ?? 0;
    if (aa > bb) return true;
    if (aa < bb) return false;
  }
  // Same core — pre-release versions are LOWER than release (1.0.0-rc < 1.0.0).
  if (A.pre && !B.pre) return false;
  if (!A.pre && B.pre) return true;
  return false;
}

/** Hit the npm registry. Never throws — returns null on any failure. */
async function fetchLatestFromNpm(): Promise<{ version: string | null; reason?: string }> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(REGISTRY_URL, { signal: ac.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return { version: null, reason: `registry HTTP ${res.status}` };
      const json = (await res.json()) as { version?: string };
      if (!json.version || typeof json.version !== "string") {
        return { version: null, reason: "registry response missing version field" };
      }
      // Defensive: validate semver shape so we never propagate junk to the
      // upgrade tool which would spawn npm with it.
      if (!/^\d+\.\d+\.\d+([.\-+][a-zA-Z0-9.\-]+)?$/.test(json.version)) {
        return { version: null, reason: `registry returned non-semver: ${json.version.slice(0, 40)}` };
      }
      return { version: json.version };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { version: null, reason: (err as Error).message.slice(0, 200) };
  }
}

/** The canonical entry point. Always resolves with a result; never throws. */
export async function checkVersion(repoRoot: string, currentVersion: string): Promise<VersionCheckResult> {
  // Try cache first.
  const cached = readCache(repoRoot);
  if (cached && cached.current === currentVersion && cacheIsFresh(cached)) {
    return {
      current: currentVersion,
      latest: cached.latest,
      updateAvailable: cached.latest !== null && semverGt(cached.latest, currentVersion),
      lastChecked: cached.lastChecked,
      fromCache: true,
      failureReason: cached.failureReason,
    };
  }
  // Fresh fetch.
  const fetchResult = await fetchLatestFromNpm();
  const lastChecked = new Date().toISOString();
  const rec: CachedRecord = {
    current: currentVersion,
    latest: fetchResult.version,
    lastChecked,
    failureReason: fetchResult.reason,
  };
  writeCache(repoRoot, rec);
  const updateAvailable = fetchResult.version !== null && semverGt(fetchResult.version, currentVersion);
  // v1.23.0 — push update notice into the inbox so the AI agent surfaces
  // it on the next tool call, even if the user never runs `mneme upgrade`.
  // Idempotent on the latest version string — no spam across daemon ticks.
  if (updateAvailable && fetchResult.version) {
    try {
      pushInbox(repoRoot, {
        id: deterministicId(`update-available-${fetchResult.version}`),
        priority: "high",
        source: "version-check",
        title: `Mneme v${fetchResult.version} is available`,
        body: `You're on v${currentVersion}.`,
        cta: "say: 'upgrade Mneme'",
      });
    } catch { /* ignore */ }
  }
  return {
    current: currentVersion,
    latest: fetchResult.version,
    updateAvailable,
    lastChecked,
    fromCache: false,
    failureReason: fetchResult.reason,
  };
}

/** Synchronous read of the last cached result (no network). Used by
 *  tools / resources that need the status NOW without awaiting. */
export function readCachedVersionCheck(repoRoot: string, currentVersion: string): VersionCheckResult | null {
  const cached = readCache(repoRoot);
  if (!cached) return null;
  return {
    current: currentVersion,
    latest: cached.latest,
    updateAvailable: cached.latest !== null && semverGt(cached.latest, currentVersion),
    lastChecked: cached.lastChecked,
    fromCache: true,
    failureReason: cached.failureReason,
  };
}
