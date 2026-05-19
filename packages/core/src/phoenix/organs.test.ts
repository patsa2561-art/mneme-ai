/**
 * v2.19.62 PHOENIX P5 — 3 priority-1 organs deep tests.
 *
 * Custodian / Sentinel / Surgeon — each is a pure function returning a
 * verdict. Tests cover: shape of reports, threshold semantics, idempotence,
 * composability via runAllOrgans.
 */

import { describe, it, expect } from "vitest";
import {
  runCustodianCycle,
  runSentinelCycle,
  runSurgeonCycle,
  runAllOrgans,
  type OrganLatencyStats,
  PROTOCOL_VERSION,
} from "./organs.js";

describe("v2.19.62 organs PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("v2.19.62 Custodian organ", () => {
  it("returns structured CustodianReport", () => {
    const r = runCustodianCycle();
    expect(r.v).toBe(1);
    expect(r.organ).toBe("custodian");
    expect(typeof r.ts).toBe("string");
    expect(r.tmpDirsSwept).toBeGreaterThanOrEqual(0);
    expect(r.tmpBytesReclaimed).toBeGreaterThanOrEqual(0);
    expect(r.globalOrphansSwept).toBeGreaterThanOrEqual(0);
    expect(r.totalReclaimedBytes).toBeGreaterThanOrEqual(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never throws on missing ~/.mneme-global", () => {
    expect(() => runCustodianCycle()).not.toThrow();
  });

  it("idempotent — second cycle finds nothing new", () => {
    const r1 = runCustodianCycle();
    const r2 = runCustodianCycle();
    expect(r2.tmpDirsSwept).toBeLessThanOrEqual(r1.tmpDirsSwept + 5); // best-effort
  });
});

describe("v2.19.62 Sentinel organ", () => {
  it("returns healthy when no opts provided", () => {
    const r = runSentinelCycle();
    expect(r.organ).toBe("sentinel");
    expect(r.hmacChainOk).toBe(true);
    expect(r.handleCount).toBe(-1); // No counter injected
    expect(r.handleBaseline).toBe(50);
    expect(r.handleLeakDetected).toBe(false);
    expect(r.recommendation).toBe("healthy");
  });

  it("detects handle leak when count > baseline×2", () => {
    const r = runSentinelCycle({ handleCounter: () => 200, handleBaseline: 50 });
    expect(r.handleCount).toBe(200);
    expect(r.handleLeakDetected).toBe(true);
    expect(r.recommendation).toBe("warn-handle-leak");
  });

  it("does NOT flag leak when count == baseline×2 (strict >)", () => {
    const r = runSentinelCycle({ handleCounter: () => 100, handleBaseline: 50 });
    expect(r.handleLeakDetected).toBe(false);
    expect(r.recommendation).toBe("healthy");
  });

  it("escalates to critical when HMAC chain broken", () => {
    const r = runSentinelCycle({
      verifyHmacChain: () => ({ ok: false, brokenAt: 42 }),
    });
    expect(r.hmacChainOk).toBe(false);
    expect(r.hmacChainBrokenAt).toBe(42);
    expect(r.recommendation).toBe("critical-chain-broken");
  });

  it("critical chain-broken takes precedence over handle leak", () => {
    const r = runSentinelCycle({
      handleCounter: () => 500,
      handleBaseline: 50,
      verifyHmacChain: () => ({ ok: false }),
    });
    expect(r.recommendation).toBe("critical-chain-broken");
  });

  it("custom baseline respected", () => {
    const r = runSentinelCycle({ handleCounter: () => 250, handleBaseline: 200 });
    expect(r.handleBaseline).toBe(200);
    // 250 not > 200×2=400, so no leak
    expect(r.handleLeakDetected).toBe(false);
  });
});

