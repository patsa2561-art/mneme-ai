/**
 * v2.32.0 — FLYWHEEL FUSE stage.
 *
 * Cross-pollinates raw findings. The wild part: when two findings from
 * DIFFERENT sources share a root signature (vendor / claim / simhash),
 * the composite score gets a 30% boost. That's the "composition
 * bonus" — fixing a fused finding kills 2+ root causes at once.
 *
 * Cluster ids: findings tagged with the same clusterId share root
 * cause and should be prescribed as ONE action.
 */

import { createHash } from "node:crypto";
import type { FusedFinding, RawFinding } from "./types.js";

function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

/**
 * Derive a cluster key from a raw finding. Findings that hash to the
 * SAME cluster key share root cause (vendor / claim / simhash).
 *
 * Heuristic per source:
 *   honest_mirror + rewind  → "vendor:<vendor-id>"
 *   hgp                     → "hgp:<hgpId>" (also adds vendor:<each-vendor> sub-clusters)
 *   truth_gate              → "claim:<claimId>"
 *   peak_gauntlet           → "finding:<id>"
 *   primitive_registry      → "primitive:<name>"
 *   marketing_diff          → "marketing:<file>"
 *   command_history         → "cmd:<command>"
 */
function clusterKeys(f: RawFinding): string[] {
  const keys: string[] = [];
  if (f.source === "honest_mirror" || f.source === "rewind") {
    const v = (f.detail?.["vendor"] as string | undefined) ?? "";
    if (v) keys.push(`vendor:${v}`);
  } else if (f.source === "hgp") {
    keys.push(`hgp:${f.id}`);
    const vc = (f.detail?.["vendorCounts"] as Record<string, number> | undefined) ?? {};
    for (const v of Object.keys(vc)) keys.push(`vendor:${v}`);
  } else if (f.source === "truth_gate") {
    keys.push(`claim:${f.id}`);
  } else if (f.source === "peak_gauntlet") {
    keys.push(`finding:${f.id}`);
  } else if (f.source === "primitive_registry") {
    keys.push(`primitive:${f.id}`);
  } else if (f.source === "marketing_diff") {
    const file = (f.detail?.["file"] as string | undefined) ?? "";
    if (file) keys.push(`marketing:${file}`);
  } else if (f.source === "command_history") {
    keys.push(`cmd:${f.id}`);
  } else if (f.source === "citizen_court") {
    // v2.33.0 — CITIZEN COURT loss findings cluster by vendor so they
    // fuse with HONEST MIRROR + REWIND vendor signals (same vendor →
    // same cluster → +30% composition bonus).
    const v = (f.detail?.["vendor"] as string | undefined) ?? "";
    if (v) keys.push(`vendor:${v}`);
  }
  // Always include the (source, id) self-key as a fallback so isolated
  // findings still get a stable cluster id.
  keys.push(`self:${f.source}:${f.id}`);
  return keys;
}

const SEVERITY_WEIGHT: Record<RawFinding["severity"], number> = {
  info: 0.2, warn: 0.6, block: 1.0,
};

/**
 * Composite priority 0..1 = baseSeverity × freshness × (1 + composition-bonus).
 *   baseSeverity  ∈ [0.2, 1.0]
 *   freshness     ∈ [0.2, 1.0]  (1.0 if 0 days old; 0.2 if 60+ days)
 *   compositionBonus = min(0.3, 0.1 × cross-source-partners)
 */
function compositeScore(f: RawFinding, crossSourcePartners: number): number {
  const base = SEVERITY_WEIGHT[f.severity] ?? 0.5;
  const fresh = Math.max(0.2, 1.0 - f.ageDays / 60);
  const comp = Math.min(0.3, 0.1 * crossSourcePartners);
  return Number((Math.min(1, base * fresh * (1 + comp))).toFixed(3));
}

export function fuse(raw: RawFinding[]): FusedFinding[] {
  // Bucket by cluster key.
  const byKey = new Map<string, RawFinding[]>();
  for (const f of raw) {
    for (const k of clusterKeys(f)) {
      const arr = byKey.get(k) ?? [];
      arr.push(f);
      byKey.set(k, arr);
    }
  }
  // For each finding, find cross-source partners (findings in any
  // shared cluster from a DIFFERENT source).
  const out: FusedFinding[] = [];
  for (const f of raw) {
    const partners = new Set<string>(); // dedup by `${source}:${id}`
    for (const k of clusterKeys(f)) {
      for (const peer of byKey.get(k) ?? []) {
        if (peer === f) continue;
        if (peer.source === f.source && peer.id === f.id) continue;
        if (peer.source !== f.source) partners.add(`${peer.source}:${peer.id}`);
      }
    }
    const partnerList = Array.from(partners).map((s) => {
      const i = s.indexOf(":");
      return { source: s.slice(0, i) as RawFinding["source"], id: s.slice(i + 1) };
    });
    // Pick the most-specific cluster key as the canonical clusterId.
    const cands = clusterKeys(f).filter((k) => !k.startsWith("self:"));
    const clusterKey = cands[0] ?? clusterKeys(f).pop()!;
    out.push({
      ...f,
      composedWith: partnerList,
      compositeScore: compositeScore(f, partnerList.length),
      clusterId: sha8(clusterKey),
    });
  }
  // Sort by compositeScore descending, then severity descending, then ageDays asc.
  out.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (SEVERITY_WEIGHT[b.severity] !== SEVERITY_WEIGHT[a.severity]) return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    return a.ageDays - b.ageDays;
  });
  return out;
}

/** Count distinct clusters across a fused list. */
export function distinctClusterCount(fused: FusedFinding[]): number {
  return new Set(fused.map((f) => f.clusterId)).size;
}
