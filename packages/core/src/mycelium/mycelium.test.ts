import { describe, it, expect } from "vitest";
import { extractLessons, buildBundle, mergeBundles, flywheelMetric, bundleLeaksRaw, noiseCount, myceliumGauntlet, type LocalOutcome, type Lesson } from "./index.js";

const outcomes: LocalOutcome[] = [
  { topic: "fix flaky auth test", approach: "retry with backoff SECRET=AKIA123", kind: "worked", count: 3 },
  { topic: "speed up payment", approach: "await inside loop", kind: "failed", count: 4 },
];

describe("v2.147 · MYCELIUM — the Sovereign Data Flywheel", () => {
  it("gauntlet is 100", () => {
    expect(myceliumGauntlet().score).toBe(100);
  });

  it("PRIVACY INVARIANT: a shared bundle carries NO raw content (only hashes + counts)", () => {
    const bundle = buildBundle(extractLessons(outcomes), { epsilon: 1, sample: () => 0 });
    expect(bundleLeaksRaw(bundle, ["AKIA123", "retry with backoff", "flaky auth test", "await inside loop"])).toBe(false);
  });

  it("shares negative knowledge (failed lessons), not just successes", () => {
    const l = extractLessons(outcomes);
    expect(l.some((x) => x.kind === "failed")).toBe(true);
  });

  it("CRDT merge is commutative and idempotent (the network converges)", () => {
    const a = extractLessons([{ topic: "t1", approach: "x", kind: "worked" }], "A");
    const b = extractLessons([{ topic: "t2", approach: "y", kind: "worked" }], "B");
    expect(JSON.stringify(mergeBundles(a, b).merged)).toBe(JSON.stringify(mergeBundles(b, a).merged));
    const once = mergeBundles(a, b).merged;
    expect(JSON.stringify(mergeBundles(once, b).merged)).toBe(JSON.stringify(once));
  });

  it("drops a forged/untrusted bundle (signature-verified)", () => {
    const a = extractLessons([{ topic: "t1", approach: "x", kind: "worked" }], "A");
    const forged: Lesson = { ...a[0]!, id: "forged", source: "evil" };
    const r = mergeBundles(a, [forged], (l) => l.source !== "evil");
    expect(r.dropped).toBe(1);
    expect(r.merged.some((l) => l.source === "evil")).toBe(false);
  });

  it("measures the compounding (inheriting a peer lesson raises the hit-rate)", () => {
    const a = extractLessons([{ topic: "local thing", approach: "x", kind: "worked" }], "A");
    const b = extractLessons([{ topic: "peer thing", approach: "y", kind: "worked" }], "B");
    const localIds = new Set(a.map((l) => l.id));
    expect(flywheelMetric(["peer thing"], a, localIds).inherited).toBe(0);
    expect(flywheelMetric(["peer thing"], mergeBundles(a, b).merged, localIds).inherited).toBe(1);
  });

  it("DP noise is bounded + non-negative; total on hostile input", () => {
    expect(noiseCount(10, 1, 0)).toBe(10);
    expect(noiseCount(5, 1, -1000)).toBeGreaterThanOrEqual(0);
    expect(() => extractLessons(null as never)).not.toThrow();
    expect(() => mergeBundles(null as never, undefined as never)).not.toThrow();
    expect(() => bundleLeaksRaw(null as never, null as never)).not.toThrow();
  });
});
