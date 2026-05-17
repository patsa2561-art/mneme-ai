import { describe, it, expect } from "vitest";
import {
  scorePair,
  rankAllPairs,
  verifyPairReport,
  formatPairLine,
  type ToolOutputSample,
  type ToolInputSchema,
} from "./index.js";

const SECRET = "pair-test-secret-997744";

function sample(toolName: string, result: Record<string, unknown>): ToolOutputSample {
  return { toolName, result };
}

function schema(toolName: string, required: string[], optional: string[] = []): ToolInputSchema {
  return { toolName, requiredProps: required, optionalProps: optional };
}

describe("v2.19.27 PAIR · scorePair (mutual info approximation)", () => {
  it("perfect coverage: A's output keys cover ALL of B's required + optional", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", { name: "x", count: 3 })],
      schemaB: schema("B", ["name", "count"], []),
    });
    expect(s.requiredCoverage).toBe(1.0);
    expect(s.optionalCoverage).toBe(1.0);
    expect(s.mutualInfoScore).toBeCloseTo(0.5 + 0.3 + 0.2 * s.keyOverlapScore, 5);
  });

  it("zero required coverage: A's keys disjoint from B's required → low MI", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", { foo: 1 })],
      schemaB: schema("B", ["name", "count"], ["other"]),  // also non-empty optional
    });
    expect(s.requiredCoverage).toBe(0);
    expect(s.optionalCoverage).toBe(0);
    expect(s.mutualInfoScore).toBeLessThan(0.2);
  });

  it("partial required coverage rewards proportionally", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", { name: "x" })],
      schemaB: schema("B", ["name", "count", "ts"]),
    });
    expect(s.requiredCoverage).toBeCloseTo(1 / 3, 5);
  });

  it("case-insensitive key matching", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", { NAME: "x" })],
      schemaB: schema("B", ["name"]),
    });
    expect(s.requiredCoverage).toBe(1.0);
  });

  it("multiple samples union their keys", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", { name: "x" }), sample("A", { count: 1 })],
      schemaB: schema("B", ["name", "count"]),
    });
    expect(s.requiredCoverage).toBe(1.0);
  });

  it("empty required + empty output -> vacuous 1.0 required coverage", () => {
    const s = scorePair({
      toolA: "A",
      outputsA: [sample("A", {})],
      schemaB: schema("B", [], []),
    });
    expect(s.requiredCoverage).toBe(1.0);
    expect(s.optionalCoverage).toBe(1.0);
  });
});

describe("v2.19.27 PAIR · rankAllPairs (full ordered ranking)", () => {
  it("scores every ordered (A, B) pair; self-pairs excluded", () => {
    const r = rankAllPairs({
      toolOutputs: [
        [sample("A", { name: "x", count: 1 })],
        [sample("B", { name: "y" })],
      ],
      toolSchemas: [
        schema("A", ["name"]),  // B → A; A → A excluded
        schema("B", ["name"]),
      ],
      minScore: 0,
      builtAt: 0,
      secret: SECRET,
    });
    // 2 tools, 2 schemas, no self-pairs -> 2 candidate pairs (A→B, B→A)
    expect(r.totalCandidatePairs).toBe(2);
  });

  it("sorts by mutual info desc; filters below minScore", () => {
    const r = rankAllPairs({
      toolOutputs: [
        [sample("good", { name: "x", count: 1, ts: 1 })],
        [sample("bad", { unrelated: 1 })],
      ],
      toolSchemas: [
        schema("good", []),
        schema("bad", []),
        schema("target", ["name", "count", "ts"]),
      ],
      minScore: 0.5,
      builtAt: 0,
      secret: SECRET,
    });
    // good → target should rank high; bad → target low (likely filtered)
    expect(r.pairs[0]!.toolA).toBe("good");
    expect(r.pairs[0]!.toolB).toBe("target");
    expect(r.pairs.every((p) => p.mutualInfoScore >= 0.5)).toBe(true);
  });

  it("topN respected", () => {
    const r = rankAllPairs({
      toolOutputs: Array.from({ length: 5 }, (_, i) => [sample(`t${i}`, { x: 1 })]),
      toolSchemas: Array.from({ length: 5 }, (_, i) => schema(`t${i}`, ["x"])),
      minScore: 0,
      topN: 3,
      builtAt: 0,
      secret: SECRET,
    });
    expect(r.pairs.length).toBeLessThanOrEqual(3);
  });

  it("HMAC sig verifies; rejects tamper", () => {
    const r = rankAllPairs({
      toolOutputs: [[sample("a", { x: 1 })]],
      toolSchemas: [schema("a", []), schema("b", [])],
      builtAt: 0,
      secret: SECRET,
    });
    expect(verifyPairReport(r, SECRET)).toBe(true);
    expect(verifyPairReport({ ...r, qualifyingPairs: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (30 trials)", () => {
    const input = {
      toolOutputs: [[sample("a", { x: 1 })], [sample("b", { y: 1 })]],
      toolSchemas: [schema("a", ["x"]), schema("b", ["y"])],
      builtAt: 1_000_000,
      secret: SECRET,
    };
    const firstSig = rankAllPairs(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (rankAllPairs(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });

  it("MEASURED canonical scenario: truth.forensic→bug_prophet has high MI", () => {
    // truth.forensic outputs { claim, sniffs, verdict, evidence }
    // bug_prophet expects { claim, evidence } as input
    const r = rankAllPairs({
      toolOutputs: [
        [sample("mneme.truth.forensic", { claim: "x", sniffs: [], verdict: "ACCEPTED", evidence: [] })],
        [sample("mneme.bug_prophet", { prophecy: "..." })], // unrelated output
      ],
      toolSchemas: [
        schema("mneme.bug_prophet", ["claim", "evidence"]),
        schema("mneme.truth.forensic", ["claim"]),
      ],
      minScore: 0.3,
      builtAt: 0,
      secret: SECRET,
    });
    const tfToProphet = r.pairs.find((p) => p.toolA === "mneme.truth.forensic" && p.toolB === "mneme.bug_prophet");
    expect(tfToProphet).toBeDefined();
    expect(tfToProphet!.mutualInfoScore).toBeGreaterThanOrEqual(0.5);
  });
});

describe("v2.19.27 PAIR · formatter", () => {
  it("formatPairLine includes A → B + MI% + required% + optional%", () => {
    const s = scorePair({
      toolA: "x",
      outputsA: [sample("x", { name: "y" })],
      schemaB: schema("y", ["name"]),
    });
    const line = formatPairLine(s);
    expect(line).toContain("PAIR x → y");
    expect(line).toContain("MI=");
    expect(line).toContain("req=");
    expect(line).toContain("opt=");
  });
});
