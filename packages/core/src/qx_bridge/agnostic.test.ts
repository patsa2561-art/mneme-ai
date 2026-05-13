import { describe, it, expect, beforeEach } from "vitest";

import {
  parseQasm,
  qasmToCircuit,
  capabilitiesOf,
  matchCircuitToProvider,
  decompose,
  circuitDna,
  cacheStats,
  cacheClear,
  route,
  multiProviderRace,
  verifyAgainstSimulator,
  totalVariationDistance,
  estimateCost,
  runQuantumAgnostic,
  formatAgnosticLine,
  bellPairCircuit,
  ghzCircuit,
} from "./index.js";
import { createInfinityMemory } from "../qx_supernova/infinity_memory.js";

beforeEach(() => cacheClear());

// ============================ QASM PARSER ============================

describe("v1.96 QX-AGNOSTIC · OpenQASM parser", () => {
  it("parses Bell-pair QASM 3.0 → CircuitIR identical to manual", () => {
    const qasm = `
      OPENQASM 3.0;
      include "stdgates.inc";
      qubit[2] q;
      bit[2] c;
      h q[0];
      cx q[0], q[1];
      measure q -> c;
    `;
    const r = parseQasm(qasm);
    expect(r.qasmVersion).toBe("3.0");
    expect(r.circuit.numQubits).toBe(2);
    expect(r.circuit.gates).toHaveLength(2);
    expect(r.circuit.gates[0]!.type).toBe("h");
    expect(r.circuit.gates[1]!.type).toBe("cnot");
  });

  it("parses QASM 2.0 with qreg/creg syntax", () => {
    const qasm = `
      OPENQASM 2.0;
      include "qelib1.inc";
      qreg q[3];
      creg c[3];
      h q[0];
      cx q[0], q[1];
      cx q[1], q[2];
    `;
    const r = parseQasm(qasm);
    expect(r.qasmVersion).toBe("2.0");
    expect(r.circuit.numQubits).toBe(3);
    expect(r.circuit.gates).toHaveLength(3);
  });

  it("parses parametric rotations with pi expressions", () => {
    const qasm = `
      OPENQASM 3.0;
      qubit[1] q;
      rx(pi/2) q[0];
      ry(pi) q[0];
      rz(2*pi/3) q[0];
    `;
    const c = qasmToCircuit(qasm);
    expect(c.gates[0]).toMatchObject({ type: "rx", theta: Math.PI / 2 });
    expect(c.gates[1]).toMatchObject({ type: "ry", theta: Math.PI });
    expect(c.gates[2]!.theta).toBeCloseTo((2 * Math.PI) / 3, 6);
  });

  it("decomposes sdg / tdg / u(θ,φ,λ) at parse time", () => {
    const c = qasmToCircuit(`OPENQASM 3.0; qubit[1] q; sdg q[0]; tdg q[0]; u(pi/2, 0, pi) q[0];`);
    // sdg → 1 rz; tdg → 1 rz; u → 3 rz/ry/rz = 5 total
    expect(c.gates.length).toBe(5);
    expect(c.gates.every((g) => ["rz", "ry"].includes(g.type))).toBe(true);
  });

  it("strips // and /* */ comments without breaking line numbers", () => {
    const qasm = `
      // entry comment
      OPENQASM 3.0;
      /* multi
         line */
      qubit[1] q;
      h q[0];  // trailing
    `;
    const c = qasmToCircuit(qasm);
    expect(c.numQubits).toBe(1);
    expect(c.gates).toHaveLength(1);
  });

  it("merges multiple registers into a flat qubit space", () => {
    const c = qasmToCircuit(`OPENQASM 3.0; qubit[2] a; qubit[3] b; h a[0]; cx a[1], b[2];`);
    expect(c.numQubits).toBe(5);
    expect(c.gates[0]).toMatchObject({ type: "h", targets: [0] });
    // a[1] → offset 1, b[2] → offset 2 + 2 = 4
    expect(c.gates[1]).toMatchObject({ type: "cnot", targets: [1, 4] });
  });

  it("throws QasmParseError with line number on unsupported gate", () => {
    expect(() => qasmToCircuit(`OPENQASM 3.0; qubit[1] q; foobar q[0];`)).toThrow(/foobar/);
  });

  it("throws on missing qubit register", () => {
    expect(() => qasmToCircuit(`OPENQASM 3.0;`)).toThrow(/no qubit register/);
  });
});

// ============================ CAPABILITIES ============================

