/**
 * `mneme cluster` — semantic clustering of commit messages.
 *
 * Closes the "commit message NLP clustering" gap from the landscape
 * survey: academic papers (arxiv 2110.00697) cluster commits semantically
 * but never ship. Mneme ships it.
 *
 * Design choices:
 *   - We DON'T ship a heavyweight embedding pipeline here. Instead we
 *     use lightweight token shingles + Jaccard similarity, which gives
 *     ~80% of the value at near-zero cost and zero deps. When commits
 *     have embeddings indexed (via @mneme-ai/embeddings), the caller
 *     can pass them in and we'll use cosine instead.
 *   - Clustering is single-pass agglomerative — for a few thousand
 *     commits it's fast enough; for 100k commits the caller should
 *     pre-filter by date / path.
 *   - Cluster topics are extracted by surfacing the top-N tokens that
 *     appear in ≥ K of a cluster's commit subjects (cluster-defining
 *     vocabulary).
 *
 * Pure data extraction. CLI renders.
 */
import type { Commit } from "../types.js";

export interface CommitCluster {
  id: number;
  /** Number of commits in this cluster. */
  size: number;
  /** Top vocabulary terms shared across the cluster's commit subjects. */
  topTerms: string[];
  /** Sample commits (most representative — closest to the cluster centroid). */
  samples: Commit[];
  /** Date range covered by this cluster. */
  fromDate: string;
  toDate: string;
  /** Cluster cohesion 0..1 — average pairwise similarity. */
  cohesion: number;
}

export interface ClusterReport {
  /** Total commits considered. */
  totalCommits: number;
  /** Resulting clusters, sorted by size descending. */
  clusters: CommitCluster[];
  /** Commits that didn't fit any cluster (singletons). */
  outliers: Commit[];
}

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","for","and","or","with","add","added","fix",
  "remove","update","change","make","made","new","old","this","that","is","are","be",
  "was","were","my","our","your","i","we","you","it","its","into","from","by","at",
  "feat","chore","docs","test","refactor","style","build","ci","perf","revert",
  "merge","branch","pr","issue","close","closes","fixes",
]);

export function buildClusters(
  commits: Commit[],
  opts: {
    similarityFloor?: number; // floor for joining a cluster
    minClusterSize?: number;
    maxSamplesPerCluster?: number;
    embeddings?: Map<string, Float32Array>; // optional: hash -> embedding
  } = {},
): ClusterReport {
  const floor = opts.similarityFloor ?? 0.3;
  const minSize = opts.minClusterSize ?? 2;
  const maxSamples = opts.maxSamplesPerCluster ?? 3;

  if (commits.length === 0) {
    return { totalCommits: 0, clusters: [], outliers: [] };
  }

  const useEmbeddings = (opts.embeddings?.size ?? 0) > 0;

  // Pre-tokenize each commit for cheap reuse
  const tokenized: Array<{ commit: Commit; tokens: Set<string>; vec?: Float32Array }> = commits.map(
    (c) => ({
      commit: c,
      tokens: tokenizeSet(`${c.subject}\n${c.body || ""}`),
      vec: opts.embeddings?.get(c.hash),
    }),
  );

  // Greedy single-pass: each commit joins the first cluster that exceeds floor
  const clusters: Array<typeof tokenized> = [];
  for (const item of tokenized) {
    let joined = false;
    for (const cluster of clusters) {
      const sample = cluster[0]!;
      const sim = useEmbeddings && sample.vec && item.vec
        ? cosine(sample.vec, item.vec)
        : jaccard(sample.tokens, item.tokens);
      if (sim >= floor) {
        cluster.push(item);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push([item]);
  }

  // Build report
  const result: CommitCluster[] = [];
  const outliers: Commit[] = [];
  let id = 1;
  for (const cluster of clusters) {
    if (cluster.length < minSize) {
      for (const it of cluster) outliers.push(it.commit);
      continue;
    }
    const allCommits = cluster.map((c) => c.commit).sort((a, b) =>
      a.authorDate.localeCompare(b.authorDate),
    );
    result.push({
      id: id++,
      size: cluster.length,
      topTerms: clusterTopTerms(cluster.map((c) => c.tokens)),
      samples: pickSamples(cluster, maxSamples),
      fromDate: allCommits[0]!.authorDate.slice(0, 10),
      toDate: allCommits[allCommits.length - 1]!.authorDate.slice(0, 10),
      cohesion: avgCohesion(cluster, useEmbeddings),
    });
  }
  result.sort((a, b) => b.size - a.size);

  return {
    totalCommits: commits.length,
    clusters: result,
    outliers,
  };
}

function tokenizeSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]+/g, " ")
    .split(/\s+/)) {
    if (!t || t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function clusterTopTerms(tokenSets: Set<string>[]): string[] {
  if (tokenSets.length === 0) return [];
  const docFreq = new Map<string, number>();
  for (const ts of tokenSets) {
    for (const t of ts) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const minDocsForTerm = Math.max(2, Math.ceil(tokenSets.length / 3));
  return [...docFreq.entries()]
    .filter(([, count]) => count >= minDocsForTerm)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);
}

function pickSamples(
  items: Array<{ commit: Commit; tokens: Set<string> }>,
  k: number,
): Commit[] {
  if (items.length <= k) return items.map((i) => i.commit);
  // Closest to centroid (by avg jaccard to others)
  const scored = items.map((it) => {
    let total = 0;
    for (const other of items) {
      if (other === it) continue;
      total += jaccard(it.tokens, other.tokens);
    }
    return { it, score: total };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.it.commit);
}

function avgCohesion(
  items: Array<{ tokens: Set<string>; vec?: Float32Array }>,
  useEmbeddings: boolean,
): number {
  if (items.length < 2) return 1;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const sim = useEmbeddings && a.vec && b.vec
        ? cosine(a.vec, b.vec)
        : jaccard(a.tokens, b.tokens);
      sum += sim;
      pairs++;
    }
  }
  return pairs === 0 ? 0 : Number((sum / pairs).toFixed(3));
}
