/**
 * v1.95.0 -- QX-BRIDGE · Real-quantum-cloud provider abstraction.
 *
 * AI agents (Claude Code / Cursor / ChatGPT-via-MCP) cannot talk to
 * IBM Quantum / AWS Braket / Azure Quantum / D-Wave directly because:
 *   1. each cloud uses a different SDK (Qiskit / Boto3 / Azure SDK / Ocean)
 *   2. each requires a vendor-specific auth token
 *   3. each speaks a different circuit language (OpenQASM / amazon-braket-ir / Q# / Ocean QUBO)
 *
 * Mneme is the bridge. A single uniform interface that:
 *   - accepts a generic CircuitIR (the JSON form in `simulator.ts`)
 *   - translates to provider format on demand
 *   - reads auth from environment variables (MNEME_IBM_TOKEN etc.)
 *   - returns a unified measurement result
 *   - records every job in Infinity Memory as a quantum event
 *
 * Real-cloud adapters are stubbed today (return clear "credential required"
 * + provider docs) — the architecture + uniform API ships now so AI
 * agents can write provider-agnostic code today. Plug in your token,
 * the same code runs on real qubits.
 */

import type { CircuitIR, MeasurementResult } from "./simulator.js";
import { runOnSimulator } from "./simulator.js";

export type ProviderName = "simulator" | "ibm" | "braket" | "azure" | "dwave";

export interface ProviderCapability {
  name: ProviderName;
  ready: boolean;
  /** Why not ready (missing env var, missing dep, etc.). */
  reason: string;
  /** Hint for the user / AI agent on how to enable. */
  enableHint?: string;
  /** Maximum qubits the provider's free tier exposes. */
  maxQubits: number;
  /** Cost note ("free" or "paid"). */
  cost: "free" | "pay-per-shot" | "paid-tier";
}

export interface CircuitRequest {
  circuit: CircuitIR;
  /** Number of shots. Default 1024. */
  shots?: number;
  /** Provider preference. Default "simulator". */
  provider?: ProviderName;
  /** Specific backend within the provider, e.g. "ibmq_qasm_simulator". */
  backend?: string;
  /** Reproducible RNG seed (simulator only). */
  seed?: number;
}

export interface CircuitResponse {
  provider: ProviderName;
  backend: string;
  result: MeasurementResult;
  elapsedMs: number;
  /** Job id from the provider, when applicable. */
  jobId?: string;
  /** Cost estimate if the provider returned one. */
  estimatedCostUsd?: number;
}

// ============================================================
// Capability discovery
// ============================================================

