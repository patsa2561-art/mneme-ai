/**
 * Mneme GraphRAG -- public surface.
 *
 *   buildKnowledgeGraph(repoRoot) -> KnowledgeGraph
 *   louvain(graph)                -> CommunityResult
 *   readCachedGraph / writeCachedGraph for persistence
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommunityResult, KnowledgeGraph } from "./types.js";

export type { KnowledgeGraph, KnowledgeGraphNode, KnowledgeGraphEdge, NodeKind, Community, CommunityResult } from "./types.js";
export { buildKnowledgeGraph } from "./build.js";
export { louvain } from "./louvain.js";
export type { LateChunkInput, LateChunkOutput } from "./late_chunking.js";
export { lateChunkEmbed } from "./late_chunking.js";

const GRAPH_FILE = ".mneme/graphrag/graph.json";
const COMMUNITIES_FILE = ".mneme/graphrag/communities.json";

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme", "graphrag");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readCachedGraph(repoRoot: string): KnowledgeGraph | null {
  const path = join(repoRoot, GRAPH_FILE);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeCachedGraph(repoRoot: string, g: KnowledgeGraph): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, GRAPH_FILE), JSON.stringify(g, null, 2), "utf8");
  } catch { /* best-effort */ }
}

export function readCachedCommunities(repoRoot: string): CommunityResult | null {
  const path = join(repoRoot, COMMUNITIES_FILE);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeCachedCommunities(repoRoot: string, c: CommunityResult): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, COMMUNITIES_FILE), JSON.stringify(c, null, 2), "utf8");
  } catch { /* best-effort */ }
}
