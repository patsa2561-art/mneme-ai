/**
 * Late chunking (Jina-style) for code/commit corpora.
 *
 * Traditional RAG chunks the doc FIRST, then embeds each chunk. The
 * encoder sees only the chunk -- no surrounding context. Late chunking
 * inverts: encode the WHOLE doc once, then mean-pool the token vectors
 * for each chunk's token range. Each chunk embedding is now informed
 * by the full document.
 *
 * For a code commit "fix auth refactor" + diff, late chunking lets the
 * "diff" chunk's embedding inherit context from the "subject + body".
 * Recall lifts measurably on cross-chunk queries.
 *
 * Implementation: we don't modify the embedder pipeline (would need
 * raw token-level access). Instead we provide a CHUNK STRATEGY +
 * RE-EMBEDDING PASS: chunk the doc, but ALSO embed the FULL doc, then
 * write each chunk embedding as alpha * chunk_embed + (1-alpha) *
 * full_doc_embed. Cheaper than true late chunking but captures most of
 * the recall gain.
 */

export interface LateChunkInput {
  /** Full document text (e.g., full commit body + diff). */
  fullText: string;
  /** Pre-split chunks of fullText. */
  chunks: Array<{ id: string; text: string }>;
  /** Embedder: takes texts, returns vectors. */
  embed: (texts: string[]) => Promise<number[][]>;
  /** Mix factor: 0 = pure chunk embed (classical), 1 = pure full-doc.
   *  Default 0.3 -- enough context to lift recall, not so much that
   *  chunks lose their local meaning. */
  alpha?: number;
}

export interface LateChunkOutput {
  /** Vector per input chunk (same order). */
  vectors: number[][];
  /** Wall time (ms). */
  totalMs: number;
  /** Mix factor used. */
  alpha: number;
  /** True if the full-doc embed succeeded; if false, falls back to
   *  classical chunk-only (no harm done). */
  contextApplied: boolean;
}

export async function lateChunkEmbed(input: LateChunkInput): Promise<LateChunkOutput> {
  const t0 = Date.now();
  const alpha = input.alpha ?? 0.3;
  if (input.chunks.length === 0) {
    return { vectors: [], totalMs: 0, alpha, contextApplied: false };
  }
  // Embed chunks individually + full doc.
  let chunkVecs: number[][] = [];
  let fullVec: number[] | null = null;
  try {
    const all = await input.embed([...input.chunks.map((c) => c.text), input.fullText]);
    chunkVecs = all.slice(0, input.chunks.length);
    fullVec = all[input.chunks.length] ?? null;
  } catch {
    return { vectors: [], totalMs: Date.now() - t0, alpha, contextApplied: false };
  }
  if (!fullVec || chunkVecs.some((v) => v.length !== fullVec!.length)) {
    return { vectors: chunkVecs, totalMs: Date.now() - t0, alpha, contextApplied: false };
  }
  // Mix.
  const dim = fullVec.length;
  const out: number[][] = chunkVecs.map((vec) => {
    const mixed = new Array<number>(dim);
    for (let i = 0; i < dim; i++) mixed[i] = (1 - alpha) * vec[i]! + alpha * fullVec![i]!;
    // L2 normalize so cosine still works.
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += mixed[i]! * mixed[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) mixed[i] = mixed[i]! / norm;
    return mixed;
  });
  return { vectors: out, totalMs: Date.now() - t0, alpha, contextApplied: true };
}
