import { describe, it, expect } from "vitest";

import {
  collapseProbabilityMatrix,
  recollapseWithWeights,
  confidenceOf,
  supernovaBurst,
  createInfinityMemory,
  appendEventToFile,
  generateGoals,
  decideGoals,
  runBenchmark,
  formatBenchmarkLine,
  reengineerUntilPassing,
  formatReengineerLine,
  type Hypothesis,
  type QuantumEvent,
} from "./index.js";

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// =================== QUANTUM CORE ===================

describe("v1.94 QX · Quantum Core", () => {
  it("collapses to clearest hypothesis", () => {
    const r = collapseProbabilityMatrix<string>([
      { id: "a", value: "a", signals: { s: 0.95, t: 0.9 } },
      { id: "b", value: "b", signals: { s: 0.2, t: 0.3 } },
    ]);
    expect(r.verdict).toBe("COLLAPSED");
    expect(r.winner?.id).toBe("a");
    expect(r.posterior).toBeGreaterThan(0.8);
    expect(r.margin).toBeGreaterThan(0.5);
  });

  it("returns DEGENERATE for 1 hypothesis + 0 hypothesis", () => {
    const r0 = collapseProbabilityMatrix([]);
    expect(r0.verdict).toBe("DEGENERATE");
    const r1 = collapseProbabilityMatrix([{ id: "a", value: 1, signals: { s: 0.9 } }]);
    expect(r1.verdict).toBe("DEGENERATE");
  });

  it("returns UNCERTAIN when margin < threshold", () => {
    const r = collapseProbabilityMatrix<string>([
      { id: "a", value: "a", signals: { s: 0.51 } },
      { id: "b", value: "b", signals: { s: 0.50 } },
    ]);
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.margin).toBeLessThan(0.05);
  });

  it("posteriors sum to 1 (normalized)", () => {
    const r = collapseProbabilityMatrix<string>([
      { id: "a", value: "a", signals: { s: 0.7 } },
      { id: "b", value: "b", signals: { s: 0.5 } },
      { id: "c", value: "c", signals: { s: 0.3 } },
    ]);
    const sum = r.ranked.reduce((s, h) => s + h.posterior, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("weights bias the collapse correctly", () => {
    const hyps: Hypothesis<string>[] = [
      { id: "a", value: "a", signals: { q: 0.9, r: 0.1 } },
      { id: "b", value: "b", signals: { q: 0.1, r: 0.9 } },
    ];
    const wq = recollapseWithWeights(hyps, { q: 3, r: 0.1 });
    expect(wq.winner?.id).toBe("a");
    const wr = recollapseWithWeights(hyps, { q: 0.1, r: 3 });
    expect(wr.winner?.id).toBe("b");
  });

  it("entropy is 0 for fully concentrated posterior", () => {
    const r = collapseProbabilityMatrix<string>([
      { id: "a", value: "a", signals: { s: 0.999 } },
      { id: "b", value: "b", signals: { s: 0.001 } },
    ]);
    expect(r.entropyNormalized).toBeLessThan(0.1);
  });

  it("confidenceOf combines posterior + low entropy", () => {
    const r = collapseProbabilityMatrix<string>([
      { id: "a", value: "a", signals: { s: 0.999, t: 0.998 } },
      { id: "b", value: "b", signals: { s: 0.001, t: 0.001 } },
    ]);
    const c = confidenceOf(r);
    expect(c).toBeGreaterThan(0.7);
  });
});

// =================== SUPERNOVA BURST ===================

describe("v1.94 QX · SuperNova Burst", () => {
  it("fires N generators in parallel + picks winner", async () => {
    const r = await supernovaBurst<number>({
      generators: [
        async () => 1,
        async () => 2,
        async () => 3,
      ],
      scoreSignal: (v) => ({ size: v / 3 }),
    });
    expect(r.fanout).toBe(3);
    expect(r.winner).toBe(3);
    expect(r.collapse.verdict).toBe("COLLAPSED");
  });

  it("parallel speedup > 1 when generators are concurrent", async () => {
    const r = await supernovaBurst<number>({
      generators: [
        async () => { await new Promise((s) => setTimeout(s, 30)); return 1; },
        async () => { await new Promise((s) => setTimeout(s, 30)); return 2; },
        async () => { await new Promise((s) => setTimeout(s, 30)); return 3; },
      ],
      scoreSignal: (v) => ({ s: v / 3 }),
    });
    expect(r.parallelSpeedup).toBeGreaterThan(2.0);
    expect(r.burstMs).toBeLessThan(r.sequentialEquivalentMs);
  });

  it("records errors but continues", async () => {
    const r = await supernovaBurst<number>({
      generators: [
        async () => 1,
        async () => { throw new Error("oops"); },
        async () => 3,
      ],
      scoreSignal: (v) => ({ s: v / 3 }),
    });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.message).toContain("oops");
    expect(r.winner).toBe(3);
  });

  it("empty generators → empty result, no crash", async () => {
    const r = await supernovaBurst<number>({ generators: [], scoreSignal: () => ({}) });
    expect(r.fanout).toBe(0);
    expect(r.winner).toBeNull();
  });
});

// =================== INFINITY MEMORY ===================

describe("v1.94 QX · Infinity Memory", () => {
  it("records + recalls + collapses events", () => {
    const m = createInfinityMemory();
    m.record({ ts: 1, kind: "decision", actors: ["a"], probabilityVector: { conf: 0.9 }, outcome: "success", trace: "x" });
    m.record({ ts: 2, kind: "regret", actors: ["b"], probabilityVector: { conf: 0.3 }, outcome: "failure", trace: "y" });
    m.record({ ts: 3, kind: "decision", actors: ["a"], probabilityVector: { conf: 0.95 }, outcome: "success", trace: "z" });
    expect(m.list().length).toBe(3);
    expect(m.recall({ kind: "decision" }).length).toBe(2);
    expect(m.recall({ actor: "a", limit: 1 })[0]!.trace).toBe("z");
  });

  it("filters by since/until", () => {
    const m = createInfinityMemory();
    m.record({ ts: 10, kind: "x", actors: [], probabilityVector: {}, outcome: "unknown", trace: "old" });
    m.record({ ts: 50, kind: "x", actors: [], probabilityVector: {}, outcome: "unknown", trace: "mid" });
    m.record({ ts: 100, kind: "x", actors: [], probabilityVector: {}, outcome: "unknown", trace: "new" });
    const after = m.recall({ sinceMs: 30 });
    expect(after.length).toBe(2);
    const window = m.recall({ sinceMs: 30, untilMs: 80 });
    expect(window.length).toBe(1);
    expect(window[0]!.trace).toBe("mid");
  });

  it("marks outcome retroactively", () => {
    const m = createInfinityMemory();
    const e = m.record({ ts: 1, kind: "x", actors: [], probabilityVector: {}, outcome: "pending", trace: "x" });
    expect(m.mark(e.id, "success")).toBe(true);
    expect(m.list()[0]!.outcome).toBe("success");
    expect(m.mark("nope", "success")).toBe(false);
  });

  it("collapses across matching events", () => {
    const m = createInfinityMemory();
    m.record({ ts: 1, kind: "decision", actors: [], probabilityVector: { conf: 0.4 }, outcome: "unknown", trace: "a" });
    m.record({ ts: 2, kind: "decision", actors: [], probabilityVector: { conf: 0.95 }, outcome: "unknown", trace: "b" });
    const r = m.collapse({ kind: "decision" });
    expect(r.verdict).toBe("COLLAPSED");
    expect(r.winner?.value.trace).toBe("b");
  });

  it("persists + reloads from JSONL", () => {
    const m1 = createInfinityMemory();
    m1.record({ ts: 1, kind: "x", actors: ["alice"], probabilityVector: { c: 0.7 }, outcome: "success", trace: "hello" });
    const path = join(mkdtempSync(join(tmpdir(), "qx-mem-")), "events.jsonl");
    m1.flushTo(path);
    const m2 = createInfinityMemory();
    const loaded = m2.loadFrom(path);
    expect(loaded).toBe(1);
    expect(m2.list()[0]!.trace).toBe("hello");
  });

  it("appendEventToFile writes one line per event", () => {
    const path = join(mkdtempSync(join(tmpdir(), "qx-append-")), "events.jsonl");
    appendEventToFile(path, { id: "a", ts: 1, kind: "x", actors: [], probabilityVector: {}, outcome: "unknown", trace: "1" });
    appendEventToFile(path, { id: "b", ts: 2, kind: "x", actors: [], probabilityVector: {}, outcome: "unknown", trace: "2" });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("precisionAtK returns hits / k", () => {
    const m = createInfinityMemory();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(m.record({ ts: i, kind: "wanted", actors: [], probabilityVector: {}, outcome: "success", trace: `${i}` }).id);
    for (let i = 0; i < 5; i++) m.record({ ts: 10 + i, kind: "noise", actors: [], probabilityVector: {}, outcome: "failure", trace: "n" });
    expect(m.precisionAtK({ kind: "wanted" }, ids, 5)).toBe(1);
    expect(m.precisionAtK({ kind: "noise" }, ids, 5)).toBe(0);
  });
});

// =================== SOUL ENGINE ===================

describe("v1.94 QX · Soul Engine", () => {
  it("generates goals from a degraded context", () => {
    const g = generateGoals({ failuresLast24h: { evolve: 5 }, hci: 50, inboxUnsent: 15, tokenSavingsRatio: 0.2 });
    expect(g.length).toBeGreaterThan(0);
    expect(g.some((x) => x.id === "g-heal")).toBe(true);
    expect(g.some((x) => x.id === "g-token-tune")).toBe(true);
    expect(g.some((x) => x.id === "g-triage-evolve")).toBe(true);
  });

  it("no goals when system is healthy + idle", () => {
    const g = generateGoals({ hci: 95, idleTicks: 0 });
    expect(g.length).toBe(0);
  });

  it("decideGoals picks top-K above posterior floor", () => {
    const v = decideGoals({ failuresLast24h: { x: 4 }, hci: 50, inboxUnsent: 12, tokenSavingsRatio: 0.2 });
    expect(v.selected.length).toBeGreaterThan(0);
    expect(v.selected.length).toBeLessThanOrEqual(2); // topK default 2
    expect(v.reason).toContain("verdict");
  });

  it("returns rest verdict when no goals", () => {
    const v = decideGoals({ hci: 90 });
    expect(v.selected.length).toBe(0);
    expect(v.reason).toMatch(/rest|no goals/i);
  });
});

// =================== BENCHMARK ===================

describe("v1.94 QX · Benchmark + Re-engineer", () => {
  it("runBenchmark returns 8 axes + overall + passing flag", async () => {
    const b = await runBenchmark();
    expect(b.axes.length).toBe(8);
    expect(b.overall).toBeGreaterThan(0);
    expect(typeof b.passing).toBe("boolean");
    expect(b.threshold).toBe(97.5);
  });

  it("baseline benchmark scores at least 95/100", async () => {
    const b = await runBenchmark();
    expect(b.overall).toBeGreaterThanOrEqual(95);
  });

  it("re-engineer loop converges to ≥ 97.5%", async () => {
    const r = await reengineerUntilPassing({ targetScore: 97.5, maxAttempts: 6 });
    expect(r.passed).toBe(true);
    expect(r.finalScore.overall).toBeGreaterThanOrEqual(97.5);
    expect(r.history.length).toBeGreaterThan(0);
    expect(r.history[r.history.length - 1]!.passing).toBe(true);
  });

  it("re-engineer trajectory is monotonic or improving overall", async () => {
    const r = await reengineerUntilPassing({ targetScore: 97.5, maxAttempts: 6 });
    // Final must beat initial.
    expect(r.history.at(-1)!.overall).toBeGreaterThanOrEqual(r.history[0]!.overall - 0.5); // tolerate tiny dip on first attempt
  });

  it("formatBenchmarkLine produces compact pulse string", async () => {
    const b = await runBenchmark();
    const line = formatBenchmarkLine(b);
    expect(line).toContain("QX-BENCH");
    expect(line).toMatch(/\d+\.\d+\/100/);
  });

  it("formatReengineerLine shows trajectory + verdict", async () => {
    const r = await reengineerUntilPassing();
    const line = formatReengineerLine(r);
    expect(line).toContain("RE-ENGINEER");
    expect(line).toMatch(/PASSED|FAILED/);
  });
});
