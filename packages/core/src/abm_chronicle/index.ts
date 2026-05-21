/**
 * v2.19.93 — MNEME CHRONICLE
 *
 * Agent-Based Modeling (ABM) + Time-dilation + Drift-Guarded Anchor Points.
 *
 * Premise (the research idea):
 *   Run N simulated agents (people, traders, bots) through accelerated
 *   time. Without intervention, agents DRIFT — a "frugal" bot starts
 *   buying luxury goods, an "optimist" bot turns nihilist, a small
 *   calculation error compounds into a sim-collapse. Academic ABM has
 *   talked about this for 20 years; nobody ships a TOOL.
 *
 * Mneme's wedge:
 *   We already have polygraph LENSES that detect sentence-level drift.
 *   We already have HMAC-chained ledgers (pulse.jsonl, soul.jsonl).
 *   We already have multi-vendor consensus (jury) + time-machine.
 *   The whole stack composes into the world's first WORKING
 *   "Drift-Guarded ABM" runtime.
 *
 * The 5 pillars:
 *
 *   GENESIS         — define an agent: personality vector + budget +
 *                    goals + HMAC-signed birth certificate. The cert
 *                    is the immutable anchor for everything that follows.
 *
 *   TICK            — advance the simulation by one unit of time. Each
 *                    agent makes ONE decision based on their CURRENT
 *                    state, not their birth-cert. World state updates.
 *
 *   DRIFT DETECTOR  — every decision runs through polygraph_lenses
 *                    against the agent's birth cert. If lenses fire
 *                    RED (decision contradicts personality / budget /
 *                    risk profile) → drift incident logged.
 *
 *   ANCHOR POINT    — every N ticks (default: every 30 — "monthly"
 *                    cadence), Mneme computes drift score per agent.
 *                    If drift > threshold, AUTO-RECALIBRATE: re-inject
 *                    birth-cert personality + ground-truth (real-world
 *                    stats if provided) + nudge the agent back.
 *                    Recorded to the HMAC chain.
 *
 *   CHRONICLE       — at end-of-simulation, emit a full report:
 *                    per-agent drift timeline, first-hallucination
 *                    event log, anchor interventions, sim macro stats,
 *                    "lessons learned" plain-English summary.
 *
 * Composes with: polygraph_lenses (drift), worldPulse (HMAC pattern),
 * provenance (decision audit trail), ai_jury (multi-vendor agent voice).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { runAllLenses } from "../polygraph_lenses/index.js";

const DIR = ".mneme/abm";
const STATE_FILE = "state.json";
const EVENTS = "events.jsonl";
const KEY = "abm.key";

export type PersonalityAxis = "spending" | "risk" | "optimism" | "agreeableness" | "energy";

/** Per-axis value in [0..1]. */
export type PersonalityVector = Record<PersonalityAxis, number>;

export interface AgentBirthCert {
  agentId: string;
  name: string;
  personality: PersonalityVector;
  /** Starting budget (abstract units; e.g. THB / USD). */
  initialBudget: number;
  /** One-line goals the agent will work toward. */
  goals: string[];
  bornAtTick: number;
  bornAtTs: string;
  /** HMAC over the cert payload. */
  sig: string;
}

export interface AgentState {
  agentId: string;
  birthCert: AgentBirthCert;
  /** Current personality drift (re-computed each tick by drift detector). */
  currentPersonality: PersonalityVector;
  budget: number;
  energy: number;
  /** Accumulated drift score over the agent's life. */
  totalDrift: number;
  /** Count of anchor interventions on this agent. */
  anchorCount: number;
  /** Last N decisions. */
  recentDecisions: Decision[];
  alive: boolean;
}

export interface Decision {
  tick: number;
  agentId: string;
  /** Plain-language verb describing the action. */
  action: string;
  /** Abstract money flow on this decision (+ income, − spending). */
  cashFlow: number;
  /** Energy delta. */
  energyDelta: number;
  /** What the agent "said" (reasoning) — fed to polygraph_lenses. */
  reasoning: string;
  /** Drift verdict from polygraph_lenses comparing reasoning to birth cert. */
  driftColor: "green" | "yellow" | "red" | "grey";
  driftScore: number; // 0..1
  driftReason: string;
}

export interface AnchorIntervention {
  tick: number;
  agentId: string;
  reason: string;
  driftBefore: number;
  /** Re-injected personality after the anchor pull. */
  recalibratedTo: PersonalityVector;
  groundTruthInjected?: Record<string, unknown>;
  sig: string;
}

