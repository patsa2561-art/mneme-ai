/**
 * v2.46.0 — NEMESIS ORGAN 3 wild-idea: WHITESPACE-STEGO WATERMARK.
 *
 * Encodes a short vendor tag (e.g. "claude", "cursor") into a string
 * using zero-width Unicode characters. Result is BYTE-different but
 * VISUALLY identical — so an AI-injected code comment can carry a
 * tamper-evident vendor watermark that survives copy-paste through
 * any text editor.
 *
 * Encoding alphabet (3 chars, base-3):
 *   U+200B  ZERO WIDTH SPACE       → digit 0
 *   U+200C  ZERO WIDTH NON-JOINER  → digit 1
 *   U+200D  ZERO WIDTH JOINER      → digit 2
 *
 * Each input byte (0-255) becomes 6 base-3 digits (3^6 = 729 ≥ 256).
 *
 * Use case: append `// AI: <invisible-watermark>` to a code comment;
 * GREP detects the visible prefix; decoder reveals the vendor.
 *
 * Pure deterministic; never throws.
 */

const D0 = "​"; // ZWSP
const D1 = "‌"; // ZWNJ
const D2 = "‍"; // ZWJ
const DIGITS = [D0, D1, D2];

function byteToBase3(b: number): string {
  let n = b & 0xff;
  let s = "";
  for (let i = 0; i < 6; i++) {
    s = DIGITS[n % 3]! + s;
    n = Math.floor(n / 3);
  }
  return s;
}

function base3ToByte(s: string): number {
  let n = 0;
  for (const ch of s) {
    const d = ch === D0 ? 0 : ch === D1 ? 1 : ch === D2 ? 2 : -1;
    if (d === -1) return -1;
    n = n * 3 + d;
  }
  return n & 0xff;
}

/**
 * Encode a watermark into a visible prefix string.
 * Returns prefix + zero-width-encoded payload.
 */
export function encodeWatermark(visiblePrefix: string, payload: string): string {
  if (!payload) return visiblePrefix;
  const bytes = Buffer.from(payload, "utf8");
  let out = visiblePrefix;
  for (const b of bytes) out += byteToBase3(b);
  return out;
}

/**
 * Decode a watermark out of a line. Returns "" when no watermark present
 * OR the encoded bytes don't form valid UTF-8.
 */
export function decodeWatermark(line: string): string {
  if (!line) return "";
  // Extract only the zero-width chars
  const zw = line.replace(/[^​‌‍]/g, "");
  if (zw.length === 0 || zw.length % 6 !== 0) return "";
  const bytes: number[] = [];
  for (let i = 0; i < zw.length; i += 6) {
    const b = base3ToByte(zw.slice(i, i + 6));
    if (b === -1) return "";
    bytes.push(b);
  }
  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return "";
  }
}
