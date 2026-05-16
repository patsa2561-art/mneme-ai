/**
 * v2.19.4 — MNEME SOUL-IN-DNA (the world's first organism-readable AI memory)
 *
 *   "Encode the Mneme soul prompt as a real DNA sequence (A=00, C=01,
 *    G=10, T=11). Optionally print the strand at Twist Bioscience or
 *    IDT for ~$0.07-0.50 per base pair. Strand arrives in ~7 days,
 *    stays stable 1000+ years at room temperature, copies via PCR.
 *    1 gram of DNA = ~215 PB — denser than every cloud storage on Earth.
 *
 *    Nobody has built this for AI memory because nobody thought to.
 *    Mneme is the first. Press value alone is TechCrunch-grade."
 *
 * Three ECC modes:
 *   - none      : pure 2-bit-per-base; 4 bases per byte; cheapest
 *   - hamming74 : Hamming(7,4) over each nibble; corrects 1 bit / block
 *                 of 4 source bits → 7 encoded bits → 4 bases per nibble
 *   - triple    : each source byte triple-repeated, majority vote on
 *                 decode; tolerates large per-base error rates
 *
 * Honest scope:
 *   - The ATCG sequence is REAL; cost estimates are calibrated against
 *     public 2025 provider pricing. The PROVIDER call is out-of-band:
 *     we generate an ordering URL the user opens; we don't auto-submit.
 *   - HMAC signature wraps the encoded sequence + payload digest + ECC
 *     mode so the user can prove sequence ↔ payload provenance after
 *     biological round-trip (sequence the strand, run mneme.dna.verify).
 *   - We do NOT pretend to be a wet-lab tool. We are the encoder + the
 *     ordering on-ramp + the post-sequencing verifier.
 *
 * Composes onto v2.14 PROJECT SOUL (the payload source). Pure additive.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type ECCMode = "none" | "hamming74" | "triple";

const BASE_BY_BITS: Record<string, string> = { "00": "A", "01": "C", "10": "G", "11": "T" };
const BITS_BY_BASE: Record<string, string> = { A: "00", C: "01", G: "10", T: "11" };

function bytesToBits(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(2).padStart(8, "0");
  return out;
}

function bitsToBytes(bits: string): Uint8Array {
  if (bits.length % 8 !== 0) throw new Error(`DNA: bit length ${bits.length} not multiple of 8`);
  const n = bits.length / 8;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }
  return out;
}

function bitsToBases(bits: string): string {
  if (bits.length % 2 !== 0) throw new Error(`DNA: bit length ${bits.length} not multiple of 2`);
  let out = "";
  for (let i = 0; i < bits.length; i += 2) out += BASE_BY_BITS[bits.slice(i, i + 2)]!;
  return out;
}

function basesToBits(seq: string): string {
  let out = "";
  for (const ch of seq.toUpperCase()) {
    const b = BITS_BY_BASE[ch];
    if (b === undefined) throw new Error(`DNA: invalid base '${ch}' (allowed: A/C/G/T)`);
    out += b;
  }
  return out;
}

// ─── Hamming(7,4) over each 4-bit nibble ────────────────────────────────
//
// Encodes 4 source bits → 7 transmitted bits. Corrects any single-bit error
// per block. Layout (Wikipedia standard, bit positions 1-7):
//   p1 p2 d1 p3 d2 d3 d4
// where p_i are parity bits computed from the d_i.
function hammingEncode4(nibble: number): number {
  const d1 = (nibble >> 3) & 1;
  const d2 = (nibble >> 2) & 1;
  const d3 = (nibble >> 1) & 1;
  const d4 = nibble & 1;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;
  // pack as 7-bit: p1 p2 d1 p3 d2 d3 d4
  return (p1 << 6) | (p2 << 5) | (d1 << 4) | (p3 << 3) | (d2 << 2) | (d3 << 1) | d4;
}

function hammingDecode7(block: number): number {
  const b1 = (block >> 6) & 1;
  const b2 = (block >> 5) & 1;
  const b3 = (block >> 4) & 1;
  const b4 = (block >> 3) & 1;
  const b5 = (block >> 2) & 1;
  const b6 = (block >> 1) & 1;
  const b7 = block & 1;
  // syndrome: which parity equations failed?
  const s1 = b1 ^ b3 ^ b5 ^ b7;
  const s2 = b2 ^ b3 ^ b6 ^ b7;
  const s3 = b4 ^ b5 ^ b6 ^ b7;
  const syndrome = (s3 << 2) | (s2 << 1) | s1;
  let corrected = block;
  if (syndrome !== 0 && syndrome <= 7) {
    // flip bit at position (syndrome) — position 1 is MSB (b1)
    const bitPos = syndrome; // 1..7, MSB-indexed
    const mask = 1 << (7 - bitPos);
    corrected = corrected ^ mask;
  }
  // re-extract data bits from corrected block
  const d1 = (corrected >> 4) & 1;
  const d2 = (corrected >> 2) & 1;
  const d3 = (corrected >> 1) & 1;
  const d4 = corrected & 1;
  return (d1 << 3) | (d2 << 2) | (d3 << 1) | d4;
}

function applyHammingEncode(bytes: Uint8Array): string {
  // Each byte = 2 nibbles → 2 × 7-bit blocks → 14 bits per byte
  let bits = "";
  for (const b of bytes) {
    const hi = (b >> 4) & 0x0f;
    const lo = b & 0x0f;
    bits += hammingEncode4(hi).toString(2).padStart(7, "0");
    bits += hammingEncode4(lo).toString(2).padStart(7, "0");
  }
  // Pad up to 2-bit boundary (DNA encoding)
  while (bits.length % 2 !== 0) bits += "0";
  return bits;
}

function applyHammingDecode(bits: string, byteCount: number): Uint8Array {
  // Each byte was 14 bits in encoded form
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const blockHi = parseInt(bits.slice(i * 14, i * 14 + 7), 2);
    const blockLo = parseInt(bits.slice(i * 14 + 7, i * 14 + 14), 2);
    const hi = hammingDecode7(blockHi);
    const lo = hammingDecode7(blockLo);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function applyTripleEncode(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 3);
  for (let i = 0; i < bytes.length; i++) {
    out[i * 3] = bytes[i]!;
    out[i * 3 + 1] = bytes[i]!;
    out[i * 3 + 2] = bytes[i]!;
  }
  return out;
}

function applyTripleDecode(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 3 !== 0) throw new Error("DNA triple: length not divisible by 3");
  const out = new Uint8Array(bytes.length / 3);
  for (let i = 0; i < out.length; i++) {
    // Bit-wise majority vote across 3 copies
    const a = bytes[i * 3]!, b = bytes[i * 3 + 1]!, c = bytes[i * 3 + 2]!;
    out[i] = (a & b) | (b & c) | (a & c);
  }
  return out;
}

// ─── Public encoding API ────────────────────────────────────────────────
export interface EncodeInput {
  payload: string;
  ecc?: ECCMode;
  secret?: string;
}

export interface EncodeResult {
  v: typeof PROTOCOL_VERSION;
  encodeId: string;
  payloadLength: number;
  payloadSha256: string;
  ecc: ECCMode;
  sequence: string; // ATCG string
  lengthBp: number; // length in base pairs
  encodedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DNA_SECRET"] || `mneme-dna-encoder-v${PROTOCOL_VERSION}`;
}

export function encode(input: EncodeInput): EncodeResult {
  const ecc: ECCMode = input.ecc ?? "hamming74";
  const bytes = new TextEncoder().encode(input.payload);
  const payloadSha256 = createHash("sha256").update(bytes).digest("hex");

  let bits: string;
  if (ecc === "none") {
    bits = bytesToBits(bytes);
  } else if (ecc === "hamming74") {
    bits = applyHammingEncode(bytes);
  } else if (ecc === "triple") {
    const tripled = applyTripleEncode(bytes);
    bits = bytesToBits(tripled);
  } else {
    throw new Error(`DNA: unknown ECC mode '${ecc}'`);
  }
  const sequence = bitsToBases(bits);

  const encodedAt = new Date().toISOString();
  const encodeId = "dna-" + createHmac("sha256", "mneme-dna-id").update(`${payloadSha256}|${ecc}|${encodedAt}`).digest("hex").slice(0, 14);
  const body: Omit<EncodeResult, "sig"> = {
    v: PROTOCOL_VERSION,
    encodeId,
    payloadLength: bytes.length,
    payloadSha256,
    ecc,
    sequence,
    lengthBp: sequence.length,
    encodedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export interface DecodeInput {
  sequence: string;
  ecc: ECCMode;
  payloadLength: number; // required to know where padding ends
}

export interface DecodeResult {
  payload: string;
  payloadSha256: string;
  decodedAt: string;
}

export function decode(input: DecodeInput): DecodeResult {
  const bits = basesToBits(input.sequence);
  let bytes: Uint8Array;
  if (input.ecc === "none") {
    bytes = bitsToBytes(bits.slice(0, input.payloadLength * 8));
  } else if (input.ecc === "hamming74") {
    bytes = applyHammingDecode(bits, input.payloadLength);
  } else if (input.ecc === "triple") {
    const trimmed = bits.slice(0, input.payloadLength * 24); // 3 bytes × 8 bits per source byte
    const tripled = bitsToBytes(trimmed);
    bytes = applyTripleDecode(tripled);
  } else {
    throw new Error(`DNA: unknown ECC mode '${input.ecc}'`);
  }
  const payloadSha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    payload: new TextDecoder().decode(bytes),
    payloadSha256,
    decodedAt: new Date().toISOString(),
  };
}

export function verifyEncodeReceipt(r: EncodeResult, secret?: string): boolean {
  const { sig: claimed, ...body } = r;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

// ─── Cost estimation (calibrated against public 2025 pricing) ───────────
export type Provider = "twist" | "idt" | "genscript" | "eurofins" | "diy";

const PRICE_USD_PER_BP: Record<Provider, { low: number; high: number; minTotal: number; note: string }> = {
  twist:   { low: 0.07, high: 0.09, minTotal: 99,  note: "Twist Bioscience — gene-length DNA, ~7-10 day turnaround" },
  idt:     { low: 0.20, high: 0.45, minTotal: 79,  note: "IDT (Integrated DNA Technologies) — gBlocks; shorter strand specialist" },
  genscript: { low: 0.06, high: 0.10, minTotal: 99, note: "GenScript — competitive on long sequences" },
  eurofins:{ low: 0.10, high: 0.18, minTotal: 99,  note: "Eurofins Genomics — EU-based; SOC2-friendly" },
  diy:     { low: 0,     high: 0,    minTotal: 0,   note: "Self-print (no provider) — for the DIY biohacker; you supply oligos + assembly" },
};

export interface CostEstimate {
  lengthBp: number;
  provider: Provider;
  priceLowUsd: number;
  priceHighUsd: number;
  totalLowUsd: number;
  totalHighUsd: number;
  note: string;
}

export function estimateCost(lengthBp: number, provider: Provider = "twist"): CostEstimate {
  const p = PRICE_USD_PER_BP[provider];
  if (!p) throw new Error(`DNA: unknown provider '${provider}'`);
  const totalLow = Math.max(p.minTotal, Math.round(lengthBp * p.low * 100) / 100);
  const totalHigh = Math.max(p.minTotal, Math.round(lengthBp * p.high * 100) / 100);
  return {
    lengthBp,
    provider,
    priceLowUsd: p.low,
    priceHighUsd: p.high,
    totalLowUsd: totalLow,
    totalHighUsd: totalHigh,
    note: p.note,
  };
}

// ─── Ordering URL generators ────────────────────────────────────────────
export interface OrderHandoff {
  provider: Provider;
  orderUrl: string;
  costEstimate: CostEstimate;
  /** Truncated sequence preview (first 60 bp) to show in UI. */
  sequencePreview: string;
  /** Instructions for the user. */
  instructions: string;
}