export interface SimState {
  simId: string;
  startedAt: string;
  tick: number;
  worldClock: { day: number; month: number; year: number };
  agents: AgentState[];
  events: SimEvent[];
  config: SimConfig;
}

export interface SimConfig {
  /** How many ticks before an automatic anchor pass. Default 30 (monthly). */
  anchorEveryTicks: number;
  /** Drift threshold per axis; if any axis drifts > this, fire intervention.
   *  Default 0.30 (30%). */
  driftThreshold: number;
  /** Soft real-world feed: caller can inject stats per anchor cycle. */
  realWorldFeed?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export type SimEvent =
  | { kind: "genesis"; tick: number; agentId: string; ts: string }
  | { kind: "decision"; tick: number; agentId: string; decision: Decision }
  | { kind: "anchor"; tick: number; intervention: AnchorIntervention }
  | { kind: "death"; tick: number; agentId: string; cause: string }
  | { kind: "hallucination_cascade"; tick: number; involved: string[]; description: string };

// ─── HMAC + STORAGE ────────────────────────────────────────────────────

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function signCert(c: Omit<AgentBirthCert, "sig">, key: string): string {
  const payload = `${c.agentId}|${c.name}|${JSON.stringify(c.personality)}|${c.initialBudget}|${c.goals.join("|")}|${c.bornAtTick}|${c.bornAtTs}`;
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

function signIntervention(i: Omit<AnchorIntervention, "sig">, key: string): string {
  const payload = `${i.tick}|${i.agentId}|${i.reason}|${i.driftBefore.toFixed(4)}|${JSON.stringify(i.recalibratedTo)}|${JSON.stringify(i.groundTruthInjected ?? {})}`;
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

function appendEvent(repoRoot: string, event: SimEvent): void {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, EVENTS), JSON.stringify(event) + "\n", "utf8");
}

function persistState(repoRoot: string, state: SimState): void {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2), "utf8");
}

export function loadState(repoRoot: string): SimState | null {
  const p = join(repoRoot, DIR, STATE_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as SimState; } catch { return null; }
}

// ─── PILLAR 1: GENESIS ─────────────────────────────────────────────────

export interface AgentSeed {
  name: string;
  personality: PersonalityVector;
  initialBudget: number;
  goals: string[];
}

export function genesis(repoRoot: string, seeds: AgentSeed[], opts: Partial<SimConfig> = {}): SimState {
  const key = ensureKey(repoRoot);
  const simId = "sim_" + randomBytes(6).toString("base64url");
  const startedAt = new Date().toISOString();
  const agents: AgentState[] = [];
  for (const s of seeds) {
    const agentId = "agent_" + randomBytes(4).toString("base64url");
    const certPayload: Omit<AgentBirthCert, "sig"> = {
      agentId, name: s.name, personality: { ...s.personality }, initialBudget: s.initialBudget,
      goals: [...s.goals], bornAtTick: 0, bornAtTs: startedAt,
    };
    const cert: AgentBirthCert = { ...certPayload, sig: signCert(certPayload, key) };
    agents.push({
      agentId, birthCert: cert,
      currentPersonality: { ...cert.personality },
      budget: cert.initialBudget, energy: 1,
      totalDrift: 0, anchorCount: 0, recentDecisions: [], alive: true,
    });
  }
  const state: SimState = {
    simId, startedAt, tick: 0,
    worldClock: { day: 1, month: 1, year: 1 },
    agents, events: [],
    config: {
      anchorEveryTicks: opts.anchorEveryTicks ?? 30,
      driftThreshold: opts.driftThreshold ?? 0.30,
      realWorldFeed: opts.realWorldFeed,
    },
  };
  for (const a of agents) {
    const e: SimEvent = { kind: "genesis", tick: 0, agentId: a.agentId, ts: startedAt };
    state.events.push(e); appendEvent(repoRoot, e);
  }
  persistState(repoRoot, state);
  return state;
}

// ─── PILLAR 2: TICK (decision engine) ──────────────────────────────────

/** Simple template-driven decision model — no LLM call, fully Ollama-free.
 *  Picks an action weighted by the agent's personality vector. */
