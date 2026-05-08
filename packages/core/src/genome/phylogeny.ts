/**
 * Phylogenetic Tree (G1) — tool ancestry queries.
 *
 * Build a tree from annotated tools (parent links). Provide:
 *   • findAncestors(name) — every ancestor up to root
 *   • findCousins(name, k) — siblings sharing common ancestor within k levels
 *   • findClosestRelative(name, candidatePool) — closest tool in pool by tree distance
 *   • treeDistance(a, b) — symmetric ancestor-distance metric
 *   • speciationEvents() — branch points in the tree
 *
 * Pure functions. Deterministic. NEVER throws.
 */

import type { AnnotatedTool } from "./annotator.js";

export interface TreeNode {
  name: string;
  domain: string;
  parent: TreeNode | null;
  children: TreeNode[];
  /** Depth from root; root = 0. */
  depth: number;
}

export interface PhylogeneticTree {
  /** Synthetic root (groups all top-level orphans). */
  root: TreeNode;
  /** Lookup map: tool name → node. */
  byName: Map<string, TreeNode>;
}

/**
 * Build the phylogenetic tree from annotated tools.
 *
 * Tools without a parent (or whose parent doesn't exist in the catalog)
 * are attached to a synthetic root "ROOT" so the structure is always a
 * connected tree.
 *
 * Cycles are broken by orphaning the offending node to ROOT (defensive).
 */
export function buildPhylogeny(tools: AnnotatedTool[]): PhylogeneticTree {
  const byName = new Map<string, TreeNode>();
  const root: TreeNode = { name: "ROOT", domain: "compose", parent: null, children: [], depth: 0 };
  byName.set("ROOT", root);

  // Phase 1: create all nodes (no parent links yet)
  for (const t of tools) {
    if (byName.has(t.name)) continue; // dedupe
    byName.set(t.name, {
      name: t.name,
      domain: t.domain,
      parent: null,
      children: [],
      depth: 0,
    });
  }

  // Phase 2: link parents.
  // Cycle defense: walk up the candidate parent chain; if we ever revisit
  // `t.name`, the chain forms a cycle → orphan to ROOT.
  for (const t of tools) {
    const node = byName.get(t.name)!;
    let parentName: string;
    if (!t.parent || !byName.has(t.parent)) {
      parentName = "ROOT";
    } else {
      // Walk up the candidate parent chain
      let probe: string | null = t.parent;
      const visited = new Set<string>([t.name]);
      let cycleDetected = false;
      let hops = 0;
      while (probe && hops < 1000) {
        if (visited.has(probe)) {
          cycleDetected = true;
          break;
        }
        visited.add(probe);
        const next = tools.find((x) => x.name === probe)?.parent ?? null;
        if (!next) break;
        probe = next;
        hops += 1;
      }
      parentName = cycleDetected ? "ROOT" : t.parent;
    }
    const parent = byName.get(parentName)!;
    node.parent = parent;
    parent.children.push(node);
  }

  // Phase 3: BFS to assign depths (visited set defends against any
  // residual cycle that slipped past Phase 2)
  const queue: TreeNode[] = [root];
  const seen = new Set<TreeNode>([root]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of cur.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      child.depth = cur.depth + 1;
      queue.push(child);
    }
  }

  // Sort children alphabetically for determinism (visited again to be safe)
  const sortStack: TreeNode[] = [root];
  const sortSeen = new Set<TreeNode>([root]);
  while (sortStack.length) {
    const cur = sortStack.pop()!;
    cur.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of cur.children) {
      if (sortSeen.has(c)) continue;
      sortSeen.add(c);
      sortStack.push(c);
    }
  }

  return { root, byName };
}

/** Walk from node to ROOT, returning ancestor names (root last). */
export function findAncestors(tree: PhylogeneticTree, name: string): string[] {
  const node = tree.byName.get(name);
  if (!node) return [];
  const out: string[] = [];
  let cur = node.parent;
  let safety = 1000;
  while (cur && safety-- > 0) {
    out.push(cur.name);
    cur = cur.parent;
  }
  return out;
}

