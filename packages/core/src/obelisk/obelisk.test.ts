import { describe, it, expect } from "vitest";
import { buildCard, verifyCard, aggregateGraph, formatObeliskLine, type VendorScorecard } from "./index.js";

const score = (vendor: string, t: number, f: number): VendorScorecard => ({
  vendor, totalVerdicts: t + f, falseCount: f, trueCount: t,
  partialCount: 0, inconclusiveCount: 0,
  falseRate: f / Math.max(1, t + f),
  falseRateLB: 0,
  generatedAt: new Date().toISOString(),
});

describe("v2.16 · OBELISK (federated trust graph)", () => {
  it("buildCard + verifyCard round-trip", () => {
    const card = buildCard({ publisher: "alice@x.com", vendorScore: score("claude", 90, 10) });
    expect(verifyCard(card).ok).toBe(true);
  });

  it("verifyCard fails on tamper", () => {
    const card = buildCard({ publisher: "alice@x.com", vendorScore: score("claude", 90, 10) });
    const tampered = { ...card, publisher: "evil@attacker.com" };
    expect(verifyCard(tampered).ok).toBe(false);
  });

  it("aggregateGraph sums verdicts across publishers", () => {
    const a = buildCard({ publisher: "alice", vendorScore: score("claude", 80, 20) });
    const b = buildCard({ publisher: "bob",   vendorScore: score("claude", 90, 10) });
    const c = buildCard({ publisher: "carol", vendorScore: score("claude", 95, 5) });
    const { rows } = aggregateGraph([a, b, c]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.totalVerdicts).toBe(300);
    expect(rows[0]!.totalFalse).toBe(35);
    expect(rows[0]!.publisherCount).toBe(3);
    expect(rows[0]!.consensusFalseRate).toBeCloseTo(35 / 300, 4);
  });

  it("aggregateGraph isolates unverified cards", () => {
    const a = buildCard({ publisher: "alice", vendorScore: score("claude", 80, 20) });
    const tampered = { ...a, publisher: "evil" };
    const { rows, unverified } = aggregateGraph([a, tampered]);
    expect(unverified).toHaveLength(1);
    expect(rows[0]!.publisherCount).toBe(1);
  });

  it("Wilson LB <= rate for small samples", () => {
    const a = buildCard({ publisher: "alice", vendorScore: score("claude", 0, 5) }); // 100% false rate, tiny sample
    const { rows } = aggregateGraph([a]);
    expect(rows[0]!.consensusFalseRate).toBe(1);
    expect(rows[0]!.consensusFalseRateLB).toBeLessThan(1);
  });

  it("diversity bonus: more publishers → higher confidence", () => {
    const a1 = buildCard({ publisher: "alice", vendorScore: score("claude", 50, 50) });
    const a2 = buildCard({ publisher: "alice", vendorScore: score("claude", 50, 50) });
    const a3 = buildCard({ publisher: "alice", vendorScore: score("claude", 50, 50) });
    const b1 = buildCard({ publisher: "bob",   vendorScore: score("claude", 50, 50) });
    const c1 = buildCard({ publisher: "carol", vendorScore: score("claude", 50, 50) });
    const single = aggregateGraph([a1, a2, a3]);
    const diverse = aggregateGraph([a1, b1, c1]);
    expect(diverse.rows[0]!.confidenceScore).toBeGreaterThanOrEqual(single.rows[0]!.confidenceScore);
  });

  it("sort orders worst (highest falseRateLB) first", () => {
    const aBad = buildCard({ publisher: "p1", vendorScore: score("vendorA", 10, 90) });
    const aGood = buildCard({ publisher: "p2", vendorScore: score("vendorB", 90, 10) });
    const { rows } = aggregateGraph([aBad, aGood]);
    expect(rows[0]!.vendor).toBe("vendorA");
  });

  it("formatObeliskLine summarises", () => {
    const card = buildCard({ publisher: "alice", vendorScore: score("claude", 90, 10) });
    const { rows } = aggregateGraph([card]);
    expect(formatObeliskLine(rows)).toContain("OBELISK");
    expect(formatObeliskLine([])).toContain("empty");
  });
});
