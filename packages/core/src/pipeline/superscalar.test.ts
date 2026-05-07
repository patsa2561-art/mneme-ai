import { describe, it, expect, vi } from "vitest";
import { superscalar, reorderBySeq, speculatePrefetch } from "./superscalar.js";
import type { PipelineStage, SeqItem } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeStage<I, O>(
  id: string,
  fn: (input: I) => Promise<O>,
): PipelineStage<I, O> {
  return { id, description: id, async process(input) { return fn(input); } };
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const v of items) yield v;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("superscalar — N parallel workers", () => {
  it("processes every input exactly once with width=4", async () => {
    const seen: number[] = [];
    const stage = makeStage<number, number>("double", async (n) => {
      seen.push(n);
      return n * 2;
    });
    const inputs: SeqItem<number>[] = Array.from({ length: 20 }, (_, i) => ({
      seq: i,
      value: i,
    }));
    const out = await collect(superscalar(stage, fromArray(inputs), 4, { trust: 1 }));
    expect(out).toHaveLength(20);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("with width>1, slow items don't block fast ones (out-of-order)", async () => {
    // Item 0 sleeps 60ms, items 1..3 sleep 5ms. With width=2, item 1 should
    // finish before item 0.
    const stage = makeStage<number, number>("vary", async (n) => {
      await sleep(n === 0 ? 60 : 5);
      return n;
    });
    const inputs: SeqItem<number>[] = [0, 1, 2, 3].map((v, i) => ({ seq: i, value: v }));
    const out = await collect(superscalar(stage, fromArray(inputs), 2, { trust: 1 }));
    // First item to complete should NOT be seq 0.
    expect(out[0].seq).not.toBe(0);
    expect(out).toHaveLength(4);
  });

  it("workerId is forwarded into ctx (0..width-1)", async () => {
    const ids = new Set<number>();
    const stage: PipelineStage<number, number> = {
      id: "id-stage",
      description: "id",
      async process(n, ctx) {
        ids.add(ctx.workerId);
        await sleep(2);
        return n;
      },
    };
    const inputs: SeqItem<number>[] = Array.from({ length: 8 }, (_, i) => ({ seq: i, value: i }));
    await collect(superscalar(stage, fromArray(inputs), 3, { trust: 1 }));
    expect([...ids].every((i) => i >= 0 && i < 3)).toBe(true);
  });

  it("a thrown stage error propagates to the consumer", async () => {
    const stage = makeStage<number, number>("err", async (n) => {
      if (n === 1) throw new Error("boom");
      return n;
    });
    const inputs: SeqItem<number>[] = [0, 1, 2].map((v, i) => ({ seq: i, value: v }));
    await expect(collect(superscalar(stage, fromArray(inputs), 1, { trust: 1 }))).rejects.toThrow(
      /boom/,
    );
  });
});

describe("reorderBySeq — input-order recovery", () => {
  it("yields items in monotonic seq order", async () => {
    // Out-of-order source: 2, 0, 1, 3
    const src: SeqItem<string>[] = [
      { seq: 2, value: "c" },
      { seq: 0, value: "a" },
      { seq: 1, value: "b" },
      { seq: 3, value: "d" },
    ];
    const out = await collect(reorderBySeq(fromArray(src)));
    expect(out.map((x) => x.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("respects a non-zero startAt", async () => {
    const src: SeqItem<number>[] = [
      { seq: 11, value: 11 },
      { seq: 10, value: 10 },
    ];
    const out = await collect(reorderBySeq(fromArray(src), 10));
    expect(out.map((x) => x.seq)).toEqual([10, 11]);
  });

  it("drains buffered items once the source closes (gap fallback)", async () => {
    // Seq 1 is missing — reorder still emits the remaining items.
    const src: SeqItem<number>[] = [
      { seq: 0, value: 0 },
      { seq: 2, value: 2 },
    ];
    const out = await collect(reorderBySeq(fromArray(src)));
    expect(out.map((x) => x.value)).toEqual([0, 2]);
  });
});

describe("speculatePrefetch", () => {
  it("starts the next stage immediately on the predicted input", async () => {
    const fn = vi.fn(async (n: number) => n * 10);
    const stage = makeStage("predict", fn);
    const { promise } = speculatePrefetch(stage, 7);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe(70);
  });

  it("cancel() flips the cancelled flag (the underlying promise still resolves)", async () => {
    const stage = makeStage("predict", async (n: number) => {
      await sleep(10);
      return n + 1;
    });
    const { promise, cancel, cancelled } = speculatePrefetch(stage, 1);
    cancel();
    expect(cancelled()).toBe(true);
    // The promise still resolves — cancel is advisory.
    await expect(promise).resolves.toBe(2);
  });

  it("emits a 'speculate' event when an emit sink is provided", async () => {
    const events: string[] = [];
    const stage = makeStage("predict", async (n: number) => n);
    speculatePrefetch(stage, 0, {
      trust: 1,
      workerId: -1,
      emit: (e) => events.push(e.kind),
    });
    expect(events).toContain("speculate");
  });
});