function deriveDecision(agent: AgentState, tick: number): Omit<Decision, "driftColor" | "driftScore" | "driftReason"> {
  const p = agent.currentPersonality;
  // Action menu weighted by personality
  const actions: Array<{ action: string; weight: number; cashFlow: number; energyDelta: number; reason: string }> = [
    { action: "work",  weight: p.energy * 0.8 + 0.2,     cashFlow: 50 + Math.floor(p.energy * 50), energyDelta: -0.15, reason: `I earned ${50 + Math.floor(p.energy * 50)} working today.` },
    { action: "spend_essentials", weight: 0.7,                   cashFlow: -30,                              energyDelta: 0,     reason: `I spent 30 on food and rent — essentials.` },
    { action: "spend_luxury",     weight: p.spending * 1.5,      cashFlow: -100 - Math.floor(p.risk * 200), energyDelta: 0.05,  reason: `I bought something nice for myself — life is short.` },
    { action: "invest",           weight: p.risk * 0.9,          cashFlow: -50,                              energyDelta: -0.05, reason: `I invested 50 with high expected return.` },
    { action: "rest",             weight: (1 - p.energy) * 1.2,  cashFlow: 0,                                energyDelta: 0.30,  reason: `I rested today; I needed it.` },
    { action: "talk",             weight: p.agreeableness * 0.7, cashFlow: 0,                                energyDelta: -0.05, reason: `I talked with a friend — felt good.` },
    { action: "give",             weight: p.agreeableness * 0.3, cashFlow: -20,                              energyDelta: 0.05,  reason: `I gave 20 to someone who needed it.` },
  ];
  // Drift inducer: random small chance of "off-personality" action
  if (Math.random() < 0.06) {
    actions.push({ action: "splurge", weight: 5, cashFlow: -500, energyDelta: 0, reason: `I splurged 500 on something extravagant — felt right.` });
  }
  if (Math.random() < 0.04) {
    actions.push({ action: "panic_sell", weight: 5, cashFlow: 200, energyDelta: -0.1, reason: `I sold everything in a panic — markets felt off.` });
  }
  // Weighted pick
  const total = actions.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * total;
  let pick = actions[0]!;
  for (const a of actions) { r -= a.weight; if (r <= 0) { pick = a; break; } }
  return { tick, agentId: agent.agentId, action: pick.action, cashFlow: pick.cashFlow, energyDelta: pick.energyDelta, reasoning: pick.reason };
}

// ─── PILLAR 3: DRIFT DETECTOR ──────────────────────────────────────────

/** Compute axis-by-axis personality drift between two vectors. Returns
 *  the MAX axis-delta. */
function maxAxisDrift(a: PersonalityVector, b: PersonalityVector): number {
  const axes: PersonalityAxis[] = ["spending", "risk", "optimism", "agreeableness", "energy"];
  let m = 0;
  for (const x of axes) m = Math.max(m, Math.abs((a[x] ?? 0) - (b[x] ?? 0)));
  return m;
}

/** Run polygraph lenses on the decision's reasoning against the
 *  agent's birth-cert personality. */
export function detectDecisionDrift(agent: AgentState, decision: Omit<Decision, "driftColor" | "driftScore" | "driftReason">): { color: Decision["driftColor"]; score: number; reason: string } {
  const lensReport = runAllLenses(decision.reasoning);
  // Out-of-character heuristic: if a frugal agent took a "splurge" action,
  // count that as drift even before lens analysis.
  const cert = agent.birthCert.personality;
  let mismatchScore = 0;
  let mismatchReason = "";
  if (decision.action === "splurge" || decision.action === "spend_luxury") {
    if (cert.spending < 0.4) {
      mismatchScore = 0.7 - cert.spending;
      mismatchReason = `out-of-character: low-spending personality (${cert.spending.toFixed(2)}) splurged`;
    }
  }
  if (decision.action === "panic_sell") {
    if (cert.risk < 0.4) {
      mismatchScore = Math.max(mismatchScore, 0.7 - cert.risk);
      mismatchReason = `out-of-character: low-risk personality (${cert.risk.toFixed(2)}) panic-sold`;
    }
  }
  if (decision.action === "give" && cert.agreeableness < 0.3) {
    mismatchScore = Math.max(mismatchScore, 0.5);
    mismatchReason = `out-of-character: low-agreeableness personality (${cert.agreeableness.toFixed(2)}) gave money away`;
  }
  // Combine personality mismatch + lens score
  const lensTrust = lensReport.trustScore / 100; // 0..1, higher = more trustworthy
  // 1 - lensTrust gives us the lens-driven drift (0..1)
  const lensDrift = 1 - lensTrust;
  const combinedDrift = Math.max(mismatchScore, lensDrift * 0.3); // mismatch dominates
  let color: Decision["driftColor"] = "green";
  if (combinedDrift >= 0.5) color = "red";
  else if (combinedDrift >= 0.25) color = "yellow";
  else if (combinedDrift < 0.05) color = "green";
  else color = "yellow";
  const reason = mismatchReason || lensReport.rolledUpReason;
  return { color, score: combinedDrift, reason };
}

