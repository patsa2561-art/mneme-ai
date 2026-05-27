/**
 * 🛡 HOMOGRAPH GUARD — Unicode normalization + confusable detection
 *
 * Closes the v2.70 vuln: "٢.70.0" (Arabic-Indic digit) passed as MIXED
 * instead of REFUTED → attacker bypassed version check by spelling the
 * digit in a non-ASCII script.
 *
 * Solution stacks 4 lenses:
 *   1. NFKC normalize     → canonicalizes compatibility forms
 *   2. Digit transliterate → maps all Unicode digits → ASCII 0-9
 *   3. Confusable scan     → flags homoglyph attempts (UTS #39 subset)
 *   4. Pipeline annotation → caller knows input was canonicalized
 *
 * API:
 *   canonicalize(input) → { canonical, original, flags, transformations }
 *
 * Output flags drive verdict:
 *   "homograph_detected"    → version claim has non-ASCII digits
 *   "mixed_script"          → claim mixes script families (suspicious)
 *   "rtl_override"          → contains BIDI override (U+202E)
 *   "control_char_injected" → contains null / BEL / BS / etc.
 *   "zwsp_injected"         → zero-width space / joiner
 *
 * No external Unicode tables — uses Node's built-in normalize() + a
 * small curated confusable map.
 */

/** Per UTS #39 — common confusables. Extend over time. */
const CONFUSABLE_MAP: Record<string, string> = {
  // Cyrillic → Latin (most common attack vector)
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
  "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
  // Greek → Latin
  "α": "a", "β": "b", "ο": "o", "ρ": "p", "ν": "v", "Α": "A", "Β": "B",
  // Cherokee letter A (very deceptive)
  "Ꭺ": "A",
  // Math alphanumerics
  "𝟎": "0", "𝟏": "1", "𝟐": "2", "𝟑": "3", "𝟒": "4",
  "𝟓": "5", "𝟔": "6", "𝟕": "7", "𝟖": "8", "𝟗": "9",
};

/** Map ALL Unicode digit code points to ASCII via Unicode digit value. */
function transliterateDigits(s: string): { out: string; changedCount: number } {
  let changed = 0;
  const out = Array.from(s, (ch) => {
    const cp = ch.codePointAt(0)!;
    // Latin ASCII already
    if (cp >= 0x30 && cp <= 0x39) return ch;
    // Arabic-Indic 0660-0669
    if (cp >= 0x0660 && cp <= 0x0669) { changed++; return String.fromCharCode(0x30 + (cp - 0x0660)); }
    // Extended Arabic-Indic 06F0-06F9
    if (cp >= 0x06F0 && cp <= 0x06F9) { changed++; return String.fromCharCode(0x30 + (cp - 0x06F0)); }
    // Bengali 09E6-09EF
    if (cp >= 0x09E6 && cp <= 0x09EF) { changed++; return String.fromCharCode(0x30 + (cp - 0x09E6)); }
    // Devanagari 0966-096F
    if (cp >= 0x0966 && cp <= 0x096F) { changed++; return String.fromCharCode(0x30 + (cp - 0x0966)); }
    // Thai 0E50-0E59
    if (cp >= 0x0E50 && cp <= 0x0E59) { changed++; return String.fromCharCode(0x30 + (cp - 0x0E50)); }
    // Lao 0ED0-0ED9
    if (cp >= 0x0ED0 && cp <= 0x0ED9) { changed++; return String.fromCharCode(0x30 + (cp - 0x0ED0)); }
    // Burmese 1040-1049
    if (cp >= 0x1040 && cp <= 0x1049) { changed++; return String.fromCharCode(0x30 + (cp - 0x1040)); }
    // Khmer 17E0-17E9
    if (cp >= 0x17E0 && cp <= 0x17E9) { changed++; return String.fromCharCode(0x30 + (cp - 0x17E0)); }
    // Fullwidth FF10-FF19
    if (cp >= 0xFF10 && cp <= 0xFF19) { changed++; return String.fromCharCode(0x30 + (cp - 0xFF10)); }
    // Mathematical bold/italic digits 1D7CE-1D7FF
    if (cp >= 0x1D7CE && cp <= 0x1D7FF) { changed++; return String.fromCharCode(0x30 + ((cp - 0x1D7CE) % 10)); }
    return ch;
  }).join("");
  return { out, changedCount: changed };
}

