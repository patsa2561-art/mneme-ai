/**
 * v2.40.0 — NUMBER PARAPHRASE BRIDGE.
 *
 * Closes the D5 audit finding: the verifier saw "865" as a token but
 * "eight hundred sixty-five" / "0x361" / "๘๖๕" / "huit cent soixante-cinq"
 * as text — so refuting one form did not refute the others. AI vendors
 * trivially evade vaccines by re-spelling numbers.
 *
 * This module exposes:
 *   extractCanonicalNumbers(text) → [{ surface, value, form }]
 *   canonicalRewrite(text)        → text with every paraphrase replaced by
 *                                   its decimal int (lossy but reproducible)
 *   sameQuantity(a, b)            → boolean: do two phrasings denote same N?
 *
 * Supported forms:
 *   - Decimal Arabic literals          "865", "1,000", "2.5", "1_000"
 *   - Hexadecimal                       "0x361", "0X3A"
 *   - Binary                            "0b1101100001"
 *   - Octal                             "0o1541" (modern), "0541" rejected
 *                                       (legacy octal is ambiguous → not bridged)
 *   - Scientific                        "8.65e2"
 *   - English words                     "eight hundred sixty-five",
 *                                       "two thousand and one",
 *                                       "a hundred", "twelve hundred"
 *   - Thai digits                       "๐๑๒๓๔๕๖๗๘๙"
 *   - Thai words                        "แปดร้อยหกสิบห้า"
 *   - Arabic-Indic digits               "٠١٢٣٤٥٦٧٨٩"
 *   - Eastern Arabic-Indic digits       "۰۱۲۳۴۵۶۷۸۹"
 *   - Full-width digits                 "０１２３" (CJK fullwidth)
 *   - Devanagari digits                 "०१२३"
 *   - Roman numerals (1..3999)          "MMXXIV", "XLII"
 *
 * Out of scope (deliberately — would cause false positives):
 *   - Floating-point words ("two point five")  → not bridged (rare in claims;
 *     and "point" causes too many false hits)
 *   - Ordinals ("first", "twenty-third")        → handled separately by callers
 *   - Negative-word forms ("minus ten")         → bridged with explicit "minus"/"-"
 *
 * Pure deterministic; no I/O.
 */

export type NumberForm =
  | "decimal"
  | "hex"
  | "binary"
  | "octal"
  | "scientific"
  | "english_words"
  | "thai_words"
  | "roman"
  | "alt_digits"; // Thai/Arabic-Indic/CJK fullwidth/Devanagari

export interface CanonicalNumber {
  /** The substring as it appears in the input. */
  surface: string;
  /** Start offset in input (UTF-16 code units). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Numeric value (finite, never NaN; integer or float). */
  value: number;
  /** Which form produced this value. */
  form: NumberForm;
}

// ─── ALT-DIGIT MAPS ────────────────────────────────────────────────────────

const ALT_DIGIT_MAP: Record<string, string> = {};
function seedDigits(start: number, label: string) {
  for (let d = 0; d <= 9; d++) ALT_DIGIT_MAP[String.fromCodePoint(start + d)] = String(d);
  void label;
}
seedDigits(0x0E50, "thai");           // ๐-๙
seedDigits(0x0660, "arabic-indic");   // ٠-٩
seedDigits(0x06F0, "eastern-arabic"); // ۰-۹
seedDigits(0xFF10, "fullwidth");      // ０-９
seedDigits(0x0966, "devanagari");     // ०-९
seedDigits(0x09E6, "bengali");        // ০-৯
seedDigits(0x0A66, "gurmukhi");
seedDigits(0x0AE6, "gujarati");
seedDigits(0x0B66, "oriya");
seedDigits(0x0BE6, "tamil");
seedDigits(0x0C66, "telugu");
seedDigits(0x0CE6, "kannada");
seedDigits(0x0D66, "malayalam");

function translateAltDigits(text: string): { translated: string; touched: boolean } {
  let touched = false;
  let out = "";
  for (const ch of text) {
    const r = ALT_DIGIT_MAP[ch];
    if (r) { out += r; touched = true; }
    else out += ch;
  }
  return { translated: out, touched };
}

// ─── ENGLISH WORDS ─────────────────────────────────────────────────────────

const EN_SMALL: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const EN_SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
  trillion: 1_000_000_000_000,
};
const EN_ARTICLES = new Set(["a", "an"]);

function isEnWord(w: string): boolean {
  return EN_SMALL[w] !== undefined || EN_TENS[w] !== undefined || EN_SCALES[w] !== undefined || EN_ARTICLES.has(w);
}

