/**
 * Hard eval suite -- builds REAL (query, expected-relevant-chunks) pairs
 * from the actual git history of the repo. Replaces the simulator's
 * synthetic quality model with measurable retrieval against the live
 * indexed corpus.
 *
 * Strategy
 * --------
 * For each commit in the recent N (default 200):
 *   - QUERY  := the commit subject + first body line (natural language)
 *   - RELEVANT := every chunk_id whose commit_hash equals this commit's SHA
 *
 * This is a "self-supervised" eval: we don't need humans to label. The
 * commit message is the query; the chunks the commit produced are the
 * ground truth. A good retrieval config returns those chunks in top-K.
 *
 * If the live store has < MIN_CHUNKS chunks (e.g., un-indexed repo), we
 * fall back to the simulator -- the tuner still works, just less
 * accurately.
 */

import { spawnSync } from "node:child_process";
import type { EvalCase } from "./types.js";

const MIN_CHUNKS_FOR_HARD_EVAL = 100;

/** Build a hard eval suite from the live git log + indexed chunks.
 *  Returns null if we can't (no git, no index, etc). */
export interface HardEvalBuildOpts {
  repoRoot: string;
  /** Max commits to walk. Default 200. */
  maxCommits?: number;
  /** Required min cases to consider the suite "real". Default 20. */
  minCases?: number;
  /** Pluggable store reader. Caller injects to avoid circular deps. */
  storeReader?: HardEvalStoreReader;
}

export interface HardEvalStoreReader {
  /** Return total embedded chunks (so we can decide hard vs simulator). */
  countChunksWithEmbedding(): number;
  /** Return chunk ids grouped by commit hash. */
  chunkIdsByCommit(commitHashes: string[]): Map<string, string[]>;
}

export interface HardEvalResult {
  /** "hard" = real corpus pairs; "simulator" = fallback. */
  source: "hard" | "simulator";
  cases: EvalCase[];
  /** ISO timestamp the suite was built. */
  builtAt: string;
}

export function buildHardEvalSuite(opts: HardEvalBuildOpts): HardEvalResult {
  const builtAt = new Date().toISOString();
  if (!opts.storeReader || opts.storeReader.countChunksWithEmbedding() < MIN_CHUNKS_FOR_HARD_EVAL) {
    return { source: "simulator", cases: [], builtAt };
  }
  const maxCommits = opts.maxCommits ?? 200;
  const minCases = opts.minCases ?? 20;

  // Pull recent commits with subject + first body line.
  const r = spawnSync("git",
    ["log", `-${maxCommits}`, "--no-merges", "--pretty=format:__C__%H%n%s%n%b%n__END__"],
    { cwd: opts.repoRoot, encoding: "utf8", timeout: 15000, maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) return { source: "simulator", cases: [], builtAt };

  // Parse stanzas.
  const stanzas: Array<{ sha: string; subject: string; body: string }> = [];
  let cur: { sha: string; subject: string; body: string } | null = null;
  let stage = 0; // 0=expect __C__sha 1=subject 2=body (until __END__)
  for (const line of (r.stdout ?? "").split("\n")) {
    if (line.startsWith("__C__")) {
      if (cur) stanzas.push(cur);
      cur = { sha: line.slice(5), subject: "", body: "" };
      stage = 1;
    } else if (line === "__END__") {
      if (cur) { stanzas.push(cur); cur = null; }
      stage = 0;
    } else if (cur && stage === 1) {
      cur.subject = line.trim();
      stage = 2;
    } else if (cur && stage === 2 && cur.body.length < 200) {
      const t = line.trim();
      if (t) cur.body += (cur.body ? " " : "") + t;
    }
  }
  if (cur) stanzas.push(cur);

  const shaToChunks = opts.storeReader.chunkIdsByCommit(stanzas.map((s) => s.sha));
  const cases: EvalCase[] = [];
  for (const s of stanzas) {
    const chunks = shaToChunks.get(s.sha) ?? [];
    if (chunks.length === 0) continue;
    // Skip overly-generic subjects ("fix typo", "wip", etc) -- they make
    // queries noisy and the retrieval target is ambiguous.
    if (!s.subject || s.subject.length < 10) continue;
    const noise = /^(fix typo|wip|cleanup|formatting|chore)\b/i;
    if (noise.test(s.subject)) continue;
    const query = s.body ? `${s.subject} ${s.body.slice(0, 120)}` : s.subject;
    cases.push({
      id: `hard-${s.sha.slice(0, 8)}`,
      query,
      relevantIds: chunks,
      note: `commit ${s.sha.slice(0, 8)} (${chunks.length} chunks)`,
    });
  }

  if (cases.length < minCases) {
    return { source: "simulator", cases: [], builtAt };
  }
  // Cap at ~100 cases so each tuning trial finishes in ~5-15s.
  return { source: "hard", cases: cases.slice(0, 100), builtAt };
}

/** Compute precision@K, recall@K, NDCG@K from a ranked list of chunk ids
 *  vs a labeled relevant set. Pure / deterministic / fast. */
export function scoreRanking(
  rankedIds: string[],
  relevantIds: string[],
  k: number,
): { precision: number; recall: number; ndcg: number } {
  const topK = rankedIds.slice(0, k);
  if (topK.length === 0) return { precision: 0, recall: 0, ndcg: 0 };
  const relevantSet = new Set(relevantIds);
  let hits = 0;
  let dcg = 0;
  let idcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const isRelevant = relevantSet.has(topK[i]!) ? 1 : 0;
    if (isRelevant) hits++;
    dcg += isRelevant / Math.log2(i + 2);
  }
  // Ideal DCG: relevant items at positions 0..min(R, k)-1
  const idealHits = Math.min(relevantIds.length, k);
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);

  const precision = hits / topK.length;
  const recall = relevantIds.length === 0 ? 0 : hits / relevantIds.length;
  const ndcg = idcg === 0 ? 0 : dcg / idcg;
  return { precision, recall, ndcg };
}
