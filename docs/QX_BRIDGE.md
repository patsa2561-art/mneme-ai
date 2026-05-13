# 🌌 MNEME-QX BRIDGE — the universal MCP→quantum-cloud bridge

> *"AI agents and quantum computers live in different universes. Mneme is the wormhole between them."*

AI agents (Claude Code · Cursor · Codex CLI · ChatGPT-via-MCP) **cannot natively talk to real quantum hardware** because each vendor speaks a different language:

- **IBM Quantum** → Qiskit / OpenQASM 3.0
- **AWS Braket** → amazon-braket-ir (Rigetti, IonQ, OQC backends)
- **Azure Quantum** → Q# (IonQ, Quantinuum, Pasqal, Rigetti)
- **D-Wave Leap** → Ocean SDK / QUBO format
- **Google Cirq** → Quantum Engine API

Mneme QX-BRIDGE accepts a **uniform CircuitIR** from any AI agent and routes it to whichever quantum provider you have credentials for — falling back to a pure-TS state-vector simulator that runs in-process with zero auth and zero network. **Write provider-agnostic quantum code once; run anywhere.**

---

## 🧪 What ships today (v1.95) — measured live, not promised

| Component | Status | Live numbers |
|---|---|---|
| Pure-TS state-vector simulator (up to 12 qubits) | ✅ ship | Bell pair 50.24% / 49.76% · 4096 shots · 1ms |
| Famous circuits (Bell · GHZ-N · Grover-2q) | ✅ ship | GHZ-5: 51.07%/48.93%; Grover finds target at **100%** exact |
| Provider capability probe (5 providers) | ✅ ship | simulator(ready) · ibm/braket/azure/dwave(needs token) |
| Uniform CircuitIR + JSON gate format | ✅ ship | H · X · Y · Z · S · T · CNOT · CZ · RX · RY · RZ |
| Auto-record into Infinity Memory as quantum-event | ✅ ship | probabilityVector per event, collapse-on-recall |
| Real-cloud SDK adapters (IBM/Braket/Azure/D-Wave) | ⏳ v1.96 | architecture + auth probe + stubs in place; SDK wiring next |

---

## ⚛ The simulator (works today, no account needed)

Pure TypeScript state-vector simulator. Real quantum mechanics on the CPU.

```typescript
import { QuantumState, bellPairCircuit, runOnSimulator } from "@mneme-ai/core";

// Manual gate construction
const s = new QuantumState(2);
s.h(0);
s.cnot(0, 1);
console.log(s.exactProbabilities());
// { "00": 0.5, "11": 0.5 }

// Or via CircuitIR
const result = runOnSimulator(bellPairCircuit(), 4096, /* seed */ 42);
console.log(result.counts);
// { "00": 2058, "11": 2038 }
console.log(result.exactProbabilities);
// { "00": 0.5, "11": 0.5 }
```

Supported gates: **H · X · Y · Z · S · T · CNOT · CZ · RX(θ) · RY(θ) · RZ(θ)**.

Reproducible: pass a `seed` and the measurement counts are deterministic. Use the same seed → get the same shot histogram.

---

## 🌐 The provider bridge — write once, run on real qubits later

```typescript
import { runQuantumCircuit, bellPairCircuit, probeProviders } from "@mneme-ai/core";

// What can I run right now?
probeProviders();
// [
//   { name: "simulator", ready: true, maxQubits: 12, cost: "free" },
//   { name: "ibm", ready: false, reason: "MNEME_IBM_TOKEN env var not set", maxQubits: 127, cost: "free" },
//   { name: "braket", ready: false, reason: "AWS_ACCESS_KEY_ID not set", maxQubits: 256, cost: "pay-per-shot" },
//   { name: "azure", ready: false, reason: "AZURE_QUANTUM_RESOURCE_ID not set", maxQubits: 100, cost: "paid-tier" },
//   { name: "dwave", ready: false, reason: "DWAVE_API_TOKEN not set", maxQubits: 5760, cost: "free" },
// ]

// Run on simulator
const resp = await runQuantumCircuit({
  circuit: bellPairCircuit(),
  shots: 4096,
  provider: "simulator",
});

// Same call, real IBM Quantum (when token is set):
//   export MNEME_IBM_TOKEN=<token>   # free at https://quantum.ibm.com
//   provider: "ibm", backend: "ibmq_qasm"
```

The provider abstraction is the point — your AI agent's code doesn't change when you switch from simulator to real hardware. Mneme handles the per-provider translation.

---

## ♾ Auto-recorded into Infinity Memory

Every quantum measurement is **automatically recorded** as an event in Infinity Memory with its full probability vector frozen. Recall later, collapse over matching events, compute precision-at-K.