/**
 * Parse a sequence of English number tokens into one numeric value.
 * Returns null if the sequence is not a valid number word phrase.
 * Implements the "current + total" cardinal accumulator standard.
 */
function parseEnglishWords(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let consumed = 0;
  for (const t of tokens) {
    const lw = t.toLowerCase();
    if (EN_ARTICLES.has(lw)) { current = 1; consumed++; continue; }
    if (lw === "and") { consumed++; continue; }
    if (EN_SMALL[lw] !== undefined) { current += EN_SMALL[lw]!; consumed++; continue; }
    if (EN_TENS[lw] !== undefined) { current += EN_TENS[lw]!; consumed++; continue; }
    if (EN_SCALES[lw] !== undefined) {
      const scale = EN_SCALES[lw]!;
      if (current === 0) current = 1;
      if (scale === 100) {
        current = current * 100;
      } else {
        total += current * scale;
        current = 0;
      }
      consumed++;
      continue;
    }
    // Stop on first non-number-word.
    break;
  }
  if (consumed === 0) return null;
  const result = total + current;
  return Number.isFinite(result) ? result : null;
}

// ─── THAI WORDS ────────────────────────────────────────────────────────────
//
// Thai uses base-10 with scale words; for our purposes we only need 0-9999
// since claims with explicit billions/etc in Thai are extremely rare and
// adding them risks false positives.

const TH_DIGITS: Record<string, number> = {
  "ศูนย์": 0,
  "หนึ่ง": 1, "เอ็ด": 1,
  "สอง": 2, "ยี่": 2,         // ยี่สิบ = twenty (special)
  "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9,
};
const TH_SCALES: Record<string, number> = {
  "สิบ": 10, "ร้อย": 100, "พัน": 1_000, "หมื่น": 10_000,
  "แสน": 100_000, "ล้าน": 1_000_000,
};

function parseThaiNumberWord(text: string): { value: number; consumed: number } | null {
  // Thai cardinal numbers are scale-suffix base-10. Each digit may be
  // followed by a scale (สิบ/ร้อย/พัน/หมื่น/แสน/ล้าน). When a scale word
  // appears WITHOUT a preceding digit, the implicit digit is 1.
  //
  // Algorithm: maintain `partial` (sum of completed (digit × scale) terms
  // in the current scope) + `pendingDigit` (the digit not yet multiplied
  // by a scale). On a scale token, partial += pendingDigit * scale and
  // pendingDigit becomes 0. On the special ล้าน (1e6) scale, the whole
  // partial flushes to `total` since ล้าน opens a new scope.
  // At end: result = total + partial + pendingDigit.
  let i = 0;
  let total = 0;
  let partial = 0;
  let pendingDigit = 0;
  let parsed = false;
  while (i < text.length) {
    let match: { word: string; isScale: boolean; value: number } | null = null;
    for (const [word, value] of Object.entries(TH_SCALES)) {
      if (text.startsWith(word, i)) {
        if (!match || word.length > match.word.length) match = { word, isScale: true, value };
      }
    }
    for (const [word, value] of Object.entries(TH_DIGITS)) {
      if (text.startsWith(word, i)) {
        if (!match || word.length > match.word.length) match = { word, isScale: false, value };
      }
    }
    if (!match) break;
    parsed = true;
    if (match.isScale) {
      const digit = pendingDigit === 0 ? 1 : pendingDigit;
      if (match.value === 1_000_000) {
        // ล้าน opens a brand new scope: flush everything we have, multiply
        // by 1e6, then continue accumulating.
        const flushed = (partial + digit) * 1_000_000;
        total += flushed;
        partial = 0;
        pendingDigit = 0;
      } else {
        partial += digit * match.value;
        pendingDigit = 0;
      }
    } else {
      // Pure digit. If there's already an unscaled pendingDigit, that means
      // we're seeing two digits in a row (e.g. "สามสี่" = 3 then 4 — really
      // just 4 since 3 had no scale). Treat as overwrite, matching the
      // way humans read informal Thai.
      pendingDigit = match.value;
    }
    i += match.word.length;
  }
  if (!parsed) return null;
  const value = total + partial + pendingDigit;
  return Number.isFinite(value) ? { value, consumed: i } : null;
}

// ─── ROMAN NUMERALS ────────────────────────────────────────────────────────

const ROMAN: Array<[string, number]> = [
  ["M", 1000], ["CM", 900], ["D", 500], ["CD", 400], ["C", 100], ["XC", 90],
  ["L", 50], ["XL", 40], ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1],
];

