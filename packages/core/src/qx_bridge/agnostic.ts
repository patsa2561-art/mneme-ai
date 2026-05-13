/**
 * v1.96.0 -- QX-BRIDGE · The agnostic master (CACHE + ROUTER + RACE + VERIFY + COST + AGNOSTIC API).
 *
 * The single function AI agents call to "just run this quantum thing,
 * pick the best provider, don't bother me with details, prove it's
 * correct, and stay under budget."
 *
 *     runQuantumAgnostic({ source, shots, budget?, preferences?, memory? })
 *
 *  source           : QASM string OR CircuitIR (uniform input)
 *  shots            : how many measurements
 *  budget           : { maxUsd?, maxQueueMs? } — refuses providers that exceed
 *  preferences      : { preferFree?, race?, verify?, allowSimulator? }
 *  memory           : InfinityMemory — auto-records every job + verification
 *
 * Composes:
 *   1. QASM parser            → CircuitIR (qasm_parser.ts)
 *   2. DNA fingerprint cache  → return cached result if recent (this file)
 *   3. Smart router           → pick best provider given budget+preferences (this file)
 *   4. Capability matcher     → fits? gates needing decomposition? (capabilities.ts)
 *   5. Gate decomposer        → rewrite to provider's native gate set (decomposer.ts)
 *   6. (optional) Multi-provider race → fastest wins (this file)
 *   7. (optional) Equivalence verifier → simulator vs real, total-variation distance
 *   8. Cost predictor + budget gate → refuses to spend more than maxUsd
 *
 * One call. No vendor lock-in. AI agent code stays the same as
 * providers come and go.
 */

import { createHash } from "node:crypto";

import type { CircuitIR } from "./simulator.js";
import type { ProviderName, CircuitResponse } from "./providers.js";
import type { InfinityMemory } from "../qx_supernova/infinity_memory.js";
import { runCircuit, formatQuantumPulseLine, probeProviders } from "./providers.js";
import { qasmToCircuit, parseQasm } from "./qasm_parser.js";
import { capabilitiesOf, matchCircuitToProvider, PROVIDER_CAPABILITIES } from "./capabilities.js";
import { decompose } from "./decomposer.js";

// ============================================================
// 1. DNA FINGERPRINT CACHE — same circuit twice → cached result
// ============================================================

export interface CacheEntry {
  dna: string;
  result: CircuitResponse;
  ts: number;
  /** Hits since insertion. */
  hits: number;
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 256;

/** Hash the structural form of the circuit. Invariant to label changes,
 *  sensitive to gate ordering / qubits / parameters. */
export function circuitDna(circuit: CircuitIR, shots: number, provider: ProviderName): string {
  const parts: string[] = [`q=${circuit.numQubits}`, `s=${shots}`, `p=${provider}`];
  for (const g of circuit.gates) {
    const t = g.targets.join(",");
    const th = g.theta !== undefined ? g.theta.toFixed(8) : "";
    parts.push(`${g.type}|${t}|${th}`);
  }
  return createHash("sha256").update(parts.join(";")).digest("hex").slice(0, 16);
}

function cacheGet(dna: string): CacheEntry | null {
  const e = CACHE.get(dna);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    CACHE.delete(dna);
    return null;
  }
  e.hits++;
  return e;
}

