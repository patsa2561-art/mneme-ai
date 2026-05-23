/**
 * v2.39.0 — Zzzzz-PROBE (The Sleepwalking Oracle) types.
 *
 * Anti-Entropy + Multi-Modal Provenance + Cross-OS Polygraph in ONE
 * primitive. Composes with ACGV (Layer 0e) + HGP (auto-record) +
 * FLYWHEEL (new HARVEST source) + TRUTH GATE (claim binding).
 *
 * Honest scope (no GPU, no ML model, pure-Node):
 *   - Text: Shannon entropy + Zipf deviation + repetition + sentence-
 *     variance (all proven signals used in academic AI-text detection)
 *   - Image: pHash + Laplacian-variance + JPEG-quantization-fingerprint
 *     + color-histogram-entropy (signals used in academic AI-image
 *     detection — frequency-domain, not "ray tracing")
 *   - OS: classify platform + record polygraph attempt; the real
 *     interception layer per-OS is shipped piecemeal by other Mneme
 *     primitives (Windows DLL chrysalis v2.19.64, polygraph autosetup)
 *
 * Verdict ladder: CRYSTAL_CLEAR / PROBE_DRIFT / REFUTED / IMPOSSIBLE_REFUTE.
 * IMPOSSIBLE_REFUTE on text composes with HGP auto-record (a Zzzzz
 * refute becomes an HGP-YYYY-NNNNN id).
 */

export type ZzzzzModality = "text" | "code" | "image";

export type ZzzzzVerdict =
  | "CRYSTAL_CLEAR"       // no anti-entropy signal; passes through
  | "PROBE_DRIFT"          // signal at threshold (warn but don't refute)
  | "REFUTED"              // clear signal — AI-generated artifact pattern
  | "IMPOSSIBLE_REFUTE";   // multi-axis signal stack — auto-emit HGP id

export interface AntiEntropyMetrics {
  /** Shannon entropy over normalized character distribution (bits/char). */
  shannonBitsPerChar: number;
  /** Repetition rate: dominant-token frequency / total tokens. */
  repetitionRate: number;
  /** Sentence-length variance ratio (sigma/mean). AI text is often uniform. */
  sentenceVarianceRatio: number;
  /** Zipf-deviation: how much top-K word distribution deviates from Zipf's law. */
  zipfDeviation: number;
  /** Composite anomaly score 0..1 (higher = more anomalous / AI-suspicious). */
  anomalyScore: number;
}

export interface ImageProvenance {
  /** SHA-256 perceptual hash (8-byte) of the image as hex. */
  pHash: string;
  /** Laplacian variance — proxy for image sharpness / AI smoothness. */
  laplacianVariance: number;
  /** Color-histogram entropy bits. AI images often cluster in a narrow palette. */
  colorHistogramEntropy: number;
  /** JPEG quantization-table fingerprint (8x8 first-channel table hash, when JPEG). */
  jpegQuantFingerprint: string | null;
  /** Number of distinct colors in a 32×32 downsample. */
  distinctColorCount32: number;
  /** Composite suspicion score 0..1. */
  suspicionScore: number;
  /** Image format detected from magic bytes. */
  format: "jpeg" | "png" | "webp" | "gif" | "bmp" | "unknown";
  /** Image dimensions (when parseable). */
  width: number;
  height: number;
}

export interface OSPolygraphFinding {
  platform: NodeJS.Platform;
  arch: string;
  /** Which interception strategy is available on this OS. */
  interceptionStrategy: "windows-dll-chrysalis" | "posix-signals" | "polygraph-bridge" | "none";
  /** Is Mneme's polygraph bridge port (:17741) reachable? */
  bridgeReachable: boolean | null;
  /** Free-form notes. */
  notes: string[];
}

export interface ZzzzzReport {
  spec: { name: "MNEME-ZZZZZ-PROBE"; version: "1.0" };
  modality: ZzzzzModality;
  /** Verdict — CRYSTAL_CLEAR/PROBE_DRIFT/REFUTED/IMPOSSIBLE_REFUTE. */
  verdict: ZzzzzVerdict;
  /** Confidence 0..1. */
  confidence: number;
  /** Plain-English headline. */
  headline: string;
  /** Per-modality detail (one of these populated). */
  textMetrics?: AntiEntropyMetrics;
  imageProvenance?: ImageProvenance;
  os: OSPolygraphFinding;
  /** Caveats / signals that fired. */
  caveats: string[];
  /** When a verdict is REFUTED/IMPOSSIBLE_REFUTE, the HGP-ID assigned by the auto-record hook. */
  hgpId?: string;
  /** HMAC-signed envelope. */
  hmac: string;
  /** Monotonic sequence number from HMAC chain. */
  seq: number;
  bodyDigest: string;
  at: string;
}

export interface ProbeInput {
  modality: ZzzzzModality;
  /** Raw text/code (modality=text/code). Mutually exclusive with `imageBytes`. */
  text?: string;
  /** Raw image bytes (modality=image). */
  imageBytes?: Uint8Array;
  /** Caller-supplied vendor id for HGP attribution. */
  vendor?: string;
}
