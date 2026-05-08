import { describe, expect, it } from "vitest";
import { pLimit, pMap, pMapSettled } from "./concurrency.js";

describe("pLimit", () => {
  it("never exceeds the configured concurrency", async () => {
    const limit = pLimit(3);
    let active = 0;
    let peak = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tasks = Array.from({ length: 12 }, (_, i) =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(5 + (i % 3) * 5);
        active -= 1;
        return i;
      }),
    );
    const results = await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("preserves input order even when tasks complete out of order", async () => {
    const limit = pLimit(4);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const out = await Promise.all(
      [50, 5, 30, 1, 20].map((ms, idx) => limit(async () => { await sleep(ms); return idx; })),
    );
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not poison the pool when one task throws", async () => {
    const limit = pLimit(2);
    const a = limit(async () => { throw new Error("boom"); });
    const b = limit(async () => 42);
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe(42);
  });

  it("rejects bad concurrency values", () => {
    expect(() => pLimit(0)).toThrow();
    expect(() => pLimit(-1)).toThrow();
    expect(() => pLimit(Infinity)).toThrow();
  });

  it("exposes active + queued counts", async () => {
    const limit = pLimit(2);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tasks = [
      limit(async () => { await sleep(10); return 1; }),
      limit(async () => { await sleep(10); return 2; }),
      limit(async () => { await sleep(10); return 3; }),
      limit(async () => { await sleep(10); return 4; }),
    ];
    // Snapshot mid-flight (after the next microtask tick scheduling first 2)
    await new Promise((r) => setImmediate(r));
    expect(limit.active).toBeLessThanOrEqual(2);
    await Promise.all(tasks);
    expect(limit.active).toBe(0);
    expect(limit.queued).toBe(0);
  });
});

describe("pMap", () => {
  it("maps in input order", async () => {
    const out = await pMap([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("propagates the first thrown error", async () => {
    await expect(
      pMap([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("nope");
        return n;
      }),
    ).rejects.toThrow("nope");
  });
});

describe("pMapSettled", () => {
  it("returns aligned results + errors arrays", async () => {
    const { results, errors } = await pMapSettled([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("nope");
      return n * 10;
    });
    expect(results[0]).toBe(10);
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe(30);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeInstanceOf(Error);
    expect(errors[2]).toBeUndefined();
  });
});
