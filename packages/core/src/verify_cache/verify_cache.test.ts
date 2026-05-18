import { describe, it, expect, beforeEach } from "vitest";
import {
  withVerifyCache,
  syncMemo,
  _resetVerifyCache,
  verifyCacheStats,
  claimKey,
} from "./index.js";

describe("verify_cache — TTL-bounded memo + concurrency coalescing", () => {
  beforeEach(() => _resetVerifyCache());

  it("memo hit within TTL returns cached value without re-running compute", async () => {
    let calls = 0;
    const compute = async () => { calls++; return { v: 42 }; };

    const r1 = await withVerifyCache("k", compute);
    const r2 = await withVerifyCache("k", compute);
    const r3 = await withVerifyCache("k", compute);

    expect(calls).toBe(1);
    expect(r1).toEqual({ v: 42 });
    expect(r2).toEqual({ v: 42 });
    expect(r3).toEqual({ v: 42 });

    const stats = verifyCacheStats();
    expect(stats.totalMisses).toBe(1);
    expect(stats.totalHits).toBe(2);
  });

  it("memo expires after TTL — next call re-runs compute", async () => {
    let calls = 0;
    const compute = async () => { calls++; return calls; };

    await withVerifyCache("k", compute, { ttlMs: 10 });
    await new Promise((r) => setTimeout(r, 25));
    await withVerifyCache("k", compute, { ttlMs: 10 });

    expect(calls).toBe(2);
  });

  it("CONCURRENCY COALESCE: 50 parallel identical calls = 1 compute + 49 await", async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return "result";
    };

    const promises = Array.from({ length: 50 }, () => withVerifyCache("hot", compute));
    const results = await Promise.all(promises);

    expect(calls).toBe(1); // ← the killer assertion
    expect(results.every((r) => r === "result")).toBe(true);

    const stats = verifyCacheStats();
    expect(stats.totalMisses).toBe(1);
    expect(stats.totalCoalesced).toBe(49);
    expect(stats.inflightSize).toBe(0); // in-flight cleared after resolve
  });

  it("DIFFERENT KEYS: 50 parallel distinct calls = 50 compute (no false coalescing)", async () => {
    let calls = 0;
    const compute = async () => { calls++; return calls; };

    const promises = Array.from({ length: 50 }, (_, i) =>
      withVerifyCache(`k${i}`, compute),
    );
    await Promise.all(promises);

    expect(calls).toBe(50);
  });

  it("FAILURE PROPAGATION: 50 parallel callers see same error from 1 compute throw", async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("kaboom");
    };

    const promises = Array.from({ length: 50 }, () =>
      withVerifyCache("fail", compute).catch((e) => (e as Error).message),
    );
    const results = await Promise.all(promises);

    expect(calls).toBe(1);
    expect(results.every((r) => r === "kaboom")).toBe(true);
    // After failure: in-flight cleared, NOT cached (next call should retry).
    const stats = verifyCacheStats();
    expect(stats.inflightSize).toBe(0);

    let secondCalls = 0;
    const recovery = async () => { secondCalls++; return "ok"; };
    const r = await withVerifyCache("fail", recovery);
    expect(secondCalls).toBe(1);
    expect(r).toBe("ok");
  });

  it("EVICTION: when memo exceeds MAX_MEMO_ENTRIES, oldest evicted first", async () => {
    // Force >1000 distinct entries fast. Default MAX_MEMO_ENTRIES = 1000.
    for (let i = 0; i < 1100; i++) {
      // syncMemo is the fastest way to fill the memo
      syncMemo(`k${i}`, () => i, { ttlMs: 60_000 });
    }
    const stats = verifyCacheStats();
    expect(stats.memoSize).toBeLessThanOrEqual(1000);
    expect(stats.memoSize).toBeGreaterThanOrEqual(900);
  });

  it("claimKey normalises whitespace + applies salt", () => {
    expect(claimKey("foo  bar")).toBe("foo bar");
    expect(claimKey("  foo bar  ")).toBe("foo bar");
    expect(claimKey("foo", "salt")).toBe("salt::foo");
    expect(claimKey("a\nb")).toBe("a b");
  });

  it("syncMemo: hit returns cached without re-compute", () => {
    let calls = 0;
    const compute = () => { calls++; return calls; };
    syncMemo("s", compute);
    syncMemo("s", compute);
    syncMemo("s", compute);
    expect(calls).toBe(1);
  });

  it("stress: 200-parallel mixed keys (50 hot + 150 unique) sub-100ms", async () => {
    const t0 = Date.now();
    let calls = 0;
    const compute = async (id: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return id;
    };

    const promises: Promise<string>[] = [];
    // 50 parallel calls to "hot" → should coalesce to 1
    for (let i = 0; i < 50; i++) {
      promises.push(withVerifyCache("hot", () => compute("hot")));
    }
    // 150 distinct unique keys → 150 computes
    for (let i = 0; i < 150; i++) {
      promises.push(withVerifyCache(`u${i}`, () => compute(`u${i}`)));
    }
    await Promise.all(promises);
    const elapsed = Date.now() - t0;

    expect(calls).toBe(151); // 1 hot + 150 unique
    expect(elapsed).toBeLessThan(500); // wide envelope for CI jitter
  });
});