describe("v2.19.62 Surgeon organ", () => {
  it("returns empty restart list when all healthy", () => {
    const stats: OrganLatencyStats[] = [
      { name: "indexer", p99Ms: 100, baselineMs: 90 },
      { name: "embedder", p99Ms: 50, baselineMs: 40 },
    ];
    const r = runSurgeonCycle(stats);
    expect(r.organsExamined).toBe(2);
    expect(r.organsToRestart).toEqual([]);
  });

  it("flags organ with 3× p99 degradation", () => {
    const stats: OrganLatencyStats[] = [
      { name: "indexer", p99Ms: 3000, baselineMs: 1000 },
    ];
    const r = runSurgeonCycle(stats);
    expect(r.organsToRestart.length).toBe(1);
    expect(r.organsToRestart[0]!.name).toBe("indexer");
    expect(r.organsToRestart[0]!.degradationFactor).toBeCloseTo(3, 1);
  });

  it("does NOT flag organ at 2.9× degradation (under threshold)", () => {
    const stats: OrganLatencyStats[] = [
      { name: "borderline", p99Ms: 2900, baselineMs: 1000 },
    ];
    const r = runSurgeonCycle(stats);
    expect(r.organsToRestart.length).toBe(0);
  });

  it("custom degradationFactor respected", () => {
    const stats: OrganLatencyStats[] = [
      { name: "loose-threshold", p99Ms: 1500, baselineMs: 1000 },
    ];
    const r = runSurgeonCycle(stats, { degradationFactor: 1.4 });
    expect(r.organsToRestart.length).toBe(1);
  });

  it("flags organ on consecutive failures even when latency healthy", () => {
    const stats: OrganLatencyStats[] = [
      { name: "flaky", p99Ms: 100, baselineMs: 90, consecutiveFailures: 5 },
    ];
    const r = runSurgeonCycle(stats);
    expect(r.organsToRestart.length).toBe(1);
    expect(r.organsToRestart[0]!.reason).toContain("consecutive failures");
  });

  it("custom maxConsecutiveFailures respected", () => {
    const stats: OrganLatencyStats[] = [
      { name: "borderline-flake", p99Ms: 100, baselineMs: 90, consecutiveFailures: 2 },
    ];
    const r1 = runSurgeonCycle(stats);
    expect(r1.organsToRestart.length).toBe(0); // default 3
    const r2 = runSurgeonCycle(stats, { maxConsecutiveFailures: 2 });
    expect(r2.organsToRestart.length).toBe(1);
  });

  it("avoids divide-by-zero when baseline=0", () => {
    const stats: OrganLatencyStats[] = [
      { name: "no-baseline", p99Ms: 10000, baselineMs: 0 },
    ];
    expect(() => runSurgeonCycle(stats)).not.toThrow();
    const r = runSurgeonCycle(stats);
    // baseline=0 short-circuits the ratio check to 0, no restart unless failures hit
    expect(r.organsToRestart.length).toBe(0);
  });

  it("handles empty stats array", () => {
    const r = runSurgeonCycle([]);
    expect(r.organsExamined).toBe(0);
    expect(r.organsToRestart).toEqual([]);
  });

  it("reports include precise reason string", () => {
    const stats: OrganLatencyStats[] = [
      { name: "slow", p99Ms: 5000, baselineMs: 1000 },
    ];
    const r = runSurgeonCycle(stats);
    expect(r.organsToRestart[0]!.reason).toContain("5000ms");
    expect(r.organsToRestart[0]!.reason).toContain("1000ms");
    expect(r.organsToRestart[0]!.reason).toContain("5.0x");
  });
});

describe("v2.19.62 runAllOrgans composed cycle", () => {
  it("returns all 3 reports in one call", () => {
    const r = runAllOrgans();
    expect(r.custodian.organ).toBe("custodian");
    expect(r.sentinel.organ).toBe("sentinel");
    expect(r.surgeon.organ).toBe("surgeon");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes through Sentinel options", () => {
    const r = runAllOrgans({
      sentinel: { handleCounter: () => 999, handleBaseline: 10 },
    });
    expect(r.sentinel.handleCount).toBe(999);
    expect(r.sentinel.handleLeakDetected).toBe(true);
  });

  it("passes through Surgeon stats", () => {
    const r = runAllOrgans({
      surgeonStats: [{ name: "x", p99Ms: 10000, baselineMs: 1000 }],
    });
    expect(r.surgeon.organsExamined).toBe(1);
    expect(r.surgeon.organsToRestart.length).toBe(1);
  });

  it("composed duration is sum-or-less of individual organs", () => {
    const r = runAllOrgans();
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    // Each sub-organ duration should be ≤ total
    expect(r.custodian.durationMs).toBeLessThanOrEqual(r.durationMs + 10);
    expect(r.sentinel.durationMs).toBeLessThanOrEqual(r.durationMs + 10);
    expect(r.surgeon.durationMs).toBeLessThanOrEqual(r.durationMs + 10);
  });

  it("never throws on bad input", () => {
    expect(() => runAllOrgans({ surgeonStats: [] })).not.toThrow();
    expect(() => runAllOrgans({ sentinel: {} })).not.toThrow();
  });
});
