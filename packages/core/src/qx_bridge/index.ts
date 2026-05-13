/**
 * v1.95.0 -- QX-BRIDGE: the universal MCP→quantum-cloud bridge.
 *
 *   "An AI agent walks into a quantum computer..."
 *
 * AI agent (Claude Code / Cursor / ChatGPT-via-MCP) → Mneme MCP →
 *   QX-BRIDGE → {simulator | IBM Quantum | AWS Braket | Azure Quantum | D-Wave Leap}
 *               → measurement (probability vector) → Infinity Memory → user
 *
 * Today (v1.95):
 *   ✓ simulator (pure-TS state-vector) works for up to 12 qubits
 *   ✓ provider abstraction + capability probe
 *   ✓ uniform CircuitIR → AI agents write provider-agnostic code
 *   ✓ auto-record measurements as quantum events in Infinity Memory
 *   ✓ famous circuit constructors (Bell, GHZ, Grover-2q)
 *   ⏳ real-cloud adapters land in v1.96 (need SDK install + token)
 *
 * The architecture proves the path: Mneme is the universal protocol
 * layer between AI agents and quantum hardware.
 */

export * from "./simulator.js";
export * from "./providers.js";

import { runCircuit as runCircuitProvider, type CircuitRequest, type CircuitResponse, formatQuantumPulseLine } from "./providers.js";
import type { InfinityMemory } from "../qx_supernova/infinity_memory.js";

export interface BridgeRunOptions {
  /** Optional InfinityMemory instance — every job auto-recorded as a quantum event with probability vector. */
  memory?: InfinityMemory;
  /** Free-form trace text appended to the recorded event. */
  trace?: string;
  /** Override the actor list on the recorded event. Default: ["ai-agent", provider]. */
  actors?: string[];
}

/** The bridge function AI agents call. Wraps the provider runCircuit
 *  + auto-records into Infinity Memory if provided.
 *
 *  Example:
 *    const resp = await runQuantumCircuit({
 *      circuit: bellPairCircuit(),
 *      shots: 1024,
 *      provider: "simulator",
 *    }, { memory });
 */
export async function runQuantumCircuit(req: CircuitRequest, opts: BridgeRunOptions = {}): Promise<CircuitResponse> {
  const resp = await runCircuitProvider(req);
  if (opts.memory) {
    opts.memory.record({
      ts: Date.now(),
      kind: "quantum-measurement",
      actors: opts.actors ?? ["ai-agent", resp.provider],
      probabilityVector: resp.result.exactProbabilities,
      outcome: "success",
      trace: opts.trace ?? `${resp.provider}/${resp.backend} · ${resp.result.shots} shots · ${formatQuantumPulseLine(resp)}`,
    });
  }
  return resp;
}

export { formatQuantumPulseLine };

/** Quick-fire helpers for AI agents that want a one-line invocation. */
export async function runBellPair(opts: { shots?: number; memory?: InfinityMemory; provider?: "simulator" | "ibm" | "braket" | "azure" | "dwave" } = {}): Promise<CircuitResponse> {
  const { bellPairCircuit } = await import("./simulator.js");
  return runQuantumCircuit({ circuit: bellPairCircuit(), shots: opts.shots ?? 1024, provider: opts.provider ?? "simulator" }, { memory: opts.memory });
}

export async function runGhz(numQubits: number, opts: { shots?: number; memory?: InfinityMemory } = {}): Promise<CircuitResponse> {
  const { ghzCircuit } = await import("./simulator.js");
  return runQuantumCircuit({ circuit: ghzCircuit(numQubits), shots: opts.shots ?? 1024, provider: "simulator" }, { memory: opts.memory });
}

export async function runGrover2q(target: "00" | "01" | "10" | "11" = "11", opts: { shots?: number; memory?: InfinityMemory } = {}): Promise<CircuitResponse> {
  const { groverCircuit2q } = await import("./simulator.js");
  return runQuantumCircuit({ circuit: groverCircuit2q(target), shots: opts.shots ?? 1024, provider: "simulator" }, { memory: opts.memory });
}
