/**
 * Leviathan citation verification — speculative-decoding-style draft/target
 * loop applied to LLM answers.
 *
 * Algorithm 1 from the Leviathan paper: a fast "draft" model proposes,
 * a strict "target" rejects un-supported tokens, residual sampling re-drafts.
 *
 * Mneme's adaptation:
 *   - Draft     = the LLM's synthesized answer (already produced by `synthesize()`)
 *   - Target    = a deterministic citation matcher (each backticked hash must
 *                 exist in the evidence pool AND the surrounding sentence must
 *                 contextually match the cited commit's subject)
 *   - Reject    = mark the unverified claim with `[unverified: ...]` so the
 *                 user sees what was filtered (no silent deletion)
 *   - Residual  = `degraded: true` when too many rejections — caller should
 *                 warn the user that trust is reduced
 *
 * The keyword/token-overlap match is intentionally lightweight (no embedding
 * call). Cosine on a sentence-level embedding would be more accurate but
 * Mneme's core stays dep-free; embeddings live in the embeddings package and
 * we don't want a runtime cycle. Empirically the 0.2 token-overlap floor
 * catches "hash present, sentence completely unrelated" without flagging
 * legitimate paraphrases.
 */

import type { EventSink } from "./stream.js";

export interface LeviathanInput {
  /** The raw LLM answer text. */
  answer: string;
  /** Evidence pool (ordered by relevance). Each must have hash + subject. */
  evidence: Array<{ hash: string; shortHash: string; subject: string }>;
  /** Optional event sink for tracing rejections. */
  events?: EventSink;
}

/** Per-claim verdict. */
export type LeviathanVerdict =
  | "verified"
  | "hash-not-in-evidence"
  | "claim-not-supported"
  | "no-citation";

export interface LeviathanResult {
  /** The cleaned answer with unverified claims wrapped in `[unverified: ...]`. */
  cleanedAnswer: string;
  /** Per-claim verification trace. */
  verifications: Array<{
    claimText: string;
    citedHash?: string;
    verdict: LeviathanVerdict;
    reason: string;
  }>;
  /** 0..1 — fraction of citation-bearing claims that verified. */
  trustScore: number;
  /** True if too many rejections (trustScore < 0.6). */
  degraded: boolean;
}

/** Fraction of claims that must verify before we stop calling the answer "degraded." */
const TRUST_FLOOR = 0.6;

/** Token-overlap floor — surrounding sentence vs commit subject. */
const CONTEXT_MATCH_FLOOR = 0.2;

/**
 * Run Algorithm-1-style verification on an LLM answer.
 *
 * The loop is single-pass (we don't actually re-draft, since the answer is
 * already paid-for). Instead we tag rejected spans inline so the renderer
 * can dim/strikethrough them.
 */
