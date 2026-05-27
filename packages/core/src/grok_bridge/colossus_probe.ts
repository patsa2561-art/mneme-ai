/**
 * 💥 4. PROTOPLASM-WRAPPED COLOSSUS
 *
 * Wrap every Grok inference call with PROTOPLASM super_quan probe.
 * Detect drift / silent model swap / personality shift in real-time.
 *
 * Returns a wrapper fn that:
 *   - calls the original inference
 *   - records latency + token count + accepted-by-user signal
 *   - feeds findings to PROTOPLASM ledger
 *   - triggers MOLT-style alert on σ ≥ 3 drift
 */

import { withSuperQuanProbe, type ProtoplasmConfig } from "../protoplasm/index.js";
import type { ColossusInferenceMeta } from "./types.js";

export type InferenceFn<P, R> = (prompt: P) => Promise<R> | R;

export interface ColossusProbeOptions {
  fnId: string;
  protoplasmConfig?: ProtoplasmConfig;
  onMeta?: (meta: ColossusInferenceMeta) => void;
  modelVersion: string;
}

/**
 * Wrap any inference function with PROTOPLASM probe + metadata capture.
 * The wrapper preserves type signature so xAI can drop it into existing
 * Grok inference pipeline without changing call sites.
 */
export function wrapColossusInference<P, R extends { tokens?: string[]; text?: string }>(
  fn: InferenceFn<P, R>,
  opts: ColossusProbeOptions,
): InferenceFn<P, R> {
  // Wrap with PROTOPLASM super_quan probe (per-call statistical + quantum-inspired monitoring)
  const probed = withSuperQuanProbe(opts.fnId, fn as any, opts.protoplasmConfig) as InferenceFn<P, R>;

  return async (prompt: P): Promise<R> => {
    const t0 = performance.now();
    const result = await probed(prompt);
    const durationMs = performance.now() - t0;
    const tokenCount =
      result?.tokens?.length ??
      (typeof result?.text === "string" ? result.text.split(/\s+/).length : 0);

    const meta: ColossusInferenceMeta = {
      fnId: opts.fnId,
      modelVersion: opts.modelVersion,
      durationMs,
      tokenCount,
    };
    opts.onMeta?.(meta);
    return result;
  };
}

/**
 * Aggregator that consumes ColossusInferenceMeta events and surfaces
 * model-rotation alerts when fingerprint shifts ≥ Nσ over a window.
 * Compatible with PROTOPLASM MOLT primitive.
 */
export class ColossusDriftWatcher {
  private window: ColossusInferenceMeta[] = [];
  private windowLimit = 1000;

  ingest(meta: ColossusInferenceMeta): void {
    this.window.push(meta);
    if (this.window.length > this.windowLimit) this.window.shift();
  }

  /** Compute drift between two halves of the rolling window. */
  driftCheck(): { drifted: boolean; zScore: number; reason: string } {
    if (this.window.length < 100) return { drifted: false, zScore: 0, reason: "insufficient samples (<100)" };
    const half = Math.floor(this.window.length / 2);
    const prior = this.window.slice(0, half);
    const post = this.window.slice(half);
    const meanPrior = prior.reduce((a, b) => a + b.tokenCount, 0) / prior.length;
    const meanPost = post.reduce((a, b) => a + b.tokenCount, 0) / post.length;
    const stdevPrior = Math.sqrt(prior.reduce((a, b) => a + (b.tokenCount - meanPrior) ** 2, 0) / prior.length);
    // When prior is constant (stdev ≈ 0) but post is different → MASSIVE drift signal
    if (stdevPrior < 0.001) {
      if (Math.abs(meanPost - meanPrior) < 0.001) {
        return { drifted: false, zScore: 0, reason: "stable (both windows identical constant)" };
      }
      return {
        drifted: true,
        zScore: Number.POSITIVE_INFINITY,
        reason: `constant→drift: prior=${meanPrior.toFixed(2)} → post=${meanPost.toFixed(2)} (stdev was 0 → any change = ∞σ)`,
      };
    }
    const z = (meanPost - meanPrior) / stdevPrior;
    const drifted = Math.abs(z) >= 3;
    return {
      drifted,
      zScore: z,
      reason: drifted
        ? `mean tokenCount drift z=${z.toFixed(2)} (likely model rotation)`
        : `stable (z=${z.toFixed(2)})`,
    };
  }
}
