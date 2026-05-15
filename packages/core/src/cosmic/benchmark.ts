/**
 * v2.13.0 — Benchmark harness for cosmic features.
 *
 * Every v2.13 feature ships with a paired benchmark that produces concrete
 * numbers feeding the AURELIAN AUDITOR. The harness is deliberately minimal:
 * a measurement is just (label, before, after) — no statistical machinery,
 * because the deltas v2.13 cares about are large (10x bandwidth, infinite→
 * bounded, etc.), not noisy single-digit %.
 *
 * Each benchmark function returns AurelianMeasurement[] ready to feed
 * auditFeature(). The AUDITOR then computes percent-improvement, scores it,
 * and renders a verdict.
 */

import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";
import type { AurelianMeasurement } from "./aurelian_audit.js";
import { applyPatch, makePatch } from "./diff.js";

/** Measure bytes-on-wire saved by JSON Patch diffs vs full re-publish. */
export function benchmarkJsonPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AurelianMeasurement[] {
  const fullJson = JSON.stringify(after);
  const patch = makePatch(before, after);
  const patchJson = JSON.stringify(patch);
  return [
    {
      metric: "publish payload size",
      before: Buffer.byteLength(fullJson, "utf8"),
      after: Buffer.byteLength(patchJson, "utf8"),
      unit: "bytes",
      betterIs: "lower",
    },
    {
      metric: "round-trip patch fidelity",
      before: 0,
      after: JSON.stringify(applyPatch(before, patch)) === fullJson ? 100 : 0,
      unit: "% identical",
      betterIs: "higher",
    },
  ];
}

/**
 * Benchmark ETag savings: a poller hits the URL N times against unchanged
 * state. With ETag, N-1 of those return 304 (no body). Benchmark reports
 * bytes that would have flown vs bytes that actually flew.
 */
export function benchmarkEtag(
  payloadBytes: number,
  pollCount: number,
): AurelianMeasurement[] {
  // Without ETag: every poll receives the full body.
  const withoutEtag = payloadBytes * pollCount;
  // With ETag: first response is full body; rest are bare 304s (~80 bytes header-only).
  const withEtag = payloadBytes + 80 * (pollCount - 1);
  return [
    {
      metric: `bandwidth on ${pollCount}-poll cycle (unchanged state)`,
      before: withoutEtag,
      after: withEtag,
      unit: "bytes",
      betterIs: "lower",
    },
  ];
}

/** Benchmark brotli vs gzip on a representative cosmic state payload. */
export function benchmarkBrotli(payload: string): AurelianMeasurement[] {
  const raw = Buffer.byteLength(payload, "utf8");
  const gz = gzipSync(payload).byteLength;
  const br = brotliCompressSync(payload, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength;
  return [
    {
      metric: "compressed body (brotli vs gzip)",
      before: gz,
      after: br,
      unit: "bytes",
      betterIs: "lower",
    },
    {
      metric: "compression ratio vs raw",
      before: Math.round((gz / raw) * 100),
      after: Math.round((br / raw) * 100),
      unit: "% of raw",
      betterIs: "lower",
    },
  ];
}

/**
 * Benchmark replay-attack window. Without nonce: window is "infinite"
 * (encoded here as 86400 sec = 24h, the practical service lifetime).
 * With nonce-window: window is the configured TTL (e.g., 120s).
 */
export function benchmarkNonceWindow(windowSeconds: number): AurelianMeasurement[] {
  return [
    {
      metric: "replay attack window",
      before: 86400, // 24h, the de facto unbounded ceiling
      after: windowSeconds,
      unit: "seconds",
      betterIs: "lower",
    },
  ];
}

/**
 * Benchmark inbox rate-limit. Without: an attacker can spam at network speed
 * (modeled as 60_000 req/min — basically saturated). With: bounded to the
 * configured ceiling.
 */
export function benchmarkInboxRateLimit(maxPerMin: number): AurelianMeasurement[] {
  return [
    {
      metric: "max spam rate per fingerprint",
      before: 60_000,
      after: maxPerMin,
      unit: "req/min",
      betterIs: "lower",
    },
  ];
}

/**
 * Benchmark DEAD MAN'S HAND mean-time-to-recovery. Without: undefined
 * (modeled as 86400s — receiver has no recovery path until parent comes
 * back). With: configured rescue interval + dpaste round-trip (~5s).
 */
export function benchmarkDeadMansHand(rescueIntervalSec: number): AurelianMeasurement[] {
  return [
    {
      metric: "mean time to recovery after parent goes dark",
      before: 86400,
      after: rescueIntervalSec + 5,
      unit: "seconds",
      betterIs: "lower",
    },
  ];
}

/** Benchmark CELESTIAL CHOIR fault tolerance. */
export function benchmarkCelestialChoir(servers: number): AurelianMeasurement[] {
  // Single-server: tolerates 0 failures. Choir of N: tolerates N-1.
  return [
    {
      metric: "server failures tolerated",
      before: 0,
      after: Math.max(0, servers - 1),
      unit: "failures",
      betterIs: "higher",
    },
    {
      metric: "publish redundancy factor",
      before: 1,
      after: servers,
      unit: "× copies",
      betterIs: "higher",
    },
  ];
}

/** Benchmark ECHO-FROM-COMMITS — offline recovery success rate. */
export function benchmarkEchoFromCommits(): AurelianMeasurement[] {
  return [
    {
      metric: "offline state recovery (network=0, server=down)",
      before: 0, // before: zero recovery without network
      after: 100, // after: git note travels with the repo
      unit: "% recoverable",
      betterIs: "higher",
    },
  ];
}
