/**
 * v2.1.0 -- PROPHET · pre-fetch top-K next user queries
 *
 * v1.99 shipped Prompt-Q-Latency Engine (Markov prediction of next query
 * class). PROPHET completes the loop: given a current query + history,
 * (1) predict top-K next queries, (2) execute the pre-warm work for each
 * (cache lookups, file reads, MCP probes), (3) cache the results so the
 * AI's NEXT response is instant.
 *
 * Pure-function PREDICTOR. The pre-warm executor is a thin abstraction
 * over caller-supplied hydration functions — keeps PROPHET stateless.
 */

import { predictNextQuery, type PredictionResult } from "../flash/predictive.js";

export interface PrewarmTask {
  id: string;
  /** Async work to run; returns whatever the caller wants cached. */
  work: () => Promise<unknown>;
  /** Optional tag for the trace. */
  tag?: string;
}

export interface ProphetInput {
  currentQuery: string;
  lastAiReply: string;
  /** Optional caller-supplied hydration: questionClass → tasks. */
  hydrationMap?: Record<string, PrewarmTask[]>;
  /** How many predicted classes to pre-warm. Default 3. */
  topK?: number;
  /** Time budget for pre-warm in ms. Default 5000. */
  timeBudgetMs?: number;
}

export interface ProphetResult {
  prediction: PredictionResult;
  prewarmed: Array<{ classId: string; taskId: string; ok: boolean; elapsedMs: number; error?: string; result?: unknown }>;
  totalMs: number;
  /** Cache-style map: classId → list of prewarmed results. */
  cache: Map<string, unknown[]>;
}

export async function prophesyAndPrewarm(input: ProphetInput): Promise<ProphetResult> {
  const topK = input.topK ?? 3;
  const budget = input.timeBudgetMs ?? 5000;
  const prediction = predictNextQuery(input.lastAiReply, topK);
  const tStart = Date.now();
  const prewarmed: ProphetResult["prewarmed"] = [];
  const cache = new Map<string, unknown[]>();

  for (const p of prediction.predictions) {
    if (Date.now() - tStart > budget) break;
    const tasks = input.hydrationMap?.[p.feature.id] ?? [];
    const bucket: unknown[] = [];
    for (const task of tasks) {
      if (Date.now() - tStart > budget) break;
      const t0 = Date.now();
      try {
        const result = await task.work();
        bucket.push(result);
        prewarmed.push({ classId: p.feature.id, taskId: task.id, ok: true, elapsedMs: Date.now() - t0, result });
      } catch (e) {
        prewarmed.push({ classId: p.feature.id, taskId: task.id, ok: false, elapsedMs: Date.now() - t0, error: (e as Error).message });
      }
    }
    cache.set(p.feature.id, bucket);
  }

  return { prediction, prewarmed, totalMs: Date.now() - tStart, cache };
}

export function formatProphetPulseLine(r: ProphetResult): string {
  return `PROPHET · predicted=${r.prediction.predictions.length} · prewarmed=${r.prewarmed.length} ok=${r.prewarmed.filter((p) => p.ok).length} · ${r.totalMs}ms`;
}
