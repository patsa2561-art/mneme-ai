/**
 * v2.19.62 PHOENIX PHASE 1 — SCOUT (P4 step 1: passive npm registry probe).
 *
 * The first step of the PHOENIX Auto-Upgrade Protocol. Scout's only job is
 * to passively observe the npm registry — never to spawn npm install, never
 * to mutate the filesystem, never to interrupt the daemon. Read-only by
 * design so it can run on every daemon tick without amplifying load.
 *
 * Behavior:
 *   1. Hit https://registry.npmjs.org/mneme-ai/latest (HTTP HEAD-or-GET)
 *   2. Compare returned `version` to the running version (passed by caller)
 *   3. Cache result for `cacheTtlMs` (default 5min) so repeated calls don't
 *      hammer the registry
 *   4. Return verdict: up-to-date | upgrade-available | unreachable
 *
 * Pure observation. Caller (daemon or PHOENIX Queen in Phase 2) decides
 * what to do with the verdict — start a cocoon, push an inbox alert, or
 * sit on the data until conditions are right.
 *
 * Cache is in-memory only. Persistent state (last-checked timestamp,
 * upgrade history) belongs in the daemon's heartbeat ledger, not here.
 *
 * Network-failure semantics: ALL failures return `unreachable` — never
 * throw. The daemon must remain alive even when offline.
 */

import { request } from "node:https";
import { request as httpRequest } from "node:http";

const PROTOCOL_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_PACKAGE = "mneme-ai";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export type ScoutVerdict =
  | "up-to-date"
  | "upgrade-available"
  | "unreachable";

export interface ScoutReport {
  v: typeof PROTOCOL_VERSION;
  organ: "scout";
  ts: string;
  verdict: ScoutVerdict;
  packageName: string;
  runningVersion: string;
  latestVersion: string | null;
  cacheHit: boolean;
  cacheAgeMs: number;
  durationMs: number;
  reachability: {
    registry: string;
    httpStatus?: number;
    error?: string;
  };
}

export interface ScoutOptions {
  packageName?: string;
  registry?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  /** Inject a fetcher for tests. Should return the parsed registry response
   *  ({version: "x.y.z", ...}) or throw on failure. */
  fetchLatest?: (registry: string, packageName: string, timeoutMs: number) => Promise<{ version: string; httpStatus?: number }>;
  /** Optional explicit clock for tests (ms since epoch). */
  now?: () => number;
}

interface CacheEntry {
  fetchedAt: number;
  latestVersion: string | null;
  httpStatus?: number;
  error?: string;
}

// Per-package cache. Cleared on process exit.
const cache = new Map<string, CacheEntry>();

/** Compare two semver-ish strings. Returns positive when `a > b`, 0 when
 *  equal, negative when `a < b`. Strips leading "v" and any pre-release
 *  suffix after the first hyphen. Safe-default — non-numeric segments
 *  compared as 0. */
export function compareVersions(a: string, b: string): number {
  const norm = (s: string) => s.replace(/^v/i, "").split("-")[0] ?? "0";
  const partsA = norm(a).split(".").map((x) => parseInt(x, 10) || 0);
  const partsB = norm(b).split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const ai = partsA[i] ?? 0;
    const bi = partsB[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/** Default fetcher — node:https GET against `${registry}/${pkg}/latest`.
 *  Times out after `timeoutMs`. Throws on any failure (caller wraps). */
async function defaultFetcher(registry: string, packageName: string, timeoutMs: number): Promise<{ version: string; httpStatus?: number }> {
  const url = `${registry.replace(/\/$/, "")}/${encodeURIComponent(packageName)}/latest`;
  return new Promise((resolve, reject) => {
    const reqFn = url.startsWith("https://") ? request : httpRequest;
    const req = reqFn(url, { method: "GET", headers: { accept: "application/json", "user-agent": `mneme-phoenix-scout/${PROTOCOL_VERSION}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          reject(Object.assign(new Error(`registry HTTP ${status}`), { httpStatus: status }));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          const version = typeof parsed?.version === "string" ? parsed.version : null;
          if (!version) {
            reject(new Error("registry response missing version"));
            return;
          }
          resolve({ version, httpStatus: status });
        } catch (e) {
          reject(new Error(`registry response parse failed: ${(e as Error).message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`registry request timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

/** Probe the npm registry for the latest version of a package. Returns a
 *  structured verdict. Never throws — failures become `unreachable` so the
 *  daemon loop is undisturbed. */
export async function runScoutCycle(runningVersion: string, opts?: ScoutOptions): Promise<ScoutReport> {
  const t0 = Date.now();
  const packageName = opts?.packageName ?? DEFAULT_PACKAGE;
  const registry = opts?.registry ?? DEFAULT_REGISTRY;
  const cacheTtlMs = opts?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = opts?.fetchLatest ?? defaultFetcher;
  const now = opts?.now ?? Date.now;
  const cacheKey = `${registry}::${packageName}`;
  const cached = cache.get(cacheKey);
  const ageMs = cached ? now() - cached.fetchedAt : Infinity;
  let entry: CacheEntry;
  let cacheHit = false;
  if (cached && ageMs < cacheTtlMs) {
    entry = cached;
    cacheHit = true;
  } else {
    try {
      const result = await fetcher(registry, packageName, timeoutMs);
      entry = { fetchedAt: now(), latestVersion: result.version, httpStatus: result.httpStatus };
    } catch (e) {
      const err = (e ?? {}) as { message?: string; httpStatus?: number };
      entry = {
        fetchedAt: now(),
        latestVersion: null,
        ...(typeof err.httpStatus === "number" ? { httpStatus: err.httpStatus } : {}),
        error: typeof err.message === "string" ? err.message : String(e),
      };
    }
    cache.set(cacheKey, entry);
  }
  let verdict: ScoutVerdict;
  if (entry.latestVersion === null) {
    verdict = "unreachable";
  } else if (compareVersions(entry.latestVersion, runningVersion) > 0) {
    verdict = "upgrade-available";
  } else {
    verdict = "up-to-date";
  }
  return {
    v: PROTOCOL_VERSION,
    organ: "scout",
    ts: new Date().toISOString(),
    verdict,
    packageName,
    runningVersion,
    latestVersion: entry.latestVersion,
    cacheHit,
    cacheAgeMs: cacheHit ? ageMs : 0,
    durationMs: Date.now() - t0,
    reachability: {
      registry,
      ...(entry.httpStatus !== undefined ? { httpStatus: entry.httpStatus } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
    },
  };
}

/** Clear Scout's in-memory cache. Used by tests + after a successful
 *  upgrade so the next probe sees fresh state. */
export function clearScoutCache(): void {
  cache.clear();
}

/** Inspect current cache size (testing/debug). */
export function scoutCacheSize(): number {
  return cache.size;
}

export { PROTOCOL_VERSION };
