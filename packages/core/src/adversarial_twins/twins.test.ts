import { describe, it, expect } from "vitest";
import { twinDebate, formatTwinDebatePulseLine } from "./index.js";

describe("v2.1 ADVERSARIAL TWINS · twin instance debate", () => {
  it("A wins when evidence overwhelmingly supports A", () => {
    const r = twinDebate({
      claim: "Postgres for v1",
      positionA: "Postgres",
      positionB: "MySQL",
      evidence: [
        { fact: "JSONB native support", supportForA: 0.9 },
        { fact: "Mature ops tooling", supportForA: 0.85 },
        { fact: "Team familiarity", supportForA: 0.8 },
      ],
    });
    expect(r.winner).toBe("A");
    expect(r.posteriorA).toBeGreaterThan(r.posteriorB);
  });

  it("B wins when evidence overwhelmingly supports B", () => {
    const r = twinDebate({
      claim: "Postgres for v1",
      positionA: "Postgres",
      positionB: "MySQL",
      evidence: [
        { fact: "Cheaper hosting", supportForA: 0.1 },
        { fact: "Vendor lock-in lower", supportForA: 0.15 },
      ],
    });
    expect(r.winner).toBe("B");
  });

  it("TIE when evidence is balanced", () => {
    const r = twinDebate({
      claim: "x",
      positionA: "yes",
      positionB: "no",
      evidence: [{ fact: "neutral", supportForA: 0.5 }],
    });
    expect(r.winner).toBe("TIE");
    expect(r.agree).toBe(true);
  });

  it("transcript records per-evidence impact", () => {
    const r = twinDebate({
      claim: "x",
      positionA: "A",
      positionB: "B",
      evidence: [
        { fact: "evidence-1", supportForA: 0.8 },
        { fact: "evidence-2", supportForA: 0.2 },
      ],
    });
    expect(r.transcript.length).toBe(2);
    expect(r.transcript[0]!.impact).toBeCloseTo(0.3, 5);
    expect(r.transcript[1]!.impact).toBeCloseTo(-0.3, 5);
  });

  it("posteriors sum to 1", () => {
    const r = twinDebate({
      claim: "x", positionA: "A", positionB: "B",
      evidence: [{ fact: "y", supportForA: 0.7 }],
    });
    expect(r.posteriorA + r.posteriorB).toBeCloseTo(1, 2);
  });

  it("formatTwinDebatePulseLine produces compact summary", () => {
    const r = twinDebate({ claim: "x", positionA: "A", positionB: "B", evidence: [{ fact: "y", supportForA: 0.8 }] });
    expect(formatTwinDebatePulseLine(r)).toContain("TWINS");
  });
});
