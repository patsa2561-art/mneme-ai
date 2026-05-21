/**
 * v2.22.0 — COMPANION · STORYLINE.
 *
 * Markov chain over the pheromone log: given a recently-invoked
 * verb, predict the top-K verbs that COMMONLY come next. AI agent
 * uses this to plan multi-step flows.
 *
 * State definition: each verb invocation is one symbol. Transitions
 * are derived from successive invocations within a session-equivalent
 * window (default 5 minutes). Order-1 chain (one-step lookback) is
 * the default; higher orders supported but require more data.
 *
 * Composes with Atlas `hot` (which counts standalone usage) — Atlas
 * tells you what's used overall; Storyline tells you what's used
 * AFTER what.
 */

import { listPheromones, type PheromoneHit } from "../atlas/pheromone.js";

export interface TransitionStats {
  /** "after this verb..." */
  from: string;
  /** ...this verb followed `count` times. */
  to: string;
  count: number;
  /** Probability `to` follows `from` given any successor. */
  probability: number;
}

export interface StorylineQuery {
  topK?: number;
  /** Maximum elapsed time between two hits for them to count as a
   *  transition. Default 5 minutes — beyond that they're separate
   *  sessions. */
  windowMs?: number;
}

function pairwiseTransitions(hits: PheromoneHit[], windowMs: number): Map<string, Map<string, number>> {
  const sorted = [...hits].sort((a, b) => a.ts.localeCompare(b.ts));
  const out = new Map<string, Map<string, number>>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = Date.parse(sorted[i]!.ts);
    const t2 = Date.parse(sorted[i + 1]!.ts);
    if (Number.isNaN(t1) || Number.isNaN(t2)) continue;
    if (t2 - t1 > windowMs) continue;
    const from = sorted[i]!.verb;
    const to = sorted[i + 1]!.verb;
    if (from === to) continue; // no self-loops; they're noise
    if (!out.has(from)) out.set(from, new Map());
    const inner = out.get(from)!;
    inner.set(to, (inner.get(to) ?? 0) + 1);
  }
  return out;
}

/** Predict the top-K verbs that commonly follow `verb` in pheromone
 *  history. Returns an empty list when the verb hasn't been seen
 *  often enough to build statistics. */
export function predictNext(repoRoot: string, verb: string, q: StorylineQuery = {}): TransitionStats[] {
  const topK = q.topK ?? 5;
  const windowMs = q.windowMs ?? 5 * 60 * 1000;
  const trans = pairwiseTransitions(listPheromones(repoRoot), windowMs);
  const outgoing = trans.get(verb);
  if (!outgoing) return [];
  const total = Array.from(outgoing.values()).reduce((s, c) => s + c, 0);
  return Array.from(outgoing.entries())
    .map(([to, count]) => ({ from: verb, to, count, probability: count / total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topK);
}

/** Reverse: which verbs commonly LEAD to `verb`? */
export function predictPrior(repoRoot: string, verb: string, q: StorylineQuery = {}): TransitionStats[] {
  const topK = q.topK ?? 5;
  const windowMs = q.windowMs ?? 5 * 60 * 1000;
  const trans = pairwiseTransitions(listPheromones(repoRoot), windowMs);
  const incoming = new Map<string, number>();
  for (const [from, inner] of trans) {
    const n = inner.get(verb) ?? 0;
    if (n > 0) incoming.set(from, n);
  }
  const total = Array.from(incoming.values()).reduce((s, c) => s + c, 0);
  if (total === 0) return [];
  return Array.from(incoming.entries())
    .map(([from, count]) => ({ from, to: verb, count, probability: count / total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topK);
}

export function formatStoryline(verb: string, next: TransitionStats[], prior: TransitionStats[]): string {
  const lines: string[] = [`🧭 STORYLINE — ${verb}`, ""];
  if (next.length > 0) {
    lines.push(`  Commonly followed by:`);
    for (const t of next) lines.push(`    ${(t.probability * 100).toFixed(1).padStart(5)}%  →  ${t.to}  (n=${t.count})`);
  } else {
    lines.push(`  Commonly followed by:  (no data yet — opt-IN to telemetry.pheromone via Consent Fabric)`);
  }
  lines.push("");
  if (prior.length > 0) {
    lines.push(`  Commonly preceded by:`);
    for (const t of prior) lines.push(`    ${(t.probability * 100).toFixed(1).padStart(5)}%  ←  ${t.from}  (n=${t.count})`);
  } else {
    lines.push(`  Commonly preceded by:  (no data yet)`);
  }
  return lines.join("\n");
}