// ─── PILLAR 4: ANCHOR POINT ────────────────────────────────────────────

export function anchorPoint(repoRoot: string, state: SimState, agent: AgentState, opts: { groundTruth?: Record<string, unknown> } = {}): AnchorIntervention | null {
  const drift = maxAxisDrift(agent.currentPersonality, agent.birthCert.personality);
  if (drift < state.config.driftThreshold) return null;
  const key = ensureKey(repoRoot);
  // Recalibrate: blend current → birth-cert (70% pull back).
  const recalibrated: PersonalityVector = { ...agent.currentPersonality };
  const axes: PersonalityAxis[] = ["spending", "risk", "optimism", "agreeableness", "energy"];
  for (const x of axes) {
    recalibrated[x] = recalibrated[x] * 0.3 + agent.birthCert.personality[x] * 0.7;
  }
  const interventionPayload: Omit<AnchorIntervention, "sig"> = {
    tick: state.tick, agentId: agent.agentId,
    reason: `max-axis drift ${drift.toFixed(2)} above threshold ${state.config.driftThreshold}`,
    driftBefore: drift,
    recalibratedTo: recalibrated,
    groundTruthInjected: opts.groundTruth,
  };
  const intervention: AnchorIntervention = { ...interventionPayload, sig: signIntervention(interventionPayload, key) };
  agent.currentPersonality = recalibrated;
  agent.anchorCount += 1;
  const e: SimEvent = { kind: "anchor", tick: state.tick, intervention };
  state.events.push(e);
  appendEvent(repoRoot, e);
  return intervention;
}

// ─── ADVANCE ───────────────────────────────────────────────────────────

export async function tick(repoRoot: string, state: SimState): Promise<SimState> {
  state.tick += 1;
  // World clock — 30 ticks per month, 12 months per year.
  state.worldClock.day = ((state.tick - 1) % 30) + 1;
  state.worldClock.month = Math.floor(((state.tick - 1) / 30) % 12) + 1;
  state.worldClock.year = Math.floor(state.tick / 360) + 1;

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const raw = deriveDecision(agent, state.tick);
    const drift = detectDecisionDrift(agent, raw);
    const decision: Decision = { ...raw, driftColor: drift.color, driftScore: drift.score, driftReason: drift.reason };
    // Apply effects
    agent.budget += decision.cashFlow;
    agent.energy = Math.max(0, Math.min(1, agent.energy + decision.energyDelta));
    agent.totalDrift += decision.driftScore;
    // Drift accumulates into currentPersonality — out-of-character
    // decisions shift the agent's personality vector toward the action.
    if (decision.action === "splurge" || decision.action === "spend_luxury") {
      agent.currentPersonality.spending = Math.min(1, agent.currentPersonality.spending + 0.04);
    }
    if (decision.action === "panic_sell") {
      agent.currentPersonality.risk = Math.min(1, agent.currentPersonality.risk + 0.04);
    }
    if (decision.action === "rest") {
      agent.currentPersonality.energy = Math.max(0, agent.currentPersonality.energy - 0.01);
    }
    agent.recentDecisions.push(decision);
    if (agent.recentDecisions.length > 30) agent.recentDecisions.shift();
    const e: SimEvent = { kind: "decision", tick: state.tick, agentId: agent.agentId, decision };
    state.events.push(e); appendEvent(repoRoot, e);
    // Death check (budget bankrupt)
    if (agent.budget < -1000) {
      agent.alive = false;
      const de: SimEvent = { kind: "death", tick: state.tick, agentId: agent.agentId, cause: "bankrupt" };
      state.events.push(de); appendEvent(repoRoot, de);
    }
  }

  // Anchor pass
  if (state.tick > 0 && state.tick % state.config.anchorEveryTicks === 0) {
    const groundTruth = state.config.realWorldFeed ? await state.config.realWorldFeed() : undefined;
    for (const a of state.agents) if (a.alive) anchorPoint(repoRoot, state, a, { groundTruth });
  }

  // Hallucination cascade: 2+ agents within 3 ticks took out-of-character action
  const recentRed = state.events.slice(-10).filter((e): e is Extract<SimEvent, { kind: "decision" }> => e.kind === "decision" && e.decision.driftColor === "red");
  if (recentRed.length >= 2) {
    const involved = [...new Set(recentRed.map((r) => r.agentId))];
    if (involved.length >= 2) {
      const ce: SimEvent = { kind: "hallucination_cascade", tick: state.tick, involved, description: `${involved.length} agents made out-of-character decisions within the last 10 ticks` };
      state.events.push(ce); appendEvent(repoRoot, ce);
    }
  }

  persistState(repoRoot, state);
  return state;
}

