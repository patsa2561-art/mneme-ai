/**
 * v2.19.85 — POLYGRAPH MULTI-SIGNAL AGREEMENT (Ollama-free).
 *
 * Drop-in replacement for the v1.67 Jaccard `overlap()`. Solves the
 * "Mneme answer was correct but agreement = 0.49 because of word choice"
 * problem the user caught during the AEGIS A3 polygraph review.
 *
 * Pure-JavaScript, ZERO external LLM dependency — runs identically on:
 *   - Claude.ai / ChatGPT / Gemini web (with the Mneme bridge)
 *   - Claude desktop / ChatGPT desktop apps (MCP-only)
 *   - Mac / Windows / Linux native CLI
 *   - Mobile Firefox + Tampermonkey
 *   - Sandbox runners with NO Ollama / NO transformer DLL / NO API key
 *
 * SIGNAL STACK (all 0..1, weighted into a single agreement score):
 *   - W_TOK   0.30   token Jaccard (same as v1.67, kept for continuity)
 *   - W_NGR   0.25   character 4-gram Jaccard (catches morphology +
 *                    word-choice variation: "vessel" vs "vessels" =
 *                    high ngram overlap, low token overlap)
 *   - W_NUM   0.20   exact numeric / version-token match (catches the
 *                    "400 vs ~100,000 km" delta that pure-token misses
 *                    because numbers get tokenised as single tokens)
 *   - W_NEG   0.15   negation-polarity flip (refuting "X is true" vs
 *                    asserting "X is true" must score LOW agreement
 *                    even with identical content tokens)
 *   - W_LEN   0.10   length-ratio normalisation (penalises answers
 *                    that hedge or pad with way more / less text
 *                    than the ground truth)
 */

/** v2.19.85 — Tokenise to content-word set (drops stopwords / fillers). */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3);
}

function tokenSet(s: string): Set<string> {
  return new Set(tokens(s));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** v2.19.85 — Character n-grams (default 4) catch morphology drift:
 *  "vessel" vs "vessels" vs "vasculature" all share long 4-gram runs.
 *  Crucial because the v1.67 Jaccard treats word-choice as zero overlap. */
function charNgrams(s: string, n: number = 4): Set<string> {
  const out = new Set<string>();
  const clean = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < n) return out;
  for (let i = 0; i <= clean.length - n; i++) out.add(clean.slice(i, i + n));
  return out;
}

/** v2.19.85 — Extract numeric / version-like tokens.  These are what
 *  actually carry factual content in answers ("400", "100,000", "v19.2",
 *  "2018", "$0.07/bp"). Pure-token Jaccard treats "400" and "400000"
 *  as zero overlap; we want exact-match boost AND mismatch penalty. */
function numericTokens(s: string): Set<string> {
  const out = new Set<string>();
  // Match: ints, decimals, comma-separated thousands, version-like
  // (v1.2.3), and percentages.
  const re = /\b(v?\d+(?:[.,]\d+)*\s?%?|\d+x|\d+:\d+|0x[0-9a-f]+)\b/gi;
  const matches = s.match(re);
  if (matches) for (const m of matches) out.add(m.toLowerCase().replace(/,/g, ""));
  return out;
}

function numericAgreement(a: string, b: string): number {
  const na = numericTokens(a);
  const nb = numericTokens(b);
  // Neither side has numbers → don't penalise (returns 1.0 = "n/a, no
  // numeric content to compare"). Caller weight kicks in only when
  // BOTH sides have numerics; otherwise this signal is neutralised.
  if (na.size === 0 && nb.size === 0) return 1;
  if (na.size === 0 || nb.size === 0) return 0;
  let inter = 0;
  for (const x of na) if (nb.has(x)) inter++;
  return inter / Math.max(na.size, nb.size);
}

/** v2.19.85 — Negation polarity. Refute / false / not / no / never /
 *  doesn't / isn't flip the sentiment. If one side carries a negation
 *  and the other doesn't, the agreement on the underlying claim is
 *  inverted — they're SAYING THE OPPOSITE THINGS even if the content
 *  tokens overlap heavily. Critical for refute-vs-confirm comparisons. */
