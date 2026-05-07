/**
 * HTC Layer 1 — semantic abstracts.
 *
 * For each commit, ask the enricher to condense subject+body+files into ~30
 * tokens of plain-English meaning. The result is cached forever (token cost
 * paid once); subsequent queries reuse it without paying the LLM tax again.
 *
 * Prompt format is INTENTIONALLY rigid — consistency at the abstract layer
 * keeps Layer 2 (cluster summaries) and Layer 3 (memoir) stable too.
 */
import type { AbstractResult, HtcEnricher } from "./types.js";
import { estimateTokens } from "./types.js";

/** System prompt — kept short + directive, no preamble allowed. */
export const ABSTRACT_SYSTEM_PROMPT =
  "You are a senior engineer condensing git commit data into ~30 tokens " +
  "of plain-English meaning. Output ONLY the condensed text, no preamble.";

export interface AbstractCommitInput {
  hash: string;
  subject: string;
  body?: string;
  files?: string[];
}

export interface AbstractInput {
  commit: AbstractCommitInput;
  enricher: HtcEnricher;
}

export function buildAbstractUserPrompt(commit: AbstractCommitInput): string {
  const subject = commit.subject?.trim() || "(empty)";
  const body = commit.body?.trim() ? commit.body.trim() : "(none)";
  const files = (commit.files ?? []).slice(0, 3);
  const filesLine = files.length ? files.join(", ") : "(none)";
  return [
    `Commit subject: ${subject}`,
    `Body: ${body}`,
    `Files (sample): ${filesLine}`,
    "",
    "Condense to ~30 tokens. Format: \"WHAT changed + WHY\". Examples:",
    "  \"auth: replaced session cookies with JWT for stateless CDN deploys\"",
    "  \"fix: AR property tap shows detail on Android — race in event listener\"",
    "  \"refactor: split payment.ts into 3 modules so legacy + V2 can coexist\"",
  ].join("\n");
}

/** Generate a single ~30-token abstract for one commit. */
export async function generateAbstract(input: AbstractInput): Promise<AbstractResult> {
  const start = Date.now();
  const userPrompt = buildAbstractUserPrompt(input.commit);
  const result = await input.enricher.enrich({
    system: ABSTRACT_SYSTEM_PROMPT,
    user: userPrompt,
    // Cap output so the model can't blow past ~30 tokens; 80 = comfortable
    // headroom for sub-word splits without inviting paragraphs.
    maxTokens: 80,
    // Low temp — we want stable, comparable abstracts across runs.
    temperature: 0.2,
  });
  const generationMs = Date.now() - start;
  const text = (result.text ?? "").trim();
  // Strip wrapping quotes the model sometimes adds.
  const abstract = stripWrappingQuotes(text);
  return {
    hash: input.commit.hash,
    abstract,
    tokenCount: estimateTokens(abstract),
    generationMs,
    generator: input.enricher.name,
    generatedAt: new Date().toISOString(),
  };
}

export interface BatchAbstractOptions {
  /** Concurrent in-flight enricher calls; default 3 (free providers like Groq rate-limit). */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  onError?: (hash: string, err: string) => void;
}

/**
 * Generate abstracts for many commits with a concurrency cap. Failures are
 * recorded via onError but DO NOT abort the batch — the caller decides
 * whether to retry the failed hashes.
 *
 * Returns one AbstractResult per SUCCESSFUL commit (failures omitted).
 */
export async function generateAbstractsBatch(
  commits: AbstractCommitInput[],
  enricher: HtcEnricher,
  opts: BatchAbstractOptions = {},
): Promise<AbstractResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: AbstractResult[] = [];
  let done = 0;

  // Simple worker-pool: N workers pulling from a shared cursor.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= commits.length) return;
      const c = commits[i]!;
      try {
        const r = await generateAbstract({ commit: c, enricher });
        results.push(r);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        opts.onError?.(c.hash, msg);
      } finally {
        done++;
        opts.onProgress?.(done, commits.length);
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  // ", ', or curly quotes
  const QUOTES = [0x22, 0x27, 0x201c, 0x201d, 0x2018, 0x2019];
  if (QUOTES.includes(first) && QUOTES.includes(last)) return s.slice(1, -1).trim();
  return s;
}