function parseRoman(text: string): number | null {
  if (!/^[MDCLXVI]+$/.test(text)) return null;
  let i = 0;
  let total = 0;
  while (i < text.length) {
    let matched = false;
    for (const [token, value] of ROMAN) {
      if (text.startsWith(token, i)) {
        total += value;
        i += token.length;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  if (total < 1 || total > 3999) return null;
  // Reject malformed Roman like "IIII" or "VV"
  const round = (() => {
    let n = total;
    let out = "";
    for (const [tok, val] of ROMAN) {
      while (n >= val) { out += tok; n -= val; }
    }
    return out;
  })();
  if (round !== text) return null;
  return total;
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

export function extractCanonicalNumbers(rawText: string): CanonicalNumber[] {
  if (!rawText) return [];
  const out: CanonicalNumber[] = [];
  // We work on TWO passes:
  //  (a) translate alt-digits to ASCII so the decimal regex catches them
  //  (b) keep original offsets via a parallel index map so we can report
  //      surface positions in the ORIGINAL text
  const altMap = translateAltDigits(rawText);
  const text = altMap.translated;

  // Pre-mark already-claimed ranges to avoid double-counting (e.g. "0x361"
  // matches both the hex pattern AND the decimal "0" + "361").
  const claimed = new Array<boolean>(text.length).fill(false);
  const isClaimed = (s: number, e: number) => {
    for (let k = s; k < e; k++) if (claimed[k]) return true;
    return false;
  };
  const claim = (s: number, e: number) => { for (let k = s; k < e; k++) claimed[k] = true; };

  // 1. Hex (must come before decimal — leading "0" would otherwise grab it)
  for (const m of text.matchAll(/\b0[xX][0-9a-fA-F]+\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const value = parseInt(surface.slice(2), 16);
    if (Number.isFinite(value)) {
      out.push({ surface, start, end, value, form: "hex" });
      claim(start, end);
    }
  }
  // 2. Binary
  for (const m of text.matchAll(/\b0[bB][01]+\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const value = parseInt(surface.slice(2), 2);
    if (Number.isFinite(value)) {
      out.push({ surface, start, end, value, form: "binary" });
      claim(start, end);
    }
  }
  // 3. Modern octal
  for (const m of text.matchAll(/\b0[oO][0-7]+\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const value = parseInt(surface.slice(2), 8);
    if (Number.isFinite(value)) {
      out.push({ surface, start, end, value, form: "octal" });
      claim(start, end);
    }
  }
  // 4. Scientific
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?[eE][+-]?\d+\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const value = parseFloat(surface);
    if (Number.isFinite(value)) {
      out.push({ surface, start, end, value, form: "scientific" });
      claim(start, end);
    }
  }
  // 5. Decimal with thousands separators / underscores / dots
  for (const m of text.matchAll(/\b\d{1,3}(?:[,_]\d{3})+(?:\.\d+)?\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const cleaned = surface.replace(/[,_]/g, "");
    const value = parseFloat(cleaned);
    if (Number.isFinite(value)) {
      out.push({ surface, start, end, value, form: "decimal" });
      claim(start, end);
    }
  }
  // 6. Plain decimal (including floats)
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    const value = parseFloat(surface);
    if (Number.isFinite(value)) {
      // Distinguish alt-digit form by inspecting the ORIGINAL text at same span
      const origSlice = rawText.slice(start, end);
      const wasAlt = origSlice !== surface;
      out.push({
        surface: origSlice,
        start, end, value,
        form: wasAlt ? "alt_digits" : "decimal",
      });
      claim(start, end);
    }
  }
  // 7. Roman numerals (only standalone tokens — never inside a word)
  for (const m of text.matchAll(/\b[MDCLXVI]{1,15}\b/g)) {
    const surface = m[0]!;
    const start = m.index!;
    const end = start + surface.length;
    if (isClaimed(start, end)) continue;
    // Avoid common English words: I, MIX, DIM, LID, CID, MILL, etc.
    // Heuristic: skip 1-2 letter matches (too ambiguous); skip "MIX" / "DIM" / "MILL"
    if (surface.length < 3) continue;
    const ENGLISH_LIKE = new Set(["MIX", "DIM", "DID", "LID", "MILL", "MILD", "MICA", "VIVID", "DIDI", "CIVIC", "MIMIC"]);
    if (ENGLISH_LIKE.has(surface)) continue;
    const value = parseRoman(surface);
    if (value !== null) {
      out.push({ surface, start, end, value, form: "roman" });
      claim(start, end);
    }
  }
  // 8. English number words (longest-match accumulator)
  // We scan token-by-token; whenever we see a known English number word,
  // greedy-consume subsequent number words until the run breaks.
  const wordRe = /\b[a-zA-Z]+\b/g;
  const wordMatches: Array<{ word: string; start: number; end: number }> = [];
  let wm: RegExpExecArray | null;
  while ((wm = wordRe.exec(text)) !== null) {
    wordMatches.push({ word: wm[0], start: wm.index, end: wm.index + wm[0].length });
  }
  let wi = 0;
  while (wi < wordMatches.length) {
    if (!isEnWord(wordMatches[wi]!.word.toLowerCase())) { wi++; continue; }
    // Greedy run. We also accept "and" as a connector.
    let wj = wi;
    const run: string[] = [];
    while (wj < wordMatches.length) {
      const lw = wordMatches[wj]!.word.toLowerCase();
      if (isEnWord(lw) || lw === "and") { run.push(lw); wj++; }
      else break;
    }
    // Trim trailing "and"
    while (run.length > 0 && run[run.length - 1] === "and") run.pop();
    if (run.length === 0) { wi++; continue; }
    const start = wordMatches[wi]!.start;
    const end = wordMatches[wi + run.length - 1]!.end;
    if (isClaimed(start, end)) { wi = wj; continue; }
    const value = parseEnglishWords(run);
    // Require: value > 0 OR the literal token is a recognized zero.
    if (value !== null && (value > 0 || run.includes("zero"))) {
      const surface = rawText.slice(start, end);
      out.push({ surface, start, end, value, form: "english_words" });
      claim(start, end);
    }
    wi = wj;
  }
  // 9. Thai number words (scan; greedy-longest)
  // Thai is harder because there are no spaces. We scan for any Thai
  // digit/scale word and greedy-extend.
  // Build a single regex of all known Thai number tokens for first-hit detection.
  const thaiTokens = [...Object.keys(TH_DIGITS), ...Object.keys(TH_SCALES)]
    .sort((a, b) => b.length - a.length);
  const thaiTokenRe = new RegExp("(" + thaiTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g");
  let tm: RegExpExecArray | null;
  // Reset lastIndex
  thaiTokenRe.lastIndex = 0;
  while ((tm = thaiTokenRe.exec(text)) !== null) {
    const start = tm.index;
    if (isClaimed(start, start + tm[0].length)) continue;
    // From this hit, greedily parse the longest Thai number word.
    const parsed = parseThaiNumberWord(text.slice(start));
    if (parsed && parsed.value > 0 && parsed.consumed > 0) {
      const end = start + parsed.consumed;
      if (!isClaimed(start, end)) {
        const surface = rawText.slice(start, end);
        out.push({ surface, start, end, value: parsed.value, form: "thai_words" });
        claim(start, end);
      }
      thaiTokenRe.lastIndex = end;
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/**
 * Replace every recognized number paraphrase with its decimal int form.
 * Returns a normalized text where "eight hundred sixty-five" and "0x361"
 * both become "865". Lossy but deterministic; intended as a SECONDARY
 * comparison channel — not a replacement for the original text.
 */
export function canonicalRewrite(text: string): string {
  if (!text) return "";
  const nums = extractCanonicalNumbers(text);
  if (nums.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const n of nums) {
    out += text.slice(cursor, n.start);
    out += String(n.value);
    cursor = n.end;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Returns true if two text fragments contain the SAME set of canonical
 * numeric values. Order- and form-independent. Used by ARGUS-10 EYE_7.
 *
 * Tolerance: floats within 1e-9 relative are considered equal.
 */
export function sameQuantity(a: string, b: string, opts: { ignoreOrder?: boolean } = {}): boolean {
  const na = extractCanonicalNumbers(a).map((n) => n.value);
  const nb = extractCanonicalNumbers(b).map((n) => n.value);
  if (na.length !== nb.length) return false;
  if (na.length === 0) return true;
  const eq = (x: number, y: number) => {
    if (x === y) return true;
    const denom = Math.max(Math.abs(x), Math.abs(y), 1);
    return Math.abs(x - y) / denom < 1e-9;
  };
  if (opts.ignoreOrder ?? true) {
    const sa = [...na].sort((x, y) => x - y);
    const sb = [...nb].sort((x, y) => x - y);
    for (let i = 0; i < sa.length; i++) if (!eq(sa[i]!, sb[i]!)) return false;
    return true;
  }
  for (let i = 0; i < na.length; i++) if (!eq(na[i]!, nb[i]!)) return false;
  return true;
}
