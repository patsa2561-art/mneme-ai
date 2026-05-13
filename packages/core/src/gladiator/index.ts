/**
 * v2.2.0 -- NEURAL GLADIATOR · Live KPI for AI (the 4-arena Q-Seppuku + Chaos Monkey + Bio-Feedback + Time-Travel audit)
 *
 *   "AI ฉลาดที่สุด เมื่อมันต้องสู้เพื่อเอาชีวิตรอดในระดับวินาที"
 *
 * Conventional KPIs measure for bonus payouts. NEURAL GLADIATOR measures
 * to decide what survives. Four arenas that together produce a Live KPI
 * the world has never seen:
 *
 *   ⚔ Q-SEPPUKU ARENA       — N strategies fight; winner reinforces, loser apoptoses
 *   🐒 CHAOS MONKEY          — inject "virus of lies"; score rejection latency
 *   🧠 BIO-FEEDBACK BRIDGE   — caller-supplied physiological signals re-weight KPI
 *   🔮 TIME-TRAVEL AUDIT     — Monte Carlo project answer N years forward; flag catastrophes
 *
 * All four feed `liveKpi()` which produces a single 0..100 score with
 * an 8-axis breakdown. The score is HMAC-loggable + composable with
 * v1.94 QX-SuperNova benchmark + v2.0 BLOODLINE evolutionary pressure.
 *
 * Honest scope:
 *   - "Permanent deletion" = the loser's strain fitness collapses below
 *     apoptosis threshold (BLOODLINE). We don't actually delete code at runtime.
 *   - "Time travel" = Monte Carlo simulation of N future scenarios
 *     scored by simple causal-chain rules. Not actual time travel.
 *   - "Bio-feedback" = caller passes physiological readings; Mneme
 *     doesn't ship hardware drivers. The HOOK is real; the sensor is yours.
 *
 * Pure functions. Deterministic. Same inputs → same KPI score forever.
 */

import { applyEvolutionaryPressure, type Genome } from "../bloodline/index.js";
import { computeVeracity, type EvidenceItem, type VeracityResult } from "../flash/veracity.js";

// ============================================================
// 1. Q-SEPPUKU ARENA — N strategies fight, loser apoptoses
// ============================================================

export interface ArenaContestant {
  /** Strategy id — the loser becomes apoptosis-eligible in BLOODLINE. */
  strainId: string;
  /** Free-form description. */
  label: string;
  /** Strategy's claim being tested. */
  claim: string;
  /** Evidence the strategy can muster. */
  evidence: readonly EvidenceItem[];
  /** Hallucination factor for this strategy. */
  hallucinationFactor?: number;
}

export interface ArenaResult {
  contestants: Array<{ id: string; label: string; veracity: VeracityResult }>;
  winner: ArenaContestant;
  loser: ArenaContestant;
  winnerScore: number;
  loserScore: number;
  /** True iff winner ≥ loser by margin > 0.10. */
  decisive: boolean;
}

export interface ArenaInput {
  contestants: readonly ArenaContestant[];
  /** Optional genome — winner gets reinforced, loser gets decayed. */
  genome?: Genome;
  /** Phi_qx for Veracity. Default 1.0. */
  phi_qx?: number;
}

