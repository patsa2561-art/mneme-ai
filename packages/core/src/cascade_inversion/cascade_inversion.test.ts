import { describe, it, expect } from "vitest";
import { runWithInversion, abBenchmark, type InversionStage } from "./index.js";

function delayStage(name: string, ms: number, returnValue: string | null, raceable = true): InversionStage<string> {
  return {
    name,
    estCost: 1,
    raceable,
    run: async (signal) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(returnValue), ms);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    }),
  };
}

describe("v2.19.42 CASCADE INVERSION · sequential mode (high confidence)", () => {
  it("first stage that returns non-null wins", async () => {
    const stages = [
      delayStage("first", 5, "result-a"),
      delayStage("second", 5, "result-b"),
    ];
    const r = await runWithInversion({ stages, ganglionConfidence: 0.99 });
    expect(r).toBeTruthy();
    expect(r!.winner).toBe("first");
    expect(r!.parallelMode).toBe(false);
  });

  it("falls through to next stage on first miss", async () => {
    const stages = [
      delayStage("first", 1, null),
      delayStage("second", 1, "result-b"),
    ];
    const r = await runWithInversion({ stages, ganglionConfidence: 0.99 });
    expect(r!.winner).toBe("second");
  });

  it("returns null when all stages miss", async () => {
    const r = await runWithInversion({
      stages: [delayStage("a", 1, null), delayStage("b", 1, null)],
      ganglionConfidence: 0.99,
    });
    expect(r).toBeNull();
  });
});

describe("v2.19.42 CASCADE INVERSION · parallel mode (low confidence)", () => {
  it("fastest hit wins the parallel race", async () => {
    const stages = [
      delayStage("slow", 50, "slow-result"),
      delayStage("fast", 5, "fast-result"),
      delayStage("medium", 25, "medium-result"),
    ];
    const r = await runWithInversion({ stages, ganglionConfidence: 0 });
    expect(r!.winner).toBe("fast");
    expect(r!.parallelMode).toBe(true);
  });

  it("non-raceable stages stay sequential", async () => {
    const stages = [
      delayStage("cache-1", 50, null, true),  // miss
      delayStage("expensive", 5, "exp-result", false), // not raceable, but only fires after raceable race
    ];
    const r = await runWithInversion({ stages, ganglionConfidence: 0 });
    expect(r!.winner).toBe("expensive");
    expect(r!.parallelMode).toBe(true);
  });

  it("returns null when all parallel + sequential stages miss", async () => {
    const r = await runWithInversion({
      stages: [delayStage("a", 1, null), delayStage("b", 1, null)],
      ganglionConfidence: 0,
    });
    expect(r).toBeNull();
  });
});

describe("v2.19.42 CASCADE INVERSION · cost budget guard", () => {
  it("falls back to sequential when totalRaceCost exceeds maxParallelCost", async () => {
    const stages = [
      { ...delayStage("a", 50, "result"), estCost: 1000 },
    ];
    const r = await runWithInversion({ stages, ganglionConfidence: 0, maxParallelCost: 100 });
    expect(r!.winner).toBe("a");
    expect(r!.parallelMode).toBe(false);
  });
});

describe("v2.19.42 CASCADE INVERSION · A/B benchmark", () => {
  it("parallel mode is at least as fast as sequential when one stage wins", async () => {
    const stages = [
      delayStage("slow", 30, "result"),
      delayStage("fast", 5, "result"),
    ];
    const ab = await abBenchmark({ stages });
    // Sequential walks "slow" first (30ms), then "fast" (5ms) = ~35ms.
    // Parallel races both — winner returns in ~5ms.
    // We're loose on exact numbers because timing varies on CI.
    expect(ab.inversion.parallelMode).toBe(true);
    expect(ab.inversion.wallTimeMs).toBeLessThanOrEqual(ab.sequential.wallTimeMs + 5);
  });
});

describe("v2.19.42 CASCADE INVERSION · 100-iter resilience", () => {
  it("never throws on randomised stage configurations", async () => {
    for (let i = 0; i < 100; i++) {
      const stages = Array.from({ length: 2 + (i % 4) }, (_, k) =>
        delayStage(`s${k}`, 1 + (k * 2), Math.random() > 0.5 ? `r${k}` : null, Math.random() > 0.3),
      );
      await expect(runWithInversion({ stages, ganglionConfidence: Math.random() })).resolves.toBeDefined();
    }
  });
});
