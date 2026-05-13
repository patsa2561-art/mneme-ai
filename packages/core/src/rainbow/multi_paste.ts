/**
 * v1.90.0 -- RAINBOW: multi-backend paste upload with retry + rate-limit
 * handling.
 *
 * Free public paste services have unpredictable rate limits (dpaste
 * is 1 req/sec; paste.rs throttles; 0x0.st returns 503 on overload).
 * For reliable cross-network handoff we need a fallback chain.
 *
 * Strategy:
 *   1. Try preferred backend (default: dpaste)
 *   2. On rate-limit (429) or failure, wait + try next backend
 *   3. Return first success OR aggregate error
 *
 * Optional: exponential backoff between attempts.
 */

import { uploadToDpaste, uploadToPasteRs, uploadToZeroXZero } from "../relay/paste_backend.js";

export type Backend = "dpaste" | "pasters" | "zero-x-zero";

export interface ResilientUploadResult {
  ok: boolean;
  url: string | null;
  backend: Backend | null;
  attempts: Array<{ backend: Backend; ok: boolean; reason?: string; elapsedMs: number }>;
  totalMs: number;
}

export interface ResilientUploadInput {
  content: string;
  order?: Backend[];
  /** Wait before each retry (ms). Default 1100ms (dpaste 1 req/sec). */
  retryWaitMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function uploadResilient(input: ResilientUploadInput): Promise<ResilientUploadResult> {
  const order: Backend[] = input.order ?? ["dpaste", "pasters", "zero-x-zero"];
  const wait = input.retryWaitMs ?? 1100;
  const attempts: ResilientUploadResult["attempts"] = [];
  const start = Date.now();

  for (let i = 0; i < order.length; i++) {
    const backend = order[i]!;
    const attemptStart = Date.now();
    const fn = backend === "dpaste" ? uploadToDpaste : backend === "pasters" ? uploadToPasteRs : uploadToZeroXZero;
    const r = await fn({ content: input.content, fetchImpl: input.fetchImpl });
    const elapsedMs = Date.now() - attemptStart;
    attempts.push({ backend, ok: r.ok, reason: r.reason, elapsedMs });
    if (r.ok && r.url) {
      return { ok: true, url: r.url, backend, attempts, totalMs: Date.now() - start };
    }
    // Wait before next backend to respect rate limits.
    if (i < order.length - 1) await sleep(wait);
  }
  return { ok: false, url: null, backend: null, attempts, totalMs: Date.now() - start };
}
