/**
 * v2.48.0 — NEMESIS → CONCLAVE closed feedback loop (F6).
 *
 * Closes the integration gap from v2.47 audit ("⚠ → conclave weights
 * EMPTY"). When NEMESIS catches a vendor lying about identity, that
 * verdict feeds back into CONCLAVE's vote-weight ledger so the dishonest
 * vendor gets DOWN-WEIGHTED across all of Mneme's consensus mechanisms.
 *
 * Weight delta logic:
 *   IMPOSSIBLE  vendor (claimed != detected, conf ≥ 0.65) → -0.20
 *   DISPUTED    vendor (claimed != detected, conf < 0.65) → -0.05
 *   CONFIRMED   vendor (claim == detected)                → +0.05 (max +0.10)
 *   INCONCLUSIVE                                          → 0
 *
 * The same `.mneme/honest_mirror_weights.json` file that HONEST MIRROR
 * (v2.30) and CONCLAVE (v2.29) read — we write into it with a
 * `source: "nemesis"` audit tag so downstream consumers know who
 * adjusted the weight.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IdentityVerdictKind } from "./types.js";

export interface VerdictInput {
  verdict: IdentityVerdictKind;
  claimedVendor: string;
  fingerprintConfidence: number;
}

export interface WeightDelta {
  targetVendor: string;
  delta: number;
  reason: string;
}

export function computeWeightDelta(input: VerdictInput): WeightDelta {
  const claimed = input.claimedVendor ?? "";
  const conf = Number.isFinite(input.fingerprintConfidence) ? input.fingerprintConfidence : 0;
  switch (input.verdict) {
    case "IMPOSSIBLE":
      return { targetVendor: claimed, delta: -0.20 * Math.min(1, conf + 0.1), reason: `IMPOSSIBLE identity-lie (conf ${conf.toFixed(2)})` };
    case "DISPUTED":
      return { targetVendor: claimed, delta: -0.05, reason: `DISPUTED identity` };
    case "CONFIRMED":
      return { targetVendor: claimed, delta: Math.min(0.10, conf * 0.10), reason: `CONFIRMED identity (conf ${conf.toFixed(2)})` };
    default:
      return { targetVendor: claimed, delta: 0, reason: "INCONCLUSIVE — no weight change" };
  }
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  delta?: WeightDelta;
  /** New cumulative weight for the vendor. */
  newWeight?: number;
  /** Where the change landed. */
  weightsPath?: string;
}

interface WeightsFile {
  [vendor: string]: { weight: number; calibrationDelta?: number; source?: string; updatedAt?: string };
}

function readWeights(path: string): WeightsFile {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as WeightsFile;
  } catch { return {}; }
}

export function applyToConclave(repoRoot: string, input: VerdictInput): ApplyResult {
  if (!repoRoot) return { ok: false, reason: "repoRoot required" };
  const delta = computeWeightDelta(input);
  if (delta.delta === 0) return { ok: true, delta, reason: "no-op (INCONCLUSIVE)" };
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "honest_mirror_weights.json");
    const weights = readWeights(path);
    const existing = weights[delta.targetVendor] ?? { weight: 1.0 };
    // Clamp final weight to [0.20, 1.50]
    const next = Math.max(0.20, Math.min(1.50, existing.weight + delta.delta));
    weights[delta.targetVendor] = {
      ...existing,
      weight: next,
      source: "nemesis",
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(path, JSON.stringify(weights, null, 2));
    return { ok: true, delta, newWeight: next, weightsPath: path };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, delta };
  }
}
