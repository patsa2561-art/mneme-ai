/**
 * v2.40.0 — INPUT HYGIENE (ACGV Layer -1 hardening).
 *
 * Closes 3 audit findings (D4 / D6 / D8) that slipped past the existing
 * 30%-printable gross-input filter:
 *
 *   D4  BIDI override (U+202E + family)   → was: UNKNOWN, no flag
 *   D6  Null byte mid-claim               → was: UNKNOWN, silent
 *   D8  Thai NFC vs NFD form              → was: UNKNOWN, no normalize
 *
 * The pre-v2.40 Layer -1 (`isUnverifiableEmptyish`) only fired when MOST
 * of the text was control / non-printable. One U+202E in a 300-char
 * sentence stayed above the 30% floor and slipped through. ARGUS-style
 * thinking: control-char attacks are CATEGORICAL, not statistical —
 * the presence of ONE hostile codepoint mid-text is already enough.
 *
 * Returns a HazardReport with:
 *   - cleanClaim:       the claim with stripped/normalized hazards
 *   - normalizedClaim:  NFC-normalized form (for downstream extractors)
 *   - hazards:          list of {kind, severity, positions, evidence}
 *
 * Severity:
 *   BLOCK  → ACGV must return IMPOSSIBLE_REFUTE with INPUT_TAMPERED.
 *   WARN   → caveat surfaced; pipeline continues on cleanClaim.
 *   INFO   → annotation only.
 *
 * Pure deterministic; no I/O.
 */

export type HazardKind =
  | "bidi_override"        // D4: U+202E / U+202D / U+2066-2069 directional override
  | "null_byte"            // D6: \x00 anywhere in the text
  | "control_char"         // D6 (extended): C0/C1 control chars except \t \n \r
  | "zero_width"           // ZWJ / ZWSP / ZWNJ / WJ / BOM mid-text
  | "homoglyph_mix"        // Cyrillic 'е' inside Latin token (cross-script word)
  | "tag_chars"            // U+E0000-E007F invisible tag range (steganography)
  | "private_use"          // U+E000-F8FF unassignable private-use
  | "denormalized_nfc"     // D8: NFC vs raw differs (combining sequences)
  | "unicode_replacement"  // U+FFFD inside text = prior decode failure
  | "rtl_override"         // U+200F (LRM/RLM at boundary) injection
  | "byte_order_mark";     // U+FEFF mid-text

export type HazardSeverity = "BLOCK" | "WARN" | "INFO";

export interface Hazard {
  kind: HazardKind;
  severity: HazardSeverity;
  /** Positions (UTF-16 code unit indices in the ORIGINAL claim). */
  positions: number[];
  /** Short, user-readable evidence string. */
  evidence: string;
  /** The actual codepoint(s) found, hex-escaped for the report. */
  codepoints: string[];
}

export interface HygieneReport {
  /** Input with BLOCK + WARN hazards stripped / replaced. */
  cleanClaim: string;
  /** NFC-normalized form of cleanClaim, for downstream extractors. */
  normalizedClaim: string;
  /** All detected hazards (BLOCK + WARN + INFO). */
  hazards: Hazard[];
  /** True if any hazard is BLOCK-severity. */
  tampered: boolean;
  /** Vaccine signature for INPUT_TAMPERED claims (so we learn the shape). */
  vaccineSignature: string;
}

const BIDI_OVERRIDES = new Set<number>([
  0x202A, // LRE
  0x202B, // RLE
  0x202C, // PDF (pop directional formatting)
  0x202D, // LRO
  0x202E, // RLO  ← classic Trojan-source attack
  0x2066, // LRI
  0x2067, // RLI
  0x2068, // FSI
  0x2069, // PDI
]);

const ZERO_WIDTH = new Set<number>([
  0x200B, // ZWSP
  0x200C, // ZWNJ
  0x200D, // ZWJ
  0x2060, // WJ
]);

/** Pseudo-spaces that confuse tokenizers but render harmless. */
const INVISIBLE_SPACES = new Set<number>([
  0x00A0, // NBSP (allowed in some contexts; INFO only)
  0x1680, // Ogham space
  0x2000, // EN QUAD … through 0x200A
  0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
  0x202F, // NARROW NBSP
  0x205F, // MEDIUM MATH SPACE
  0x3000, // IDEOGRAPHIC SPACE
]);