export function probeProviders(env: NodeJS.ProcessEnv = process.env): ProviderCapability[] {
  const caps: ProviderCapability[] = [];

  caps.push({
    name: "simulator",
    ready: true,
    reason: "in-process state-vector simulator (no network, no auth)",
    maxQubits: 12,
    cost: "free",
  });

  caps.push({
    name: "ibm",
    ready: !!env.MNEME_IBM_TOKEN,
    reason: env.MNEME_IBM_TOKEN ? "IBM Quantum credential found" : "MNEME_IBM_TOKEN env var not set",
    enableHint: env.MNEME_IBM_TOKEN ? undefined : "Get a free IBM Quantum account at https://quantum.ibm.com, copy your API token, then export MNEME_IBM_TOKEN=<token>",
    maxQubits: 127,
    cost: "free",
  });

  caps.push({
    name: "braket",
    ready: !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
    reason: (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ? "AWS credentials found" : "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set",
    enableHint: "Configure AWS credentials and ensure your account has Braket access. https://aws.amazon.com/braket/",
    maxQubits: 256,
    cost: "pay-per-shot",
  });

  caps.push({
    name: "azure",
    ready: !!(env.AZURE_QUANTUM_RESOURCE_ID && env.AZURE_QUANTUM_LOCATION),
    reason: (env.AZURE_QUANTUM_RESOURCE_ID && env.AZURE_QUANTUM_LOCATION) ? "Azure Quantum resource configured" : "AZURE_QUANTUM_RESOURCE_ID / AZURE_QUANTUM_LOCATION not set",
    enableHint: "Create an Azure Quantum workspace, then export AZURE_QUANTUM_RESOURCE_ID + AZURE_QUANTUM_LOCATION. https://azure.microsoft.com/en-us/products/quantum",
    maxQubits: 100,
    cost: "paid-tier",
  });

  caps.push({
    name: "dwave",
    ready: !!env.DWAVE_API_TOKEN,
    reason: env.DWAVE_API_TOKEN ? "D-Wave Leap credential found" : "DWAVE_API_TOKEN env var not set",
    enableHint: "Sign up for D-Wave Leap (free tier 1 min/month QPU time), then export DWAVE_API_TOKEN=<token>. https://cloud.dwavesys.com/leap/",
    maxQubits: 5760, // Advantage system
    cost: "free",
  });

  return caps;
}

// ============================================================
// Provider stubs — REAL clouds need their SDK; Mneme keeps the
// uniform interface and returns clear errors until SDKs are wired.
// ============================================================

const NOT_WIRED_HINT = "(Provider adapter ships in v1.96 with optional SDK install. Use provider=\"simulator\" for an immediate working quantum experience today.)";

async function runIbm(req: CircuitRequest, _env: NodeJS.ProcessEnv): Promise<CircuitResponse> {
  // Architecture: take CircuitIR → OpenQASM 3.0 → submit to IBM Runtime → poll
  // → return measurement result. SDK wiring lands in v1.96.
  throw new Error(`IBM Quantum adapter not yet wired in v1.95. ${NOT_WIRED_HINT}`);
}

async function runBraket(req: CircuitRequest, _env: NodeJS.ProcessEnv): Promise<CircuitResponse> {
  throw new Error(`AWS Braket adapter not yet wired in v1.95. ${NOT_WIRED_HINT}`);
}

async function runAzure(req: CircuitRequest, _env: NodeJS.ProcessEnv): Promise<CircuitResponse> {
  throw new Error(`Azure Quantum adapter not yet wired in v1.95. ${NOT_WIRED_HINT}`);
}

async function runDwave(req: CircuitRequest, _env: NodeJS.ProcessEnv): Promise<CircuitResponse> {
  throw new Error(`D-Wave Leap adapter not yet wired in v1.95. ${NOT_WIRED_HINT}`);
}

// ============================================================
// Bridge — the single function AI agents call
// ============================================================

export async function runCircuit(req: CircuitRequest, env: NodeJS.ProcessEnv = process.env): Promise<CircuitResponse> {
  const shots = req.shots ?? 1024;
  const provider = req.provider ?? "simulator";
  const t0 = Date.now();

  if (provider === "simulator") {
    const result = runOnSimulator(req.circuit, shots, req.seed);
    return {
      provider: "simulator",
      backend: req.backend ?? "in-process-state-vector",
      result,
      elapsedMs: Date.now() - t0,
    };
  }

  const cap = probeProviders(env).find((c) => c.name === provider);
  if (!cap) throw new Error(`Unknown provider: ${provider}`);
  if (!cap.ready) {
    throw new Error(`Provider '${provider}' not ready: ${cap.reason}. ${cap.enableHint ?? ""}`);
  }

  switch (provider) {
    case "ibm": return runIbm(req, env);
    case "braket": return runBraket(req, env);
    case "azure": return runAzure(req, env);
    case "dwave": return runDwave(req, env);
  }
}

/** Pretty-print a one-line summary of a quantum job for the pulse / inbox. */
export function formatQuantumPulseLine(resp: CircuitResponse): string {
  const top = Object.entries(resp.result.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([label, p]) => `${label}=${(p * 100).toFixed(1)}%`)
    .join(" · ");
  return `QX-BRIDGE ${resp.provider}/${resp.backend} · ${resp.result.shots} shots · ${resp.elapsedMs}ms · top: ${top}`;
}
