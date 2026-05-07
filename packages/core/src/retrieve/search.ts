import type {
  AskResult,
  Citation,
  Commit,
  CommitChunk,
  EmbeddingProvider,
  RepoMeta,
  SearchResult,
} from "../types.js";
import type { MnemeStore } from "../store/sqlite.js";
import type { EventSink } from "./stream.js";

export interface SearchOptions {
  store: MnemeStore;
  embedder?: EmbeddingProvider;
  repo?: RepoMeta;
  topK?: number;
  /** Weight for semantic vs lexical (0 = pure lexical, 1 = pure semantic). */
  semanticWeight?: number;
  /**
   * Confidence floor — return [] instead of low-confidence guesses when the
   * query has no real signal in the corpus. Critical for honest "no context
   * found" answers on gibberish/out-of-distribution queries.
   *
   *   "auto" (default) — empty if (no FTS hits) AND (top semantic cosine < 0.4)
   *   "off"            — never filter; return whatever fusion produced
   *   { ... }          — explicit thresholds
   */
  confidenceFloor?: "auto" | "off" | { minFtsHits: number; minSemCosine: number };
  /**
   * Speculative-reasoning event sink. When provided, search emits
   * `consider` / `accept` / `prune` events as it scores candidates so callers
   * can render a live trace. Defaults to a no-op sink — zero cost when unused.
   */
  events?: EventSink;
}

/** Thresholds used when confidenceFloor === "auto". Calibrated from the eval set. */
export const DEFAULT_CONFIDENCE: { minFtsHits: number; minSemCosine: number } = {
  minFtsHits: 1,
  minSemCosine: 0.4,
};

/** Confidence label assigned to a result set based on score distribution. */
export type ConfidenceLabel = "high" | "medium" | "low" | "none";

/**
 * Adaptive confidence — looks at the score gap between top-1 and top-3 in
 * addition to the absolute top score. Hard thresholds alone are misleading:
 *   - "stripe bigint" returns one strong match (top=0.025, second=0.005) → high
 *   - "how to improve code" returns 8 ties (all ≈ 0.016) → low
 *
 * Calibrated empirically on the 50-question eval set + the production query
 * "how to improve my code" that exposed the original regression.
 */
export function classifyConfidence(results: SearchResult[]): ConfidenceLabel {
  if (results.length === 0) return "none";
  const top = results[0]!.score;

  // Absolute floor — anything below this is noise regardless of gap.
  if (top < 0.005) return "none";

  // Gap-based: if top is much higher than the average of the next 2-4
  // results, the system has a clear winner. If results are tied (small gap),
  // confidence drops even when top is decent.
  const tail = results.slice(1, 5);
  const tailMean = tail.length > 0 ? tail.reduce((s, r) => s + r.score, 0) / tail.length : 0;
  const gap = top - tailMean;
  const ratio = tailMean === 0 ? Infinity : top / tailMean;

  if (top >= 0.025 && (ratio >= 1.4 || gap >= 0.005)) return "high";
  if (top >= 0.012 && (ratio >= 1.2 || gap >= 0.002)) return "medium";
  if (top >= 0.005) return "low";
  return "none";
}

/**
 * Hybrid retrieval: combine FTS (BM25) with vector cosine, fuse with weighted RRF.
 * Falls back to FTS-only if no embedder is configured or no embeddings exist.
 */
export async function search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
  const topK = opts.topK ?? 10;
  const semanticWeight = clamp(opts.semanticWeight ?? 0.65, 0, 1);

  const ftsHits = opts.store.ftsSearch(query, topK * 4);
  const ftsScored = ftsHits.map((h, i) => ({
    chunk: { id: h.id, commitHash: h.commitHash, kind: h.kind as CommitChunk["kind"], text: h.text } as CommitChunk,
    rank: i + 1,
    raw: h.bm25,
  }));

  let semanticScored: Array<{ chunk: CommitChunk; rank: number; raw: number }> = [];
  let topSemCosine = 0;
  if (opts.embedder && opts.store.countChunksWithEmbedding() > 0) {
    try {
      const [qvec] = await opts.embedder.embed([query]);
      if (qvec) {
        const sims: Array<{ chunk: CommitChunk; sim: number }> = [];
        for (const r of opts.store.iterEmbeddedChunks()) {
          // Skip chunks whose embedding dimension differs from the query —
          // happens when the configured embedder is different from the one
          // used at index time. cosine() returns 0 for mismatches, but we
          // also avoid emitting noisy zero-scored hits.
          if (r.vec.length !== qvec.length) continue;
          const sim = cosine(qvec, r.vec);
          sims.push({
            chunk: { id: r.id, commitHash: r.commitHash, kind: r.kind as CommitChunk["kind"], text: r.text } as CommitChunk,
            sim,
          });
        }
        sims.sort((a, b) => b.sim - a.sim);
        topSemCosine = sims[0]?.sim ?? 0;
        semanticScored = sims.slice(0, topK * 4).map((s, i) => ({ chunk: s.chunk, rank: i + 1, raw: s.sim }));
      }
    } catch {
      // Embedder unavailable (e.g. Ollama model not pulled). Fall back to
      // lexical-only retrieval — better than crashing the whole query.
      semanticScored = [];
    }
  }

  // Honest "no context found" — block low-confidence guesses on gibberish queries.
  // This is the difference between an AI tool and a slot machine.
  const floor = opts.confidenceFloor ?? "auto";
  if (floor !== "off") {
    const cfg = floor === "auto" ? DEFAULT_CONFIDENCE : floor;
    const noLex = ftsScored.length < cfg.minFtsHits;
    const noSem = topSemCosine < cfg.minSemCosine;
    if (noLex && noSem) return [];
  }

  const fused = reciprocalRankFusion(ftsScored, semanticScored, {
    lexicalWeight: 1 - semanticWeight,
    semanticWeight,
    k: 60,
  });

  const byCommit = new Map<string, SearchResult>();
  for (const f of fused) {
    const existing = byCommit.get(f.chunk.commitHash);
    if (existing) {
      existing.score = Math.max(existing.score, f.score);
      existing.matchedChunks.push(f.chunk);
    } else {
      const commit = opts.store.getCommit(f.chunk.commitHash);
      if (!commit) continue;
      byCommit.set(f.chunk.commitHash, {
        commit,
        score: f.score,
        matchedChunks: [f.chunk],
      });
    }
  }

  const ranked = Array.from(byCommit.values()).sort((a, b) => b.score - a.score);

  // Speculative-reasoning trace: every candidate emits `consider`; the topK
  // emit `accept` and the rest emit `prune` so the caller can render the
  // model's elimination process. Cheap when no sink is attached.
  if (opts.events) {
    const sink = opts.events;
    const accepted = ranked.slice(0, topK);
    const pruned = ranked.slice(topK);
    for (const r of ranked) {
      sink.emit({
        kind: "consider",
        commit: { shortHash: r.commit.shortHash, subject: r.commit.subject },
        score: r.score,
      });
    }
    for (const r of accepted) {
      sink.emit({
        kind: "accept",
        commit: { shortHash: r.commit.shortHash, subject: r.commit.subject },
        reason: "above score floor",
      });
    }
    for (const r of pruned) {
      sink.emit({
        kind: "prune",
        commit: { shortHash: r.commit.shortHash, subject: r.commit.subject },
        reason: "below topK cut",
      });
    }
  }

  return ranked.slice(0, topK);
}