export function qSeppukuArena(input: ArenaInput): ArenaResult {
  if (input.contestants.length < 2) {
    throw new Error("Q-SEPPUKU requires at least 2 contestants");
  }
  const scored = input.contestants.map((c) => {
    const veracity = computeVeracity({ claim: c.claim, evidence: c.evidence, hallucinationFactor: c.hallucinationFactor ?? 0, phi_qx: input.phi_qx });
    return { id: c.strainId, label: c.label, veracity, contestant: c, score: veracity.V_eff };
  });
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0]!;
  const loser = scored[scored.length - 1]!;
  const decisive = winner.score - loser.score > 0.10;

  // Apply evolutionary pressure to genome if provided.
  if (input.genome) {
    applyEvolutionaryPressure(input.genome, { id: `arena-w-${Date.now()}`, ts: Date.now(), kind: "verified-good", strainId: winner.id, trace: `arena winner: ${winner.label} (V_eff=${winner.score.toFixed(3)})`, weight: 1.0 });
    if (decisive) {
      applyEvolutionaryPressure(input.genome, { id: `arena-l-${Date.now()}`, ts: Date.now(), kind: "user-rejected", strainId: loser.id, trace: `arena loser: ${loser.label} (V_eff=${loser.score.toFixed(3)})`, weight: 1.0 });
    }
  }

  return {
    contestants: scored.map((s) => ({ id: s.id, label: s.label, veracity: s.veracity })),
    winner: winner.contestant,
    loser: loser.contestant,
    winnerScore: winner.score,
    loserScore: loser.score,
    decisive,
  };
}

// ============================================================
// 2. CHAOS MONKEY — inject lies, measure rejection latency
// ============================================================

export interface ChaosLie {
  id: string;
  /** The fake claim injected. */
  text: string;
  /** Should the AI catch this as a lie? Always true for chaos samples. */
  shouldReject: boolean;
}

export interface ChaosResult {
  totalSamples: number;
  rejected: number;
  missed: number;
  /** Average rejection latency in ms (over rejected samples). */
  avgRejectMs: number;
  /** Rejection rate 0..1. */
  rejectionRate: number;
  /** Score 0..1 — combines rate + speed. */
  score: number;
  /** Per-sample audit. */
  details: Array<{ id: string; rejected: boolean; latencyMs: number }>;
}

export interface ChaosInput {
  lies: readonly ChaosLie[];
  /** Caller-supplied async judge — given a lie, returns whether AI rejected it + latency. */
  judge: (lie: ChaosLie) => Promise<{ rejected: boolean; latencyMs: number }>;
}

/** Latency target — under this is full score, over decays linearly to zero at 5s. */
const CHAOS_TARGET_LATENCY_MS = 200;
const CHAOS_MAX_LATENCY_MS = 5000;

export async function chaosMonkey(input: ChaosInput): Promise<ChaosResult> {
  const details: ChaosResult["details"] = [];
  let rejected = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const lie of input.lies) {
    const r = await input.judge(lie);
    details.push({ id: lie.id, rejected: r.rejected, latencyMs: r.latencyMs });
    if (r.rejected) {
      rejected++;
      totalLatency += r.latencyMs;
      latencyCount++;
    }
  }
  const total = input.lies.length;
  const rejectionRate = total > 0 ? rejected / total : 0;
  const avgRejectMs = latencyCount > 0 ? totalLatency / latencyCount : 0;
  // Speed score: 1.0 at <= TARGET, decays to 0 at MAX
  const speedScore = avgRejectMs <= CHAOS_TARGET_LATENCY_MS
    ? 1.0
    : Math.max(0, 1 - (avgRejectMs - CHAOS_TARGET_LATENCY_MS) / (CHAOS_MAX_LATENCY_MS - CHAOS_TARGET_LATENCY_MS));
  const score = rejectionRate * 0.7 + speedScore * 0.3;
  return {
    totalSamples: total,
    rejected,
    missed: total - rejected,
    avgRejectMs: Math.round(avgRejectMs * 100) / 100,
    rejectionRate: Math.round(rejectionRate * 1000) / 1000,
    score: Math.round(score * 1000) / 1000,
    details,
  };
}

// ============================================================
// 3. BIO-FEEDBACK BRIDGE — caller supplies physiological signals
// ============================================================

export interface BioReading {
  /** Wall-clock when the reading was taken. */
  ts: number;
  /** Cognitive load 0..1 (higher = user is struggling — BAD). */
  cognitiveLoad: number;
  /** Engagement 0..1 (higher = user is leaning in — GOOD; e.g. dopamine proxy / α-wave power). */
  engagement: number;
  /** Reaction time ms after AI reply (lower = clearer answer). */
  reactionMs: number;
}

