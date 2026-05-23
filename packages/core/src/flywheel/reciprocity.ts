/**
 * v2.32.0 — FLYWHEEL RECIPROCITY layer.
 *
 * Living negotiation organ with the AI vendor ecosystem. When a
 * Vendor Bulletin is posted publicly (off-system), the user records
 * the vendor's response here. Trust deltas auto-feed
 * .mneme/aletheia/honest_mirror_weights.json (the same file HONEST
 * MIRROR + REWIND already write to) — closing the loop.
 *
 * Trust delta rules (v2.32.0):
 *   fix within 7 days       → +0.05
 *   acknowledge within 7d   → +0.01
 *   ignore > 30 days        → −0.10
 *   disputed (with evidence)→  0.00 (neutral)
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReciprocityEntry } from "./types.js";

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "flywheel");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function ledgerPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "reciprocity.jsonl");
}

export function computeTrustDelta(response: ReciprocityEntry["response"], reactionDays: number): number {
  if (response === "fix" && reactionDays <= 7) return 0.05;
  if (response === "acknowledge" && reactionDays <= 7) return 0.01;
  if (response === "ignore" && reactionDays >= 30) return -0.10;
  return 0.0;
}

export interface RecordResponseParams {
  vendor: string;
  bulletinSeq: number;
  response: ReciprocityEntry["response"];
  reactionDays: number;
}

export function recordResponse(repoRoot: string, params: RecordResponseParams): ReciprocityEntry {
  const trustDelta = computeTrustDelta(params.response, params.reactionDays);
  const entry: ReciprocityEntry = {
    vendor: params.vendor,
    bulletinSeq: params.bulletinSeq,
    response: params.response,
    reactionDays: params.reactionDays,
    trustDelta,
    at: new Date().toISOString(),
  };
  appendFileSync(ledgerPath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function readLedger(repoRoot: string, limit = 500): ReciprocityEntry[] {
  const p = ledgerPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const body = readFileSync(p, "utf8");
    const out: ReciprocityEntry[] = [];
    for (const ln of body.split("\n").filter(Boolean).slice(-limit)) {
      try { out.push(JSON.parse(ln) as ReciprocityEntry); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/**
 * Apply the cumulative trust delta per vendor into the shared
 * .mneme/aletheia/honest_mirror_weights.json file. Composes with the
 * HONEST MIRROR + REWIND feedback loops — same destination, source
 * field disambiguates ("reciprocity") so we never overwrite a
 * fresher calibration.
 *
 * Returns the per-vendor net delta applied this run.
 */
export function applyToAletheiaWeights(repoRoot: string): Record<string, number> {
  const ledger = readLedger(repoRoot);
  const sumByVendor: Record<string, number> = {};
  for (const e of ledger) sumByVendor[e.vendor] = (sumByVendor[e.vendor] ?? 0) + e.trustDelta;
  const aletheiaDir = join(repoRoot, ".mneme", "aletheia");
  if (!existsSync(aletheiaDir)) mkdirSync(aletheiaDir, { recursive: true });
  const aletheiaPath = join(aletheiaDir, "honest_mirror_weights.json");
  const merged: Record<string, { trust: number; source: string; at: string }> = {};
  if (existsSync(aletheiaPath)) {
    try { Object.assign(merged, JSON.parse(readFileSync(aletheiaPath, "utf8")) as typeof merged); }
    catch { /* corrupt — start fresh */ }
  }
  const applied: Record<string, number> = {};
  for (const [vendor, delta] of Object.entries(sumByVendor)) {
    const prior = merged[vendor]?.trust ?? 0.5;
    // Only overwrite if the existing entry isn't from a fresher calibration
    // pass (honest_mirror/rewind already wrote within the last hour).
    const existing = merged[vendor];
    if (existing && (existing.source === "honest_mirror" || existing.source === "rewind")) {
      const minutesAgo = (Date.now() - Date.parse(existing.at)) / 60_000;
      if (minutesAgo < 60) { applied[vendor] = 0; continue; } // skip — fresher signal wins
    }
    const next = Math.max(0.1, Math.min(0.95, Number((prior + delta).toFixed(3))));
    merged[vendor] = { trust: next, source: "reciprocity", at: new Date().toISOString() };
    applied[vendor] = next - prior;
  }
  writeFileSync(aletheiaPath, JSON.stringify(merged, null, 2));
  return applied;
}