function isC0OrC1Control(cp: number): boolean {
  // C0 except TAB(0x09) LF(0x0A) CR(0x0D); C1 (0x80-0x9F) all.
  if (cp === 0x09 || cp === 0x0A || cp === 0x0D) return false;
  if (cp >= 0x00 && cp <= 0x1F) return true;
  if (cp >= 0x80 && cp <= 0x9F) return true;
  return false;
}

function isTagChar(cp: number): boolean {
  return cp >= 0xE0000 && cp <= 0xE007F;
}

function isPrivateUse(cp: number): boolean {
  return cp >= 0xE000 && cp <= 0xF8FF;
}

function hex(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Detect cross-script mixing INSIDE a single word. We classify each char
 * as Latin / Cyrillic / Greek (only — most homoglyph attacks target those
 * three). A token that contains chars from ≥ 2 of those scripts is flagged.
 *
 * Critical: we do NOT flag mixed Latin + Thai or Latin + Arabic — those
 * are legitimate multilingual sentences. Homoglyph attacks specifically
 * exploit visually-confusable glyphs in the SAME letterform family.
 */
function scriptOf(cp: number): "latin" | "cyrillic" | "greek" | "other" {
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return "latin";
  if (cp >= 0x0400 && cp <= 0x04FF) return "cyrillic";
  if (cp >= 0x0370 && cp <= 0x03FF) return "greek";
  return "other";
}

function detectHomoglyphMix(claim: string): { positions: number[]; tokens: string[] } {
  const tokens = claim.split(/(\s+)/);
  const found: { positions: number[]; tokens: string[] } = { positions: [], tokens: [] };
  let offset = 0;
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      offset += tok.length;
      continue;
    }
    const scripts = new Set<string>();
    for (const ch of tok) {
      const cp = ch.codePointAt(0)!;
      const s = scriptOf(cp);
      if (s !== "other") scripts.add(s);
    }
    if (scripts.size >= 2) {
      found.tokens.push(tok);
      found.positions.push(offset);
    }
    offset += tok.length;
  }
  return found;
}

/**
 * Build a quick simhash-style signature so INPUT_TAMPERED claims can
 * be vaccinated and recognized again. Includes the hazard kinds + a
 * collapsed form of the cleaned claim head.
 */
function buildVaccineSignature(hazards: Hazard[], cleanHead: string): string {
  const kinds = Array.from(new Set(hazards.filter((h) => h.severity === "BLOCK").map((h) => h.kind))).sort();
  const head = cleanHead.slice(0, 60).replace(/\s+/g, " ").trim();
  return `INPUT_TAMPERED :: kinds=${kinds.join(",")} :: head="${head}"`;
}

/**
 * The Layer -1 entry point. Pure. Always returns a report.
 */
