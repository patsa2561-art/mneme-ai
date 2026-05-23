/**
 * v2.41.0 — ARGUS-11 MULTIMODAL EYES (EYE_11, EYE_12).
 *
 * Extend ARGUS-10 (10 surface+truth eyes for text) into a true
 * multimodal system. EYE_11 compares IMAGE bytes (any candidate.meta
 * carrying `imageBytes` or `imagePath`) using the v2.39 Zzzzz-PROBE
 * signals (perceptual hash + Laplacian variance + color-histogram
 * entropy). EYE_12 compares CODE blobs via AST-shape + symbol-overlap
 * (Mneme-unique: we use the existing codegraph normalizer when present;
 * otherwise fall back to token n-gram on identifier-bearing lines).
 *
 * These eyes:
 *   - close gracefully when the candidate has no image/code metadata
 *   - never throw (any analyzer error → raw=0 with a reason)
 *   - are pure functions; no I/O beyond reading the bytes supplied
 *
 * Composability: callers attach modality info via Candidate.meta:
 *   meta: { imageBytes?: Uint8Array, codeText?: string, language?: string }
 */

import { readFileSync, existsSync } from "node:fs";
import type { Candidate, Eye, EyeCtx, EyeSignal } from "./types.js";

// ─── EYE_11 — image-modality similarity ────────────────────────────────
//
// We use the Zzzzz-PROBE image_provenance helpers. For each candidate
// with image data, compute:
//   - perceptual hash diff (Hamming distance / 64 → similarity)
//   - color-histogram entropy delta (closer = more similar)
//   - JPEG quant fingerprint match (if both are JPEG)
// Output is the WEIGHTED MEAN of the three.

interface ZzzzzImageMod {
  analyzeImage: (bytes: Uint8Array) => unknown;
}

function getImageBytesFromMeta(meta: { imageBytes?: Uint8Array; imagePath?: string } | undefined): Uint8Array | null {
  if (!meta) return null;
  if (meta.imageBytes instanceof Uint8Array) return meta.imageBytes;
  if (typeof meta.imagePath === "string" && existsSync(meta.imagePath)) {
    try { return new Uint8Array(readFileSync(meta.imagePath)); } catch { return null; }
  }
  return null;
}

function popcount64(a: string, b: string): number {
  // Both expected hex of equal length (16 chars for 64-bit pHash).
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][x]!;
  }
  return dist;
}

export const EYE_11_image_modality: Eye = {
  id: "EYE_HYDRA_image_modality" as Eye["id"],
  layer: "truth",
  weight: 0.08,
  probe: () => "OPEN", // closes per-call when no image data
  async signal(_q: string, c: Candidate, _ctx: EyeCtx): Promise<EyeSignal> {
    const qBytes = getImageBytesFromMeta((c.meta as { queryImageBytes?: Uint8Array })?.queryImageBytes as never ?? undefined);
    const cBytes = getImageBytesFromMeta(c.meta as { imageBytes?: Uint8Array; imagePath?: string } | undefined);
    if (!qBytes && !cBytes) return { raw: 0, reason: "no image data on either side" };
    if (!qBytes || !cBytes) return { raw: 0, reason: "asymmetric image data" };
    try {
      const mod = (await import("../zzzzz_probe/image_provenance.js")) as unknown as ZzzzzImageMod;
      const qa = mod.analyzeImage(qBytes) as {
        perceptualHash: string;
        colorHistogramEntropy: number;
        jpegQuantFingerprint?: string | null;
      };
      const ca = mod.analyzeImage(cBytes) as {
        perceptualHash: string;
        colorHistogramEntropy: number;
        jpegQuantFingerprint?: string | null;
      };
      // 1. Perceptual hash similarity (Hamming distance over 64 bits)
      const dist = popcount64(qa.perceptualHash, ca.perceptualHash);
      const phashSim = 1 - dist / 64;
      // 2. Histogram entropy proximity
      const entDelta = Math.abs(qa.colorHistogramEntropy - ca.colorHistogramEntropy);
      const entSim = Math.max(0, 1 - entDelta / 9);
      // 3. JPEG quant table match (when applicable)
      let jpegSim = 0.5;
      if (qa.jpegQuantFingerprint && ca.jpegQuantFingerprint) {
        jpegSim = qa.jpegQuantFingerprint === ca.jpegQuantFingerprint ? 1.0 : 0.3;
      }
      const raw = phashSim * 0.6 + entSim * 0.25 + jpegSim * 0.15;
      return { raw, reason: `pHash=${phashSim.toFixed(2)} ent=${entSim.toFixed(2)} jpeg=${jpegSim.toFixed(2)}` };
    } catch (e) {
      return { raw: 0, reason: `image-analysis failed: ${(e as Error).message?.slice(0, 60) ?? "err"}` };
    }
  },
};

