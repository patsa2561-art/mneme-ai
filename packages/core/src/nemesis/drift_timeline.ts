/**
 * v2.46.0 — NEMESIS ORGAN 4: MODEL DRIFT TIMELINE.
 *
 * Records each fingerprint per vendor over time + computes variance.
 * When a vendor's fingerprint distribution shifts past N standard
 * deviations, NEMESIS surfaces "vendor X changed personality on Y".
 *
 * Ledger: `.mneme/nemesis/drift-<vendor>.jsonl` — one row per recorded
 * fingerprint, capped at 200 most-recent rows per vendor.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const LEDGER_CAP = 200;
const DRIFT_SIGMA_THRESHOLD = 3; // 3σ = "real" drift

export interface DriftEntry {
  at: string;
  vendor: string;
  fingerprint: Record<string, number>;
}

export interface VarianceResult {
  feature: string;
  vendor: string;
  mean: number;
  stdev: number;
  /** Most recent value of the feature. */
  latest: number;
  /** Z-score of the latest vs the prior distribution. */
  z: number;
  driftDetected: boolean;
  /** ISO timestamp of the drift event (the latest entry). */
  driftAt?: string;
}

function dirOf(repoRoot: string): string {
  const dir = join(repoRoot, ".mneme", "nemesis");
  if (!existsSync(dir)) { try { mkdirSync(dir, { recursive: true }); } catch { /* */ } }
  return dir;
}

function safeVendor(v: string): string {
  return v.replace(/[^a-zA-Z0-9._-]/g, "_") || "anonymous";
}

export function recordFingerprint(repoRoot: string, vendor: string, fingerprint: Record<string, number>): { ok: boolean; reason?: string } {
  try {
    const ledger = join(dirOf(repoRoot), `drift-${safeVendor(vendor)}.jsonl`);
    const entry: DriftEntry = { at: new Date().toISOString(), vendor, fingerprint };
    // Roll the ledger if it's at cap.
    if (existsSync(ledger)) {
      try {
        const body = readFileSync(ledger, "utf8");
        const lines = body.split("\n").filter(Boolean);
        if (lines.length >= LEDGER_CAP) {
          const trimmed = lines.slice(-(LEDGER_CAP - 1));
          writeFileSync(ledger, trimmed.join("\n") + "\n");
        }
      } catch { /* */ }
    }
    appendFileSync(ledger, JSON.stringify(entry) + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function readTimeline(repoRoot: string, vendor: string): DriftEntry[] {
  try {
    const ledger = join(dirOf(repoRoot), `drift-${safeVendor(vendor)}.jsonl`);
    if (!existsSync(ledger)) return [];
    const body = readFileSync(ledger, "utf8");
    const out: DriftEntry[] = [];
    for (const ln of body.split("\n")) {
      if (!ln.trim()) continue;
      try { out.push(JSON.parse(ln) as DriftEntry); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

export function computeVariance(repoRoot: string, vendor: string, feature: string): VarianceResult {
  const tl = readTimeline(repoRoot, vendor);
  if (tl.length === 0) {
    return { feature, vendor, mean: 0, stdev: 0, latest: 0, z: 0, driftDetected: false };
  }
  const values = tl.map((e) => Number(e.fingerprint[feature] ?? 0)).filter((n) => Number.isFinite(n));
  if (values.length === 0) {
    return { feature, vendor, mean: 0, stdev: 0, latest: 0, z: 0, driftDetected: false };
  }
  // Compute mean + stdev of all-but-latest, compare latest against that distribution.
  const latestValue = values[values.length - 1]!;
  const priorValues = values.slice(0, -1);
  if (priorValues.length < 2) {
    return { feature, vendor, mean: latestValue, stdev: 0, latest: latestValue, z: 0, driftDetected: false };
  }
  const mean = priorValues.reduce((a, b) => a + b, 0) / priorValues.length;
  const variance = priorValues.reduce((s, v) => s + (v - mean) ** 2, 0) / priorValues.length;
  const stdev = Math.sqrt(variance);
  const z = stdev === 0 ? 0 : Math.abs(latestValue - mean) / stdev;
  const driftDetected = z >= DRIFT_SIGMA_THRESHOLD && stdev > 0;
  return {
    feature, vendor, mean, stdev, latest: latestValue, z,
    driftDetected,
    driftAt: driftDetected ? tl[tl.length - 1]!.at : undefined,
  };
}
