/**
 * 🦠 PROTOPLASM — wisdom_space
 *
 * When orchestrator marks a finding BROKEN → wisdom_space diagnoses root cause.
 *
 * Strategy:
 *   1. Collect last N findings across ALL functions in same time window
 *   2. Score upstream suspects by co-occurrence (broke around same time)
 *   3. Detect "neighbor-broken-first" patterns (this fn broke 30s AFTER fnX broke)
 *   4. Emit hypothesis + proposed heal actions
 *
 * The "wisdom" is the cross-function correlation — single-function metrics
 * can't see "I broke because dep X broke 30 seconds ago".
 */

import type { SuperQuanFinding, WisdomRootCause, HealAction } from "./types.js";

interface DiagnoseInput {
  brokenFinding: SuperQuanFinding;
  recentLedger: SuperQuanFinding[];          // recent findings across all fns
  windowMs?: number;
}

export function diagnose(input: DiagnoseInput): WisdomRootCause {
  const window = input.windowMs ?? 60_000;
  const brokenAt = new Date(input.brokenFinding.at).getTime();
  const inWindow = input.recentLedger.filter(
    (f) => Math.abs(new Date(f.at).getTime() - brokenAt) <= window,
  );

  // Upstream suspects: other fns that turned broken WITHIN the window AND earlier
  const earlierBroken = inWindow.filter(
    (f) => f.fnId !== input.brokenFinding.fnId
      && f.outcome === "broken"
      && new Date(f.at).getTime() < brokenAt,
  );

  // Score by recency (earlier → higher suspect score)
  const suspects = earlierBroken
    .map((f) => ({ fnId: f.fnId, age: brokenAt - new Date(f.at).getTime(), reason: f.evidence }))
    .sort((a, b) => b.age - a.age);          // older = upstream
  const upstreamSuspects = suspects.slice(0, 5).map((s) => s.fnId);

  let hypothesis: string;
  let confidence = 0.4;
  const heals: HealAction[] = [];

  if (upstreamSuspects.length >= 2) {
    hypothesis = `cascade failure from upstream: ${upstreamSuspects.join(" → ")}`;
    confidence = 0.85;
    heals.push({ kind: "request-supernova-restart", rationale: "multiple upstream functions broken — restart cycle to clear shared state" });
    heals.push({ kind: "raise-truth-gate-block", rationale: "cascade detected — block any new release tag until heal verified" });
  } else if (upstreamSuspects.length === 1) {
    hypothesis = `proximate cause: ${upstreamSuspects[0]} broke earlier in window`;
    confidence = 0.7;
    heals.push({ kind: "retry-with-backoff", rationale: "single upstream suspect — retry after upstream stabilizes" });
  } else {
    // No upstream suspects → check quantum signals
    const qs = input.brokenFinding.quantumSignals;
    if (qs.collapseStability < 0.5) {
      hypothesis = "intrinsic instability — function throws on >50% of calls";
      confidence = 0.6;
      heals.push({ kind: "fallback-to-cached", rationale: "high throw rate — serve cached last-good response" });
    } else if (qs.chaosDivergence > 3) {
      hypothesis = "duration variance spiking — likely external dep slowdown (network/disk/db)";
      confidence = 0.55;
      heals.push({ kind: "retry-with-backoff", rationale: "transient slowdown — backoff + retry" });
    } else {
      hypothesis = "unknown — z-score breach but no clear pattern";
      confidence = 0.3;
      heals.push({ kind: "noop", rationale: "insufficient signal — record + observe one more cycle before acting" });
    }
  }

  return {
    fnId: input.brokenFinding.fnId,
    hypothesis,
    upstreamSuspects,
    confidence,
    proposedHeal: heals,
  };
}

/** Quick summary of recent ledger health. */
export function ledgerHealth(recent: SuperQuanFinding[]): { broken: number; warn: number; healthy: number; brokenRate: number } {
  const broken = recent.filter((f) => f.outcome === "broken").length;
  const warn = recent.filter((f) => f.outcome === "warn").length;
  const healthy = recent.filter((f) => f.outcome === "healthy").length;
  const total = recent.length || 1;
  return { broken, warn, healthy, brokenRate: broken / total };
}
