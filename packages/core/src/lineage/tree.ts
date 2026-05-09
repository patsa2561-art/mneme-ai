/**
 * Lineage tree — DAG of chromosomes (parents ↔ children).
 *
 * Persisted at `.mneme/lineage/tree.json`. Every chromosome write updates
 * the tree atomically. Lookups walk the in-memory cache; mutations are
 * write-through.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { listChromosomes, loadChromosome } from "./chromosome.js";
import { lineageRoot, treePath } from "./paths.js";
import type { Chromosome, LineageNode, LineageTree } from "./types.js";

function emptyTree(): LineageTree {
  return { schemaVersion: 1, nodes: {}, head: null, species: {} };
}

export function readTree(repoRoot: string): LineageTree {
  const path = treePath(repoRoot);
  if (!existsSync(path)) return emptyTree();
  try {
    const t = JSON.parse(readFileSync(path, "utf8")) as LineageTree;
    if (t.schemaVersion !== 1) return emptyTree();
    return t;
  } catch {
    return emptyTree();
  }
}

export function writeTree(repoRoot: string, tree: LineageTree): void {
  const dir = lineageRoot(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = treePath(repoRoot);
  // Atomic write.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(tree, null, 2), "utf8");
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  if (!existsSync(dirname(tmp))) mkdirSync(dirname(tmp), { recursive: true });
  renameSync(tmp, path);
}

/** Add a chromosome to the tree, updating parent ↔ child links + head. */
export function addToTree(repoRoot: string, c: Chromosome): LineageTree {
  const tree = readTree(repoRoot);
  if (tree.nodes[c.id]) return tree; // idempotent
  const node: LineageNode = { id: c.id, parents: c.parents, children: [] };
  tree.nodes[c.id] = node;
  for (const p of c.parents) {
    const parent = tree.nodes[p];
    if (parent && !parent.children.includes(c.id)) parent.children.push(c.id);
  }
  // Head = newest by createdAt across nodes (we just added c, so c wins
  // unless an existing node is newer — defensive against out-of-order writes).
  const headChromosome = tree.head ? safeLoad(repoRoot, tree.head) : null;
  if (!headChromosome || c.createdAt >= headChromosome.createdAt) {
    tree.head = c.id;
  }
  writeTree(repoRoot, tree);
  return tree;
}

function safeLoad(repoRoot: string, id: string): Chromosome | null {
  try { return loadChromosome(repoRoot, id); } catch { return null; }
}

/** Walk `n` ancestors of a starting node — newest-first BFS. */
export function ancestors(tree: LineageTree, startId: string, n: number): string[] {
  const out: string[] = [];
  const queue: string[] = [startId];
  const seen = new Set<string>();
  while (queue.length > 0 && out.length < n) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id !== startId) out.push(id);
    const node = tree.nodes[id];
    if (node) for (const p of node.parents) queue.push(p);
  }
  return out;
}

/** All descendants of a node — BFS. */
export function descendants(tree: LineageTree, startId: string): string[] {
  const out: string[] = [];
  const queue: string[] = [startId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id !== startId) out.push(id);
    const node = tree.nodes[id];
    if (node) for (const c of node.children) queue.push(c);
  }
  return out;
}

/** Reconstruct the tree from disk if tree.json is missing/corrupt
 *  (recovery path — used by the orphan-detection routine). */
export function rebuildTreeFromDisk(repoRoot: string): LineageTree {
  const tree = emptyTree();
  for (const id of listChromosomes(repoRoot)) {
    const c = safeLoad(repoRoot, id);
    if (!c) continue;
    addToTree(repoRoot, c);
  }
  return readTree(repoRoot);
}

/** Common ancestor (LCA approximation) — find the deepest shared ancestor
 *  of two nodes, walking parents BFS. Used for pedigree distance. */
export function findCommonAncestor(tree: LineageTree, a: string, b: string): string | null {
  const ancA = new Set(ancestors(tree, a, 1000));
  ancA.add(a);
  const queueB: string[] = [b];
  const seen = new Set<string>();
  while (queueB.length > 0) {
    const id = queueB.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (ancA.has(id)) return id;
    const node = tree.nodes[id];
    if (node) for (const p of node.parents) queueB.push(p);
  }
  return null;
}
