/**
 * v2.74.0 — CHRONOS embedder.
 *
 * CHRONOS needs to recognize when an AI is answering "the same question"
 * it answered before, across time. That requires a semantic embedding +
 * cosine similarity.
 *
 * Design rule: DETERMINISTIC + OFFLINE by default. The default embedder
 * is a pure hash-based bag-of-features (FNV-1a over tokens + bigrams,
 * L2-normalized) — no network, no model download, byte-identical across
 * runs. This makes the Chronos ledger reproducible + the tests
 * deterministic. Production callers can inject a real embedder (Ollama /
 * OpenAI) via `ChronosOptions.embed` for higher semantic fidelity; the
 * ledger records WHICH embedder produced each vector so cross-embedder
 * comparisons are never silently mixed.
 *
 * A `number[]` (not Float32Array) is used so vectors serialize cleanly
 * into the append-only JSONL ledger.
 */

export type Embedder = (text: string) => number[];

export interface EmbedderInfo {
  name: string;
  dimensions: number;
  embed: Embedder;
}

const DEFAULT_DIM = 256;

/**
 * Question/filler words stripped before embedding a TOPIC. The default
 * embedder is a bag-of-tokens hash, so two paraphrases of the same
 * question ("What is the TSLA price target?" vs "TSLA price target?")
 * must collapse to the same CONTENT tokens to score a high cosine. We
 * keep only content words; genuinely-different questions still differ
 * because their content tokens differ.
 *
 * (A production Ollama/OpenAI embedder handles paraphrase natively; this
 * normalization makes the offline deterministic default robust too.)
 */
const TOPIC_STOPWORDS = new Set([
  "what", "whats", "what's", "which", "who", "whom", "whose", "when", "where",
  "why", "how", "is", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "or",
  "that", "this", "it", "as", "by", "with", "now", "today", "currently",
  "right", "about", "tell", "me", "your", "you", "please", "can", "could",
  "would", "should", "will", "shall", "may", "might", "exactly", "really",
]);

/** Normalize a topic to its content tokens for robust similarity.
 *  Tokens are SORTED so word order doesn't matter — "price target" and
 *  "target price" are the same question. (A factual stance's order-
 *  dependent meaning is caught later by the stance comparison, not the
 *  topic match.) */
export function normalizeTopic(topic: string): string {
  if (typeof topic !== "string") return "";
  const toks = (topic.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !TOPIC_STOPWORDS.has(t));
  toks.sort();
  return toks.join(" ");
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply (kept in uint range).
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Tokenize: lowercase words (≥2 chars) + adjacent bigrams for a little
 *  word-order signal. Numbers are kept (they're high-signal for facts). */
function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out: string[] = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(words[i] + "_" + words[i + 1]);
  return out;
}

/** Deterministic hash embedding → L2-normalized number[]. */
export function hashEmbed(text: string, dim = DEFAULT_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const toks = tokenize(text);
  for (const t of toks) {
    const h = fnv1a(t);
    const idx = h % dim;
    // Signed contribution (second hash bit decides sign) reduces collisions
    // canceling vs reinforcing arbitrarily.
    const sign = (fnv1a(t + "#") & 1) === 0 ? 1 : -1;
    v[idx] += sign;
  }
  // L2 normalize.
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v; // empty text → zero vector
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity of two equal-length vectors. Both expected
 *  L2-normalized (then cosine = dot product), but we normalize defensively. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The built-in deterministic embedder. Topics are content-normalized
 *  first so paraphrases of the same question score a high cosine. */
export const HASH_EMBEDDER: EmbedderInfo = {
  name: "chronos-hash-v1",
  dimensions: DEFAULT_DIM,
  embed: (text: string) => hashEmbed(normalizeTopic(text) || text, DEFAULT_DIM),
};
