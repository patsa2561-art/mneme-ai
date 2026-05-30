/**
 * v2.96.0 — HYDRA · L1 semantic mining + L2 MDL-optimal selection.
 *
 * The codebook Mneme mines from its OWN corpus — "the rarest gem the
 * system forges itself". Different from BPE (subword) and LZ (byte): we
 * mine over SEMANTIC token-windows (whole recurring phrases like
 * "HMAC-chained ledger", "Ed25519-signed", "tamper-evident") so the
 * symbols carry meaning, and we keep them as EXACT corpus substrings so
 * the round-trip stays byte-lossless by construction.
 *
 * Selection is L2 MDL-optimal: a phrase earns its place only if it pays
 * back more bytes than it costs to store — an information-theoretic
 * objective (Rissanen's Minimum Description Length), not a heuristic.
 *
 * Pure + deterministic: same corpus → same candidates → same ranking.
 */

export interface PhraseCandidate {
  phrase: string;
  hits: number;
  /** MDL net byte gain if this phrase becomes a symbol. */
  gain: number;
}

/** Approx bytes a 1–2 char PUA symbol costs inline (open+idx+close). */
const SYM_INLINE_COST = 3;
/** Bytes of codebook-storage overhead per entry (sym + phrase + json). */
const ENTRY_STORE_OVERHEAD = 12;

/**
 * Tokenize into an alternating stream of word-runs and whitespace-runs.
 * `tokens.join("")` reconstructs the input EXACTLY — that exactness is
 * what keeps every mined phrase a real substring (→ lossless).
 */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * L1 — generate candidate phrases as windows of consecutive tokens. Odd
 * window sizes straddle word·space·word so a candidate is always an exact
 * substring. L2 — score each by MDL net gain and keep only payers.
 *
 * @param windowSizes token-window widths to consider (default 3..15 odd)
 * @param minHits     minimum occurrences to be worth a symbol
 */
export function mineCandidates(
  corpus: string,
  opts: { windowSizes?: number[]; minHits?: number; maxCandidates?: number } = {},
): PhraseCandidate[] {
  const windowSizes = opts.windowSizes ?? [3, 5, 7, 9, 11, 13, 15];
  const minHits = opts.minHits ?? 3;
  const maxCandidates = opts.maxCandidates ?? 4000;
  const toks = tokenize(corpus);

  // Count occurrences of each window phrase.
  const freq = new Map<string, number>();
  for (const w of windowSizes) {
    if (w > toks.length) continue;
    for (let i = 0; i + w <= toks.length; i++) {
      const phrase = toks.slice(i, i + w).join("");
      // Skip pure-whitespace or trivially-short phrases.
      if (phrase.trim().length < 6) continue;
      freq.set(phrase, (freq.get(phrase) ?? 0) + 1);
    }
  }

  const out: PhraseCandidate[] = [];
  for (const [phrase, hits] of freq) {
    if (hits < minHits) continue;
    const len = Buffer.byteLength(phrase, "utf8");
    // MDL: each replaced occurrence saves (len - SYM_INLINE_COST); we pay
    // (len + overhead) once to store the entry. Net positive = it earns it.
    const gain = hits * (len - SYM_INLINE_COST) - (len + ENTRY_STORE_OVERHEAD);
    if (gain <= 0) continue;
    out.push({ phrase, hits, gain });
  }
  // Highest gain first; tie-break by longer phrase then lexicographic for
  // full determinism.
  out.sort((a, b) => b.gain - a.gain || b.phrase.length - a.phrase.length || (a.phrase < b.phrase ? -1 : 1));
  return out.slice(0, maxCandidates);
}