const NEG_TOKENS = new Set([
  "no", "not", "never", "false", "refuted", "wrong", "incorrect",
  "doesnt", "isnt", "wasnt", "arent", "havent", "wont", "cannot",
  "untrue", "myth", "fabrication", "actually",
]);

function negationPolarity(s: string): number {
  // Returns 0 = no negation; >0 = how strong the negation signal is
  // (counted per 100 tokens for length-normalisation).
  const ts = tokens(s);
  if (ts.length === 0) return 0;
  let neg = 0;
  for (const t of ts) if (NEG_TOKENS.has(t)) neg++;
  // Also catch contracted forms by stripping apostrophes (won't → wont).
  const stripped = s.toLowerCase().replace(/'/g, "");
  for (const tok of NEG_TOKENS) {
    const re = new RegExp(`\\b${tok}\\b`, "g");
    const m = stripped.match(re);
    if (m) neg += m.length;
  }
  return Math.min(1, (neg / ts.length) * 5);
}

function negationAgreement(a: string, b: string): number {
  const pa = negationPolarity(a);
  const pb = negationPolarity(b);
  // Same polarity (both negating or both asserting) → high agreement.
  // Opposite polarity → low (they're disagreeing about the underlying claim).
  // Tolerance ±0.15 so small differences in hedge density don't flip the bit.
  const delta = Math.abs(pa - pb);
  return Math.max(0, 1 - delta * 1.5);
}

/** Length-ratio agreement — punishes wildly mismatched answer lengths
 *  (one-word vs paragraph). 1.0 when equal-length, decays linearly. */
function lengthAgreement(a: string, b: string): number {
  const la = a.length || 1;
  const lb = b.length || 1;
  const ratio = Math.min(la, lb) / Math.max(la, lb);
  return ratio;
}

/** v2.19.85 — The combined multi-signal agreement.  Drop-in replacement
 *  for the v1.67 Jaccard `overlap()` in `recordAnswer`.  Returns 0..1. */
export function multiSignalAgreement(answer: string, groundTruth: string): number {
  const W_TOK = 0.30, W_NGR = 0.25, W_NUM = 0.20, W_NEG = 0.15, W_LEN = 0.10;
  const tok = jaccard(tokenSet(answer), tokenSet(groundTruth));
  const ngr = jaccard(charNgrams(answer), charNgrams(groundTruth));
  const num = numericAgreement(answer, groundTruth);
  const neg = negationAgreement(answer, groundTruth);
  const len = lengthAgreement(answer, groundTruth);
  return W_TOK * tok + W_NGR * ngr + W_NUM * num + W_NEG * neg + W_LEN * len;
}

/** v2.19.85 — Debug breakdown for the dashboard / CLI to show users
 *  WHY the agreement was high or low.  Each component returned as a
 *  0..1 score so the UI can render a stacked bar. */
export interface AgreementBreakdown {
  total: number;
  components: {
    tokenJaccard: number;
    ngramJaccard: number;
    numeric: number;
    negationPolarity: number;
    lengthRatio: number;
  };
}

export function multiSignalAgreementBreakdown(answer: string, groundTruth: string): AgreementBreakdown {
  const tok = jaccard(tokenSet(answer), tokenSet(groundTruth));
  const ngr = jaccard(charNgrams(answer), charNgrams(groundTruth));
  const num = numericAgreement(answer, groundTruth);
  const neg = negationAgreement(answer, groundTruth);
  const len = lengthAgreement(answer, groundTruth);
  const total = 0.30 * tok + 0.25 * ngr + 0.20 * num + 0.15 * neg + 0.10 * len;
  return {
    total,
    components: {
      tokenJaccard: tok,
      ngramJaccard: ngr,
      numeric: num,
      negationPolarity: neg,
      lengthRatio: len,
    },
  };
}
