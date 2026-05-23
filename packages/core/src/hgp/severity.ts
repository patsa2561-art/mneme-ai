/**
 * v2.31.0 — HGP severity scoring by vendor + time window.
 *
 * Powers `mneme.hgp.severity --vendor anthropic --window 30d`.
 *
 * Composes with CONCLAVE Aletheia weights: vendors with high HGP
 * severity over the recent window can be auto-downgraded in the
 * vote-weight feedback file (next iteration; v2.31.0 surfaces the
 * signal, v2.32.x wires the auto-downgrade).
 */

import type { HallucinationRecord, SeverityWindow } from "./types.js";
import { loadCollapsed } from "./registry.js";

export function severityForVendor(repoRoot: string, vendor: string, windowDays: number): SeverityWindow {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const all = Array.from(loadCollapsed(repoRoot).values());
  const inWindow = all.filter((r) => Date.parse(r.lastSeen) >= cutoff && (r.vendorCounts[vendor] ?? 0) > 0);
  const count = inWindow.reduce((s, r) => s + (r.vendorCounts[vendor] ?? 0), 0);
  const meanSeverity = inWindow.length === 0 ? 0
    : Number((inWindow.reduce((s, r) => s + r.severity, 0) / inWindow.length).toFixed(3));
  const sorted = inWindow.slice().sort((a, b) => b.severity - a.severity || b.observeCount - a.observeCount);
  const topIds = sorted.slice(0, 3).map((r) => ({
    hgpId: r.hgpId,
    observeCount: r.observeCount,
    severity: r.severity,
  }));
  return { vendor, windowDays, count, meanSeverity, topIds };
}

export function allVendorsBreakdown(repoRoot: string, windowDays: number): SeverityWindow[] {
  const all = Array.from(loadCollapsed(repoRoot).values());
  const vendors = new Set<string>();
  for (const r of all) for (const v of Object.keys(r.vendorCounts)) vendors.add(v);
  return Array.from(vendors).map((v) => severityForVendor(repoRoot, v, windowDays))
    .sort((a, b) => b.count - a.count);
}

/**
 * Top globally-severe HGP-IDs (regardless of vendor) over window.
 * Useful for the dashboard / public roll-up.
 */
export function topInWindow(repoRoot: string, windowDays: number, limit = 10): HallucinationRecord[] {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const all = Array.from(loadCollapsed(repoRoot).values()).filter((r) => Date.parse(r.lastSeen) >= cutoff);
  all.sort((a, b) => b.severity - a.severity || b.observeCount - a.observeCount);
  return all.slice(0, limit);
}
