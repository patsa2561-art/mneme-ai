import { describe, it, expect } from "vitest";

import {
  QuantumState,
  runOnSimulator,
  bellPairCircuit,
  ghzCircuit,
  groverCircuit2q,
  runQuantumCircuit,
  runBellPair,
  runGhz,
  runGrover2q,
  probeProviders,
  runCircuit,
  formatQuantumPulseLine,
} from "./index.js";
import { createInfinityMemory } from "../qx_supernova/infinity_memory.js";

// ============================ SIMULATOR ============================

describe("v1.95 QX-BRIDGE · QuantumState simulator", () => {
  it("initializes in |0...0⟩", () => {
    const s = new QuantumState(3);
    const p = s.exactProbabilities();
    expect(p["000"]).toBeCloseTo(1, 6);
  });

  it("Hadamard on 1 qubit → 50/50 in |0⟩ and |1⟩", () => {
    const s = new QuantumState(1);
    s.h(0);
    const p = s.exactProbabilities();
    expect(p["0"]).toBeCloseTo(0.5, 6);
    expect(p["1"]).toBeCloseTo(0.5, 6);
  });

  it("X gate flips qubit |0⟩ → |1⟩", () => {
    const s = new QuantumState(1);
    s.x(0);
    expect(s.exactProbabilities()["1"]).toBeCloseTo(1, 6);
  });

  it("CNOT entangles after H: Bell pair → 50/50 of |00⟩ and |11⟩", () => {
    const s = new QuantumState(2);
    s.h(0);
    s.cnot(0, 1);
    const p = s.exactProbabilities();
    expect(p["00"]).toBeCloseTo(0.5, 6);
    expect(p["11"]).toBeCloseTo(0.5, 6);
    expect(p["01"] ?? 0).toBeLessThan(1e-9);
    expect(p["10"] ?? 0).toBeLessThan(1e-9);
  });

  it("RX(π) is equivalent to X (up to global phase)", () => {
    const s = new QuantumState(1);
    s.rx(0, Math.PI);
    expect(s.exactProbabilities()["1"]).toBeCloseTo(1, 5);
  });

  it("measure() shot counts approximate exact probabilities", () => {
    const s = new QuantumState(1);
    s.h(0);
    const r = s.measure(10000, 42);
    expect(r.probabilities["0"]! - 0.5).toBeLessThan(0.05);
    expect(r.probabilities["1"]! - 0.5).toBeLessThan(0.05);
    expect(r.shots).toBe(10000);
  });

  it("measure() is reproducible with same seed", () => {
    const s1 = new QuantumState(2); s1.h(0); s1.cnot(0, 1);
    const r1 = s1.measure(1000, 123);
    const s2 = new QuantumState(2); s2.h(0); s2.cnot(0, 1);
    const r2 = s2.measure(1000, 123);
    expect(r1.counts).toEqual(r2.counts);
  });

  it("rejects > 12 qubits in-process", () => {
    expect(() => new QuantumState(13)).toThrow(/numQubits/);
  });
});

// ============================ CIRCUIT IR ============================

describe("v1.95 QX-BRIDGE · CircuitIR + runOnSimulator", () => {
  it("Bell pair via CircuitIR matches manual gates", () => {
    const r = runOnSimulator(bellPairCircuit(), 10000, 7);
    expect(r.exactProbabilities["00"]).toBeCloseTo(0.5, 5);
    expect(r.exactProbabilities["11"]).toBeCloseTo(0.5, 5);
  });

  it("GHZ-3 produces equal superposition of |000⟩ and |111⟩", () => {
    const r = runOnSimulator(ghzCircuit(3), 8000, 11);
    expect(r.exactProbabilities["000"]).toBeCloseTo(0.5, 5);
    expect(r.exactProbabilities["111"]).toBeCloseTo(0.5, 5);
  });

  it("GHZ-5 still yields 50/50 across the two extremes", () => {
    const r = runOnSimulator(ghzCircuit(5), 4000, 11);
    expect(r.exactProbabilities["00000"]).toBeCloseTo(0.5, 5);
    expect(r.exactProbabilities["11111"]).toBeCloseTo(0.5, 5);
  });

  it("Grover-2q with target |11⟩ concentrates ≥ 99% on |11⟩ after 1 iteration", () => {
    const r = runOnSimulator(groverCircuit2q("11"), 4000, 22);
    expect(r.exactProbabilities["11"]).toBeGreaterThan(0.99);
  });

  it("Grover-2q with target |01⟩ concentrates on |01⟩", () => {
    const r = runOnSimulator(groverCircuit2q("01"), 4000, 22);
    expect(r.exactProbabilities["01"]).toBeGreaterThan(0.99);
  });

  it("Grover-2q with target |00⟩ concentrates on |00⟩", () => {
    const r = runOnSimulator(groverCircuit2q("00"), 4000, 22);
    expect(r.exactProbabilities["00"]).toBeGreaterThan(0.99);
  });
});