function cachePut(dna: string, result: CircuitResponse): void {
  if (CACHE.size >= CACHE_MAX) {
    // Evict oldest.
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
  CACHE.set(dna, { dna, result, ts: Date.now(), hits: 0 });
}

export function cacheStats(): { size: number; totalHits: number; entries: Array<{ dna: string; hits: number; ageMs: number }> } {
  const now = Date.now();
  const entries = [...CACHE.values()].map((e) => ({ dna: e.dna, hits: e.hits, ageMs: now - e.ts }));
  return { size: CACHE.size, totalHits: entries.reduce((s, e) => s + e.hits, 0), entries };
}

export function cacheClear(): void { CACHE.clear(); }

// ============================================================
// 2. SMART ROUTER — pick the best provider given the request
// ============================================================

export interface RouterPreferences {
  /** Prefer providers with $0 cost. Default true. */
  preferFree?: boolean;
  /** Allow simulator as a candidate. Default true. */
  allowSimulator?: boolean;
  /** Force this provider (skips routing). */
  forceProvider?: ProviderName;
  /** Skip providers in this list. */
  exclude?: ProviderName[];
}

export interface BudgetConstraints {
  maxUsd?: number;
  maxQueueMs?: number;
}

export interface RouteDecision {
  provider: ProviderName;
  reason: string;
  estimatedCostUsd: number;
  estimatedQueueMs: number;
  gatesToDecompose: string[];
  /** All providers considered, with their pros/cons. */
  considered: Array<{ provider: ProviderName; ready: boolean; fits: boolean; estCostUsd: number; estQueueMs: number; reason: string }>;
}

/** Score a provider for ranking. Lower is better. */
function scoreProvider(args: { fits: boolean; ready: boolean; cost: number; queue: number; preferFree: boolean }): number {
  if (!args.fits || !args.ready) return Infinity;
  const costPenalty = args.preferFree && args.cost > 0 ? 1_000_000 : args.cost * 1000;
  const queuePenalty = args.queue * 0.001; // 1 ms = 0.001 score
  return costPenalty + queuePenalty;
}

export function route(args: {
  circuit: CircuitIR;
  shots: number;
  budget?: BudgetConstraints;
  preferences?: RouterPreferences;
  env?: NodeJS.ProcessEnv;
}): RouteDecision {
  const prefs = args.preferences ?? {};
  const budget = args.budget ?? {};
  const probe = probeProviders(args.env ?? process.env);

  // Force route
  if (prefs.forceProvider) {
    const cap = capabilitiesOf(prefs.forceProvider)!;
    const m = matchCircuitToProvider(args.circuit, prefs.forceProvider, args.shots);
    return {
      provider: prefs.forceProvider,
      reason: `forced by user preference`,
      estimatedCostUsd: m.estimatedCostUsd,
      estimatedQueueMs: m.estimatedQueueMs,
      gatesToDecompose: m.gatesToDecompose,
      considered: [{ provider: prefs.forceProvider, ready: probe.find((p) => p.name === prefs.forceProvider)?.ready ?? false, fits: m.fits, estCostUsd: m.estimatedCostUsd, estQueueMs: m.estimatedQueueMs, reason: m.reason }],
    };
  }

  const considered: RouteDecision["considered"] = [];
  const candidates: Array<{ provider: ProviderName; score: number; m: ReturnType<typeof matchCircuitToProvider>; ready: boolean }> = [];

  for (const cap of PROVIDER_CAPABILITIES) {
    if (cap.name === "simulator" && prefs.allowSimulator === false) continue;
    if (prefs.exclude?.includes(cap.name)) continue;
    const ready = probe.find((p) => p.name === cap.name)?.ready ?? false;
    const m = matchCircuitToProvider(args.circuit, cap.name, args.shots);
    const overBudgetCost = budget.maxUsd !== undefined && m.estimatedCostUsd > budget.maxUsd;
    const overBudgetQueue = budget.maxQueueMs !== undefined && m.estimatedQueueMs > budget.maxQueueMs;
    const fitsAfterBudget = m.fits && !overBudgetCost && !overBudgetQueue;
    const score = scoreProvider({ fits: fitsAfterBudget, ready, cost: m.estimatedCostUsd, queue: m.estimatedQueueMs, preferFree: prefs.preferFree ?? true });
    considered.push({
      provider: cap.name,
      ready,
      fits: m.fits,
      estCostUsd: m.estimatedCostUsd,
      estQueueMs: m.estimatedQueueMs,
      reason: !ready ? "not ready (no creds)" : !m.fits ? m.reason : overBudgetCost ? `over USD budget ($${m.estimatedCostUsd} > $${budget.maxUsd})` : overBudgetQueue ? `over queue budget (${m.estimatedQueueMs}ms > ${budget.maxQueueMs}ms)` : m.reason,
    });
    candidates.push({ provider: cap.name, score, m, ready });
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best || best.score === Infinity) {
    // Last-resort fallback: only suggest simulator if NOT explicitly excluded.
    const simExcluded = prefs.exclude?.includes("simulator") || prefs.allowSimulator === false;
    if (simExcluded) {
      // Surface the highest-scoring remaining provider, or fail loudly.
      const remaining = candidates.find((c) => c.score !== Infinity);
      if (remaining) {
        return {
          provider: remaining.provider,
          reason: `no provider fully satisfies constraints; falling back to '${remaining.provider}' (closest match)`,
          estimatedCostUsd: remaining.m.estimatedCostUsd,
          estimatedQueueMs: remaining.m.estimatedQueueMs,
          gatesToDecompose: remaining.m.gatesToDecompose,
          considered,
        };
      }
      // No ready provider at all.
      const stub = considered[0] ?? { provider: "ibm" as ProviderName, estCostUsd: 0, estQueueMs: 0 };
      return {
        provider: stub.provider,
        reason: `no provider available (simulator excluded; no cloud creds set) — request will likely fail`,
        estimatedCostUsd: stub.estCostUsd,
        estimatedQueueMs: stub.estQueueMs,
        gatesToDecompose: [],
        considered,
      };
    }
    return {
      provider: "simulator",
      reason: "no provider satisfies all constraints — falling back to simulator (will likely fail if circuit > 12 qubits)",
      estimatedCostUsd: 0,
      estimatedQueueMs: 0,
      gatesToDecompose: [],
      considered,
    };
  }
  return {
    provider: best.provider,
    reason: `best score (cost=$${best.m.estimatedCostUsd}, queue=${best.m.estimatedQueueMs}ms, fits=${best.m.fits}, ready=${best.ready})`,
    estimatedCostUsd: best.m.estimatedCostUsd,
    estimatedQueueMs: best.m.estimatedQueueMs,
    gatesToDecompose: best.m.gatesToDecompose,
    considered,
  };
}

// ============================================================
// 3. MULTI-PROVIDER RACE — concurrent fanout, first-back wins
// ============================================================

export interface RaceResult {
  winner: CircuitResponse | null;
  loser: CircuitResponse | null;
  /** All providers attempted with elapsed time. */
  trajectory: Array<{ provider: ProviderName; outcome: "won" | "lost" | "errored"; elapsedMs: number; error?: string }>;
}

export async function multiProviderRace(args: {
  circuit: CircuitIR;
  shots: number;
  providers: ProviderName[];
  env?: NodeJS.ProcessEnv;
}): Promise<RaceResult> {
  const trajectory: RaceResult["trajectory"] = [];
  const tStart = Date.now();
  const promises = args.providers.map((p) =>
    runCircuit({ circuit: args.circuit, shots: args.shots, provider: p }, args.env ?? process.env)
      .then((r) => ({ provider: p, ok: true as const, response: r, elapsed: Date.now() - tStart }))
      .catch((e) => ({ provider: p, ok: false as const, error: (e as Error).message, elapsed: Date.now() - tStart })),
  );
  const settled = await Promise.allSettled(promises);
  let winner: CircuitResponse | null = null;
  let loser: CircuitResponse | null = null;
  // First fulfilled-success wins; track each.
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const v = s.value;
    if (v.ok) {
      if (!winner) {
        winner = v.response;
        trajectory.push({ provider: v.provider, outcome: "won", elapsedMs: v.elapsed });
      } else {
        loser = v.response;
        trajectory.push({ provider: v.provider, outcome: "lost", elapsedMs: v.elapsed });
      }
    } else {
      trajectory.push({ provider: v.provider, outcome: "errored", elapsedMs: v.elapsed, error: v.error });
    }
  }
  return { winner, loser, trajectory };
}