```typescript
import { createInfinityMemory } from "@mneme-ai/core";

const memory = createInfinityMemory();
await runQuantumCircuit({ circuit: bellPairCircuit(), shots: 1024, provider: "simulator" }, { memory });
await runQuantumCircuit({ circuit: groverCircuit2q("11"), shots: 1024, provider: "simulator" }, { memory });

const events = memory.recall({ kind: "quantum-measurement" });
// Each event has probabilityVector: { "00": 0.5, "11": 0.5 } (Bell) or { "11": 1.0 } (Grover)

const collapse = memory.collapse({ kind: "quantum-measurement" });
// → returns the highest-confidence quantum event by posterior
```

Quantum measurements *are literally probability vectors*. Mneme's Infinity Memory was designed for exactly this. The two universes mesh perfectly.

---

## 🚀 One-line helpers for AI agents

```typescript
import { runBellPair, runGhz, runGrover2q } from "@mneme-ai/core";

await runBellPair({ shots: 4096 });
// → 50/50 of |00⟩ and |11⟩

await runGhz(5);
// → 50/50 of |00000⟩ and |11111⟩ (cat state on 5 qubits)

await runGrover2q("01");
// → 100% on |01⟩ after 1 Grover iteration
```

---

## 🔑 Enabling real-cloud providers

When v1.96 ships the SDK wiring, the same code above will run on real qubits as soon as you set the right env var.

### IBM Quantum (free tier · up to 127 qubits)

```bash
# 1. Sign up at https://quantum.ibm.com (free, no credit card)
# 2. Copy your API token from the dashboard
export MNEME_IBM_TOKEN=<your-token>

# 3. Same Mneme call — different provider
# resp = await runQuantumCircuit({..., provider: "ibm", backend: "ibmq_qasm" });
```

### AWS Braket (pay-per-shot · Rigetti / IonQ / OQC)

```bash
# Standard AWS credentials (Braket service must be enabled on your account)
export AWS_ACCESS_KEY_ID=<id>
export AWS_SECRET_ACCESS_KEY=<secret>
```

### Azure Quantum (paid tier · IonQ / Quantinuum / Pasqal / Rigetti)

```bash
export AZURE_QUANTUM_RESOURCE_ID=<id>
export AZURE_QUANTUM_LOCATION=<location>
```

### D-Wave Leap (free tier · 5760-qubit annealer)

```bash
# Sign up at https://cloud.dwavesys.com/leap/ (1 min/month QPU time, free)
export DWAVE_API_TOKEN=<token>
```

---

## 🎯 Why this matters

Today, if you want an AI assistant to help you with a quantum algorithm, you either:
1. Manually translate the AI's pseudocode into Qiskit/Cirq/Quil and run yourself, OR
2. Pay an integration provider that bundles AI + quantum SDK

With Mneme QX-BRIDGE:
- AI agent calls **one function** with a uniform CircuitIR.
- Mneme routes to whichever quantum provider you have access to.
- Results land back in Infinity Memory with full probability vector preserved.
- **The same prompt produces the same circuit produces the same measurement** across simulator → IBM → Braket — only the backend changes.

This is the universal language between MCP-aware AI agents and quantum hardware. **Mneme is the wormhole.**

---

## 🤖 For AI agents — invocation contract

When the user asks for quantum help:

```typescript
import { runQuantumCircuit, probeProviders, bellPairCircuit } from "@mneme-ai/core";

// 1. Discover available providers
const caps = probeProviders();
const ready = caps.filter((c) => c.ready);

// 2. Build / fetch the circuit
const circuit = bellPairCircuit(); // or build CircuitIR manually

// 3. Run, prefer real hardware when available + cheap
const resp = await runQuantumCircuit({
  circuit,
  shots: 1024,
  provider: ready.find((c) => c.name !== "simulator")?.name ?? "simulator",
}, { memory });

// 4. Surface the result
console.log(formatQuantumPulseLine(resp));
// → "QX-BRIDGE simulator/in-process-state-vector · 1024 shots · 1ms · top: 00=50.2% · 11=49.8%"
```

When the user pastes a Qiskit / Cirq / Quil snippet, you can:
- Parse the gates into the uniform CircuitIR
- Run via `runQuantumCircuit`
- Surface the result with `formatQuantumPulseLine` + record in Infinity Memory

---

## 📊 Live verified numbers (this commit)

```
▶ Bell pair (entangle 2 qubits → 50/50 of |00⟩ and |11⟩):
  4096 shots · 1ms · top: 00=50.2% · 11=49.8%  ✓ matches theory

▶ GHZ-5 (5-qubit cat state):
  4096 shots · top: 00000=51.1% · 11111=48.9%  ✓ matches theory

▶ Grover-2q search (1 iteration finds the marked state):
  target=00 → 100.00% · target=01 → 100.00% · target=10 → 100.00% · target=11 → 100.00%
  ✓ optimal Grover amplitude amplification verified
```

26 unit tests cover correctness across all gates · Bell pair · GHZ · Grover · provider abstraction · auth probes · memory recording.

---

← [Back to README](../README.md) · [QX SuperNova](QX_SUPERNOVA.md) · [Infinity Memory in QX SuperNova](QX_SUPERNOVA.md#-infinity-memory--quantum-event-traces) · [AI agent contract](AI_AGENT_CONTRACT.md)