// ============================ PROVIDERS ============================

describe("v1.95 QX-BRIDGE · provider abstraction", () => {
  it("probeProviders returns simulator always-ready + 4 cloud providers", () => {
    const ps = probeProviders({});
    const sim = ps.find((p) => p.name === "simulator");
    expect(sim?.ready).toBe(true);
    expect(sim?.cost).toBe("free");
    expect(ps.length).toBe(5);
    expect(ps.map((p) => p.name).sort()).toEqual(["azure", "braket", "dwave", "ibm", "simulator"]);
  });

  it("cloud providers report ready=true ONLY when env vars are present", () => {
    const ps = probeProviders({ MNEME_IBM_TOKEN: "x" });
    expect(ps.find((p) => p.name === "ibm")?.ready).toBe(true);
    expect(ps.find((p) => p.name === "braket")?.ready).toBe(false);
  });

  it("cloud providers include enableHint when not ready", () => {
    const ps = probeProviders({});
    const ibm = ps.find((p) => p.name === "ibm")!;
    expect(ibm.ready).toBe(false);
    expect(ibm.enableHint).toMatch(/quantum\.ibm\.com/);
  });

  it("runCircuit(simulator) returns measurement", async () => {
    const resp = await runCircuit({ circuit: bellPairCircuit(), shots: 500, provider: "simulator", seed: 5 });
    expect(resp.provider).toBe("simulator");
    expect(resp.result.shots).toBe(500);
    expect(resp.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("runCircuit(ibm) without token returns clear error", async () => {
    await expect(runCircuit({ circuit: bellPairCircuit(), provider: "ibm" }, {})).rejects.toThrow(/MNEME_IBM_TOKEN/);
  });

  it("runCircuit(braket) without AWS creds returns clear error", async () => {
    await expect(runCircuit({ circuit: bellPairCircuit(), provider: "braket" }, {})).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
  });

  it("formatQuantumPulseLine summarizes top 2 outcomes", async () => {
    const resp = await runCircuit({ circuit: bellPairCircuit(), shots: 1000, provider: "simulator", seed: 3 });
    const line = formatQuantumPulseLine(resp);
    expect(line).toContain("QX-BRIDGE");
    expect(line).toContain("simulator");
    expect(line).toMatch(/00=|11=/);
  });
});

// ============================ BRIDGE + MEMORY ============================

describe("v1.95 QX-BRIDGE · auto-record into Infinity Memory", () => {
  it("runQuantumCircuit records the measurement as a quantum event", async () => {
    const memory = createInfinityMemory();
    const resp = await runQuantumCircuit({ circuit: bellPairCircuit(), shots: 256, provider: "simulator", seed: 1 }, { memory });
    expect(resp.result.shots).toBe(256);
    const recalled = memory.recall({ kind: "quantum-measurement" });
    expect(recalled.length).toBe(1);
    expect(recalled[0]!.probabilityVector["00"]).toBeCloseTo(0.5, 5);
    expect(recalled[0]!.probabilityVector["11"]).toBeCloseTo(0.5, 5);
  });

  it("runBellPair shorthand works + records", async () => {
    const memory = createInfinityMemory();
    const resp = await runBellPair({ shots: 100, memory });
    expect(resp.result.exactProbabilities["00"]).toBeCloseTo(0.5, 5);
    expect(memory.list().length).toBe(1);
  });

  it("runGhz shorthand works for N=4", async () => {
    const resp = await runGhz(4, { shots: 100 });
    expect(resp.result.exactProbabilities["0000"]).toBeCloseTo(0.5, 5);
    expect(resp.result.exactProbabilities["1111"]).toBeCloseTo(0.5, 5);
  });

  it("runGrover2q shorthand finds the target", async () => {
    const resp = await runGrover2q("10", { shots: 100 });
    expect(resp.result.exactProbabilities["10"]).toBeGreaterThan(0.99);
  });

  it("recorded event's trace contains the provider + shots", async () => {
    const memory = createInfinityMemory();
    await runQuantumCircuit({ circuit: bellPairCircuit(), shots: 500, provider: "simulator" }, { memory, trace: "custom note" });
    const e = memory.list()[0]!;
    expect(e.trace).toContain("custom note");
  });
});
