/**
 * `mneme network` — author social graph with semantic edges.
 *
 * Closes the "author network with semantic edges" gap from the
 * landscape survey: Unblocked.com is the closest commercial competitor
 * (closed-source, PR-only, paid). No open-source tool builds an author
 * social graph weighted by *what they collaborated on*, not just
 * how often.
 *
 * Edges between authors are weighted by:
 *   - co-edits   : how often they touched the same file
 *   - co-time    : how often they committed within the same window
 *   - co-topic   : how often their commit messages share vocabulary
 *
 * The semantic component (co-topic) is what makes this novel — it
 * surfaces "Alice and Bob both worked on the auth refactor" even when
 * they touched different files.
 *
 * Pure data extraction. CLI renders.
 */
import type { Commit } from "../types.js";

export interface AuthorNode {
  author: string;
  /** Total commits in window. */
  commits: number;
  /** Number of distinct other authors collaborated with. */
  collaborators: number;
  /** Centrality 0..1 — how "bridging" they are between others. */
  centrality: number;
}

export interface AuthorEdge {
  authorA: string;
  authorB: string;
  /** Weight 0..1 — composite of co-edit, co-time, co-topic. */
  weight: number;
  /** Per-axis breakdown. */
  axes: {
    coEdit: number;
    coTime: number;
    coTopic: number;
  };
  /** Top shared vocabulary terms (drives the "what they worked on together" semantic edge label). */
  sharedTerms: string[];
}

export interface NetworkReport {
  windowCommits: number;
  nodes: AuthorNode[];
  edges: AuthorEdge[];
  /** Detected silos — sets of authors with weak edges to others. */
  silos: string[][];
  /** Detected bridges — authors connecting otherwise weakly-linked groups. */
  bridges: string[];
}

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","for","and","or","with","add","added","fix",
  "remove","update","change","make","made","new","old","this","that","is","are","be",
  "feat","chore","docs","test","refactor","style","build","ci","perf","revert",
  "merge","branch","pr","issue","close","closes","fixes","from","by","at","into",
]);

