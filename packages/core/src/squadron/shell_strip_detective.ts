/**
 * v2.44.0 — SHELL-STRIP DETECTIVE.
 *
 * Closes UX gap from v2.41 audit screenshot: user typed
 * `mneme verify "Mneme verifies <BIDI> claims"` intending to test the
 * BIDI override path, but bash/PowerShell stripped U+202E before Node
 * received it. Verifier saw clean text, returned MIXED, user reasonably
 * concluded "BIDI detection is broken".
 *
 * Heuristic: when the claim TEXT MENTIONS hostile-char keywords
 * (BIDI / null / override / U+202E / \x00 / RTL / homoglyph etc) but
 * the claim itself contains NONE of the actual hostile codepoints, the
 * shell probably stripped them. Emit a structured suggestion the CLI
 * can render: "try `mneme verify --stdin` to bypass the shell."
 *
 * Pure deterministic; no I/O.
 */

import { checkInputHygiene } from "./acgv_input_hygiene.js";

const HOSTILE_KEYWORDS = /\b(BIDI|RTL\s*override|null\s*byte|null-byte|NUL\s*byte|U\+20[0-9A-F][0-9A-F]|U\+FFFD|U\+E00[0-9A-F]|\\x00|\\u202[ABCDEF]|\\u200[CDEF]|homoglyph|tag\s*char|zero-?width|control\s*char|prompt\s*smuggle|trojan\s*source)\b/i;

export type SuggestedMode = "stdin" | "hex" | "base64" | "clipboard" | "file";

export interface ShellStripVerdict {
  suspicious: boolean;
  /** Why we think the shell stripped hostile chars. */
  reason: string;
  /** Which lossless input mode to suggest. */
  suggestedMode: SuggestedMode;
  /** User-readable hint string. */
  hint: string;
}

/**
 * Returns suspicious=true when the claim mentions a hostile-char
 * keyword but contains none of the actual hostile codepoints.
 *
 * Pure function. Tests live in v44 regression suite.
 */
export function detectShellStrip(claim: string): ShellStripVerdict {
  if (!claim || claim.length === 0) {
    return { suspicious: false, reason: "empty input", suggestedMode: "stdin", hint: "" };
  }
  const hyg = checkInputHygiene(claim);
  // If claim ALREADY contains a BLOCK hazard, the shell did NOT strip —
  // the user successfully passed the hostile char through. No suggestion needed.
  if (hyg.tampered) {
    return { suspicious: false, reason: "claim already contains real hostile codepoints", suggestedMode: "stdin", hint: "" };
  }
  // Check for keyword mention WITHOUT corresponding actual char.
  const match = claim.match(HOSTILE_KEYWORDS);
  if (!match) {
    return { suspicious: false, reason: "no hostile-char keyword mentioned", suggestedMode: "stdin", hint: "" };
  }
  const kw = match[0];
  return {
    suspicious: true,
    reason: `claim mentions "${kw}" but contains no actual hostile codepoints — your shell may have stripped them`,
    suggestedMode: "stdin",
    hint: `⚠ Your input mentions "${kw}" but Mneme received no actual hostile codepoints. The OS shell (bash/PowerShell on Windows) often strips BIDI / NUL / control chars from argv. To verify losslessly, try one of:\n` +
          `  • mneme verify --stdin       (echo "$CLAIM" | mneme verify --stdin)\n` +
          `  • mneme verify --hex <hex>   (encode UTF-8 as hex)\n` +
          `  • mneme verify --base64 <b64>\n` +
          `  • mneme verify --clipboard   (paste hostile text first)\n` +
          `  • mneme verify --file <path> (write claim to a file, then pass --file)`,
  };
}
