/**
 * AGENT IMPACT — did the agent leave the codebase cleaner or dirtier? (Diamond 4 of 5).
 *
 * X-Ray measures a repo at a point in time. This measures the DELTA across an agent's
 * work: Context Air Quality before → after. Everyone asks "did it write the feature";
 * nobody asks "what debt did it leave behind". A signed, deterministic answer.
 *
 * Pure + total. Honest: it's the AQI composite delta (a measured signal of the repo's
 * AI-workability), NOT a moral judgement of the agent — a degraded repo can be a
 * deliberate, correct trade-off.
 */
import { buildAirQuality, type AirQuality } from "./airquality.js";

export interface AgentImpact {
  aqiBefore: number;
  aqiAfter: number;
  delta: number;
  verdict: "improved" | "neutral" | "degraded";
  bandBefore: string;
  bandAfter: string;
  /** pollutants that got WORSE (newly present or higher impact). */
  pollutantsAdded: string[];
  /** pollutants that got better/cleared. */
  pollutantsCleared: string[];
  note: string;
}

function impactMap(aq: AirQuality): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of aq.pollutants) m.set(p.name, (p as { impact?: number }).impact ?? 1);
  return m;
}

/** Compare two X-Ray reports (before → after the agent's work). */
export function buildAgentImpact(beforeReport: unknown, afterReport: unknown): AgentImpact {
  const before = buildAirQuality(beforeReport);
  const after = buildAirQuality(afterReport);
  const delta = after.score - before.score;
  const verdict: AgentImpact["verdict"] = delta >= 3 ? "improved" : delta <= -3 ? "degraded" : "neutral";
  const mb = impactMap(before), ma = impactMap(after);
  const pollutantsAdded: string[] = [], pollutantsCleared: string[] = [];
  for (const [name, ia] of ma) { const ib = mb.get(name) ?? 0; if (ia > ib + 1e-9) pollutantsAdded.push(name); }
  for (const [name, ib] of mb) { const ia = ma.get(name) ?? 0; if (ia < ib - 1e-9) pollutantsCleared.push(name); }
  const note = verdict === "improved"
    ? `left the repo CLEANER for an AI (+${delta} air quality)`
    : verdict === "degraded"
      ? `left ${-delta} points of AI-workability debt behind`
      : "left the repo's AI air quality roughly unchanged";
  return { aqiBefore: before.score, aqiAfter: after.score, delta, verdict, bandBefore: before.band, bandAfter: after.band, pollutantsAdded, pollutantsCleared, note };
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface AgentImpactGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function agentImpactGauntlet(): AgentImpactGauntlet {
  const clean = { secrets: { totalFindings: 0 }, security: { destructive: [] }, busFactor: { singleOwnerFilePct: 0 }, coupling: { pairs: [] }, deps: { byBand: {} }, complexity: { hotspots: [] } };
  const dirty = { secrets: { totalFindings: 20 }, security: { destructive: [{}, {}] }, busFactor: { singleOwnerFilePct: 80 }, coupling: { pairs: Array.from({ length: 12 }, () => ({ hidden: true })) }, deps: { byBand: { dead: 5 } }, complexity: { hotspots: Array.from({ length: 6 }, () => ({ bodyLines: 200 })) } };
  const degraded = buildAgentImpact(clean, dirty);
  const improved = buildAgentImpact(dirty, clean);
  const neutral = buildAgentImpact(clean, clean);
  const det = JSON.stringify(buildAgentImpact(clean, dirty)) === JSON.stringify(buildAgentImpact(clean, dirty));
  const checks = [
    { name: "DETECTS-DEGRADE", pass: degraded.verdict === "degraded" && degraded.delta < 0 && degraded.pollutantsAdded.length > 0, detail: "clean → dirty is 'degraded' + names the added pollutants" },
    { name: "DETECTS-IMPROVE", pass: improved.verdict === "improved" && improved.delta > 0 && improved.pollutantsCleared.length > 0, detail: "dirty → clean is 'improved' + names what was cleared" },
    { name: "NEUTRAL-STABLE", pass: neutral.verdict === "neutral" && neutral.delta === 0, detail: "no change is 'neutral'" },
    { name: "SYMMETRIC", pass: degraded.delta === -improved.delta, detail: "the delta is symmetric (no fabrication)" },
    { name: "DETERMINISTIC", pass: det, detail: "same before/after → byte-identical impact" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
