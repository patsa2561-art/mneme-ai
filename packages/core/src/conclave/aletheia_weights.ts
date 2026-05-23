/**
 * v2.29.0 — Aletheia weight reader for CONCLAVE.
 *
 * Reads the per-vendor truth-track record from Mneme's existing
 * bounty / aletheia / vendor-karma stores. If a vendor has no record,
 * defaults to 0.5 (neutral prior). If the user passes weightBy="equal"
 * the orchestrator skips this step entirely.
 *
 * Cached per process for sub-millisecond lookups.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, { weight: number; expiresAt: number }>();
const TTL_MS = 30_000;

function defaultWeight(): number { return 0.5; }

function read(repoRoot: string, vendor: string): number {
  // Try multiple sources in priority order:
  //   1. .mneme/aletheia/karma.json   (per-tool but we treat per-vendor too)
  //   2. .mneme/bounty/leaderboard.json (vendor falseRate → 1 - falseRate)
  //   3. default neutral prior
  try {
    const karmaPath = join(repoRoot, ".mneme", "aletheia", "karma.json");
    if (existsSync(karmaPath)) {
      const j = JSON.parse(readFileSync(karmaPath, "utf8")) as { vendors?: Record<string, { karma?: number; trust?: number }> };
      const v = j.vendors?.[vendor];
      if (v && typeof v.trust === "number") return clamp01(v.trust);
      if (v && typeof v.karma === "number") return clamp01(v.karma);
    }
  } catch { /* ignore */ }
  try {
    const bountyPath = join(repoRoot, ".mneme", "bounty", "leaderboard.json");
    if (existsSync(bountyPath)) {
      const j = JSON.parse(readFileSync(bountyPath, "utf8")) as { vendors?: Array<{ vendor?: string; falseRate?: number; truthScore?: number }> };
      const row = (j.vendors ?? []).find((r) => r.vendor === vendor);
      if (row) {
        if (typeof row.truthScore === "number") return clamp01(row.truthScore);
        if (typeof row.falseRate === "number") return clamp01(1 - row.falseRate);
      }
    }
  } catch { /* ignore */ }
  return defaultWeight();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return defaultWeight();
  return Math.min(1, Math.max(0, n));
}

export function aletheiaWeight(repoRoot: string, vendor: string): number {
  const key = `${repoRoot}|${vendor}`;
  const now = Date.now();
  const c = cache.get(key);
  if (c && c.expiresAt > now) return c.weight;
  const w = read(repoRoot, vendor);
  cache.set(key, { weight: w, expiresAt: now + TTL_MS });
  return w;
}

/** Test-only reset. */
export function __resetAletheiaCacheForTest(): void { cache.clear(); }