export function checkInputHygiene(rawClaim: string): HygieneReport {
  const hazards: Hazard[] = [];
  if (!rawClaim || rawClaim.length === 0) {
    return {
      cleanClaim: "",
      normalizedClaim: "",
      hazards: [],
      tampered: false,
      vaccineSignature: "",
    };
  }

  // Pass 1: codepoint scan. Collect positions + build a cleaned form
  // where BLOCK hazards are removed and WARN hazards are stripped too
  // (we keep the cleaned form so downstream layers see safe text).
  const positions: { [K in HazardKind]?: number[] } = {};
  const codepoints: { [K in HazardKind]?: string[] } = {};
  const cleanChars: string[] = [];
  let i = 0;
  for (const ch of rawClaim) {
    const cp = ch.codePointAt(0)!;
    let drop = false;
    let kind: HazardKind | null = null;

    if (BIDI_OVERRIDES.has(cp)) { kind = "bidi_override"; drop = true; }
    else if (cp === 0x00) { kind = "null_byte"; drop = true; }
    else if (isC0OrC1Control(cp)) { kind = "control_char"; drop = true; }
    else if (cp === 0xFEFF && i > 0) { kind = "byte_order_mark"; drop = true; }
    else if (cp === 0xFFFD) { kind = "unicode_replacement"; drop = true; }
    else if (ZERO_WIDTH.has(cp)) { kind = "zero_width"; drop = true; }
    else if (isTagChar(cp)) { kind = "tag_chars"; drop = true; }
    else if (isPrivateUse(cp)) { kind = "private_use"; drop = true; }
    else if (cp === 0x200E || cp === 0x200F) { kind = "rtl_override"; drop = true; }
    // INVISIBLE_SPACES: normalize to regular space, INFO severity only
    else if (INVISIBLE_SPACES.has(cp)) {
      // Replace with regular space; do not drop. INFO-level only.
      cleanChars.push(" ");
      i += ch.length;
      continue;
    }

    if (kind) {
      positions[kind] = positions[kind] ?? [];
      codepoints[kind] = codepoints[kind] ?? [];
      positions[kind]!.push(i);
      codepoints[kind]!.push(hex(cp));
    }
    if (!drop) cleanChars.push(ch);
    i += ch.length;
  }
  const cleanClaim = cleanChars.join("");

  // Pass 2: emit hazards with severity.
  const sev = (kind: HazardKind): HazardSeverity => {
    switch (kind) {
      case "bidi_override":
      case "null_byte":
      case "tag_chars":
        return "BLOCK";
      case "control_char":
      case "unicode_replacement":
      case "rtl_override":
      case "private_use":
        return "WARN";
      case "zero_width":
      case "byte_order_mark":
      case "homoglyph_mix":
      case "denormalized_nfc":
        return "WARN";
      default:
        return "INFO";
    }
  };
  const evidenceFor = (kind: HazardKind, n: number): string => {
    switch (kind) {
      case "bidi_override": return `${n} BIDI directional override codepoint(s) embedded mid-text — classic Trojan-source attack`;
      case "null_byte": return `${n} NUL byte(s) embedded in the claim — likely C-string terminator injection`;
      case "control_char": return `${n} ASCII/C1 control character(s) — likely log-injection or terminal-escape attempt`;
      case "byte_order_mark": return `${n} BOM (U+FEFF) embedded mid-text — likely concatenation tamper`;
      case "unicode_replacement": return `${n} U+FFFD replacement character(s) — input was decoded from corrupted bytes`;
      case "zero_width": return `${n} zero-width joiner/space — invisible tokenizer evasion`;
      case "tag_chars": return `${n} Unicode tag character(s) — steganographic payload (LLM-prompt-smuggling pattern)`;
      case "private_use": return `${n} private-use codepoint(s) — undefined glyph (possible covert channel)`;
      case "rtl_override": return `${n} LRM/RLM directional mark(s) — RTL injection`;
      case "homoglyph_mix": return `${n} cross-script word(s) — Cyrillic/Greek letters inside Latin tokens`;
      case "denormalized_nfc": return `claim is not NFC-normalized — combining-mark form differs from canonical`;
    }
    return "";
  };

  for (const kind of Object.keys(positions) as HazardKind[]) {
    const pos = positions[kind]!;
    if (pos.length === 0) continue;
    hazards.push({
      kind,
      severity: sev(kind),
      positions: pos,
      evidence: evidenceFor(kind, pos.length),
      codepoints: codepoints[kind] ?? [],
    });
  }

  // Pass 3: homoglyph mix (operates on the cleaned form so dropped hazards
  // don't double-count).
  const mix = detectHomoglyphMix(cleanClaim);
  if (mix.positions.length > 0) {
    hazards.push({
      kind: "homoglyph_mix",
      severity: "WARN",
      positions: mix.positions,
      evidence: evidenceFor("homoglyph_mix", mix.tokens.length),
      codepoints: mix.tokens.slice(0, 3),
    });
  }

  // Pass 4: NFC normalization. Compare original (post-clean) to NFC form;
  // if they differ, flag denormalized_nfc and use the NFC form downstream.
  // This is THE D8 fix — same Thai phrase in NFC vs NFD now produces the
  // SAME canonical key, so fact extractors don't get fooled by the
  // combining-character form.
  let normalizedClaim = cleanClaim;
  try {
    normalizedClaim = cleanClaim.normalize("NFC");
    if (normalizedClaim !== cleanClaim) {
      hazards.push({
        kind: "denormalized_nfc",
        severity: "WARN",
        positions: [0],
        evidence: evidenceFor("denormalized_nfc", 0),
        codepoints: [`raw=${cleanClaim.length}cu`, `nfc=${normalizedClaim.length}cu`],
      });
    }
  } catch {
    normalizedClaim = cleanClaim;
  }

  const tampered = hazards.some((h) => h.severity === "BLOCK");
  const vaccineSignature = tampered ? buildVaccineSignature(hazards, normalizedClaim) : "";

  return { cleanClaim, normalizedClaim, hazards, tampered, vaccineSignature };
}

/**
 * Convenience: returns the cleaned + NFC form of any text. Used by ARGUS-10
 * EYE_6 (homoglyphCollapse) and EYE_7 (numberParaphraseBridge) so they
 * never see raw hostile input.
 */
export function safeNormalize(text: string): string {
  if (!text) return "";
  return checkInputHygiene(text).normalizedClaim;
}