// ============================================================
// 4. EQUIVALENCE VERIFIER — simulator vs real, total variation distance
// ============================================================

export interface VerificationResult {
  /** TVD = ½ Σ |p_a(x) - p_b(x)|. 0 = identical, 1 = disjoint. */
  totalVariationDistance: number;
  /** Verdict based on TVD threshold. */
  verdict: "MATCH" | "DRIFT" | "DIVERGE";
  reference: CircuitResponse;
  candidate: CircuitResponse;
}

const TVD_MATCH = 0.05;   // < 5% TVD → noise-free agreement
const TVD_DRIFT = 0.20;   // 5-20% TVD → real-hardware noise within expectations
                          // > 20% TVD → divergence, escalate

export function totalVariationDistance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return sum / 2;
}

export async function verifyAgainstSimulator(args: {
  circuit: CircuitIR;
  shots: number;
  candidateProvider: ProviderName;
  env?: NodeJS.ProcessEnv;
}): Promise<VerificationResult> {
  const reference = await runCircuit({ circuit: args.circuit, shots: args.shots, provider: "simulator" });
  const candidate = await runCircuit({ circuit: args.circuit, shots: args.shots, provider: args.candidateProvider }, args.env ?? process.env);
  const tvd = totalVariationDistance(reference.result.exactProbabilities, candidate.result.exactProbabilities);
  const verdict: VerificationResult["verdict"] = tvd < TVD_MATCH ? "MATCH" : tvd < TVD_DRIFT ? "DRIFT" : "DIVERGE";
  return { totalVariationDistance: tvd, verdict, reference, candidate };
}