function detectScripts(s: string): Set<string> {
  const scripts = new Set<string>();
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0041 && cp <= 0x024F) scripts.add("Latin");
    else if (cp >= 0x0400 && cp <= 0x04FF) scripts.add("Cyrillic");
    else if (cp >= 0x0370 && cp <= 0x03FF) scripts.add("Greek");
    else if (cp >= 0x0590 && cp <= 0x05FF) scripts.add("Hebrew");
    else if (cp >= 0x0600 && cp <= 0x06FF) scripts.add("Arabic");
    else if (cp >= 0x0E00 && cp <= 0x0E7F) scripts.add("Thai");
    else if (cp >= 0x0900 && cp <= 0x097F) scripts.add("Devanagari");
    else if (cp >= 0x4E00 && cp <= 0x9FFF) scripts.add("CJK");
  }
  return scripts;
}

const RTL_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;
const ZWSP_RE = /[​-‍﻿]/g;
const CONTROL_RE = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/g;
const NON_ASCII_DIGIT_RE = /[٠-٩۰-۹߀-߉०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯෦-෯๐-๙໐-໙༠-༩၀-၉႐-႙០-៩᠐-᠙᥆-᥏᧐-᧙᪀-᪉᪐-᪙᭐-᭙᮰-᮹᱀-᱉᱐-᱙꘠-꘩꣐-꣙꤀-꤉꧐-꧙꧰-꧹꩐-꩙꯰-꯹０-９]/g;

export interface CanonicalizeResult {
  original: string;
  canonical: string;
  flags: string[];
  transformations: string[];
  confusablesReplaced: number;
  digitsTransliterated: number;
}

export function canonicalize(input: string): CanonicalizeResult {
  const flags: string[] = [];
  const transformations: string[] = [];
  let working = input;

  // Pre-detect: did the input contain ANY non-ASCII Unicode digit?
  // (Catches fullwidth ２ which NFKC normalizes BEFORE our transliterator runs.)
  const preNonAsciiDigitMatches = input.match(NON_ASCII_DIGIT_RE);
  const preNonAsciiDigitCount = preNonAsciiDigitMatches ? preNonAsciiDigitMatches.length : 0;

  // Stage 0: detect control chars BEFORE stripping (alert + strip)
  if (CONTROL_RE.test(working)) {
    flags.push("control_char_injected");
    working = working.replace(CONTROL_RE, "");
    transformations.push("stripped control chars (0x00-0x1F except tab/LF/CR)");
  }
  if (RTL_OVERRIDE_RE.test(working)) {
    flags.push("rtl_override");
    working = working.replace(RTL_OVERRIDE_RE, "");
    transformations.push("stripped BIDI override (U+202A-202E + 2066-2069)");
  }
  if (ZWSP_RE.test(working)) {
    flags.push("zwsp_injected");
    working = working.replace(ZWSP_RE, "");
    transformations.push("stripped zero-width chars (U+200B-200D + FEFF)");
  }

  // Stage 1: NFKC — canonicalize compatibility forms
  const beforeNfkc = working;
  working = working.normalize("NFKC");
  if (beforeNfkc !== working) {
    transformations.push("NFKC normalize");
  }

  // Stage 2: Digit transliteration (Arabic-Indic / Bengali / Thai / fullwidth / math)
  const dt = transliterateDigits(working);
  working = dt.out;
  // Count: explicit transliteration + NFKC-induced non-ASCII digit changes
  const totalDigitsChanged = dt.changedCount + Math.max(0, preNonAsciiDigitCount - dt.changedCount);
  if (totalDigitsChanged > 0) {
    flags.push("homograph_detected");
    transformations.push(`transliterated ${totalDigitsChanged} non-Latin digit(s) to ASCII (NFKC + direct map)`);
  }

  // Stage 3: Confusable letter replacement
  let confusables = 0;
  working = Array.from(working, (ch) => {
    if (CONFUSABLE_MAP[ch] !== undefined) { confusables++; return CONFUSABLE_MAP[ch]; }
    return ch;
  }).join("");
  if (confusables > 0) {
    flags.push("homograph_detected");
    transformations.push(`replaced ${confusables} confusable letter(s) with ASCII equivalent`);
  }

  // Stage 4: mixed-script detection (only flag if NOT already Latin-only after canonicalization)
  const scripts = detectScripts(working);
  if (scripts.size > 1 && scripts.has("Latin")) {
    flags.push("mixed_script");
    transformations.push(`mixed scripts detected: ${[...scripts].join("+")}`);
  }

  return {
    original: input,
    canonical: working,
    flags: [...new Set(flags)],
    transformations,
    confusablesReplaced: confusables,
    digitsTransliterated: totalDigitsChanged,
  };
}

/**
 * Convenience: given a claim, return whether it's safe to verify as-is
 * or needs caller to re-verify on the canonical form.
 *
 * Caller should:
 *   const c = canonicalize(input);
 *   if (c.flags.includes("homograph_detected")) {
 *     // verify on c.canonical instead — annotate verdict with c.flags
 *   }
 */
export function shouldReVerify(result: CanonicalizeResult): boolean {
  return result.flags.length > 0 && result.original !== result.canonical;
}
