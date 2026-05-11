/**
 * POWER 2 — SOVEREIGN INFRASTRUCTURE (v1.48.0)
 *
 * Mneme must survive any single jurisdiction's subpoena, takedown, or
 * shutdown. This module audits Mneme's deployment topology and reports
 * how close we are to a "sovereign" footprint -- one no single power
 * can extinguish.
 *
 * Inputs: a node registry at `.mneme/sovereign-nodes.jsonl` (operator-
 * curated; each line: { id, jurisdiction, type, lastSeen }).
 * Outputs: a SovereigntyReport with the math behind the verdict.
 *
 * IDEA-CHEST FOUND ALONG THE WAY:
 *   - Borrow the GINI coefficient from economics: when one jurisdiction
 *     hosts > 50% of nodes we're effectively centralized regardless of
 *     raw count. Surface this as `concentrationRisk`.
 *   - Time-decay node "liveness" the same way pheromones decay --
 *     a node not seen in 30 days counts at half weight.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NODES_REL = ".mneme/sovereign-nodes.jsonl";

export type NodeType = "validator" | "mirror" | "gateway" | "bootstrap";

export interface SovereignNode {
  id: string;
  jurisdiction: string;     // ISO 3166-1 alpha-2 (US, DE, JP) or special (eu-shared, anon)
  type: NodeType;
  lastSeen: string;         // ISO-8601
  publicKeyFingerprint?: string;
  region?: string;          // optional sub-jurisdiction hint (Bay Area, Frankfurt)
}

export interface SovereigntyReport {
  generatedAt: string;
  nodeCount: number;
  jurisdictionCount: number;
  jurisdictionDistribution: { jurisdiction: string; count: number; share: number }[];
  /** 0..1 -- 0 means perfectly even, 1 means single-jurisdiction monopoly. */
  concentrationRisk: number;
  /** Live = lastSeen within 30d. Stale = older. */
  liveNodes: number;
  staleNodes: number;
  spofs: { reason: string; severity: "low" | "medium" | "high" | "critical" }[];
  verdict: "embryonic" | "regional" | "multi-jurisdictional" | "sovereign";
  reasoning: string;
}

const LIVENESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SOVEREIGN_TARGET_NODES = 1000;
const SOVEREIGN_TARGET_JURISDICTIONS = 80;

function readNodes(repoRoot: string): SovereignNode[] {
  const path = join(resolve(repoRoot), NODES_REL);
  if (!existsSync(path)) return [];
  const out: SovereignNode[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as SovereignNode); } catch { /* skip */ }
  }
  return out;
}

export function registerNode(repoRoot: string, node: Omit<SovereignNode, "lastSeen"> & { lastSeen?: string }): SovereignNode {
  const root = resolve(repoRoot);
  mkdirSync(join(root, ".mneme"), { recursive: true });
  const full: SovereignNode = { ...node, lastSeen: node.lastSeen ?? new Date().toISOString() };
  appendFileSync(join(root, NODES_REL), JSON.stringify(full) + "\n");
  return full;
}

/**
 * Borrowed from economics: the Herfindahl-Hirschman concentration
 * metric, normalised to 0..1. 1 = total monopoly, 0 = perfectly even.
 */
function concentration(distribution: { count: number }[], total: number): number {
  if (total === 0 || distribution.length === 0) return 1;
  // Single-jurisdiction = total monopoly = 1.0 (worst case). The
  // normalization below would otherwise return 0 here, which is the
  // OPPOSITE of the truth.
  if (distribution.length === 1) return 1;
  let hhi = 0;
  for (const d of distribution) {
    const share = d.count / total;
    hhi += share * share;
  }
  // hhi is in [1/N, 1]; normalize so 0 = perfectly even, 1 = monopoly.
  const minHhi = 1 / distribution.length;
  return Math.max(0, Math.min(1, (hhi - minHhi) / Math.max(1e-9, 1 - minHhi)));
}

export function auditSovereignty(repoRoot: string, asOf: Date = new Date()): SovereigntyReport {
  const nodes = readNodes(repoRoot);
  const cutoff = asOf.getTime() - LIVENESS_WINDOW_MS;

  // Jurisdiction distribution
  const byJurisdiction = new Map<string, number>();
  let live = 0;
  let stale = 0;
  for (const n of nodes) {
    byJurisdiction.set(n.jurisdiction, (byJurisdiction.get(n.jurisdiction) ?? 0) + 1);
    const ts = Date.parse(n.lastSeen);
    if (!Number.isNaN(ts) && ts >= cutoff) live++;
    else stale++;
  }
  const total = nodes.length;
  const distribution = Array.from(byJurisdiction.entries())
    .map(([jurisdiction, count]) => ({ jurisdiction, count, share: total === 0 ? 0 : +(count / total).toFixed(4) }))
    .sort((a, b) => b.count - a.count);

  const conc = concentration(distribution, total);

  const spofs: SovereigntyReport["spofs"] = [];
  if (total < 5) spofs.push({ reason: `only ${total} nodes registered`, severity: "critical" });
  if (distribution[0] && distribution[0].share > 0.5) {
    spofs.push({ reason: `${distribution[0].jurisdiction} hosts ${(distribution[0].share * 100).toFixed(0)}% of nodes`, severity: "high" });
  }
  if (live === 0 && total > 0) spofs.push({ reason: "no live nodes (all stale)", severity: "critical" });
  if (byJurisdiction.size === 1 && total > 1) spofs.push({ reason: "single jurisdiction", severity: "high" });

  let verdict: SovereigntyReport["verdict"] = "embryonic";
  if (total >= 5) verdict = "regional";
  if (total >= 50 && byJurisdiction.size >= 5) verdict = "multi-jurisdictional";
  if (total >= SOVEREIGN_TARGET_NODES && byJurisdiction.size >= SOVEREIGN_TARGET_JURISDICTIONS) verdict = "sovereign";

  const reasoning = `${total} nodes across ${byJurisdiction.size} jurisdictions; ${live} live, ${stale} stale; concentration=${conc.toFixed(2)} (target<0.30 to be safe). Sovereign target: ${SOVEREIGN_TARGET_NODES}+ nodes, ${SOVEREIGN_TARGET_JURISDICTIONS}+ jurisdictions.`;

  return {
    generatedAt: asOf.toISOString(),
    nodeCount: total,
    jurisdictionCount: byJurisdiction.size,
    jurisdictionDistribution: distribution,
    concentrationRisk: +conc.toFixed(4),
    liveNodes: live,
    staleNodes: stale,
    spofs,
    verdict,
    reasoning,
  };
}