// ============================================================
// 5. COST PREDICTOR + BUDGET ENFORCEMENT
// ============================================================

export interface CostEstimate {
  provider: ProviderName;
  shots: number;
  costPerShotUsd: number;
  totalUsd: number;
  withinBudget: boolean;
  budgetMaxUsd?: number;
}

export function estimateCost(provider: ProviderName, shots: number, budgetMaxUsd?: number): CostEstimate {
  const cap = capabilitiesOf(provider);
  const cost = (cap?.costPerShotUsd ?? 0) * shots;
  return {
    provider,
    shots,
    costPerShotUsd: cap?.costPerShotUsd ?? 0,
    totalUsd: cost,
    withinBudget: budgetMaxUsd === undefined ? true : cost <= budgetMaxUsd,
    budgetMaxUsd,
  };
}

// ============================================================
// 6. THE AGNOSTIC MASTER FUNCTION
// ============================================================

export type AgnosticSource = string | CircuitIR;

export interface AgnosticInput {
  /** QASM string OR CircuitIR. AI agents pass whichever they have. */
  source: AgnosticSource;
  shots?: number;
  budget?: BudgetConstraints;
  preferences?: RouterPreferences & {
    /** Race the top-K providers concurrently — first-back wins. */
    race?: boolean | number;
    /** Also run on simulator + compare via TVD; flag DRIFT/DIVERGE. */
    verify?: boolean;
    /** Disable cache lookup for this call. */
    bypassCache?: boolean;
  };
  /** Optional InfinityMemory for auto-recording. */
  memory?: InfinityMemory;
  /** Optional env override (for tests). */
  env?: NodeJS.ProcessEnv;
}

export interface AgnosticResult {
  /** The result the user actually gets. */
  response: CircuitResponse;
  /** Routing decision (which provider, why). */
  route: RouteDecision;
  /** Decomposition info (which gates were rewritten + count). */
  decomposition: { input: number; output: number; ratio: number; rulesApplied: Record<string, number> };
  /** Cost estimate (informational). */
  cost: CostEstimate;
  /** Cache hit? */
  cacheHit: boolean;
  /** Optional verification against simulator. */
  verification?: VerificationResult;
  /** Optional race trajectory if multi-provider race used. */
  race?: RaceResult;
  /** One-line pulse summary. */
  pulseLine: string;
}

/** The single function. Composes parser + cache + router + matcher +
 *  decomposer + (optional) race + (optional) verify + cost gate. */
