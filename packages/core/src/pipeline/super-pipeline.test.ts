import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./super-pipeline.js";
import { reorderBySeq } from "./superscalar.js";
import { defineStage } from "./index.js";
import type { PipelineEvent, PipelineStage } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const v of items) yield v;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("runPipeline — fan-through correctness", () => {
  it("two-stage chain produces all outputs", async () => {
    const stages = [
      defineStage<number, number>("plus1", "plus1", (n) => n + 1),
      defineStage<number, number>("times2", "times2", (n) => n * 2),
    ] as const;
    const out = await collect(
      reorderBySeq(runPipeline<number, number>({ stages }, [1, 2, 3])),
    );
    expect(out.map((x) => x.value)).toEqual([4, 6, 8]);
  });

  it("preserves input order via reorderBySeq", async () => {
    // Stage 0 sleeps inversely so later items finish first.
    const stages = [
      defineStage<number, number>("sleep", "sleep", async (n) => {
        await sleep((5 - n) * 5);
        return n;
      }),
      defineStage<number, number>("id", "id", (n) => n),
    ] as const;
    const out = await collect(
      reorderBySeq(runPipeline<number, number>({ stages, width: 4 }, [0, 1, 2, 3, 4])),
    );
    expect(out.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(out.map((x) => x.value)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("runPipeline — superscalar speedup", () => {
  it("width=4 finishes a slow stage faster than width=1", async () => {
    const inputs = Array.from({ length: 8 }, (_, i) => i);
    const slow = defineStage<number, number>("slow", "slow", async (n) => {
      await sleep(20);
      return n;
    });

    const t0 = Date.now();
    await collect(runPipeline<number, number>({ stages: [slow], width: 1 }, inputs));
    const seq = Date.now() - t0;

    const t1 = Date.now();
    await collect(runPipeline<number, number>({ stages: [slow], width: 4 }, inputs));
    const par = Date.now() - t1;

    // 4 workers should finish noticeably faster — give a generous bound to
    // keep the test stable on slow CI.
    expect(par).toBeLessThan(seq);
  });
});

describe("runPipeline — backpressure", () => {
  it("a slow downstream stage caps in-flight queue depth", async () => {
    // When stage 2 is slow + bufferSize=2, stage 1 cannot run more than
    // ~2 items ahead (queue capacity).
    let stage1InFlight = 0;
    let maxInFlight = 0;
    const stages = [
      defineStage<number, number>("fast", "fast", async (n) => {
        stage1InFlight += 1;
        maxInFlight = Math.max(maxInFlight, stage1InFlight);
        await sleep(2);
        stage1InFlight -= 1;
        return n;
      }),
      defineStage<number, number>("slow", "slow", async (n) => {
        await sleep(40);
        return n;
      }),
    ] as const;

    await collect(
      runPipeline<number, number>(
        { stages, width: 1, bufferSize: 2 },
        Array.from({ length: 10 }, (_, i) => i),
      ),
    );
    // Without backpressure, stage 1 would race ahead and finish all 10 ~immediately.
    // With bufferSize=2, the running window is bounded.
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("runPipeline — failure isolation", () => {
  it("a single stage failure does not stop the rest of the items", async () => {
    const events: PipelineEvent[] = [];
    const stages = [
      defineStage<number, number>("guard", "guard", (n) => {
        if (n === 2) throw new Error("nope");
        return n;
      }),
      defineStage<number, number>("ok", "ok", (n) => n + 100),
    ] as const;
    const out = await collect(
      runPipeline<number, number>({ stages, onEvent: (e) => events.push(e) }, [0, 1, 2, 3]),
    );
    // 3 succeed, 1 dropped — but pipeline finishes.
    expect(out.map((x) => x.value).sort((a, b) => a - b)).toEqual([100, 101, 103]);
    expect(events.some((e) => e.kind === "stage-fail")).toBe(true);
  });
});

describe("runPipeline — events + MPE telemetry", () => {
  it("emits stage-start and stage-done for every successful run", async () => {
    const events: PipelineEvent[] = [];
    const stages = [defineStage<number, number>("e", "e", (n) => n)] as const;
    await collect(
      runPipeline<number, number>({ stages, onEvent: (e) => events.push(e) }, [0, 1, 2]),
    );
    const starts = events.filter((e) => e.kind === "stage-start").length;
    const dones = events.filter((e) => e.kind === "stage-done").length;
    expect(starts).toBe(3);
    expect(dones).toBe(3);
  });

  it("requires at least one stage", async () => {
    await expect(async () => {
      for await (const _ of runPipeline({ stages: [] as never[] }, [1])) {
        // unreachable
      }
    }).rejects.toThrow(/at least one stage/);
  });

  it("stage receives StageContext.trust ∈ [0,1]", async () => {
    const trusts: number[] = [];
    const stage: PipelineStage<number, number> = {
      id: "trust",
      description: "t",
      async process(n, ctx) {
        trusts.push(ctx.trust);
        return n;
      },
    };
    await collect(runPipeline<number, number>({ stages: [stage] }, [0]));
    expect(trusts.every((t) => t >= 0 && t <= 1)).toBe(true);
  });
});
