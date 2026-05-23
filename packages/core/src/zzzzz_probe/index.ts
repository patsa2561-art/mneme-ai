/**
 * v2.39.0 — Zzzzz-PROBE (The Sleepwalking Oracle) public surface.
 *
 * Multi-modal anti-entropy detector that fuses 4 text signals + 5
 * image signals + cross-OS polygraph classification into one
 * HMAC-signed report. REFUTED / IMPOSSIBLE_REFUTE verdicts auto-
 * emit an HGP-YYYY-NNNNN id via the existing HGP module.
 *
 * Composes with:
 *   - ACGV (Layer 0e — text anti-entropy spike as a caveat)
 *   - HGP (auto-record on refute)
 *   - FLYWHEEL (new HARVEST signal source 'zzzzz')
 *   - TRUTH GATE (new claim binding to probe.zzzzz.ledger_size)
 *   - BRIDGE PHOENIX (probe :17741 reachability)
 */

export type {
  ZzzzzModality, ZzzzzVerdict, AntiEntropyMetrics, ImageProvenance,
  OSPolygraphFinding, ZzzzzReport, ProbeInput,
} from "./types.js";

export {
  shannonBitsPerChar, repetitionRate, sentenceVarianceRatio,
  zipfDeviation, analyzeText,
} from "./anti_entropy.js";

export {
  detectFormat, parseDimensions, perceptualHash, colorHistogramEntropy,
  laplacianVariance, distinctColorCount32, jpegQuantFingerprint, analyzeImage,
} from "./image_provenance.js";

export { classifyOS } from "./os_polygraph.js";

export {
  probeArtifact, readLedger, verifyReport, arm, disarm, isArmed,
  __resetZzzzzChainForTest,
} from "./engine.js";
export type { ArmState } from "./engine.js";