export function buildNetwork(
  commits: Commit[],
  opts: {
    coTimeWindowDays?: number; // commits within this window count as "concurrent"
    minEdgeWeight?: number; // floor for inclusion
    minAuthorCommits?: number;
  } = {},
): NetworkReport {
  const coTimeWindow = (opts.coTimeWindowDays ?? 7) * 86_400_000;
  const minEdge = opts.minEdgeWeight ?? 0.05;
  const minAuthor = opts.minAuthorCommits ?? 2;

  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));
  if (sorted.length === 0) {
    return { windowCommits: 0, nodes: [], edges: [], silos: [], bridges: [] };
  }

  // Author commit counts + tokens + files
  const authorCommits = new Map<string, Commit[]>();
  const authorTokens = new Map<string, Set<string>>();
  const authorFiles = new Map<string, Set<string>>();
  const tokenizedPerCommit = new Map<string, Set<string>>();

  for (const c of sorted) {
    const a = c.authorName || c.authorEmail;
    let arr = authorCommits.get(a);
    if (!arr) {
      arr = [];
      authorCommits.set(a, arr);
    }
    arr.push(c);
    const tokens = tokenizeSet(`${c.subject}\n${c.body || ""}`);
    tokenizedPerCommit.set(c.hash, tokens);
    let at = authorTokens.get(a);
    if (!at) {
      at = new Set();
      authorTokens.set(a, at);
    }
    for (const t of tokens) at.add(t);
    let af = authorFiles.get(a);
    if (!af) {
      af = new Set();
      authorFiles.set(a, af);
    }
    for (const f of c.files) af.add(f);
  }

  // Filter to authors meeting min
  const eligible = [...authorCommits.entries()]
    .filter(([, cs]) => cs.length >= minAuthor)
    .map(([a]) => a);

  // Build pairwise edges
  const edges: AuthorEdge[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      const aFiles = authorFiles.get(a)!;
      const bFiles = authorFiles.get(b)!;
      const aTokens = authorTokens.get(a)!;
      const bTokens = authorTokens.get(b)!;
      const aCommits = authorCommits.get(a)!;
      const bCommits = authorCommits.get(b)!;

      const coEdit = jaccard(aFiles, bFiles);
      const coTopic = jaccard(aTokens, bTokens);
      const coTime = computeCoTime(aCommits, bCommits, coTimeWindow);
      const weight = Number((0.4 * coEdit + 0.2 * coTime + 0.4 * coTopic).toFixed(3));
      if (weight < minEdge) continue;

      const sharedTerms = [...aTokens]
        .filter((t) => bTokens.has(t))
        .slice(0, 5);

      edges.push({
        authorA: a,
        authorB: b,
        weight,
        axes: {
          coEdit: Number(coEdit.toFixed(3)),
          coTime: Number(coTime.toFixed(3)),
          coTopic: Number(coTopic.toFixed(3)),
        },
        sharedTerms,
      });
    }
  }
  edges.sort((a, b) => b.weight - a.weight);

  // Build nodes with centrality (simple degree-normalized)
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.authorA, (degree.get(e.authorA) ?? 0) + e.weight);
    degree.set(e.authorB, (degree.get(e.authorB) ?? 0) + e.weight);
  }
  const maxDeg = Math.max(0, ...degree.values());
  const nodes: AuthorNode[] = eligible.map((author) => ({
    author,
    commits: authorCommits.get(author)!.length,
    collaborators: edges.filter((e) => e.authorA === author || e.authorB === author).length,
    centrality: maxDeg === 0 ? 0 : Number(((degree.get(author) ?? 0) / maxDeg).toFixed(3)),
  }));
  nodes.sort((a, b) => b.centrality - a.centrality);

  // Detect silos via connected components on the (filtered) graph
  const silos = detectSilos(eligible, edges);

  // Bridges: authors with edges to ≥ 2 silos
  const bridges = detectBridges(eligible, edges, silos);

  return {
    windowCommits: sorted.length,
    nodes,
    edges,
    silos,
    bridges,
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

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function computeCoTime(a: Commit[], b: Commit[], windowMs: number): number {
  if (a.length === 0 || b.length === 0) return 0;
  // For each commit in a, count if any commit in b is within window
  const bTimes = b.map((c) => new Date(c.authorDate).getTime()).sort((x, y) => x - y);
  let hits = 0;
  for (const ca of a) {
    const t = new Date(ca.authorDate).getTime();
    // binary search for any time within [t - window, t + window]
    const target = t;
    let lo = 0, hi = bTimes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = bTimes[mid]!;
      if (Math.abs(v - target) <= windowMs) {
        hits++;
        break;
      }
      if (v < target) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return hits / a.length;
}

function detectSilos(authors: string[], edges: AuthorEdge[]): string[][] {
  // Union-find over authors
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== x) {
      const grand = parent.get(p) ?? p;
      parent.set(x, grand);
      x = grand;
      p = parent.get(x) ?? x;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const a of authors) parent.set(a, a);
  // Only edges with weight ≥ 0.15 join
  const joinFloor = 0.15;
  for (const e of edges) {
    if (e.weight >= joinFloor) union(e.authorA, e.authorB);
  }
  const groups = new Map<string, string[]>();
  for (const a of authors) {
    const r = find(a);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(a);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

function detectBridges(
  authors: string[],
  edges: AuthorEdge[],
  silos: string[][],
): string[] {
  if (silos.length < 2) return [];
  // For each author, count how many silos they have weak (<0.15) cross-edges to
  const siloOf = new Map<string, number>();
  for (let i = 0; i < silos.length; i++) {
    for (const a of silos[i]!) siloOf.set(a, i);
  }
  const otherSilosByAuthor = new Map<string, Set<number>>();
  for (const e of edges) {
    if (e.weight >= 0.15) continue; // only weak/cross-cluster edges
    const sa = siloOf.get(e.authorA);
    const sb = siloOf.get(e.authorB);
    if (sa === undefined || sb === undefined) continue;
    if (sa === sb) continue;
    let setA = otherSilosByAuthor.get(e.authorA);
    if (!setA) {
      setA = new Set();
      otherSilosByAuthor.set(e.authorA, setA);
    }
    setA.add(sb);
    let setB = otherSilosByAuthor.get(e.authorB);
    if (!setB) {
      setB = new Set();
      otherSilosByAuthor.set(e.authorB, setB);
    }
    setB.add(sa);
  }
  return [...otherSilosByAuthor.entries()]
    .filter(([, silosSet]) => silosSet.size >= 2)
    .map(([a]) => a);
}
