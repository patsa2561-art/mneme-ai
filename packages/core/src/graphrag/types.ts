/**
 * Mneme GraphRAG -- knowledge graph over (commits × files × authors)
 * with community detection (Louvain). The communities surface as
 * "topics" the retrieve/ layer can filter by.
 *
 * Why GraphRAG matters: pure RAG retrieves chunks one-by-one; GraphRAG
 * exploits that good answers live in CLUSTERS of related chunks. By
 * pre-computing communities offline, we can:
 *   - filter top-K to the most-relevant community ("topic")
 *   - surface community summaries as facets
 *   - identify isolated chunks that may be hallucination targets
 */

export type NodeKind = "commit" | "file" | "author";

export interface KnowledgeGraphNode {
  id: string;
  kind: NodeKind;
  /** Stable label (commit short SHA, basename, author name). */
  label: string;
  /** Per-kind metadata; loose so the graph stays small. */
  meta?: Record<string, string | number>;
}

export interface KnowledgeGraphEdge {
  /** From-node id. */
  from: string;
  /** To-node id. */
  to: string;
  /** Edge type informs weighting:
   *   "authored":  author -> commit  (weight 1)
   *   "touched":   commit -> file    (weight = log(line-changes))
   *   "co-edits":  file -> file via shared commit (weight = co-edit count)
   *   "co-author": author -> author via shared file (weight = shared count)
   */
  kind: "authored" | "touched" | "co-edits" | "co-author";
  weight: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  /** ISO timestamp the graph was built. */
  builtAt: string;
  /** Source: how the graph was constructed (e.g., "git log -N"). */
  source: string;
}

export interface Community {
  /** Stable id ("c0", "c1", ...). */
  id: string;
  /** Member node ids. */
  members: string[];
  /** Density = (intra-community edge weight) / (sum of node degrees). */
  density: number;
  /** Auto-derived label from the dominant file paths / commit subjects. */
  label: string;
  /** Topic tags extracted from member labels (top tokens). */
  topics: string[];
}

export interface CommunityResult {
  communities: Community[];
  /** Modularity of the partition (Newman's metric, 0..1; >0.3 = good). */
  modularity: number;
  /** Iterations the Louvain pass took to converge. */
  iterations: number;
  /** ISO timestamp. */
  ranAt: string;
}
