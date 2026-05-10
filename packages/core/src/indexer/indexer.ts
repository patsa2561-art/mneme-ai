import { createHash } from "node:crypto";
import type {
  Commit,
  CommitChunk,
  EmbeddingProvider,
  IndexerProgress,
} from "../types.js";
import { readCommits, readFileChanges } from "../git/log.js";
import { MnemeStore } from "../store/sqlite.js";
import { redact, mergeHits, type RedactOptions } from "../util/redact.js";

export interface IndexerOptions {
  cwd: string;
  store: MnemeStore;
  embedder?: EmbeddingProvider;
  since?: string;
  maxCount?: number;
  embedBatchSize?: number;
  onProgress?: (p: IndexerProgress) => void;
  /**
   * Strip secrets from chunk text before storage and embedding.
   *   true | undefined → built-in rules with default settings
   *   false            → no redaction (kept as escape hatch for trusted repos)
   *   { ... }          → forwarded to redact()
   *
   * Default: ON (true). Honest "no secret should ever leave the machine"
   * is more important than slightly more readable indexed text.
   */
  redact?: boolean | RedactOptions;
}

export class Indexer {
  constructor(private opts: IndexerOptions) {}

  async run(): Promise<{ commits: number; chunks: number; redactionHits: Record<string, number> }> {
    const report = (p: IndexerProgress) => this.opts.onProgress?.(p);

    report({ phase: "git_log", current: 0, total: 0, message: "reading git history" });
    const commits = await readCommits({
      cwd: this.opts.cwd,
      since: this.opts.since,
      maxCount: this.opts.maxCount,
    });

    report({
      phase: "writing",
      current: 0,
      total: commits.length,
      message: `persisting ${commits.length} commits`,
    });
    this.opts.store.upsertCommits(commits);

    for (let i = 0; i < commits.length; i++) {
      const c = commits[i]!;
      const changes = await readFileChanges(this.opts.cwd, c.hash);
      this.opts.store.upsertFileChanges(changes);
      if (i % 50 === 0) {
        report({
          phase: "writing",
          current: i,
          total: commits.length,
          message: "indexing file changes",
        });
      }
    }

    const chunks = buildChunks(commits);

    // Redaction runs BEFORE embedding so secrets never reach a remote provider.
    // Default ON; opt out only on trusted internal repos with no secret history.
    let redactionHits: Record<string, number> = {};
    if (this.opts.redact !== false) {
      const ropts: RedactOptions = typeof this.opts.redact === "object" ? this.opts.redact : {};
      for (const chunk of chunks) {
        const r = redact(chunk.text, ropts);
        if (Object.keys(r.hits).length > 0) {
          chunk.text = r.text;
          redactionHits = mergeHits(redactionHits, r.hits);
        }
      }
      const totalHits = Object.values(redactionHits).reduce((a, b) => a + b, 0);
      if (totalHits > 0) {
        report({
          phase: "writing",
          current: totalHits,
          total: chunks.length,
          message: `redacted ${totalHits} secret(s) across ${Object.keys(redactionHits).length} rule(s)`,
        });
      }
    }

    if (this.opts.embedder) {
      const model = this.opts.embedder.name;
      const batchSize = this.opts.embedBatchSize ?? 32;

      // Tell the user the first batch may take longer (cold-start model load).
      report({
        phase: "embedding",
        current: 0,
        total: chunks.length,
        message: `warming up ${model} (first batch may take ~30s)`,
      });

      // v1.25.1 -- LATE CHUNKING (Jina-style, opt-in via env).
      // When MNEME_LATE_CHUNKING=1, we group chunks by parent commit,
      // embed the FULL commit body alongside chunks, then mix each
      // chunk vector with the parent vector via alpha=0.3. Cosine-
      // normalized so existing search() works unchanged. Recall lifts
      // on cross-chunk queries.
      const lateChunking = process.env["MNEME_LATE_CHUNKING"] === "1";
      const lateAlpha = Number(process.env["MNEME_LATE_CHUNKING_ALPHA"] ?? "0.3");

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        let vecs: Float32Array[] | number[][];
        if (lateChunking) {
          const { lateChunkEmbed } = await import("../graphrag/late_chunking.js");
          const byCommit = new Map<string, typeof batch>();
          for (const c of batch) {
            let arr = byCommit.get(c.commitHash);
            if (!arr) { arr = []; byCommit.set(c.commitHash, arr); }
            arr.push(c);
          }
          const batchVecs: Float32Array[] = new Array(batch.length);
          for (const [, group] of byCommit) {
            if (group.length === 1) {
              const v = await this.opts.embedder.embed([group[0]!.text]);
              const idx = batch.indexOf(group[0]!);
              batchVecs[idx] = v[0]!;
              continue;
            }
            const fullText = group.map((c) => c.text).join("\n\n");
            const out = await lateChunkEmbed({
              fullText,
              chunks: group.map((c, gi) => ({ id: `${c.commitHash}:${gi}`, text: c.text })),
              embed: async (texts) => {
                const f32s = await this.opts.embedder!.embed(texts);
                return f32s.map((f) => Array.from(f));
              },
              alpha: Number.isFinite(lateAlpha) ? Math.max(0, Math.min(1, lateAlpha)) : 0.3,
            });
            for (let g = 0; g < group.length; g++) {
              const idx = batch.indexOf(group[g]!);
              batchVecs[idx] = Float32Array.from(out.vectors[g] ?? []);
            }
          }
          vecs = batchVecs;
        } else {
          vecs = await this.opts.embedder.embed(batch.map((c) => c.text));
        }
        for (let j = 0; j < batch.length; j++) batch[j]!.embedding = vecs[j];
        this.opts.store.upsertChunks(batch, model);
        report({
          phase: "embedding",
          current: Math.min(i + batchSize, chunks.length),
          total: chunks.length,
          message: `embedding with ${model}${lateChunking ? " (late chunking)" : ""}`,
        });
      }
    } else {
      this.opts.store.upsertChunks(chunks);
    }

    report({ phase: "done", current: chunks.length, total: chunks.length });
    return {
      commits: commits.length,
      chunks: chunks.length,
      redactionHits,
    };
  }
}

export function buildChunks(commits: Commit[]): CommitChunk[] {
  const chunks: CommitChunk[] = [];
  for (const c of commits) {
    if (c.subject) {
      chunks.push(makeChunk(c.hash, "subject", c.subject));
    }
    if (c.body) {
      for (const segment of splitBody(c.body)) {
        chunks.push(makeChunk(c.hash, "body", segment));
      }
    }
    if (c.prTitle) chunks.push(makeChunk(c.hash, "pr_title", c.prTitle));
    if (c.prBody) {
      for (const segment of splitBody(c.prBody)) {
        chunks.push(makeChunk(c.hash, "pr_body", segment));
      }
    }
  }
  return chunks;
}

function makeChunk(commitHash: string, kind: CommitChunk["kind"], text: string): CommitChunk {
  const id = createHash("sha1").update(`${commitHash}|${kind}|${text}`).digest("hex").slice(0, 16);
  return { id: `${commitHash.slice(0, 12)}-${kind}-${id}`, commitHash, kind, text };
}

export function splitBody(text: string, maxChars = 800): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paragraphs) {
    if (!p.trim()) continue;
    if (buf.length + p.length + 2 > maxChars && buf) {
      parts.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}