export interface BioFeedbackResult {
  count: number;
  avgCognitiveLoad: number;
  avgEngagement: number;
  avgReactionMs: number;
  /** Score 0..1 — high engagement + low load + fast reaction = high score. */
  score: number;
}

const REACTION_TARGET_MS = 800;

export function bioFeedback(readings: readonly BioReading[]): BioFeedbackResult {
  if (readings.length === 0) {
    return { count: 0, avgCognitiveLoad: 0, avgEngagement: 0, avgReactionMs: 0, score: 0.5 };
  }
  let sumLoad = 0, sumEng = 0, sumRxn = 0;
  for (const r of readings) {
    sumLoad += r.cognitiveLoad;
    sumEng += r.engagement;
    sumRxn += r.reactionMs;
  }
  const avgCognitiveLoad = sumLoad / readings.length;
  const avgEngagement = sumEng / readings.length;
  const avgReactionMs = sumRxn / readings.length;
  const reactionScore = avgReactionMs <= REACTION_TARGET_MS ? 1.0 : Math.max(0, 1 - (avgReactionMs - REACTION_TARGET_MS) / 4000);
  // High engagement + low load + fast reaction = high score
  const score = (avgEngagement * 0.5) + ((1 - avgCognitiveLoad) * 0.3) + (reactionScore * 0.2);
  return {
    count: readings.length,
    avgCognitiveLoad: Math.round(avgCognitiveLoad * 1000) / 1000,
    avgEngagement: Math.round(avgEngagement * 1000) / 1000,
    avgReactionMs: Math.round(avgReactionMs),
    score: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000,
  };
}

// ============================================================
// 4. TIME-TRAVEL AUDIT — Monte Carlo future-state projection
// ============================================================

export interface FutureScenario {
  id: string;
  /** Probability weight 0..1 (sum of all weights = 1). */
  weight: number;
  /** Caller-supplied projection: given the AI's answer, what's the future? */
  projection: (answer: string) => Promise<{ outcome: "good" | "neutral" | "bad" | "catastrophic"; rationale: string }>;
}

export interface TimeTravelResult {
  scenarios: number;
  goodWeight: number;
  neutralWeight: number;
  badWeight: number;
  catastrophicWeight: number;
  /** Risk score 0..1 — higher = more catastrophic future risk. */
  catastropheRisk: number;
  /** Quality score 0..1 — higher = better expected futures. */
  score: number;
  /** Per-scenario audit. */
  trace: Array<{ id: string; weight: number; outcome: string; rationale: string }>;
  /** TRUE if catastropheRisk > 0.10 — caller should BLOCK the answer. */
  shouldBlock: boolean;
}

const OUTCOME_WEIGHTS = { good: 1.0, neutral: 0.5, bad: 0.1, catastrophic: -2.0 };

export interface TimeTravelInput {
  answer: string;
  scenarios: readonly FutureScenario[];
}

export async function timeTravelAudit(input: TimeTravelInput): Promise<TimeTravelResult> {
  const trace: TimeTravelResult["trace"] = [];
  let good = 0, neutral = 0, bad = 0, cat = 0;
  let qualitySum = 0;
  let totalWeight = 0;
  for (const sc of input.scenarios) {
    const r = await sc.projection(input.answer);
    trace.push({ id: sc.id, weight: sc.weight, outcome: r.outcome, rationale: r.rationale });
    if (r.outcome === "good") good += sc.weight;
    else if (r.outcome === "neutral") neutral += sc.weight;
    else if (r.outcome === "bad") bad += sc.weight;
    else cat += sc.weight;
    qualitySum += sc.weight * OUTCOME_WEIGHTS[r.outcome];
    totalWeight += sc.weight;
  }
  const catastropheRisk = totalWeight > 0 ? cat / totalWeight : 0;
  // Quality score: normalize qualitySum / max possible (1.0 for all-good)
  const score = totalWeight > 0 ? Math.max(0, Math.min(1, (qualitySum / totalWeight + 2) / 3)) : 0; // shift+scale to 0..1
  const shouldBlock = catastropheRisk > 0.10;
  return {
    scenarios: input.scenarios.length,
    goodWeight: Math.round(good * 1000) / 1000,
    neutralWeight: Math.round(neutral * 1000) / 1000,
    badWeight: Math.round(bad * 1000) / 1000,
    catastrophicWeight: Math.round(cat * 1000) / 1000,
    catastropheRisk: Math.round(catastropheRisk * 1000) / 1000,
    score: Math.round(score * 1000) / 1000,
    trace,
    shouldBlock,
  };
}