/**
 * Cousins = nodes that share a common ancestor within `k` levels above
 * the given node, EXCLUDING the node itself + descendants.
 */
export function findCousins(tree: PhylogeneticTree, name: string, k: number = 1): string[] {
  const node = tree.byName.get(name);
  if (!node) return [];
  const out = new Set<string>();
  // Walk up `k` levels, collect descendants of each, exclude self + descendants
  const selfDescendants = collectDescendants(node);
  selfDescendants.add(name);
  let cur: TreeNode | null = node.parent;
  let levels = 0;
  while (cur && levels < k) {
    for (const sib of cur.children) {
      if (sib.name === node.name) continue;
      out.add(sib.name);
      for (const d of collectDescendants(sib)) out.add(d);
    }
    cur = cur.parent;
    levels += 1;
  }
  for (const d of selfDescendants) out.delete(d);
  return Array.from(out).sort();
}

function collectDescendants(node: TreeNode): Set<string> {
  const out = new Set<string>();
  const stack: TreeNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of cur.children) {
      out.add(child.name);
      stack.push(child);
    }
  }
  return out;
}

/**
 * Tree distance — number of edges between two nodes via their lowest
 * common ancestor (LCA). Symmetric.
 *
 * Returns Infinity if either node missing.
 */
export function treeDistance(tree: PhylogeneticTree, a: string, b: string): number {
  const nodeA = tree.byName.get(a);
  const nodeB = tree.byName.get(b);
  if (!nodeA || !nodeB) return Infinity;
  if (a === b) return 0;
  // Walk both nodes to ROOT; lowest common ancestor = first shared
  const ancestorsA = new Map<string, number>();
  let cur: TreeNode | null = nodeA;
  let dist = 0;
  while (cur) {
    ancestorsA.set(cur.name, dist);
    cur = cur.parent;
    dist += 1;
  }
  cur = nodeB;
  let distB = 0;
  while (cur) {
    if (ancestorsA.has(cur.name)) {
      return ancestorsA.get(cur.name)! + distB;
    }
    cur = cur.parent;
    distB += 1;
  }
  return Infinity;
}

/**
 * Pick the closest relative to `name` from `candidatePool` by tree distance.
 * Ties broken by alphabetical order. Returns null if pool empty / all
 * unrelated.
 */
export function findClosestRelative(
  tree: PhylogeneticTree,
  name: string,
  candidatePool: string[],
): { name: string; distance: number } | null {
  let best: { name: string; distance: number } | null = null;
  const sorted = [...candidatePool].sort();
  for (const cand of sorted) {
    if (cand === name) continue;
    const d = treeDistance(tree, name, cand);
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.distance) {
      best = { name: cand, distance: d };
    }
  }
  return best;
}

/** Speciation events = nodes with > 1 child (where the lineage branched). */
export function speciationEvents(tree: PhylogeneticTree): Array<{ ancestor: string; branches: string[] }> {
  const out: Array<{ ancestor: string; branches: string[] }> = [];
  const stack: TreeNode[] = [tree.root];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.children.length > 1) {
      out.push({
        ancestor: cur.name,
        branches: cur.children.map((c) => c.name).sort(),
      });
    }
    for (const c of cur.children) stack.push(c);
  }
  return out.sort((a, b) => a.ancestor.localeCompare(b.ancestor));
}

/** Render an ASCII tree for debugging / docs. */
export function renderAsciiTree(tree: PhylogeneticTree): string {
  const lines: string[] = [];
  function walk(node: TreeNode, prefix: string, isLast: boolean): void {
    const branch = node === tree.root ? "" : isLast ? "└─ " : "├─ ";
    lines.push(prefix + branch + node.name);
    const childPrefix = node === tree.root ? "" : prefix + (isLast ? "   " : "│  ");
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]!, childPrefix, i === node.children.length - 1);
    }
  }
  walk(tree.root, "", true);
  return lines.join("\n");
}
