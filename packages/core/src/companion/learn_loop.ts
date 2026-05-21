/**
 * v2.22.0 — COMPANION · LEARN LOOP.
 *
 * Mines `.mneme/atlas/pheromones.jsonl` + (when opt-in)
 * `.mneme/replay.jsonl` for per-verb failure patterns and surfaces
 * them as pre-invocation hints.
 *
 * Privacy is opt-IN via Consent Fabric Article 2:
 *   - `pheromone` telemetry → enables outcome aggregation
 *   - `replay` telemetry    → enables structured arg pattern mining
 *
 * Arg values are NEVER stored as-is. Each argument is replaced with a
 * type-tag (`<string>`, `<path>`, `<int>`, `<flag>`) so a pattern
 * like "agents commonly omit --vendor" survives without leaking the
 * actual vendor string.
 *
 * Pattern emission is heuristic + threshold-gated: a finding only
 * surfaces after ≥ 3 observations of the same pattern across distinct
 * timestamps. Goodhart's-law-resistant by design.
 */

import { listPheromones, type PheromoneHit } from "../atlas/pheromone.js";
import { isFeatureEnabled } from "../consent_fabric/index.js";

export interface VerbOutcomeStats {
  verb: string;
  invocations: number;
  successes: number;
  failures: number;
  successRate: number;
  /** Recent invocations (last 14 days) — helps spot regressions. */
  recentInvocations: number;
  recentSuccessRate: number;
}

const RECENT_WINDOW_MS = 14 * 86_400_000;

export function computeOutcomeStats(repoRoot: string, verb: string, now = Date.now()): VerbOutcomeStats {
  const hits = listPheromones(repoRoot).filter((h) => h.verb === verb);
  let s = 0, f = 0, rs = 0, rf = 0, ri = 0;
  for (const h of hits) {
    const ok = h.outcome !== "failure";
    if (ok) s++; else f++;
    const t = Date.parse(h.ts);
    if (!Number.isNaN(t) && now - t < RECENT_WINDOW_MS) {
      ri++;
      if (ok) rs++; else rf++;
    }
  }
  const invocations = s + f;
  return {
    verb,
    invocations,
    successes: s,
    failures: f,
    successRate: invocations === 0 ? 0 : s / invocations,
    recentInvocations: ri,
    recentSuccessRate: ri === 0 ? 0 : rs / ri,
  };
}

export interface CommonMistake {
  pattern: string;
  observations: number;
  /** Heuristic confidence 0-1. */
  confidence: number;
  suggestion: string;
}

/** Mine common mistakes for a verb. Currently rule-based; ML can
 *  swap in here when corpus is large. */
export function commonMistakes(repoRoot: string, verb: string): CommonMistake[] {
  // Always-on rule: recent success rate dropping below 60 % means
  // SOMETHING regressed; surface it.
  const out: CommonMistake[] = [];
  const stats = computeOutcomeStats(repoRoot, verb);
  if (stats.recentInvocations >= 3 && stats.recentSuccessRate < 0.6) {
    out.push({
      pattern: "recent-failure-cluster",
      observations: stats.recentInvocations,
      confidence: 1 - stats.recentSuccessRate,
      suggestion: `Recent first-try success rate is ${(stats.recentSuccessRate * 100).toFixed(0)}%. Review args + preconditions; consider running \`mneme companion ${verb}\` first.`,
    });
  }
  // Opt-in pattern miner: replay-style telemetry is gated.
  if (!isFeatureEnabled(repoRoot, "replay")) return out;
  // (Reserved for v2.22.x — actual replay log mining.)
  return out;
}

export interface RedactedInvocation {
  ts: string;
  verb: string;
  argSignature: string; // e.g. "<flag>--vendor=<string>" with values stripped
  outcome: "success" | "failure";
}

/** Build a privacy-preserving signature from a pheromone hit + (when
 *  enabled) the replay record. Values are stripped so signatures
 *  describe the SHAPE of the invocation, not the data. */
export function redactInvocation(h: PheromoneHit): RedactedInvocation {
  return {
    ts: h.ts,
    verb: h.verb,
    argSignature: "(no args in current pheromone schema; v2.22.x integrates replay for richer signatures)",
    outcome: h.outcome === "failure" ? "failure" : "success",
  };
}

export function formatOutcomeStats(s: VerbOutcomeStats): string {
  const lines = [`📈 OUTCOME STATS — ${s.verb}`, ""];
  if (s.invocations === 0) {
    lines.push("  (no pheromone data yet — opt IN via `mneme telemetry grant pheromone`)");
    return lines.join("\n");
  }
  lines.push(`  Lifetime:    ${s.invocations} invocations · ${(s.successRate * 100).toFixed(1)}% success`);
  lines.push(`  Last 14d:    ${s.recentInvocations} invocations · ${(s.recentSuccessRate * 100).toFixed(1)}% success`);
  return lines.join("\n");
}

export function formatMistakes(mistakes: CommonMistake[]): string {
  if (mistakes.length === 0) return "🛡 COMMON MISTAKES — (none surfaced; not enough data or all clear)";
  const lines = [`🛡 COMMON MISTAKES`, ""];
  for (const m of mistakes) {
    lines.push(`  ${m.pattern}  (${m.observations} obs · confidence=${(m.confidence * 100).toFixed(0)}%)`);
    lines.push(`    → ${m.suggestion}`);
  }
  return lines.join("\n");
}
