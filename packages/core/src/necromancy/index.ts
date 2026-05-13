/**
 * v2.1.0 -- NECROMANCY · style-fingerprint MVP
 *
 * Cannot resurrect deprecated AI vendors' models. That's a research
 * project. But we CAN extract a deterministic STYLE FINGERPRINT from
 * old chat logs — average sentence length, hedge ratio, emoji density,
 * common closing phrases, signature catchphrases. The AI agent can
 * then be prompted to respond IN that style for nostalgic continuity.
 *
 * Honest scope: this is stylometric mimicry, NOT model resurrection.
 * The output reads "in the style of" — never claims to BE the dead AI.
 *
 * Pure function. Statistical. No external deps.
 */

const HEDGE_PATTERNS = [/\bmaybe\b/gi, /\bperhaps\b/gi, /\bI think\b/gi, /\bI believe\b/gi];
const ABSOLUTE_PATTERNS = [/\balways\b/gi, /\bnever\b/gi, /\bdefinitely\b/gi];
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
const COMMON_OPENERS = ["sure", "of course", "absolutely", "let me", "here's", "great question", "i'd be happy to"];
const COMMON_CLOSINGS = ["let me know", "hope this helps", "happy to", "any other questions", "good luck"];

export interface StyleFingerprint {
  /** Sample id / vendor label e.g. "claude-1.0". */
  vendorLabel: string;
  /** Total characters analyzed. */
  totalChars: number;
  /** Total sentences analyzed. */
  totalSentences: number;
  /** Average sentence length in chars. */
  avgSentenceLength: number;
  /** Hedges per 100 sentences. */
  hedgesPer100Sentences: number;
  /** Absolutes per 100 sentences. */
  absolutesPer100Sentences: number;
  /** Emojis per 1k chars. */
  emojisPer1k: number;
  /** Common openers found, ordered by frequency. */
  topOpeners: Array<{ phrase: string; count: number }>;
  /** Common closings found, ordered by frequency. */
  topClosings: Array<{ phrase: string; count: number }>;
  /** Distinctive bigrams (rare-in-baseline pairs). */
  signatureBigrams: string[];
  /** Cosine-comparable feature vector (numeric). */
  featureVector: number[];
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const re = new RegExp(p.source, p.flags);
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

function topHits(text: string, phrases: readonly string[]): Array<{ phrase: string; count: number }> {
  const t = text.toLowerCase();
  const out: Array<{ phrase: string; count: number }> = [];
  for (const p of phrases) {
    // Count occurrences
    let count = 0;
    let idx = 0;
    while ((idx = t.indexOf(p, idx)) !== -1) { count++; idx += p.length; }
    if (count > 0) out.push({ phrase: p, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

function extractBigrams(text: string): string[] {
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
  const seen = new Map<string, number>();
  for (let i = 0; i + 1 < tokens.length; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    seen.set(bigram, (seen.get(bigram) ?? 0) + 1);
  }
  // Distinctive = appears more than once but not super common
  return [...seen.entries()]
    .filter(([, c]) => c >= 2 && c <= 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([b]) => b);
}

export function extractStyleFingerprint(vendorLabel: string, chatLogs: readonly string[]): StyleFingerprint {
  const text = chatLogs.join("\n\n");
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const totalChars = text.length;
  const totalSentences = sentences.length || 1;
  const avgSentenceLength = totalChars / totalSentences;
  const hedges = countMatches(text, HEDGE_PATTERNS);
  const absolutes = countMatches(text, ABSOLUTE_PATTERNS);
  const emojis = (text.match(EMOJI_RE) || []).length;
  const topOpeners = topHits(text, COMMON_OPENERS).slice(0, 5);
  const topClosings = topHits(text, COMMON_CLOSINGS).slice(0, 5);
  const signatureBigrams = extractBigrams(text);
  const hedgesPer100Sentences = (hedges / totalSentences) * 100;
  const absolutesPer100Sentences = (absolutes / totalSentences) * 100;
  const emojisPer1k = (emojis / Math.max(1, totalChars)) * 1000;
  const featureVector = [avgSentenceLength, hedgesPer100Sentences, absolutesPer100Sentences, emojisPer1k];
  return {
    vendorLabel,
    totalChars,
    totalSentences,
    avgSentenceLength: Math.round(avgSentenceLength * 100) / 100,
    hedgesPer100Sentences: Math.round(hedgesPer100Sentences * 100) / 100,
    absolutesPer100Sentences: Math.round(absolutesPer100Sentences * 100) / 100,
    emojisPer1k: Math.round(emojisPer1k * 100) / 100,
    topOpeners,
    topClosings,
    signatureBigrams,
    featureVector,
  };
}

/** Cosine similarity between two style fingerprints. 1.0 = identical style. */
export function styleSimilarity(a: StyleFingerprint, b: StyleFingerprint): number {
  const av = a.featureVector;
  const bv = b.featureVector;
  if (av.length !== bv.length || av.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < av.length; i++) {
    dot += av[i]! * bv[i]!;
    na += av[i]! * av[i]!;
    nb += bv[i]! * bv[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? Math.max(-1, Math.min(1, dot / denom)) : 0;
}

/** Render the fingerprint as a "respond in style of X" prompt prefix
 *  that an AI agent can prepend to its system message. */
export function styleAsPromptPrefix(fp: StyleFingerprint): string {
  const traits: string[] = [];
  if (fp.avgSentenceLength > 100) traits.push("verbose, multi-clause sentences");
  else if (fp.avgSentenceLength < 50) traits.push("short, punchy sentences");
  if (fp.hedgesPer100Sentences > 20) traits.push("hedged language ('maybe', 'I think')");
  if (fp.absolutesPer100Sentences > 10) traits.push("confident absolutes");
  if (fp.emojisPer1k > 1) traits.push("emoji-friendly");
  if (fp.topClosings.length > 0) traits.push(`signature closing: "${fp.topClosings[0]!.phrase}"`);
  return `Respond in the style of "${fp.vendorLabel}": ${traits.join(" · ") || "neutral tone"}. (Stylometric mimicry only — not an actual resurrection of the model.)`;
}

export function formatNecromancyPulseLine(fp: StyleFingerprint): string {
  return `NECROMANCY · ${fp.vendorLabel} · ${fp.totalSentences} sentences · avg=${fp.avgSentenceLength}ch · hedges/100=${fp.hedgesPer100Sentences} · emoji/1k=${fp.emojisPer1k}`;
}
