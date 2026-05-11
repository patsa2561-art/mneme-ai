/**
 * DEMON STAGE 3.2 — AI Vendor Arbitrage Router (v1.44.0)
 *
 * SCOPE: pick the cheapest competent vendor for a given task class, given
 * the operator's local cost table + observed quality history. Emits a
 * routing recommendation. NEVER calls vendor APIs (that's the operator's
 * AI agent — Mneme just tells it which vendor to use).
 *
 * COST TABLE: `.mneme/vendor-costs.jsonl` — operator-curated; we never
 * embed prices (rot in days). Format:
 *   { "vendor": "v", "model": "m", "perMTokIn": 5.0, "perMTokOut": 15.0 }
 *
 * QUALITY HISTORY: `.mneme/vendor-trials.jsonl` — operator's AI agent
 * appends a trial each time it uses a vendor for a task class.
 *   { "vendor": "v", "taskClass": "code-edit", "outcome": "success" | "fail", "tokensIn": N, "tokensOut": N }
 *
 * INNOVATIONS BEYOND SPEC:
 *   - Wilson lower-bound on success rate (penalize low-sample vendors —
 *     don't crown a vendor as "best" off 2 trials)
 *   - "Cost per successful completion" = (cost-per-call) / (success-rate-LB)
 *     instead of raw cost (a 50%-success cheap vendor is more expensive
 *     than 100%-success premium vendor when re-tries cost real money)
 *   - "Cold-start mode": when no trials exist for a (vendor, task-class),
 *     fall back to a baseline 0.5 success rate so new vendors get a chance
 *   - "Diversity bonus": within 10% of the best score, the router prefers
 *     a vendor that hasn't been used recently (anti-monoculture)
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const COSTS_REL = ".mneme/vendor-costs.jsonl";
const TRIALS_REL = ".mneme/vendor-trials.jsonl";

export interface VendorCost {
  vendor: string;
  model: string;
  perMTokIn: number;       // USD per 1M input tokens
  perMTokOut: number;      // USD per 1M output tokens
}

export interface VendorTrial {
  vendor: string;
  taskClass: string;
  outcome: "success" | "fail";
  tokensIn: number;
  tokensOut: number;
  at: string;              // ISO-8601
}

export interface RouteRecommendation {
  taskClass: string;
  estTokensIn: number;
  estTokensOut: number;
  candidates: RouteCandidate[];
  recommended: RouteCandidate | null;
  reasoning: string;
}

export interface RouteCandidate {
  vendor: string;
  model: string;
  estCostUsd: number;
  successRateLB: number;          // Wilson lower bound
  trialsSeen: number;
  effectiveCostUsd: number;       // estCost / successRateLB
  recencyMinutes: number | null;  // mins since last use, or null
  diversityPick: boolean;         // chosen as the diversity tie-breaker
}

const Z = 1.96; // 95% Wilson lower bound

function wilsonLB(successes: number, trials: number): number {
  if (trials === 0) return 0.5;   // cold-start prior
  const p = successes / trials;
  const denom = 1 + (Z * Z) / trials;
  const center = p + (Z * Z) / (2 * trials);
  const margin = Z * Math.sqrt((p * (1 - p) / trials) + (Z * Z) / (4 * trials * trials));
  return Math.max(0, (center - margin) / denom);
}

function readJsonl<T>(repoRoot: string, rel: string): T[] {
  const path = join(repoRoot, rel);
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* skip malformed */ }
  }
  return out;
}

export function recordTrial(repoRoot: string, trial: Omit<VendorTrial, "at">): void {
  const root = resolve(repoRoot);
  mkdirSync(join(root, ".mneme"), { recursive: true });
  appendFileSync(join(root, TRIALS_REL), JSON.stringify({ ...trial, at: new Date().toISOString() }) + "\n");
}

export function listCosts(repoRoot: string): VendorCost[] {
  return readJsonl<VendorCost>(repoRoot, COSTS_REL);
}