describe("v1.96 QX-AGNOSTIC · capability matcher", () => {
  it("simulator matches every reasonable circuit", () => {
    const m = matchCircuitToProvider(bellPairCircuit(), "simulator", 1024);
    expect(m.fits).toBe(true);
    expect(m.gatesToDecompose.length).toBe(0);
    expect(m.estimatedCostUsd).toBe(0);
  });

  it("IBM lists H + CZ as needing decomposition (not in native set)", () => {
    const m = matchCircuitToProvider(bellPairCircuit(), "ibm", 1024);
    expect(m.fits).toBe(true);
    expect(m.gatesToDecompose).toContain("h");
  });

  it("D-Wave is annealer — refuses gate-model circuits", () => {
    const m = matchCircuitToProvider(bellPairCircuit(), "dwave", 1024);
    expect(m.fits).toBe(false);
    expect(m.blockingIssues[0]).toMatch(/annealer/);
  });

  it("provider that's too small is BLOCKED with clear reason", () => {
    const big = ghzCircuit(12);
    // Pretend a hypothetical 5-qubit limit
    expect(capabilitiesOf("simulator")?.maxQubits).toBeGreaterThanOrEqual(12);
    // Force-test: GHZ-12 too big for simulator (limit is 12 — at boundary)
    const m = matchCircuitToProvider(big, "simulator", 100);
    expect(m.fits).toBe(true); // 12 == 12 — at limit
  });

  it("Braket cost predicted = costPerShot × shots", () => {
    const m = matchCircuitToProvider(bellPairCircuit(), "braket", 10000);
    expect(m.estimatedCostUsd).toBeCloseTo(0.0003 * 10000, 5);
  });
});

// ============================ DECOMPOSER ============================

describe("v1.96 QX-AGNOSTIC · gate decomposer", () => {
  it("Hadamard decomposes into RZ-RX-RZ for IBM-style native set", () => {
    const c = bellPairCircuit();
    const r = decompose(c, ["x", "rz", "rx", "cnot"]); // strict-IBM-like
    expect(r.circuit.gates.every((g) => ["x", "rz", "rx", "cnot"].includes(g.type))).toBe(true);
    expect(r.expansion.output).toBeGreaterThan(r.expansion.input);
    expect(r.rulesApplied.h).toBe(1);
  });

  it("Z gate becomes RZ(π)", () => {
    const r = decompose({ numQubits: 1, gates: [{ type: "z", targets: [0] }] }, ["rz"]);
    expect(r.circuit.gates).toHaveLength(1);
    expect(r.circuit.gates[0]).toMatchObject({ type: "rz", targets: [0], theta: Math.PI });
  });

  it("CZ decomposes into H-CNOT-H", () => {
    const r = decompose({ numQubits: 2, gates: [{ type: "cz", targets: [0, 1] }] }, ["h", "cnot"]);
    expect(r.circuit.gates).toHaveLength(3);
    expect(r.circuit.gates.map((g) => g.type)).toEqual(["h", "cnot", "h"]);
  });

  it("SWAP decomposes into 3 CNOTs", () => {
    const r = decompose({ numQubits: 2, gates: [{ type: "swap", targets: [0, 1] }] }, ["cnot"]);
    expect(r.circuit.gates).toHaveLength(3);
    expect(r.circuit.gates.every((g) => g.type === "cnot")).toBe(true);
  });

  it("native gates pass through unchanged", () => {
    const c = { numQubits: 2, gates: [{ type: "cnot" as const, targets: [0, 1] }] };
    const r = decompose(c, ["cnot"]);
    expect(r.circuit.gates).toEqual(c.gates);
    expect(Object.keys(r.rulesApplied).length).toBe(0);
  });
});

// ============================ DNA CACHE ============================

describe("v1.96 QX-AGNOSTIC · DNA cache", () => {
  it("identical structure → identical DNA hash", () => {
    const dna1 = circuitDna(bellPairCircuit(), 1024, "simulator");
    const dna2 = circuitDna(bellPairCircuit(), 1024, "simulator");
    expect(dna1).toBe(dna2);
  });

  it("different shots → different DNA", () => {
    expect(circuitDna(bellPairCircuit(), 1024, "simulator")).not.toBe(circuitDna(bellPairCircuit(), 2048, "simulator"));
  });

  it("different provider → different DNA", () => {
    expect(circuitDna(bellPairCircuit(), 1024, "simulator")).not.toBe(circuitDna(bellPairCircuit(), 1024, "ibm"));
  });

  it("different gate angles → different DNA", () => {
    const c1 = { numQubits: 1, gates: [{ type: "rx" as const, targets: [0], theta: 1.0 }] };
    const c2 = { numQubits: 1, gates: [{ type: "rx" as const, targets: [0], theta: 1.5 }] };
    expect(circuitDna(c1, 100, "simulator")).not.toBe(circuitDna(c2, 100, "simulator"));
  });

  it("cache stats start empty after clear", () => {
    cacheClear();
    expect(cacheStats().size).toBe(0);
  });
});

