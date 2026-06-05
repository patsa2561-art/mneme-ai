/**
 * AGENT RELIABILITY BENCHMARK — cross-vendor, from REAL outcomes (Diamond 5 of 5).
 *
 * Mneme is the neutral party sitting on signed, cross-vendor, ground-truthed records
 * of what AI behaviour actually led to good/bad outcomes (attestation + revert radar).
 * This ranks agents (any vendor) on the SAME measured outcome — did their work SURVIVE
 * — with a Wilson 95% LOWER bound, so a small sample scores LOW by construction and the
 * ranking can't be gamed by a lucky streak. NOT a synthetic benchmark; NOT vendor PR.
 *
 * Pure + total. The card is signable (CANON/NOTARY) so a vendor can't forge its band.
 */
import type { AgentSurvival } from "../revert_radar/index.js";

export type ReliabilityBand = "trusted" | "solid" | "watch" | "risky" | "unmeasured";
export interface AgentReliability {
  agent: string;
  commits: number;
  survived: number;
  survivalRate: number;
  /** Wilson 95% LOWER bound on the survival proportion — the honest, un-gameable number. */
  wilsonLB: number;
  band: ReliabilityBand;
}

/** Wilson score interval lower bound (z = 1.96). Total. */
export function wilsonLowerBound(successes: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = Math.max(0, Math.min(1, successes / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, Math.min(1, (centre - margin) / denom));
}

const MIN_SAMPLE = 5;
function bandOf(lb: number, n: number): ReliabilityBand {
  if (n < MIN_SAMPLE) return "unmeasured";
  return lb >= 0.85 ? "trusted" : lb >= 0.7 ? "solid" : lb >= 0.5 ? "watch" : "risky";
}

/** Rank agents by their Wilson-LB survival. Small samples are 'unmeasured', not trusted. */
export function rankAgents(survival: AgentSurvival[]): AgentReliability[] {
  const out = (survival ?? []).map((s) => {
    const commits = Math.max(0, s.commits | 0);
    const survived = Math.max(0, commits - Math.max(0, s.regretted | 0));
    const survivalRate = commits ? survived / commits : 0;
    const wilsonLB = wilsonLowerBound(survived, commits);
    return { agent: s.agent, commits, survived, survivalRate, wilsonLB, band: bandOf(wilsonLB, commits) };
  });
  // rank: measured first, by Wilson-LB desc, then sample size
  out.sort((a, b) => {
    const am = a.band !== "unmeasured" ? 1 : 0, bm = b.band !== "unmeasured" ? 1 : 0;
    return (bm - am) || (b.wilsonLB - a.wilsonLB) || (b.commits - a.commits) || a.agent.localeCompare(b.agent);
  });
  return out;
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface BenchmarkGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function benchmarkGauntlet(): BenchmarkGauntlet {
  const survival: AgentSurvival[] = [
    { agent: "claude-code", commits: 40, regretted: 1, survivalRate: 0.975, explicit: 1, hotfix: 0 },   // big-n, clean → trusted
    { agent: "cursor", commits: 40, regretted: 16, survivalRate: 0.6, explicit: 8, hotfix: 8 },           // big-n, shaky → watch/risky
    { agent: "newbie", commits: 2, regretted: 0, survivalRate: 1, explicit: 0, hotfix: 0 },               // tiny-n, perfect → UNMEASURED (can't game)
  ];
  const ranked = rankAgents(survival);
  const claude = ranked.find((r) => r.agent === "claude-code");
  const cursor = ranked.find((r) => r.agent === "cursor");
  const newbie = ranked.find((r) => r.agent === "newbie");
  const wlbSane = wilsonLowerBound(40, 40) < 1 && wilsonLowerBound(40, 40) > 0.9 && wilsonLowerBound(0, 0) === 0;
  const ungameable = newbie?.band === "unmeasured";                  // 2/2 perfect does NOT become 'trusted'
  const ordered = ranked[0].agent === "claude-code" && claude!.wilsonLB > cursor!.wilsonLB;
  const trusted = claude?.band === "trusted";
  const lowerBand = cursor?.band === "watch" || cursor?.band === "risky";
  const det = JSON.stringify(rankAgents(survival)) === JSON.stringify(rankAgents(survival));
  const checks = [
    { name: "WILSON-LB-SOUND", pass: wlbSane, detail: "Wilson lower bound ∈ (0,1), 0 on no data" },
    { name: "UNGAMEABLE-SMALL-N", pass: ungameable, detail: "a perfect 2/2 agent is 'unmeasured', never 'trusted'" },
    { name: "RANKS-BY-OUTCOME", pass: ordered && trusted && lowerBand, detail: "a big-n clean agent outranks a shaky one (measured, not PR)" },
    { name: "DETERMINISTIC", pass: det, detail: "same outcomes → byte-identical ranking" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