export function listTrials(repoRoot: string): VendorTrial[] {
  return readJsonl<VendorTrial>(repoRoot, TRIALS_REL);
}

function estCost(c: VendorCost, tokIn: number, tokOut: number): number {
  return (tokIn / 1_000_000) * c.perMTokIn + (tokOut / 1_000_000) * c.perMTokOut;
}

function vendorRecency(trials: VendorTrial[], vendor: string, asOf: Date): number | null {
  let lastMs: number | null = null;
  for (const t of trials) {
    if (t.vendor !== vendor) continue;
    const ms = new Date(t.at).getTime();
    if (lastMs === null || ms > lastMs) lastMs = ms;
  }
  return lastMs === null ? null : Math.round((asOf.getTime() - lastMs) / 60000);
}

export function recommendRoute(
  repoRoot: string,
  taskClass: string,
  estTokensIn: number,
  estTokensOut: number,
  asOf: Date = new Date(),
): RouteRecommendation {
  const costs = listCosts(repoRoot);
  const trials = listTrials(repoRoot);

  if (costs.length === 0) {
    return {
      taskClass,
      estTokensIn,
      estTokensOut,
      candidates: [],
      recommended: null,
      reasoning: "no vendor costs on disk — operator must seed `.mneme/vendor-costs.jsonl`",
    };
  }

  // Per-vendor stats for THIS task class
  const candidates: RouteCandidate[] = [];
  for (const c of costs) {
    const relevantTrials = trials.filter((t) => t.vendor === c.vendor && t.taskClass === taskClass);
    const successes = relevantTrials.filter((t) => t.outcome === "success").length;
    const lb = wilsonLB(successes, relevantTrials.length);
    const cost = estCost(c, estTokensIn, estTokensOut);
    const effective = lb > 0 ? cost / lb : Number.POSITIVE_INFINITY;
    candidates.push({
      vendor: c.vendor,
      model: c.model,
      estCostUsd: +cost.toFixed(6),
      successRateLB: +lb.toFixed(4),
      trialsSeen: relevantTrials.length,
      effectiveCostUsd: Number.isFinite(effective) ? +effective.toFixed(6) : Number.POSITIVE_INFINITY,
      recencyMinutes: vendorRecency(trials, c.vendor, asOf),
      diversityPick: false,
    });
  }

  // Sort by effective cost ascending
  candidates.sort((a, b) => a.effectiveCostUsd - b.effectiveCostUsd);

  if (candidates.length === 0 || !Number.isFinite(candidates[0]!.effectiveCostUsd)) {
    return {
      taskClass,
      estTokensIn,
      estTokensOut,
      candidates,
      recommended: null,
      reasoning: "no candidate has a finite effective cost (all success-rate LBs are 0)",
    };
  }

  // Diversity tie-breaker: within 10% of best, prefer the one used least recently
  const best = candidates[0]!;
  const tolerated = best.effectiveCostUsd * 1.10;
  const tied = candidates.filter((c) => c.effectiveCostUsd <= tolerated);
  let pick = best;
  let pickedByDiversity = false;
  if (tied.length > 1) {
    // null recency (never used) ranks as "most stale" → highest priority
    tied.sort((a, b) => {
      const ra = a.recencyMinutes ?? Number.POSITIVE_INFINITY;
      const rb = b.recencyMinutes ?? Number.POSITIVE_INFINITY;
      return rb - ra;
    });
    if (tied[0]!.vendor !== best.vendor) {
      pick = tied[0]!;
      pickedByDiversity = true;
      pick.diversityPick = true;
    }
  }

  const reasoning = pickedByDiversity
    ? `tied within 10%; picked least-recently-used vendor (anti-monoculture)`
    : `best effective cost = est-cost / wilson-LB(${pick.trialsSeen} trials)`;

  return {
    taskClass,
    estTokensIn,
    estTokensOut,
    candidates,
    recommended: pick,
    reasoning,
  };
}