export function orderHandoff(input: { sequence: string; provider: Provider }): OrderHandoff {
  const lengthBp = input.sequence.length;
  const cost = estimateCost(lengthBp, input.provider);
  const preview = input.sequence.slice(0, 60) + (input.sequence.length > 60 ? "…" : "");

  const URLS: Record<Provider, string> = {
    twist: "https://ecommerce.twistbioscience.com/cart/landing",
    idt: "https://www.idtdna.com/site/order/gblockentry",
    genscript: "https://www.genscript.com/gene_synthesis.html",
    eurofins: "https://eurofinsgenomics.com/en/products/dnarna-synthesis/gene-synthesis/",
    diy: "https://en.wikipedia.org/wiki/Polymerase_chain_reaction",
  };

  const instructions = [
    `1. Open the order page (URL below).`,
    `2. Paste the full ${lengthBp} bp sequence into the provider's gene-synthesis form.`,
    `3. Expected cost: $${cost.totalLowUsd.toLocaleString()} - $${cost.totalHighUsd.toLocaleString()} USD.`,
    `4. Strand arrives in ~7-10 days.`,
    `5. When the strand arrives, sequence-verify it (Sanger or NGS), then call mneme.dna.verify({ original, observed }) to confirm bit-perfect cold storage.`,
    `6. Store the strand in a freezer at -20°C (or room temp for 1000+ year stability).`,
  ].join("\n");

  return {
    provider: input.provider,
    orderUrl: URLS[input.provider]!,
    costEstimate: cost,
    sequencePreview: preview,
    instructions,
  };
}