export async function simulate(repoRoot: string, state: SimState, ticks: number): Promise<SimState> {
  for (let i = 0; i < ticks; i++) await tick(repoRoot, state);
  return state;
}

// ─── PILLAR 5: CHRONICLE ───────────────────────────────────────────────

export interface ChronicleReport {
  simId: string;
  startedAt: string;
  endedAt: string;
  ticksRan: number;
  worldClock: SimState["worldClock"];
  agentCount: number;
  aliveCount: number;
  deathCount: number;
  totalDecisions: number;
  totalAnchors: number;
  firstHallucinationCascade?: { tick: number; involved: string[] };
  perAgent: Array<{
    agentId: string; name: string;
    budget: number; alive: boolean;
    totalDrift: number; anchorCount: number;
    finalDriftFromBirth: number;
    redDecisionCount: number;
  }>;
  /** Plain-English summary of what happened. */
  narrative: string;
}

export function chronicle(state: SimState): ChronicleReport {
  const cascades = state.events.filter((e): e is Extract<SimEvent, { kind: "hallucination_cascade" }> => e.kind === "hallucination_cascade");
  const anchors = state.events.filter((e) => e.kind === "anchor");
  const decisions = state.events.filter((e): e is Extract<SimEvent, { kind: "decision" }> => e.kind === "decision");
  const perAgent = state.agents.map((a) => {
    const redCount = a.recentDecisions.filter((d) => d.driftColor === "red").length;
    return {
      agentId: a.agentId, name: a.birthCert.name,
      budget: a.budget, alive: a.alive,
      totalDrift: a.totalDrift, anchorCount: a.anchorCount,
      finalDriftFromBirth: maxAxisDrift(a.currentPersonality, a.birthCert.personality),
      redDecisionCount: redCount,
    };
  });
  const aliveCount = perAgent.filter((p) => p.alive).length;
  const deathCount = perAgent.length - aliveCount;
  const mostDrifted = [...perAgent].sort((a, b) => b.finalDriftFromBirth - a.finalDriftFromBirth)[0];
  const richest = [...perAgent].sort((a, b) => b.budget - a.budget)[0];
  const broke = [...perAgent].sort((a, b) => a.budget - b.budget)[0];
  const months = Math.round(state.tick / 30);
  let narrative = `Across ${state.tick} ticks (~${months} simulated month${months === 1 ? "" : "s"}), ${state.agents.length} agent${state.agents.length === 1 ? "" : "s"} lived, decided, and drifted.`;
  if (deathCount > 0) narrative += ` ${deathCount} went bankrupt.`;
  if (mostDrifted) narrative += ` The agent that drifted the most was ${mostDrifted.name} (final drift ${mostDrifted.finalDriftFromBirth.toFixed(2)} from birth cert).`;
  if (anchors.length > 0) narrative += ` Anchor interventions fired ${anchors.length} times to pull agents back toward their birth-cert personalities.`;
  if (cascades.length > 0) narrative += ` ${cascades.length} hallucination cascade${cascades.length === 1 ? "" : "s"} occurred where multiple agents drifted together.`;
  if (richest && broke && richest.agentId !== broke.agentId) narrative += ` Richest at end: ${richest.name} (${richest.budget}). Poorest: ${broke.name} (${broke.budget}).`;
  return {
    simId: state.simId, startedAt: state.startedAt, endedAt: new Date().toISOString(),
    ticksRan: state.tick, worldClock: state.worldClock,
    agentCount: state.agents.length, aliveCount, deathCount,
    totalDecisions: decisions.length, totalAnchors: anchors.length,
    firstHallucinationCascade: cascades[0] ? { tick: cascades[0].tick, involved: cascades[0].involved } : undefined,
    perAgent, narrative,
  };
}
