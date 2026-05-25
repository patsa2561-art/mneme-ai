/**
 * v2.47.0 — NEMESIS SELF-CALIBRATING LEARNING LOOP.
 *
 * Wild idea no other agent-fingerprinter has: every CONFIRMED identity
 * verdict appends the fixture to a per-repo calibration ledger; the
 * classifier periodically recomputes stats from (seed + ledger) so the
 * detector improves forever from real-world usage.
 *
 * Academic paper: trained once on 33,580 PRs, frozen.
 * NEMESIS: starts at ≥95% on seed corpus + improves every CONFIRMED
 * verdict for the rest of the install's life.
 *
 * Privacy: ledger lives ONLY in `.mneme/nemesis/calibration-ledger.jsonl`
 * (local-first). Opt-in via env var `MNEME_NEMESIS_LEARN=1` (default
 * OFF — user must explicitly enable to avoid silent data accumulation).
 *
 * Defensive: never throws; ledger cap 1000 rows.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { CorpusEntry, VendorStats } from "./calibration_corpus.js";
import type { Fixture, VendorId } from "./types.js";
import { buildSeedCorpus, computeStats } from "./calibration_corpus.js";

const LEDGER_CAP = 1000;

function isLearnEnabled(): boolean {
  return process.env["MNEME_NEMESIS_LEARN"] === "1" || process.env["MNEME_NEMESIS_LEARN"] === "true";
}

function dirOf(repoRoot: string): string {
  const dir = join(repoRoot, ".mneme", "nemesis");
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { /* */ }
  return dir;
}

function ledgerPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "calibration-ledger.jsonl");
}

export interface AppendResult {
  ok: boolean;
  reason?: string;
  appended: boolean;
  /** Reason for skip (user not opted in / verdict not CONFIRMED). */
  skipReason?: string;
}

/**
 * Append a CONFIRMED-verdict fixture to the calibration ledger.
 * No-ops when MNEME_NEMESIS_LEARN is not set.
 */
export function appendCalibrationEntry(
  repoRoot: string,
  vendor: VendorId,
  fixture: Fixture,
): AppendResult {
  if (!isLearnEnabled()) {
    return { ok: true, appended: false, skipReason: "MNEME_NEMESIS_LEARN not enabled (opt-in only)" };
  }
  if (!vendor || vendor === "unknown") {
    return { ok: true, appended: false, skipReason: "vendor missing or unknown" };
  }
  try {
    const path = ledgerPath(repoRoot);
    // Roll the ledger if it's at cap.
    if (existsSync(path)) {
      try {
        const body = readFileSync(path, "utf8");
        const lines = body.split("\n").filter(Boolean);
        if (lines.length >= LEDGER_CAP) {
          const trimmed = lines.slice(-(LEDGER_CAP - 1));
          writeFileSync(path, trimmed.join("\n") + "\n");
        }
      } catch { /* */ }
    }
    const entry = { at: new Date().toISOString(), vendor, fixture };
    appendFileSync(path, JSON.stringify(entry) + "\n");
    return { ok: true, appended: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, appended: false };
  }
}

export function readCalibrationLedger(repoRoot: string): CorpusEntry[] {
  try {
    const path = ledgerPath(repoRoot);
    if (!existsSync(path)) return [];
    const body = readFileSync(path, "utf8");
    const out: CorpusEntry[] = [];
    for (const ln of body.split("\n")) {
      if (!ln.trim()) continue;
      try {
        const j = JSON.parse(ln) as CorpusEntry;
        if (j && j.vendor && j.fixture) out.push({ vendor: j.vendor, fixture: j.fixture });
      } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** Recompute per-vendor stats from (seed corpus + repo ledger). */
export function recomputeStats(repoRoot: string): Map<VendorId, VendorStats> {
  const seed = buildSeedCorpus();
  const learned = readCalibrationLedger(repoRoot);
  return computeStats([...seed, ...learned]);
}

export interface CalibrationStatus {
  learnEnabled: boolean;
  seedCount: number;
  ledgerCount: number;
  totalCount: number;
  perVendor: Partial<Record<VendorId, number>>;
  ledgerPath: string;
}

export function calibrationStatus(repoRoot: string): CalibrationStatus {
  const seed = buildSeedCorpus();
  const learned = readCalibrationLedger(repoRoot);
  const perVendor: Partial<Record<VendorId, number>> = {};
  for (const e of [...seed, ...learned]) {
    perVendor[e.vendor] = (perVendor[e.vendor] ?? 0) + 1;
  }
  return {
    learnEnabled: isLearnEnabled(),
    seedCount: seed.length,
    ledgerCount: learned.length,
    totalCount: seed.length + learned.length,
    perVendor,
    ledgerPath: ledgerPath(repoRoot),
  };
}