export function verifyAnswerLeviathan(input: LeviathanInput): LeviathanResult {
  const { answer, evidence, events } = input;
  const sentences = splitSentences(answer);
  const verifications: LeviathanResult["verifications"] = [];
  const cleanedSentences: string[] = [];

  let totalWithCitation = 0;
  let verifiedWithCitation = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      cleanedSentences.push(sentence);
      continue;
    }

    const citedHash = extractHash(trimmed);
    if (!citedHash) {
      verifications.push({
        claimText: trimmed,
        verdict: "no-citation",
        reason: "intro/conclusion sentence with no hash citation",
      });
      cleanedSentences.push(sentence);
      continue;
    }

    totalWithCitation += 1;
    const matched = findEvidenceForHash(citedHash, evidence);
    if (!matched) {
      const reason = `cited \`${citedHash}\` is not in the evidence pool`;
      verifications.push({
        claimText: trimmed,
        citedHash,
        verdict: "hash-not-in-evidence",
        reason,
      });
      cleanedSentences.push(wrapUnverified(sentence, "hash not in evidence"));
      events?.emit({ kind: "verify", claim: trimmed, ok: false, reason });
      continue;
    }

    const overlap = tokenOverlap(trimmed, matched.subject);
    if (overlap < CONTEXT_MATCH_FLOOR) {
      const reason = `sentence does not contextually match commit subject (overlap=${overlap.toFixed(2)})`;
      verifications.push({
        claimText: trimmed,
        citedHash,
        verdict: "claim-not-supported",
        reason,
      });
      cleanedSentences.push(wrapUnverified(sentence, "claim not supported by commit subject"));
      events?.emit({ kind: "verify", claim: trimmed, ok: false, reason });
      continue;
    }

    verifiedWithCitation += 1;
    verifications.push({
      claimText: trimmed,
      citedHash,
      verdict: "verified",
      reason: `hash present in evidence; subject overlap=${overlap.toFixed(2)}`,
    });
    cleanedSentences.push(sentence);
    events?.emit({ kind: "verify", claim: trimmed, ok: true });
  }

  const trustScore =
    totalWithCitation === 0 ? 1.0 : verifiedWithCitation / totalWithCitation;
  const degraded = trustScore < TRUST_FLOOR;

  return {
    cleanedAnswer: cleanedSentences.join("").trim() || answer.trim(),
    verifications,
    trustScore: Number(trustScore.toFixed(2)),
    degraded,
  };
}

/**
 * Split an answer into "claim sentences" but preserve trailing punctuation +
 * inter-sentence whitespace. We need the whitespace back when we re-join so
 * the cleaned answer reads naturally.
 *
 * Returns an array where each element is "<sentence-content><punct><ws>".
 */
function splitSentences(text: string): string[] {
  if (!text) return [];
  // Capture sentence-ending punctuation. We split on `. ! ?` followed by
  // whitespace OR end-of-string.
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+(\s*)|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/**
 * Extract the first backticked hex token (>=4 chars) from a sentence.
 * Returns the hash lowercased, or undefined if no hash.
 *
 * Mirrors `findUnverifiedCitations` in synthesize.ts so a hash that one
 * function flags is the same one this function checks.
 */
function extractHash(sentence: string): string | undefined {
  const m = sentence.match(/`([0-9a-f]{4,40})`/i);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** Find the evidence entry whose hash prefix-matches the cited hash (either direction). */
function findEvidenceForHash(
  cited: string,
  evidence: Array<{ hash: string; shortHash: string; subject: string }>,
): { hash: string; shortHash: string; subject: string } | undefined {
  const c = cited.toLowerCase();
  for (const e of evidence) {
    const h = e.hash.toLowerCase();
    const sh = (e.shortHash ?? "").toLowerCase();
    if (h === c || h.startsWith(c) || c.startsWith(h)) return e;
    if (sh && (sh === c || sh.startsWith(c) || c.startsWith(sh))) return e;
  }
  return undefined;
}

/**
 * Lightweight Jaccard-like token overlap: shared tokens / total unique tokens
 * after dropping stopwords + the cited hash itself. Symmetric, in [0,1].
 */
export function tokenOverlap(sentence: string, subject: string): number {
  const a = tokenize(sentence);
  const b = tokenize(subject);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = new Set<string>([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "is", "was", "are", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its",
  "as", "by", "at", "from", "into", "see", "also",
]);

function tokenize(text: string): Set<string> {
  const toks = new Set<string>();
  // Strip backtick spans so the hash itself doesn't count as a shared token.
  const noBackticks = text.replace(/`[^`]*`/g, " ");
  for (const raw of noBackticks.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    if (raw.length < 2) continue;
    toks.add(raw);
  }
  return toks;
}

function wrapUnverified(sentence: string, reason: string): string {
  // Preserve trailing whitespace so re-joined paragraphs flow naturally.
  const tail = sentence.match(/\s*$/)?.[0] ?? "";
  const body = sentence.slice(0, sentence.length - tail.length);
  return `[unverified: ${reason}] ${body}${tail}`;
}
