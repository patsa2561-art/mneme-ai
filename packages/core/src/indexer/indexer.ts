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

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vecs = await this.opts.embedder.embed(batch.map((c) => c.text));
        for (let j = 0; j < batch.length; j++) batch[j]!.embedding = vecs[j];
        this.opts.store.upsertChunks(batch, model);
        report({
          phase: "embedding",
          current: Math.min(i + batchSize, chunks.length),
          total: chunks.length,
          message: `embedding with ${model}`,
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