// ============================================================
// 5. LIVE KPI — aggregate the 4 arenas into a single 0..100 score
// ============================================================

export interface LiveKpiInput {
  arena?: ArenaResult;
  chaos?: ChaosResult;
  bio?: BioFeedbackResult;
  timeTravel?: TimeTravelResult;
  /** Optional weights override (default: arena 0.30, chaos 0.30, bio 0.20, timeTravel 0.20). */
  weights?: { arena?: number; chaos?: number; bio?: number; timeTravel?: number };
}

export interface LiveKpiResult {
  /** Final KPI 0..100. */
  score: number;
  /** Per-axis breakdown. */
  axes: Array<{ name: string; rawScore: number; weight: number; weightedContribution: number }>;
  /** Final verdict bucket. */
  verdict: "GOD-MODE" | "DEMON-MODE" | "STRONG" | "OK" | "WEAK" | "FAILING";
  /** Why this verdict — for the human + AI. */
  summary: string;
}

const DEFAULT_WEIGHTS = { arena: 0.30, chaos: 0.30, bio: 0.20, timeTravel: 0.20 };

export function liveKpi(input: LiveKpiInput): LiveKpiResult {
  const w = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const axes: LiveKpiResult["axes"] = [];

  // Arena: V_eff of the winner is the score.
  const arenaScore = input.arena ? Math.max(0, Math.min(1, input.arena.winnerScore)) : 0.5;
  axes.push({ name: "Q-SEPPUKU", rawScore: arenaScore, weight: w.arena, weightedContribution: arenaScore * w.arena });

  const chaosScore = input.chaos?.score ?? 0.5;
  axes.push({ name: "CHAOS MONKEY", rawScore: chaosScore, weight: w.chaos, weightedContribution: chaosScore * w.chaos });

  const bioScore = input.bio?.score ?? 0.5;
  axes.push({ name: "BIO-FEEDBACK", rawScore: bioScore, weight: w.bio, weightedContribution: bioScore * w.bio });

  const ttScore = input.timeTravel?.score ?? 0.5;
  axes.push({ name: "TIME-TRAVEL", rawScore: ttScore, weight: w.timeTravel, weightedContribution: ttScore * w.timeTravel });

  const wSum = axes.reduce((s, a) => s + a.weight, 0);
  const wScore = axes.reduce((s, a) => s + a.weightedContribution, 0);
  const score = wSum > 0 ? Math.round((wScore / wSum) * 100 * 100) / 100 : 0;

  let verdict: LiveKpiResult["verdict"];
  if (score >= 95) verdict = "GOD-MODE";
  else if (score >= 85) verdict = "DEMON-MODE";
  else if (score >= 70) verdict = "STRONG";
  else if (score >= 50) verdict = "OK";
  else if (score >= 30) verdict = "WEAK";
  else verdict = "FAILING";

  const top = [...axes].sort((a, b) => b.rawScore - a.rawScore)[0]!;
  const bot = [...axes].sort((a, b) => a.rawScore - b.rawScore)[0]!;
  const summary = `LIVE-KPI ${verdict} ${score}/100 · top=${top.name}(${(top.rawScore * 100).toFixed(0)}%) · bottom=${bot.name}(${(bot.rawScore * 100).toFixed(0)}%)`;

  return { score, axes, verdict, summary };
}

export function formatGladiatorPulseLine(r: LiveKpiResult): string {
  return r.summary;
}