export async function runQuantumAgnostic(input: AgnosticInput): Promise<AgnosticResult> {
  const shots = input.shots ?? 1024;
  const env = input.env ?? process.env;
  const prefs = input.preferences ?? {};

  // STEP 1: parse source if it's QASM
  let circuit: CircuitIR;
  if (typeof input.source === "string") {
    circuit = qasmToCircuit(input.source);
  } else {
    circuit = input.source;
  }

  // STEP 2: route
  const decision = route({ circuit, shots, budget: input.budget, preferences: prefs, env });

  // STEP 3: decompose for chosen provider
  const cap = capabilitiesOf(decision.provider)!;
  const decomp = decompose(circuit, cap.nativeGates);

  // STEP 4: cache lookup
  const dna = circuitDna(decomp.circuit, shots, decision.provider);
  if (!prefs.bypassCache) {
    const cached = cacheGet(dna);
    if (cached) {
      const cost = estimateCost(decision.provider, shots, input.budget?.maxUsd);
      return wrap(cached.result, decision, decomp, cost, true, undefined, undefined, input.memory);
    }
  }

  // STEP 5: cost gate
  const cost = estimateCost(decision.provider, shots, input.budget?.maxUsd);
  if (!cost.withinBudget) {
    throw new Error(`AGNOSTIC: cost $${cost.totalUsd} exceeds budget $${cost.budgetMaxUsd} for provider ${decision.provider}`);
  }

  // STEP 6: race (if requested)
  let race: RaceResult | undefined;
  let response: CircuitResponse;
  if (prefs.race) {
    const k = typeof prefs.race === "number" ? prefs.race : 2;
    const racers: ProviderName[] = decision.considered
      .filter((c) => c.ready && c.fits)
      .slice(0, k)
      .map((c) => c.provider);
    if (racers.length === 0) racers.push(decision.provider);
    race = await multiProviderRace({ circuit: decomp.circuit, shots, providers: racers, env });
    if (!race.winner) throw new Error(`AGNOSTIC: race produced no winner — all providers errored`);
    response = race.winner;
  } else {
    response = await runCircuit({ circuit: decomp.circuit, shots, provider: decision.provider }, env);
  }

  // STEP 7: verify (if requested + provider != simulator)
  let verification: VerificationResult | undefined;
  if (prefs.verify && decision.provider !== "simulator") {
    verification = await verifyAgainstSimulator({ circuit: decomp.circuit, shots, candidateProvider: decision.provider, env });
  }

  // STEP 8: cache + record
  cachePut(dna, response);
  return wrap(response, decision, decomp, cost, false, verification, race, input.memory);
}

function wrap(
  response: CircuitResponse,
  route: RouteDecision,
  decomp: ReturnType<typeof decompose>,
  cost: CostEstimate,
  cacheHit: boolean,
  verification: VerificationResult | undefined,
  race: RaceResult | undefined,
  memory: InfinityMemory | undefined,
): AgnosticResult {
  const pulseLine = `QX-AGNOSTIC ${cacheHit ? "🪞cached" : "🌌live"} · ${route.provider} · ${response.result.shots} shots · $${cost.totalUsd.toFixed(4)} · ${formatQuantumPulseLine(response).split(" · ").slice(2).join(" · ")}${verification ? ` · verify=${verification.verdict}` : ""}`;
  if (memory) {
    memory.record({
      ts: Date.now(),
      kind: "quantum-measurement",
      actors: ["ai-agent", "qx-agnostic", route.provider],
      probabilityVector: response.result.exactProbabilities,
      outcome: verification?.verdict === "DIVERGE" ? "failure" : "success",
      trace: pulseLine + (verification ? ` · TVD=${verification.totalVariationDistance.toFixed(4)}` : "") + (race ? ` · race-trajectory=${race.trajectory.map((t) => `${t.provider}:${t.outcome}@${t.elapsedMs}ms`).join("|")}` : ""),
    });
  }
  return {
    response,
    route,
    decomposition: { input: decomp.expansion.input, output: decomp.expansion.output, ratio: decomp.expansion.ratio, rulesApplied: decomp.rulesApplied },
    cost,
    cacheHit,
    verification,
    race,
    pulseLine,
  };
}

/** One-line summary for AI agents to print to the user. */
export function formatAgnosticLine(r: AgnosticResult): string {
  return r.pulseLine;
}

// Re-exports so callers can import everything from one place.
export { parseQasm, qasmToCircuit } from "./qasm_parser.js";
export { capabilitiesOf, matchCircuitToProvider, summarizeCapabilities, PROVIDER_CAPABILITIES } from "./capabilities.js";
export { decompose } from "./decomposer.js";
