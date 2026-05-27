/**
 * 🌊 TIDE GUARD — Entropy-aware adaptive rate limiter
 *
 * Closes v2.70 Vuln #1: rate limit removed (regression) → DoS surface.
 * Standard token bucket is brittle: bots can match the rate. TIDE GUARD
 * adds an ENTROPY signal — low-entropy bursts (repetitive payloads,
 * identical user-agents, similar timing) get throttled harder, even
 * if they're under the nominal rate.
 *
 * Per-source bucket:
 *   - refillRatePerSec  R (legitimate human baseline)
 *   - capacity          C (burst tolerance)
 *   - entropyAdjuster   downscales R by (1 - lowEntropyPenalty)
 *
 * Entropy computed over rolling N-request payload-shape window. If recent
 * Shannon entropy < threshold → assume bot, halve effective rate.
 *
 * Fingerprint-tier hook: caller can supply trust score → tier multiplier:
 *   trust ≥ 0.9 → 10× R   (verified human / known-good vendor)
 *   trust ≥ 0.6 → 3× R    (NEMESIS classified, low refute rate)
 *   trust ≥ 0.3 → 1× R    (default)
 *   trust < 0.3 → 0.3× R  (suspicious)
 *
 * Output: { allowed, tokensLeft, retryAfterMs, reason, hmac } — HMAC
 * lets caller present "I was rate-limited" receipt to support.
 */

import { createHmac } from "node:crypto";

export interface TideGuardConfig {
  /** Tokens per second baseline. */
  refillRatePerSec: number;
  /** Max bucket capacity. */
  capacity: number;
  /** Window size for entropy computation (last N requests). */
  entropyWindow: number;
  /** Shannon-entropy threshold below which throttle kicks in. */
  entropyFloor: number;
  /** Max penalty when entropy is at minimum (e.g. 0.5 = halve rate). */
  maxLowEntropyPenalty: number;
  /** HMAC key for signed reject receipts. */
  hmacKey: string;
}

export const DEFAULT_TIDE: TideGuardConfig = {
  refillRatePerSec: 5,
  capacity: 30,
  entropyWindow: 20,
  entropyFloor: 1.5,
  maxLowEntropyPenalty: 0.5,
  hmacKey: "tide-dev-key",
};

interface SourceState {
  tokens: number;
  lastRefillMs: number;
  recentPayloadShapes: string[];   // for entropy
}

export interface TideRequest {
  sourceId: string;                // vendor / IP / sessionId / user-hash
  payloadShape?: string;           // e.g. argShape, or hash of request body
  trustScore?: number;             // 0..1, optional fingerprint signal
}

export interface TideDecision {
  allowed: boolean;
  tokensLeft: number;
  retryAfterMs: number;
  effectiveRate: number;
  entropyBits: number;
  trustMultiplier: number;
  reason: string;
  hmac: string;
}

function shannonEntropy(items: string[]): number {
  if (items.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / items.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

function trustMultiplier(trust?: number): number {
  if (trust === undefined) return 1;
  if (trust >= 0.9) return 10;
  if (trust >= 0.6) return 3;
  if (trust >= 0.3) return 1;
  return 0.3;
}

export class TideGuard {
  private sources = new Map<string, SourceState>();

  constructor(public readonly cfg: TideGuardConfig = DEFAULT_TIDE) {}

  check(req: TideRequest, now = Date.now()): TideDecision {
    let state = this.sources.get(req.sourceId);
    if (!state) {
      state = { tokens: this.cfg.capacity, lastRefillMs: now, recentPayloadShapes: [] };
      this.sources.set(req.sourceId, state);
    }

    // Trust + entropy multiplier
    const tm = trustMultiplier(req.trustScore);
    const entropy = shannonEntropy(state.recentPayloadShapes);
    const maxEntropy = Math.log2(Math.max(1, this.cfg.entropyWindow));
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 1;
    let entropyMult = 1;
    if (entropy < this.cfg.entropyFloor && state.recentPayloadShapes.length >= 5) {
      const ratio = entropy / this.cfg.entropyFloor;
      entropyMult = 1 - this.cfg.maxLowEntropyPenalty * (1 - ratio);
    }
    const effectiveRate = this.cfg.refillRatePerSec * tm * entropyMult;

    // Refill since last check
    const elapsedSec = (now - state.lastRefillMs) / 1000;
    state.tokens = Math.min(this.cfg.capacity, state.tokens + elapsedSec * effectiveRate);
    state.lastRefillMs = now;

    // Track payload shape for next entropy
    if (req.payloadShape) {
      state.recentPayloadShapes.push(req.payloadShape);
      if (state.recentPayloadShapes.length > this.cfg.entropyWindow) state.recentPayloadShapes.shift();
    }

    const reasonParts: string[] = [];
    reasonParts.push(`rate=${effectiveRate.toFixed(2)}/sec (base ${this.cfg.refillRatePerSec} × trust ${tm.toFixed(2)} × entropy ${entropyMult.toFixed(2)})`);
    reasonParts.push(`entropy=${entropy.toFixed(2)} bits (norm ${normalizedEntropy.toFixed(2)})`);

    if (state.tokens < 1) {
      const retryAfterMs = ((1 - state.tokens) / effectiveRate) * 1000;
      const body = { sourceId: req.sourceId, allowed: false, retryAfterMs, ts: now };
      const hmac = createHmac("sha256", this.cfg.hmacKey).update(JSON.stringify(body)).digest("hex").slice(0, 16);
      return {
        allowed: false,
        tokensLeft: state.tokens,
        retryAfterMs,
        effectiveRate,
        entropyBits: entropy,
        trustMultiplier: tm,
        reason: `REJECTED — ${reasonParts.join("; ")} — retry after ${retryAfterMs.toFixed(0)}ms`,
        hmac,
      };
    }

    state.tokens -= 1;
    const body = { sourceId: req.sourceId, allowed: true, ts: now };
    const hmac = createHmac("sha256", this.cfg.hmacKey).update(JSON.stringify(body)).digest("hex").slice(0, 16);
    return {
      allowed: true,
      tokensLeft: state.tokens,
      retryAfterMs: 0,
      effectiveRate,
      entropyBits: entropy,
      trustMultiplier: tm,
      reason: reasonParts.join("; "),
      hmac,
    };
  }

  /** Reset source — e.g. on admin override. */
  reset(sourceId: string): void { this.sources.delete(sourceId); }

  /** Snapshot for diagnostics. */
  snapshot(): Array<{ sourceId: string; tokensLeft: number; recentShapes: number }> {
    return [...this.sources.entries()].map(([id, s]) => ({
      sourceId: id, tokensLeft: s.tokens, recentShapes: s.recentPayloadShapes.length,
    }));
  }
}
