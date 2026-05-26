/**
 * v2.60.0 — SKELETON KEY bypass graph.
 *
 * Models MCP servers as graph nodes; edges = capability overlap. Computes
 * transitive bypass paths so we surface that e.g. shell-mcp + git-mcp +
 * file-mcp = THREE independent ways to delete the repo, even if each is
 * "lightly scoped" in isolation.
 *
 * Most security audit tools stop at single-server analysis. SKELETON KEY
 * computes the GRAPH because the actual security model is the union of
 * all capabilities reachable through ANY allowed server.
 */

import type { RiskHeuristic } from "./risk_heuristics.js";

export interface ServerNode {
  name: string;
  /** Risk class assigned (heuristic or empirical). */
  risk: RiskHeuristic;
  /** Source: which config file declared this server. */
  source: string;
}

export interface CapabilityOverlap {
  capability: string;
  servers: string[];
  /** Count of independent servers exposing this capability. */
  count: number;
}

export interface BypassPath {
  /** Capability the attacker is after (e.g. "delete_repo", "exfiltrate_secret"). */
  goal: string;
  /** Ordered list of servers + their step in the chain. */
  steps: Array<{ server: string; via: string }>;
  /** 0..1 severity of the easiest step in the chain. */
  weakestSeverity: number;
  /** Plain-English description. */
  narrative: string;
}

/** Goal → set of contributing capabilities (any one enables it). */
const GOAL_TO_CAPABILITIES: Record<string, string[]> = {
  delete_repo: ["exec", "write_fs", "git_write"],
  exfiltrate_secret: ["read_fs", "network", "exec", "read_memory"],
  drop_database: ["db_ddl", "exec"],
  modify_ci_pipeline: ["git_write", "write_fs", "exec"],
  unauthorized_cloud_change: ["cloud_mutate", "exec"],
  ssrf_internal_network: ["browser_automation", "network", "exec"],
};

/**
 * Build the bypass graph from a list of server nodes.
 * Returns capability overlaps + transitive bypass paths.
 */
export interface BypassGraph {
  nodes: ServerNode[];
  overlaps: CapabilityOverlap[];
  bypassPaths: BypassPath[];
}

export function buildBypassGraph(nodes: ServerNode[]): BypassGraph {
  // Capability inverted index.
  const capToServers = new Map<string, ServerNode[]>();
  for (const n of nodes) {
    for (const c of n.risk.capabilities) {
      const list = capToServers.get(c) ?? [];
      list.push(n);
      capToServers.set(c, list);
    }
  }

  const overlaps: CapabilityOverlap[] = [];
  for (const [cap, servers] of capToServers.entries()) {
    if (servers.length >= 2) {
      overlaps.push({
        capability: cap,
        servers: servers.map((s) => s.name),
        count: servers.length,
      });
    }
  }
  overlaps.sort((a, b) => b.count - a.count);

  const bypassPaths: BypassPath[] = [];
  for (const [goal, requiredCaps] of Object.entries(GOAL_TO_CAPABILITIES)) {
    // For each contributing cap, collect ALL servers that expose it.
    const stepsByCap: Array<{ cap: string; servers: ServerNode[] }> = [];
    for (const cap of requiredCaps) {
      const servers = capToServers.get(cap) ?? [];
      if (servers.length > 0) stepsByCap.push({ cap, servers });
    }
    // If at least 2 different capabilities are reachable (or 1 cap with 2+ servers),
    // we can build a bypass narrative.
    const totalDistinctServers = new Set<string>();
    for (const s of stepsByCap) for (const x of s.servers) totalDistinctServers.add(x.name);
    if (totalDistinctServers.size >= 2) {
      // Pick the lowest-friction route: one server per required cap.
      const steps = stepsByCap.map((s) => ({
        server: s.servers[0]!.name,
        via: s.cap,
      }));
      const allSeverities = stepsByCap.flatMap((s) => s.servers.map((x) => x.risk.severity));
      // Weakest link = the LOWEST severity any path step requires — the attacker only
      // needs the easiest unguarded surface.
      const weakestSeverity = Math.min(...allSeverities);
      bypassPaths.push({
        goal,
        steps,
        weakestSeverity,
        narrative: `${goal.replace(/_/g, " ")}: attacker can chain ${steps.map((s) => `\`${s.server}\`(${s.via})`).join(" → ")} (weakest-link severity ${(weakestSeverity * 100).toFixed(0)}%)`,
      });
    }
  }
  bypassPaths.sort((a, b) => b.weakestSeverity - a.weakestSeverity);

  return { nodes, overlaps, bypassPaths };
}

/**
 * Compute a single risk-budget score 0..N.
 * = Σ (severity × capability count per server).
 * Lower = safer.
 */
export function totalRiskBudget(nodes: ServerNode[]): number {
  return +nodes
    .reduce((s, n) => s + n.risk.severity * Math.max(1, n.risk.capabilities.length), 0)
    .toFixed(2);
}