export async function ask(
  question: string,
  opts: SearchOptions,
): Promise<AskResult> {
  const results = await search(question, opts);
  return {
    question,
    summary: synthesizeSummary(question, results),
    citations: results.flatMap((r) => commitToCitations(r.commit, opts.repo)).slice(0, 8),
    searchResults: results,
  };
}

function commitToCitations(commit: Commit, repo?: RepoMeta): Citation[] {
  const cites: Citation[] = [];
  cites.push({
    kind: "commit",
    id: commit.shortHash || commit.hash.slice(0, 7),
    title: commit.subject,
    url: buildCommitUrl(commit.hash, repo),
    excerpt: truncate(commit.body || commit.subject, 240),
  });
  if (commit.prNumber && repo?.host === "github" && repo.owner && repo.repo) {
    cites.push({
      kind: "pr",
      id: `#${commit.prNumber}`,
      title: commit.prTitle ?? commit.subject,
      url: `https://github.com/${repo.owner}/${repo.repo}/pull/${commit.prNumber}`,
      excerpt: truncate(commit.prBody ?? commit.body, 240),
    });
  }
  return cites;
}

function buildCommitUrl(hash: string, repo?: RepoMeta): string | undefined {
  if (!repo?.owner || !repo.repo) return undefined;
  if (repo.host === "github") return `https://github.com/${repo.owner}/${repo.repo}/commit/${hash}`;
  if (repo.host === "gitlab") return `https://gitlab.com/${repo.owner}/${repo.repo}/-/commit/${hash}`;
  if (repo.host === "bitbucket") return `https://bitbucket.org/${repo.owner}/${repo.repo}/commits/${hash}`;
  return undefined;
}

function synthesizeSummary(question: string, results: SearchResult[]): string {
  if (!results.length) {
    return `No relevant commits or PRs were found for: "${question}". This usually means the WHY behind this code lives outside the git history (slack threads, design docs, in-person decisions).`;
  }
  const top = results.slice(0, 3);
  const lines = top.map((r, i) => {
    const date = r.commit.authorDate.slice(0, 10);
    const author = r.commit.authorName;
    const ref = r.commit.prNumber ? `PR #${r.commit.prNumber}` : r.commit.shortHash;
    return `${i + 1}. ${ref} (${date}, ${author}): ${r.commit.subject}`;
  });
  return [
    `Found ${results.length} relevant commit(s) for: "${question}".`,
    "Top matches:",
    ...lines,
  ].join("\n");
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface RrfInput {
  chunk: CommitChunk;
  rank: number;
  raw: number;
}

export function reciprocalRankFusion(
  lex: RrfInput[],
  sem: RrfInput[],
  cfg: { lexicalWeight: number; semanticWeight: number; k: number },
): Array<{ chunk: CommitChunk; score: number }> {
  const map = new Map<string, { chunk: CommitChunk; score: number }>();
  for (const r of lex) {
    const inc = cfg.lexicalWeight / (cfg.k + r.rank);
    upsert(map, r.chunk, inc);
  }
  for (const r of sem) {
    const inc = cfg.semanticWeight / (cfg.k + r.rank);
    upsert(map, r.chunk, inc);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

function upsert(
  map: Map<string, { chunk: CommitChunk; score: number }>,
  chunk: CommitChunk,
  inc: number,
): void {
  const cur = map.get(chunk.id);
  if (cur) cur.score += inc;
  else map.set(chunk.id, { chunk, score: inc });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