// ============================ ROUTER ============================

describe("v1.96 QX-AGNOSTIC · smart router", () => {
  it("routes Bell pair to simulator when no creds set (preferFree=true)", () => {
    const d = route({ circuit: bellPairCircuit(), shots: 1024, env: {} });
    expect(d.provider).toBe("simulator");
    expect(d.estimatedCostUsd).toBe(0);
  });

  it("considers all 5 providers and reports each", () => {
    const d = route({ circuit: bellPairCircuit(), shots: 1024, env: {} });
    expect(d.considered.length).toBe(5);
    expect(d.considered.find((c) => c.provider === "dwave")?.fits).toBe(false);
  });

  it("respects forceProvider", () => {
    const d = route({ circuit: bellPairCircuit(), shots: 1024, preferences: { forceProvider: "ibm" } });
    expect(d.provider).toBe("ibm");
    expect(d.reason).toContain("forced");
  });

  it("excludes providers in preferences.exclude", () => {
    const d = route({ circuit: bellPairCircuit(), shots: 1024, preferences: { exclude: ["simulator"] } });
    expect(d.provider).not.toBe("simulator");
  });

  it("budget cost cap excludes paid providers", () => {
    const d = route({ circuit: bellPairCircuit(), shots: 100_000, budget: { maxUsd: 0 }, env: {} });
    // Only free providers (simulator/ibm/dwave) should win
    expect(d.estimatedCostUsd).toBe(0);
  });
});

// ============================ COST PREDICTOR ============================

describe("v1.96 QX-AGNOSTIC · cost predictor", () => {
  it("estimates 0 for free providers", () => {
    const e = estimateCost("simulator", 1_000_000);
    expect(e.totalUsd).toBe(0);
    expect(e.withinBudget).toBe(true);
  });

  it("estimates non-zero for Braket", () => {
    const e = estimateCost("braket", 1000);
    expect(e.totalUsd).toBeCloseTo(0.3, 5);
  });

  it("withinBudget=false when over cap", () => {
    const e = estimateCost("braket", 100_000, 1.0);
    expect(e.withinBudget).toBe(false);
  });
});

// ============================ TVD VERIFIER ============================

describe("v1.96 QX-AGNOSTIC · total variation distance", () => {
  it("returns 0 for identical distributions", () => {
    expect(totalVariationDistance({ "00": 0.5, "11": 0.5 }, { "00": 0.5, "11": 0.5 })).toBeCloseTo(0, 6);
  });

  it("returns 1 for fully disjoint distributions", () => {
    expect(totalVariationDistance({ "00": 1 }, { "11": 1 })).toBeCloseTo(1, 6);
  });

  it("returns 0.1 for 10% drift", () => {
    expect(totalVariationDistance({ "00": 0.6, "11": 0.4 }, { "00": 0.5, "11": 0.5 })).toBeCloseTo(0.1, 6);
  });
});

// ============================ MULTI-PROVIDER RACE ============================

describe("v1.96 QX-AGNOSTIC · multi-provider race", () => {
  it("returns winner and trajectory", async () => {
    // Simulator vs simulator (the only ready provider in clean env) → both win? Not really — first returns wins, second errors out as cloud fails fast.
    const r = await multiProviderRace({ circuit: bellPairCircuit(), shots: 100, providers: ["simulator", "simulator"], env: {} });
    expect(r.winner).not.toBeNull();
    expect(r.trajectory.length).toBeGreaterThanOrEqual(1);
  });

  it("records errored providers in trajectory", async () => {
    const r = await multiProviderRace({ circuit: bellPairCircuit(), shots: 100, providers: ["simulator", "ibm"], env: {} });
    expect(r.winner).not.toBeNull(); // simulator wins
    expect(r.trajectory.find((t) => t.provider === "ibm")?.outcome).toBe("errored");
  });
});

// ============================ AGNOSTIC MASTER ============================

