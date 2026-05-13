/**
 * v1.96.0 -- QX-BRIDGE · Provider capability matrix + circuit matcher.
 *
 * Each real quantum hardware vendor ships only a small set of NATIVE
 * gates. Everything else must be decomposed before submission. Mneme's
 * agnostic layer needs to know:
 *   - What's the gate set per provider?
 *   - What's the qubit topology / max?
 *   - What's the typical queue + cost?
 *
 * This file is the source of truth. Update when vendor SDKs land in v1.96+.
 */

import type { CircuitIR, GateName } from "./simulator.js";
import type { ProviderName } from "./providers.js";

export interface ProviderCapabilities {
  name: ProviderName;
  /** Maximum qubits this provider's free/default tier exposes. */
  maxQubits: number;
  /** Gates that run NATIVELY without decomposition. */
  nativeGates: GateName[];
  /** Estimated time before a job starts running (queue), in ms. Best-effort. */
  estimatedQueueMs: number;
  /** Cost per shot in USD. 0 = free tier. */
  costPerShotUsd: number;
  /** Whether the provider supports parametric gates (rx/ry/rz with arbitrary θ). */
  supportsParametric: boolean;
  /** Whether the provider is an annealer (D-Wave) — only QUBO/Ising, not gate model. */
  isAnnealer: boolean;
  /** Notes for AI agents / users. */
  notes?: string;
}

/** Authoritative capability table. */
export const PROVIDER_CAPABILITIES: ProviderCapabilities[] = [
  {
    name: "simulator",
    maxQubits: 12,
    nativeGates: ["h", "x", "y", "z", "s", "t", "cnot", "cz", "rx", "ry", "rz"],
    estimatedQueueMs: 0,
    costPerShotUsd: 0,
    supportsParametric: true,
    isAnnealer: false,
    notes: "Pure-TS state-vector simulator. No queue, no auth, deterministic with seed.",
  },
  {
    name: "ibm",
    maxQubits: 127,
    // Realistic IBM Heron / Eagle native set: id, rz, sx, x, cx (2024+).
    // Mneme decomposes h/y/z/s/t/cz/swap into these before submitting.
    nativeGates: ["x", "rz", "cnot"],
    estimatedQueueMs: 600_000, // 10 min typical free-tier queue
    costPerShotUsd: 0,
    supportsParametric: true,
    isAnnealer: false,
    notes: "Free 127-qubit (Eagle) backends. Free-tier queue can be 10-60 min.",
  },
  {
    name: "braket",
    maxQubits: 256,
    // IonQ Forte gateset + Rigetti Aspen + OQC Lucy — superset is wide
    nativeGates: ["x", "y", "z", "h", "s", "t", "cnot", "rx", "ry", "rz"],
    estimatedQueueMs: 30_000,
    costPerShotUsd: 0.0003, // IonQ Aria typical pricing
    supportsParametric: true,
    isAnnealer: false,
    notes: "Pay-per-shot. Pricing varies by backend (IonQ ~$0.0003/shot, Rigetti ~$0.00035/shot).",
  },
  {
    name: "azure",
    maxQubits: 100,
    nativeGates: ["x", "y", "z", "h", "cnot", "rx", "ry", "rz"],
    estimatedQueueMs: 60_000,
    costPerShotUsd: 0.0002,
    supportsParametric: true,
    isAnnealer: false,
    notes: "Multi-vendor (IonQ, Quantinuum, Pasqal, Rigetti). Paid-tier required.",
  },
  {
    name: "dwave",
    maxQubits: 5760,
    // D-Wave is an annealer — no gate model. Mneme will refuse to route
    // a gate-model circuit here.
    nativeGates: [],
    estimatedQueueMs: 1_000,
    costPerShotUsd: 0,
    supportsParametric: false,
    isAnnealer: true,
    notes: "Annealer (Advantage 5760-qubit). Free tier 1 min/month QPU. Accepts QUBO/Ising only — gate-model circuits will be REJECTED until v1.97 ships QUBO translator.",
  },
];

export function capabilitiesOf(name: ProviderName): ProviderCapabilities | null {
  return PROVIDER_CAPABILITIES.find((c) => c.name === name) ?? null;
}

export interface MatchResult {
  fits: boolean;
  reason: string;
  /** Gates in the circuit that aren't native to this provider. */
  gatesToDecompose: GateName[];
  /** Queue + cost estimates if we ran this circuit on this provider. */
  estimatedQueueMs: number;
  estimatedCostUsd: number;
  /** Critical issues that block running entirely (hard fail). */
  blockingIssues: string[];
}

/** Check whether a circuit can run on a given provider. Returns a structured
 *  match result with issues + decomposition needs. Pure function. */
export function matchCircuitToProvider(
  circuit: CircuitIR,
  provider: ProviderName,
  shots: number,
): MatchResult {
  const caps = capabilitiesOf(provider);
  if (!caps) {
    return { fits: false, reason: `unknown provider ${provider}`, gatesToDecompose: [], estimatedQueueMs: 0, estimatedCostUsd: 0, blockingIssues: [`unknown provider ${provider}`] };
  }
  const blocking: string[] = [];

  if (caps.isAnnealer) {
    blocking.push(`provider '${provider}' is an annealer (no gate model support). Use QUBO translator (v1.97).`);
  }
  if (circuit.numQubits > caps.maxQubits) {
    blocking.push(`circuit needs ${circuit.numQubits} qubits but ${provider} max is ${caps.maxQubits}`);
  }
  const native = new Set(caps.nativeGates);
  const usedGates = new Set<GateName>();
  for (const g of circuit.gates) usedGates.add(g.type);
  const toDecompose: GateName[] = [];
  for (const g of usedGates) {
    if (!native.has(g)) toDecompose.push(g);
  }

  const estCost = caps.costPerShotUsd * shots;
  const estQueue = caps.estimatedQueueMs;

  return {
    fits: blocking.length === 0,
    reason: blocking.length > 0
      ? blocking.join(" · ")
      : toDecompose.length > 0
        ? `fits after decomposing ${toDecompose.length} gate type(s): ${toDecompose.join(", ")}`
        : `fits natively (no decomposition needed)`,
    gatesToDecompose: toDecompose,
    estimatedQueueMs: estQueue,
    estimatedCostUsd: estCost,
    blockingIssues: blocking,
  };
}

/** One-line capability summary for AI agents / pulse output. */
export function summarizeCapabilities(): string {
  return PROVIDER_CAPABILITIES.map((c) => `${c.name}(${c.maxQubits}q · $${c.costPerShotUsd}/shot · ${Math.round(c.estimatedQueueMs / 1000)}s queue${c.isAnnealer ? " · annealer" : ""})`).join(" · ");
}
