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

/** v1.25.1 -- Build a fast lookup: file path -> community id. The
 *  retrieve/search filter uses this to keep only chunks whose parent
 *  commit touched a file in the requested community. Returns null
 *  when no communities exist yet (fall back to no filter). */
export function fileToCommunityIndex(repoRoot: string): Map<string, string> | null {
  const cr = readCachedCommunities(repoRoot);
  if (!cr || cr.communities.length === 0) return null;
  const m = new Map<string, string>();
  for (const c of cr.communities) {
    for (const memberId of c.members) {
      // Member ids are like "file:packages/core/src/foo.ts" or
      // "commit:abc1234" or "author:name". We only care about files.
      if (memberId.startsWith("file:")) {
        m.set(memberId.slice(5), c.id);
      }
    }
  }
  return m;
}

/** Look up the community id for a file path, if any. */
export function communityForFile(
  index: Map<string, string> | null,
  filePath: string,
): string | null {
  if (!index) return null;
  return index.get(filePath) ?? null;
}

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