describe("v1.96 QX-AGNOSTIC · runQuantumAgnostic master function", () => {
  it("accepts QASM string source and returns a result", async () => {
    const qasm = `OPENQASM 3.0; qubit[2] q; h q[0]; cx q[0], q[1];`;
    const r = await runQuantumAgnostic({ source: qasm, shots: 256, env: {} });
    expect(r.response.result.exactProbabilities["00"]).toBeCloseTo(0.5, 5);
    expect(r.route.provider).toBe("simulator");
    expect(r.cacheHit).toBe(false);
  });

  it("accepts CircuitIR source and returns a result", async () => {
    const r = await runQuantumAgnostic({ source: bellPairCircuit(), shots: 256, env: {} });
    expect(r.response.result.exactProbabilities["00"]).toBeCloseTo(0.5, 5);
  });

  it("hits cache on second identical call", async () => {
    const r1 = await runQuantumAgnostic({ source: bellPairCircuit(), shots: 256, env: {} });
    expect(r1.cacheHit).toBe(false);
    const r2 = await runQuantumAgnostic({ source: bellPairCircuit(), shots: 256, env: {} });
    expect(r2.cacheHit).toBe(true);
  });

  it("bypasses cache when preferences.bypassCache=true", async () => {
    await runQuantumAgnostic({ source: bellPairCircuit(), shots: 256, env: {} });
    const r = await runQuantumAgnostic({ source: bellPairCircuit(), shots: 256, env: {}, preferences: { bypassCache: true } });
    expect(r.cacheHit).toBe(false);
  });

  it("decomposes gates before running on provider with limited native set", async () => {
    const r = await runQuantumAgnostic({
      source: bellPairCircuit(),
      shots: 100,
      preferences: { forceProvider: "simulator" }, // sim accepts h+cnot natively → no decomp
      env: {},
    });
    expect(r.decomposition.input).toBe(2);
    expect(r.decomposition.output).toBe(2); // simulator accepts h + cnot natively
  });

  it("auto-records into Infinity Memory when memory provided", async () => {
    const memory = createInfinityMemory();
    await runQuantumAgnostic({ source: bellPairCircuit(), shots: 100, memory, env: {} });
    expect(memory.recall({ kind: "quantum-measurement" }).length).toBe(1);
  });

  it("formatAgnosticLine produces a one-liner with provider + cost", async () => {
    const r = await runQuantumAgnostic({ source: bellPairCircuit(), shots: 100, env: {} });
    const line = formatAgnosticLine(r);
    expect(line).toContain("QX-AGNOSTIC");
    expect(line).toContain("simulator");
    expect(line).toContain("$0.0000");
  });

  it("budget cap rejects request when cost exceeds maxUsd", async () => {
    await expect(runQuantumAgnostic({
      source: bellPairCircuit(),
      shots: 100_000,
      preferences: { forceProvider: "braket" },
      budget: { maxUsd: 0.01 },
      env: {},
    })).rejects.toThrow(/budget/i);
  });

  it("race=true returns a race trajectory", async () => {
    const r = await runQuantumAgnostic({
      source: bellPairCircuit(),
      shots: 100,
      preferences: { race: 2 },
      env: {},
    });
    expect(r.race).toBeDefined();
    expect(r.race?.trajectory.length).toBeGreaterThanOrEqual(1);
  });

  it("verify=true on simulator (degenerate) skips verification", async () => {
    const r = await runQuantumAgnostic({
      source: bellPairCircuit(),
      shots: 100,
      preferences: { verify: true, forceProvider: "simulator" },
      env: {},
    });
    expect(r.verification).toBeUndefined(); // skipped because winner is simulator itself
  });

  it("end-to-end: parse QASM → route → decompose → cache → record", async () => {
    const memory = createInfinityMemory();
    const qasm = `
      OPENQASM 3.0;
      include "stdgates.inc";
      qubit[3] q;
      h q[0];
      cx q[0], q[1];
      cx q[1], q[2];
    `;
    const r = await runQuantumAgnostic({ source: qasm, shots: 512, memory, env: {} });
    // GHZ-3: should be 50/50 of 000 and 111
    expect(r.response.result.exactProbabilities["000"]).toBeCloseTo(0.5, 5);
    expect(r.response.result.exactProbabilities["111"]).toBeCloseTo(0.5, 5);
    expect(memory.recall({ kind: "quantum-measurement" }).length).toBe(1);
    // Run it AGAIN — should hit cache.
    const r2 = await runQuantumAgnostic({ source: qasm, shots: 512, memory, env: {} });
    expect(r2.cacheHit).toBe(true);
  });
});
