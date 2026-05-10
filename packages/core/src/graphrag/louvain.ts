/**
 * Louvain community detection -- pure JS, no deps. Newman's modularity-
 * maximizing algorithm. Runs in O(V * log V) per pass, typically 3-5
 * passes to converge on graphs of <50K nodes.
 *
 * Why Louvain over Leiden: Leiden is slightly better quality but adds
 * a refinement pass that's harder to implement correctly. For Mneme's
 * graph sizes (~1-10K nodes per repo), Louvain is plenty.
 */

import type { Community, CommunityResult, KnowledgeGraph } from "./types.js";

interface AdjacencyMap {
  /** node -> neighbor -> weight (sum of edge weights between them) */
  adj: Map<string, Map<string, number>>;
  /** node -> total weight of incident edges (k_i) */
  degree: Map<string, number>;
  /** total weight of all edges (m). Each undirected edge counted ONCE here. */
  totalWeight: number;
}

function buildAdjacency(graph: KnowledgeGraph): AdjacencyMap {
  const adj = new Map<string, Map<string, number>>();
  const degree = new Map<string, number>();
  let totalWeight = 0;
  // Initialize all nodes (so isolated nodes get an entry)
  for (const n of graph.nodes) {
    adj.set(n.id, new Map());
    degree.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    const a = adj.get(e.from)!;
    const b = adj.get(e.to)!;
    a.set(e.to, (a.get(e.to) ?? 0) + e.weight);
    b.set(e.from, (b.get(e.from) ?? 0) + e.weight);
    degree.set(e.from, (degree.get(e.from) ?? 0) + e.weight);
    degree.set(e.to, (degree.get(e.to) ?? 0) + e.weight);
    totalWeight += e.weight;
  }
  return { adj, degree, totalWeight };
}

/** Compute modularity gain when moving node `n` from its current community
 *  to community `c`. Standard Louvain delta formula. */
function modularityDelta(
  n: string,
  c: string,
  community: Map<string, string>,
  communitySumWeights: Map<string, number>,
  adjacency: AdjacencyMap,
  k_i: number,
  k_i_in: number,
  m: number,
): number {
  const sumIn = communitySumWeights.get(c) ?? 0;
  const oldC = community.get(n);
  const isOldCommunity = oldC === c;
  // Standard formula:
  //   ΔQ = [ (k_i_in / m) - 2 * sumIn * k_i / (2m)^2 ]
  // But we ignore self-loop case (Mneme graph has none).
  void isOldCommunity;
  void adjacency;
  const term1 = k_i_in / Math.max(1, m);
  const term2 = (sumIn * k_i) / (2 * m * m);
  return term1 - term2;
}

export function louvain(graph: KnowledgeGraph, opts: { maxPasses?: number } = {}): CommunityResult {
  const maxPasses = opts.maxPasses ?? 10;
  const adjacency = buildAdjacency(graph);
  const m = adjacency.totalWeight;
  if (m === 0) {
    return {
      communities: [],
      modularity: 0,
      iterations: 0,
      ranAt: new Date().toISOString(),
    };
  }
  // Init: every node in its own community.
  const community = new Map<string, string>();
  for (const n of graph.nodes) community.set(n.id, n.id);
  // Per-community sum of node degrees.
  const communitySumWeights = new Map<string, number>();
  for (const [nodeId, deg] of adjacency.degree) {
    communitySumWeights.set(nodeId, deg);
  }

  let iterations = 0;
  let changed = true;
  while (changed && iterations < maxPasses) {
    changed = false;
    iterations++;
    // Iterate nodes in stable order for determinism.
    const nodeIds = Array.from(adjacency.adj.keys()).sort();
    for (const n of nodeIds) {
      const k_i = adjacency.degree.get(n) ?? 0;
      if (k_i === 0) continue;
      const oldC = community.get(n)!;
      // Compute weight from n to each neighboring community.
      const neighborCommunityWeight = new Map<string, number>();
      for (const [neighbor, w] of adjacency.adj.get(n)!) {
        const nc = community.get(neighbor)!;
        neighborCommunityWeight.set(nc, (neighborCommunityWeight.get(nc) ?? 0) + w);
      }
      // Best community to move to.
      let bestC = oldC;
      let bestDelta = 0;
      // First: subtract n from its current community.
      const k_i_in_old = neighborCommunityWeight.get(oldC) ?? 0;
      communitySumWeights.set(oldC, (communitySumWeights.get(oldC) ?? 0) - k_i);
      for (const [c, k_i_in] of neighborCommunityWeight) {
        const delta = modularityDelta(n, c, community, communitySumWeights, adjacency, k_i, k_i_in, m);
        if (delta > bestDelta + 1e-9) {
          bestDelta = delta;
          bestC = c;
        }
      }
      // Add n to its (possibly new) best community.
      communitySumWeights.set(bestC, (communitySumWeights.get(bestC) ?? 0) + k_i);
      if (bestC !== oldC) {
        community.set(n, bestC);
        changed = true;
      } else {
        // Restore subtraction (n stayed in oldC; subtraction was tentative).
        // Already added back since bestC === oldC -> communitySumWeights restored.
        // Use k_i_in_old to silence lint.
        void k_i_in_old;
      }
    }
  }

  // Group nodes by community id.
  const groups = new Map<string, string[]>();
  for (const [n, c] of community) {
    let arr = groups.get(c);
    if (!arr) { arr = []; groups.set(c, arr); }
    arr.push(n);
  }

  // Drop singletons (uninteresting). Keep their members floating (no
  // community); they show up as "uncategorized" in the UI.
  const realGroups = Array.from(groups.entries()).filter(([, members]) => members.length >= 2);

  // Compute modularity of the final partition.
  let Q = 0;
  for (const [c, members] of realGroups) {
    const sumIn = communitySumWeights.get(c) ?? 0;
    let lc = 0; // sum of weights of edges INSIDE this community
    const memberSet = new Set(members);
    for (const n of members) {
      for (const [neigh, w] of adjacency.adj.get(n) ?? []) {
        if (memberSet.has(neigh)) lc += w;
      }
    }
    lc /= 2; // each undirected edge counted twice in the loop
    Q += (lc / m) - Math.pow(sumIn / (2 * m), 2);
  }

  // Build Community[] with auto-labels from member kinds + dominant tokens.
  const communities: Community[] = realGroups.map(([cid, members], idx) => {
    const memberSet = new Set(members);
    let lc = 0;
    let degSum = 0;
    for (const n of members) {
      degSum += adjacency.degree.get(n) ?? 0;
      for (const [neigh, w] of adjacency.adj.get(n) ?? []) {
        if (memberSet.has(neigh)) lc += w;
      }
    }
    lc /= 2;
    const density = degSum === 0 ? 0 : (2 * lc) / degSum;

    // Auto-label: top filename tokens from file-kind members.
    const tokenCounts = new Map<string, number>();
    for (const n of members) {
      const node = graph.nodes.find((g) => g.id === n);
      if (!node || node.kind !== "file") continue;
      for (const t of node.label.toLowerCase().split(/[._\-/]/).filter((x) => x.length >= 3)) {
        tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
      }
    }
    const topTokens = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((x) => x[0]);

    return {
      id: `c${idx}`,
      members,
      density: Number(density.toFixed(3)),
      label: topTokens.length > 0 ? topTokens.slice(0, 3).join(" + ") : `community-${cid.slice(0, 12)}`,
      topics: topTokens,
    };
  }).sort((a, b) => b.members.length - a.members.length);

  return {
    communities,
    modularity: Number(Q.toFixed(4)),
    iterations,
    ranAt: new Date().toISOString(),
  };
}
