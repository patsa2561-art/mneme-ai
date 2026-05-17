import { describe, it, expect } from "vitest";
import { consolidateMemory, verifyConsolidation, formatConsolidationLine, type YesterdayObservation } from "./index.js";

const SECRET = "hippocampus-test-secret-997744";

function obs(eventSig: string, toolName: string, ts: number, eventKind: YesterdayObservation["eventKind"] = "git_commit"): YesterdayObservation {
  return { eventKind, eventSig, toolName, args: { ts }, ts };
}

describe("v2.19.23 HIPPOCAMPUS-DREAMS · consolidateMemory", () => {
  it("empty observations -> zero rules", () => {
    const r = consolidateMemory({ yesterdayObservations: [], consolidatedAt: 0, secret: SECRET });
    expect(r.promotedRules.length).toBe(0);
    expect(r.totalObservations).toBe(0);
    expect(r.crystallisationRatio).toBe(0);
  });

  it("patterns fired >= threshold (3) promoted; below threshold dropped", () => {
    const observations = [
      obs("sigA", "mneme.ask", 1),
      obs("sigA", "mneme.ask", 2),
      obs("sigA", "mneme.ask", 3),     // 3 times -> promoted
      obs("sigA", "mneme.why", 4),
      obs("sigA", "mneme.why", 5),     // 2 times -> not promoted (below threshold 3)
      obs("sigB", "mneme.status", 6),  // 1 time -> not promoted
    ];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    expect(r.promotedRules.length).toBe(1);
    expect(r.promotedRules[0]!.toolName).toBe("mneme.ask");
    expect(r.promotedRules[0]!.occurrenceCount).toBe(3);
  });

  it("priorConfidence = occurrenceCount / total observations for eventSig", () => {
    const observations = [
      obs("sigA", "mneme.ask", 1),
      obs("sigA", "mneme.ask", 2),
      obs("sigA", "mneme.ask", 3),
      obs("sigA", "mneme.why", 4),
      obs("sigA", "mneme.why", 5),
    ];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    // 3 out of 5 total observations for sigA -> 0.6
    const ask = r.promotedRules.find((p) => p.toolName === "mneme.ask")!;
    expect(ask.priorConfidence).toBeCloseTo(3 / 5, 5);
  });

  it("custom threshold respected (threshold=1 promotes everything)", () => {
    const observations = [obs("sigA", "t1", 1), obs("sigB", "t2", 2)];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, promotionThreshold: 1, secret: SECRET });
    expect(r.promotedRules.length).toBe(2);
  });

  it("sorted by priorConfidence desc", () => {
    const observations = [
      obs("sigA", "t_low", 1), obs("sigA", "t_low", 2), obs("sigA", "t_low", 3),  // 3/10
      obs("sigA", "t_high", 4), obs("sigA", "t_high", 5), obs("sigA", "t_high", 6), obs("sigA", "t_high", 7),
      obs("sigA", "t_high", 8), obs("sigA", "t_high", 9), obs("sigA", "t_high", 10), // 7/10
    ];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    expect(r.promotedRules.length).toBe(2);
    expect(r.promotedRules[0]!.toolName).toBe("t_high");
  });

  it("crystallisationRatio = promoted / uniqueEventSigs", () => {
    const observations = [
      obs("sigA", "t1", 1), obs("sigA", "t1", 2), obs("sigA", "t1", 3),
      obs("sigB", "t2", 4),
    ];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    expect(r.uniqueEventSigs).toBe(2);
    expect(r.promotedRules.length).toBe(1);
    expect(r.crystallisationRatio).toBeCloseTo(1 / 2, 5);
  });

  it("argsTemplate captured from latest occurrence", () => {
    const observations: YesterdayObservation[] = [
      { eventKind: "git_commit", eventSig: "sigA", toolName: "mneme.ask", args: { v: "v1" }, ts: 1 },
      { eventKind: "git_commit", eventSig: "sigA", toolName: "mneme.ask", args: { v: "v2" }, ts: 2 },
      { eventKind: "git_commit", eventSig: "sigA", toolName: "mneme.ask", args: { v: "v3" }, ts: 3 },
    ];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    expect(r.promotedRules[0]!.argsTemplate["v"]).toBe("v3");
  });

  it("HMAC sig verifies on untampered; rejects tamper", () => {
    const observations = [obs("sigA", "t1", 1), obs("sigA", "t1", 2), obs("sigA", "t1", 3)];
    const r = consolidateMemory({ yesterdayObservations: observations, consolidatedAt: 0, secret: SECRET });
    expect(verifyConsolidation(r, SECRET)).toBe(true);
    const tampered = { ...r, totalObservations: 9999 };
    expect(verifyConsolidation(tampered, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (30 trials)", () => {
    const observations = [
      obs("sigA", "t1", 1), obs("sigA", "t1", 2), obs("sigA", "t1", 3),
      obs("sigB", "t2", 4), obs("sigB", "t2", 5), obs("sigB", "t2", 6),
    ];
    const input = { yesterdayObservations: observations, consolidatedAt: 1_000_000, secret: SECRET };
    const firstSig = consolidateMemory(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (consolidateMemory(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.23 HIPPOCAMPUS-DREAMS · formatter", () => {
  it("formatConsolidationLine renders digest", () => {
    const r = consolidateMemory({ yesterdayObservations: [obs("sigA", "t1", 1)], consolidatedAt: 0, secret: SECRET });
    const line = formatConsolidationLine(r);
    expect(line).toContain("HIPPOCAMPUS");
  });
});
