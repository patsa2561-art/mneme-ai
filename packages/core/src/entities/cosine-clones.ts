/**
 * Cosine-similarity clone detector.
 *
 *   1. For each entity pair, compute cosine of their embeddings.
 *   2. Build a similarity graph: edge A↔B if cos(A,B) ≥ threshold.
 *   3. Connected-component-cluster the graph (union-find).
 *   4. Drop singletons; cap cluster size at maxClusterSize.
 *   5. Compute cohesion = mean pairwise cosine within cluster.
 *
 * Why connected components and not HDBSCAN: the threshold is the user's lever.
 * Connected components are monotone in the threshold — slide it up, get fewer
 * tighter clusters; slide it down, get bigger looser ones. Users can reason
 * about that. HDBSCAN's `min_cluster_size` and `min_samples` are not
 * intuitive for "I want clones tighter than 0.85".
 *
 * Complexity: O(N²). Fine up to ~5,000 entities (~12 M comparisons, sub-second
 * on a laptop). Beyond that, swap in approximate-NN — same surface, faster core.
 */
import { createHash } from "node:crypto";
import type { Entity } from "../types.js";
import {
  DEFAULT_CLONE_THRESHOLD,
  DEFAULT_MAX_CLUSTER_SIZE,
  type CloneDetector,
  type DetectOptions,
  type EntityCluster,
} from "./index.js";

interface EmbeddedEntity extends Entity {
  embedding: Float32Array;
}

export class CosineCloneDetector implements CloneDetector {
  readonly name = "cosine-connected-components-v1";

  async detect(opts: DetectOptions): Promise<EntityCluster[]> {
    const threshold = opts.threshold ?? DEFAULT_CLONE_THRESHOLD;
    const maxClusterSize = opts.maxClusterSize ?? DEFAULT_MAX_CLUSTER_SIZE;

    const withVecs = opts.entities.filter(hasEmbedding);
    if (withVecs.length < 2) return [];

    // Pre-normalize for cosine = dot product.
    const norms = withVecs.map((e) => normalize(e.embedding));

    // Union-find structure.
    const parent = new Int32Array(withVecs.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x]! !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    // Pair-wise cosine via dot of normalized vectors. Track sims for cohesion.
    const simMap = new Map<string, number>(); // key: "min-max"
    for (let i = 0; i < norms.length; i++) {
      for (let j = i + 1; j < norms.length; j++) {
        const sim = dot(norms[i]!, norms[j]!);
        if (sim >= threshold) {
          union(i, j);
          simMap.set(`${i}-${j}`, sim);
        }
      }
    }

    // Group by root.
    const groups = new Map<number, number[]>();
    for (let i = 0; i < withVecs.length; i++) {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(i);
      else groups.set(root, [i]);
    }

    const clusters: EntityCluster[] = [];
    for (const [, indices] of groups) {
      if (indices.length < 2) continue;
      const limited = indices.slice(0, maxClusterSize);
      const cohesion = pairwiseMean(limited, simMap);
      const members = limited.map((i) => stripVec(withVecs[i]!));
      clusters.push({
        id: clusterId(members.map((m) => m.id)),
        cohesion,
        members,
      });
    }

    // Stable ordering: most-cohesive first; tiebreak by largest cluster.
    clusters.sort((a, b) => {
      if (b.members.length !== a.members.length) return b.members.length - a.members.length;
      return b.cohesion - a.cohesion;
    });

    return clusters;
  }
}

function hasEmbedding(e: Entity): e is EmbeddedEntity {
  return e.embedding instanceof Float32Array && e.embedding.length > 0;
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  const norm = Math.sqrt(n);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function pairwiseMean(indices: number[], simMap: Map<string, number>): number {
  if (indices.length < 2) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const a = indices[i]!;
      const b = indices[j]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const sim = simMap.get(key);
      if (sim !== undefined) {
        total += sim;
        count++;
      }
    }
  }
  return count > 0 ? total / count : 0;
}

function stripVec<T extends Entity>(e: T): Entity {
  const { embedding, ...rest } = e as Entity;
  void embedding;
  return rest;
}

function clusterId(memberIds: string[]): string {
  const sorted = [...memberIds].sort();
  return "c_" + createHash("sha1").update(sorted.join("|")).digest("hex").slice(0, 12);
}
