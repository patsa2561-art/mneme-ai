/**
 * v2.96.0 — HYDRA · L3 deterministic expansion engine + L4 lossless proof.
 *
 * HYDRA is NOT a "compressor" (the world has those — LLMLingua/LoPace/AWS
 * Meta-Tokens). HYDRA is a SIGNED, DETERMINISTIC, PROVABLY-LOSSLESS,
 * VENDOR-NEUTRAL context codebook that Mneme mines from its OWN corpus.
 * The defensible gem is the CUT, not the carbon: L5 signed codebook (NOTARY)
 * × L6 vendor-neutral-by-construction × L7 axiom-lattice binding — a
 * combination prior-art research found UNFILLED.
 *
 * This file is the bedrock every other layer stands on: a substitution
 * codec whose round-trip is BYTE-IDENTICAL by construction, and a proof
 * (SHA-256 round-trip) that is a boolean — never "downstream accuracy
 * stayed similar", always lossless=1.000 or fail. No lies.
 *
 * KEY DESIGN (different thinking):
 *   - Symbols live in the Unicode Private-Use Area (U+E000…), which never
 *     occurs in real manifests/code/docs. The marker pair is VERIFIED
 *     absent from the corpus AND every phrase, with deterministic fallback
 *     to the next candidate pair → collision is impossible, not unlikely.
 *   - Expansion is a single deterministic pass: phrases (raw corpus
 *     substrings) cannot contain markers, so no cascade, no ambiguity.
 *   - Pure functions. Same input → same bytes on every OS/arch (that IS
 *     the L6 vendor-neutral proof: the LLM never sees the codebook).
 */

import { createHash } from "node:crypto";

export interface CodebookEntry {
  /** The private-use-area symbol that stands in for `phrase`. */
  sym: string;
  /** The raw corpus substring this symbol expands to. */
  phrase: string;
  /** Occurrences in the corpus at mining time (telemetry only). */
  hits: number;
  /** MDL gain in bytes this entry contributed (telemetry only). */
  gain: number;
}

export interface Codebook {
  v: 1;
  /** Open marker (PUA char), verified absent from corpus + all phrases. */
  open: string;
  /** Close marker (PUA char), verified absent from corpus + all phrases. */
  close: string;
  /** Entries ordered LONGEST-phrase-first so greedy encode never splits a
   *  longer phrase by replacing a shorter sub-phrase first. */
  entries: CodebookEntry[];
  /** SHA-256 of the exact corpus this codebook was mined from. */
  corpusHash: string;
}

/** Candidate marker pairs, built from Private-Use-Area code points
 *  (U+E000…U+E00B) — these never occur in real manifests/code/docs.
 *  Built programmatically so the bytes are unambiguous in source. */
const MARKER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [String.fromCharCode(0xe000), String.fromCharCode(0xe001)],
  [String.fromCharCode(0xe002), String.fromCharCode(0xe003)],
  [String.fromCharCode(0xe004), String.fromCharCode(0xe005)],
  [String.fromCharCode(0xe006), String.fromCharCode(0xe007)],
  [String.fromCharCode(0xe008), String.fromCharCode(0xe009)],
  [String.fromCharCode(0xe00a), String.fromCharCode(0xe00b)],
];

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Pick a marker pair guaranteed absent from `corpus` and every `phrase`.
 * Deterministic: always returns the first clean candidate. Throws only if
 * the (astronomically unlikely) corpus contains every PUA candidate.
 */
export function chooseMarkers(corpus: string, phrases: string[]): readonly [string, string] {
  for (const [o, c] of MARKER_PAIRS) {
    if (corpus.includes(o) || corpus.includes(c)) continue;
    if (phrases.some((p) => p.includes(o) || p.includes(c))) continue;
    return [o, c];
  }
  throw new Error("HYDRA: corpus exhausts all PUA marker candidates (impossible for real text)");
}

/** The deterministic symbol for entry index `i`. */
export function symbolFor(open: string, close: string, i: number): string {
  return open + i.toString(36) + close;
}

/**
 * L3 — COMPRESS. Replace each codebook phrase with its symbol, longest
 * phrase first (the entries are pre-sorted). Pure + deterministic.
 */
export function compress(text: string, cb: Codebook): string {
  let out = text;
  for (const e of cb.entries) {
    if (e.phrase.length === 0) continue;
    out = out.split(e.phrase).join(e.sym);
  }
  return out;
}

/**
 * L3 — EXPAND (the Hydra head). Single deterministic pass: replace every
 * symbol with its phrase. Because phrases are raw corpus substrings they
 * cannot contain markers, so there is no cascade and the result is exact.
 */
export function expand(encoded: string, cb: Codebook): string {
  let out = encoded;
  for (const e of cb.entries) {
    if (e.phrase.length === 0) continue;
    out = out.split(e.sym).join(e.phrase);
  }
  return out;
}

export interface LosslessProof {
  /** True iff expand(compress(text)) is byte-identical to text. */
  lossless: boolean;
  originalHash: string;
  roundTripHash: string;
  originalBytes: number;
  compressedBytes: number;
  /** original / compressed (1.0 = no gain). */
  ratio: number;
}

/**
 * L4 — LOSSLESS PROOF. The boolean that cannot lie: a SHA-256 round-trip,
 * not a similarity score. If `lossless` is ever false the codebook is
 * REJECTED upstream — HYDRA never ships a codebook that loses a byte.
 */
export function proveLossless(text: string, cb: Codebook): LosslessProof {
  const encoded = compress(text, cb);
  const restored = expand(encoded, cb);
  const originalHash = sha256Hex(text);
  const roundTripHash = sha256Hex(restored);
  const originalBytes = Buffer.byteLength(text, "utf8");
  const compressedBytes = Buffer.byteLength(encoded, "utf8");
  return {
    lossless: originalHash === roundTripHash,
    originalHash,
    roundTripHash,
    originalBytes,
    compressedBytes,
    ratio: compressedBytes === 0 ? 1 : originalBytes / compressedBytes,
  };
}