// ─── Verify after biological round-trip ────────────────────────────────
export interface VerifyInput {
  /** The sequence Mneme originally produced via encode(). */
  originalSequence: string;
  /** The sequence read back from the synthesised strand (Sanger / NGS result). */
  observedSequence: string;
}

export interface VerifyResult {
  v: typeof PROTOCOL_VERSION;
  match: boolean;
  totalBp: number;
  mismatchBp: number;
  mismatchRate: number;
  /** Up to 8 sample positions where mismatches occurred. */
  sampleMismatches: Array<{ pos: number; expected: string; observed: string }>;
  message: string;
}

export function verifyRoundTrip(input: VerifyInput): VerifyResult {
  if (input.originalSequence.length !== input.observedSequence.length) {
    return {
      v: PROTOCOL_VERSION,
      match: false,
      totalBp: input.originalSequence.length,
      mismatchBp: Math.abs(input.originalSequence.length - input.observedSequence.length),
      mismatchRate: 1,
      sampleMismatches: [],
      message: `length mismatch: original ${input.originalSequence.length} vs observed ${input.observedSequence.length}`,
    };
  }
  const total = input.originalSequence.length;
  let mismatches = 0;
  const samples: VerifyResult["sampleMismatches"] = [];
  for (let i = 0; i < total; i++) {
    const a = input.originalSequence[i]!.toUpperCase();
    const b = input.observedSequence[i]!.toUpperCase();
    if (a !== b) {
      mismatches++;
      if (samples.length < 8) samples.push({ pos: i, expected: a, observed: b });
    }
  }
  const rate = total === 0 ? 0 : Math.round((mismatches / total) * 100000) / 100000;
  return {
    v: PROTOCOL_VERSION,
    match: mismatches === 0,
    totalBp: total,
    mismatchBp: mismatches,
    mismatchRate: rate,
    sampleMismatches: samples,
    message: mismatches === 0
      ? `🧬 PERFECT ROUND-TRIP · ${total} bp matched`
      : `🧬 ${mismatches}/${total} bp mismatched (${(rate * 100).toFixed(3)}%) — ECC may recover on decode`,
  };
}

export function formatDnaLine(r: EncodeResult): string {
  return `🧬 DNA · ${r.payloadLength}B payload → ${r.lengthBp} bp · ecc=${r.ecc}`;
}
