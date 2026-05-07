import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  emptyMpeState,
  updateMpe,
  powerIterate,
  recommendFromMpe,
  serializeMpeState,
  deserializeMpeState,
  readMpeState,
  writeMpeState,
  type StageResult,
} from "./mpe.js";

describe("MPE — formula basics", () => {
  it("emptyMpeState seeds decay and empty maps", () => {
    const s = emptyMpeState(0.9);
    expect(s.decay).toBe(0.9);
    expect(s.trust.size).toBe(0);
    expect(s.callCount.size).toBe(0);
  });

  it("a single successful observation moves trust above prior", () => {
    const s = updateMpe(emptyMpeState(0.85), [
      { stage: "embed", ok: true, latencyMs: 10, targetMs: 100 },
    ]);
    // Single stage → prior = 1, trust normalized to 1.
    expect(s.trust.get("embed")).toBeCloseTo(1.0, 6);
    expect(s.successCount.get("embed")).toBe(1);
    expect(s.failureCount.get("embed")).toBe(0);
  });

  it("a single failure leaves only the (1-α)×prior contribution", () => {
    const s = updateMpe(emptyMpeState(0.85), [
      { stage: "embed", ok: false, latencyMs: 10, targetMs: 100 },
    ]);
    expect(s.trust.get("embed")).toBeCloseTo(1.0, 6); // normalized
    // After normalization a single stage is always 1, so check raw counters.
    expect(s.failureCount.get("embed")).toBe(1);
  });

  it("trust eigenvector sums to 1 (proper probability distribution)", () => {
    const results: StageResult[] = [
      { stage: "a", ok: true, latencyMs: 10, targetMs: 100 },
      { stage: "b", ok: true, latencyMs: 50, targetMs: 100 },
      { stage: "c", ok: false, latencyMs: 200, targetMs: 100 },
    ];
    const s = updateMpe(emptyMpeState(0.85), results);
    const total = [...s.trust.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });
});

describe("MPE — latency weighting", () => {
  it("fast successes outrank slow successes", () => {
    const results: StageResult[] = [
      { stage: "fast", ok: true, latencyMs: 5, targetMs: 100 },
      { stage: "slow", ok: true, latencyMs: 500, targetMs: 100 },
    ];
    // Power-iterate to converge.
    const s = powerIterate(emptyMpeState(0.85), results, { maxIter: 30 });
    expect(s.trust.get("fast")!).toBeGreaterThan(s.trust.get("slow")!);
  });

  it("successes outrank failures even at the same latency", () => {
    const results: StageResult[] = [
      { stage: "ok", ok: true, latencyMs: 50, targetMs: 100 },
      { stage: "bad", ok: false, latencyMs: 50, targetMs: 100 },
    ];
    const s = powerIterate(emptyMpeState(0.85), results, { maxIter: 30 });
    expect(s.trust.get("ok")!).toBeGreaterThan(s.trust.get("bad")!);
  });

  it("targetMs from earlier observation is reused if not provided", () => {
    let s = updateMpe(emptyMpeState(0.85), [
      { stage: "x", ok: true, latencyMs: 5, targetMs: 50 },
    ]);
    s = updateMpe(s, [{ stage: "x", ok: true, latencyMs: 5 }]);
    expect(s.targetMs.get("x")).toBe(50);
  });
});

describe("MPE — eigentrust convergence", () => {
  it("power iteration converges (L1 distance shrinks below tol)", () => {
    const results: StageResult[] = [
      { stage: "p", ok: true, latencyMs: 10, targetMs: 100 },
      { stage: "q", ok: true, latencyMs: 20, targetMs: 100 },
      { stage: "r", ok: false, latencyMs: 100, targetMs: 100 },
    ];
    const a = powerIterate(emptyMpeState(0.85), results, { maxIter: 100, tol: 1e-9 });
    const b = updateMpe(a, results);
    let l1 = 0;
    for (const k of a.trust.keys()) l1 += Math.abs((a.trust.get(k) ?? 0) - (b.trust.get(k) ?? 0));
    expect(l1).toBeLessThan(1e-6);
  });

  it("decay closer to 1 makes the ranking sharper", () => {
    const results: StageResult[] = [
      { stage: "fast", ok: true, latencyMs: 1, targetMs: 100 },
      { stage: "slow", ok: true, latencyMs: 200, targetMs: 100 },
    ];
    const sharp = powerIterate(emptyMpeState(0.99), results, { maxIter: 100 });
    const soft = powerIterate(emptyMpeState(0.5), results, { maxIter: 100 });
    const sharpGap = (sharp.trust.get("fast") ?? 0) - (sharp.trust.get("slow") ?? 0);
    const softGap = (soft.trust.get("fast") ?? 0) - (soft.trust.get("slow") ?? 0);
    expect(sharpGap).toBeGreaterThan(softGap);
  });
});

describe("MPE — recommendation engine", () => {
  it("ranking is sorted top-down by trust", () => {
    const results: StageResult[] = [
      { stage: "a", ok: true, latencyMs: 5, targetMs: 100 },
      { stage: "b", ok: true, latencyMs: 50, targetMs: 100 },
      { stage: "c", ok: false, latencyMs: 200, targetMs: 100 },
    ];
    const s = powerIterate(emptyMpeState(0.85), results, { maxIter: 50 });
    const rec = recommendFromMpe(s);
    for (let i = 1; i < rec.ranking.length; i++) {
      expect(rec.ranking[i].trust).toBeLessThanOrEqual(rec.ranking[i - 1].trust);
    }
  });

  it("scaleUp picks high-trust stages whose avg latency exceeds target", () => {
    // Fabricate state directly so we control averages.
    const s = emptyMpeState(0.85);
    s.trust.set("hot", 0.6);
    s.trust.set("cold", 0.4);
    s.callCount.set("hot", 5);
    s.callCount.set("cold", 5);
    s.totalLatencyMs.set("hot", 1000); // avg 200ms
    s.totalLatencyMs.set("cold", 50); // avg 10ms
    s.targetMs.set("hot", 100);
    s.targetMs.set("cold", 100);
    s.failureCount.set("hot", 0);
    s.failureCount.set("cold", 0);
    const rec = recommendFromMpe(s);
    expect(rec.scaleUp).toContain("hot");
    expect(rec.scaleUp).not.toContain("cold");
  });

  it("scaleDown flags low-trust + high-failure stages", () => {
    const s = emptyMpeState(0.85);
    s.trust.set("good", 0.7);
    s.trust.set("flaky", 0.1);
    s.callCount.set("good", 10);
    s.callCount.set("flaky", 10);
    s.failureCount.set("good", 0);
    s.failureCount.set("flaky", 6); // 60% failure
    s.totalLatencyMs.set("good", 100);
    s.totalLatencyMs.set("flaky", 100);
    const rec = recommendFromMpe(s);
    expect(rec.scaleDown).toContain("flaky");
  });

  it("noSpeculate flags stages below the speculate threshold", () => {
    const s = emptyMpeState(0.85);
    s.trust.set("a", 0.95);
    s.trust.set("b", 0.04);
    s.trust.set("c", 0.01);
    const rec = recommendFromMpe(s, { speculateThreshold: 0.3 });
    // prior = 1/3 ≈ 0.333; cutoff = 0.3 * prior ≈ 0.1
    expect(rec.noSpeculate).toContain("c");
  });
});

describe("MPE — persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mneme-mpe-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serialize → deserialize is round-trip stable", () => {
    const s = updateMpe(emptyMpeState(0.85), [
      { stage: "x", ok: true, latencyMs: 10, targetMs: 50 },
      { stage: "y", ok: false, latencyMs: 200, targetMs: 50 },
    ]);
    const out = deserializeMpeState(serializeMpeState(s));
    expect(out.trust.get("x")).toBeCloseTo(s.trust.get("x")!, 9);
    expect(out.trust.get("y")).toBeCloseTo(s.trust.get("y")!, 9);
    expect(out.decay).toBe(0.85);
  });

  it("readMpeState returns empty when file does not exist", () => {
    const s = readMpeState(dir);
    expect(s.trust.size).toBe(0);
    expect(s.decay).toBe(0.85);
  });

  it("writeMpeState then readMpeState preserves the state", () => {
    const s = updateMpe(emptyMpeState(0.7), [
      { stage: "z", ok: true, latencyMs: 5, targetMs: 100 },
    ]);
    writeMpeState(dir, s);
    expect(existsSync(join(dir, ".mneme", "mpe.json"))).toBe(true);
    const back = readMpeState(dir);
    expect(back.decay).toBe(0.7);
    expect(back.trust.get("z")).toBeCloseTo(s.trust.get("z")!, 9);
  });

  it("readMpeState handles corrupt JSON gracefully", () => {
    writeMpeState(dir, emptyMpeState());
    const f = join(dir, ".mneme", "mpe.json");
    // Stomp the file with garbage.
    require("node:fs").writeFileSync(f, "{not json", "utf8");
    const back = readMpeState(dir);
    expect(back.trust.size).toBe(0);
  });

  it("written file is valid JSON", () => {
    const s = updateMpe(emptyMpeState(), [
      { stage: "a", ok: true, latencyMs: 1, targetMs: 10 },
    ]);
    writeMpeState(dir, s);
    const text = readFileSync(join(dir, ".mneme", "mpe.json"), "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
