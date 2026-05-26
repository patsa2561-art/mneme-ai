/**
 * v2.62.0 — MIRRAGE sentence splitter.
 *
 * Splits a draft into sentence chunks suitable for per-claim ACGV /
 * heuristic check. Handles:
 *   - common English abbreviations (Mr., Dr., e.g., i.e., etc.)
 *   - decimal numbers (3.14)
 *   - URLs / file paths (https://example.com / src/file.ts)
 *   - inline code blocks (preserved as single chunk)
 *
 * Pure, defensive — never throws.
 */

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
  "e.g", "i.e", "u.s", "u.k", "no", "vol", "fig", "approx", "min", "max",
  "inc", "ltd", "co", "corp", "esp", "incl", "exc",
]);

export interface Sentence {
  /** Original sentence text. */
  text: string;
  /** Character offset where the sentence starts in the original draft. */
  start: number;
  /** Character offset where the sentence ends (exclusive). */
  end: number;
}

export function splitSentences(draft: string): Sentence[] {
  if (typeof draft !== "string" || draft.length === 0) return [];
  const out: Sentence[] = [];
  let buf = "";
  let bufStart = 0;
  let i = 0;
  let inCode = false;
  let inUrl = false;
  const flush = (offset: number) => {
    const trimmed = buf.trim();
    if (trimmed.length > 0) {
      out.push({ text: trimmed, start: bufStart + buf.indexOf(trimmed), end: offset });
    }
    buf = "";
    bufStart = offset;
  };
  while (i < draft.length) {
    const ch = draft[i]!;
    const next = draft[i + 1] ?? "";
    // Track inline code blocks (single backtick segments).
    if (ch === "`") {
      inCode = !inCode;
      buf += ch;
      i++;
      continue;
    }
    if (inCode) { buf += ch; i++; continue; }
    // Track URLs heuristically: "://" entered, exit on whitespace.
    if (ch === ":" && draft.slice(i, i + 3) === "://") inUrl = true;
    if (inUrl && /\s/.test(ch)) inUrl = false;
    if (inUrl) { buf += ch; i++; continue; }
    // Decimals: digit . digit → keep
    if (ch === "." && /\d/.test(draft[i - 1] ?? "") && /\d/.test(next)) {
      buf += ch;
      i++;
      continue;
    }
    // Abbreviation lookback: split only when next char is space/newline AND
    // preceding word is NOT a known abbreviation.
    if ((ch === "." || ch === "!" || ch === "?") && (/\s|$/.test(next) || i === draft.length - 1)) {
      buf += ch;
      // Inspect last word before the punctuation.
      const lastSpace = Math.max(buf.lastIndexOf(" ", buf.length - 2), buf.lastIndexOf("\n", buf.length - 2));
      const lastWord = buf.slice(lastSpace + 1, buf.length - 1).toLowerCase();
      if (!ABBREVIATIONS.has(lastWord)) {
        flush(i + 1);
        bufStart = i + 1;
      }
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush(draft.length);
  return out;
}