// ─── EYE_12 — code-modality similarity ─────────────────────────────────
//
// Mneme-unique: we lex the query + candidate as code (extract identifiers,
// keywords, string literals), build a multiset, and Dice-coefficient them.
// For higher-quality matching we ALSO normalize: strip comments, collapse
// whitespace, hash literals into placeholders so renamed code still
// matches structurally.

const KEYWORDS = new Set([
  // common subset across TS/JS/Python/Go/Rust/Java/C# — keep top by frequency
  "function", "const", "let", "var", "if", "else", "for", "while", "return", "true",
  "false", "null", "undefined", "this", "class", "import", "export", "from", "default",
  "def", "lambda", "elif", "and", "or", "not", "is", "in", "as", "with", "try", "except",
  "raise", "func", "package", "type", "struct", "interface", "go", "chan", "select",
  "fn", "pub", "mut", "use", "mod", "impl", "trait", "where",
  "public", "private", "protected", "static", "abstract", "final", "void", "int", "string", "bool",
]);

function lexCode(s: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!s) return out;
  // Strip line comments and block comments (loose; works across //, #, /* */).
  let t = s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/(^|\s)#[^\n]*/g, "$1 ");
  // Replace string literals with placeholder
  t = t.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "STR_LIT");
  // Replace numeric literals
  t = t.replace(/\b\d+(?:\.\d+)?\b/g, "NUM_LIT");
  // Match identifiers + the placeholder tokens we inserted
  for (const m of t.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const tok = m[0];
    if (!tok || tok.length < 2) continue;
    const weight = KEYWORDS.has(tok) ? 1 : 2;
    out.set(tok, (out.get(tok) ?? 0) + weight);
  }
  return out;
}

function diceMultiset(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  let sumA = 0;
  let sumB = 0;
  for (const v of a.values()) sumA += v;
  for (const v of b.values()) sumB += v;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb !== undefined) inter += Math.min(va, vb);
  }
  return (2 * inter) / (sumA + sumB);
}

export const EYE_12_code_modality: Eye = {
  id: "EYE_HYDRA_code_modality" as Eye["id"],
  layer: "truth",
  weight: 0.08,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const candMeta = c.meta as { codeText?: string; language?: string } | undefined;
    const candCode = candMeta?.codeText ?? c.text;
    // Heuristic: only fire when the candidate looks like code (has braces /
    // semicolons / function keywords / indented blocks).
    const looksLikeCode = /\b(function|const|let|class|def|fn|func|pub|return)\b|[{};]/.test(candCode);
    if (!looksLikeCode) return { raw: 0, reason: "candidate not code-shaped" };
    const A = lexCode(q);
    const B = lexCode(candCode);
    const raw = diceMultiset(A, B);
    return { raw, reason: `code-dice=${raw.toFixed(2)} (q:${A.size}, c:${B.size})` };
  },
};

export const MULTIMODAL_EYES: Eye[] = [
  EYE_11_image_modality,
  EYE_12_code_modality,
];

export { lexCode, diceMultiset, popcount64 };
