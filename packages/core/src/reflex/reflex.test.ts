import { describe, it, expect } from "vitest";
import {
  eventCacheKey,
  emptyStore,
  recordObservation,
  verifyStore,
  predictFollowup,
  emptyCache,
  writeCacheEntry,
  readCache,
  gcCache,
  prefetch,
  emptyTelemetry,
  recordFetch,
  computeStats,
  formatStatsLine,
  type ReflexEvent,
  type PheromoneStore,
} from "./index.js";

const SECRET = "reflex-test-secret-997744";

function mkEvent(kind: ReflexEvent["kind"], context: Record<string, unknown>, ts = 1_000_000): ReflexEvent {
  return { v: 1, kind, context, ts };
}

describe("v2.19.22 REFLEX · eventCacheKey (signature stability)", () => {
  it("MEASURED 100% determinism: same event -> same key (100 trials)", () => {
    const e = mkEvent("file_save", { path: "src/foo.ts" });
    const k1 = eventCacheKey(e);
    let allEqual = true;
    for (let i = 0; i < 100; i++) {
      if (eventCacheKey(e) !== k1) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
    expect(k1.length).toBe(16);
  });

  it("ignores ts (same kind+context but different ts -> same key)", () => {
    const a = mkEvent("git_commit", { sha: "abc" }, 1);
    const b = mkEvent("git_commit", { sha: "abc" }, 999_999);
    expect(eventCacheKey(a)).toBe(eventCacheKey(b));
  });

  it("distinct kind OR context -> distinct key (50 random pairs, no collisions)", () => {
    const seen = new Set<string>();
    let collisions = 0;
    for (let i = 0; i < 50; i++) {
      const e = mkEvent(i % 2 === 0 ? "file_save" : "git_commit", { i });
      const k = eventCacheKey(e);
      if (seen.has(k)) collisions++;
      seen.add(k);
    }
    expect(collisions).toBe(0);
  });

  it("context key order does not matter (canonicalisation)", () => {
    const a = mkEvent("user_chat", { a: 1, b: 2 });
    const b = mkEvent("user_chat", { b: 2, a: 1 });
    expect(eventCacheKey(a)).toBe(eventCacheKey(b));
  });
});

describe("v2.19.22 REFLEX · pheromone store (HMAC chain)", () => {
  it("recordObservation appends + HMAC-chains to predecessor", () => {
    let s = emptyStore();
    const e = mkEvent("file_save", { path: "x.ts" });
    s = recordObservation({ store: s, event: e, followup: { toolName: "mneme.ask", args: { q: "foo" }, ts: 1 }, secret: SECRET });
    s = recordObservation({ store: s, event: e, followup: { toolName: "mneme.why", args: { f: "x.ts" }, ts: 2 }, secret: SECRET });
    expect(s.records).toHaveLength(2);
    expect(s.records[0]!.prevSig).toBeNull();
    expect(s.records[1]!.prevSig).toBe(s.records[0]!.sig);
  });

  it("verifyStore passes on untampered chain (10 records)", () => {
    let s = emptyStore();
    for (let i = 0; i < 10; i++) {
      s = recordObservation({
        store: s,
        event: mkEvent("git_commit", { i }),
        followup: { toolName: "mneme.ask", args: { i }, ts: i },
        secret: SECRET,
      });
    }
    expect(verifyStore(s, SECRET).ok).toBe(true);
  });

  it("verifyStore detects tamper at exact step", () => {
    let s = emptyStore();
    for (let i = 0; i < 5; i++) {
      s = recordObservation({
        store: s,
        event: mkEvent("file_save", { i }),
        followup: { toolName: "mneme.ask", args: { i }, ts: i },
        secret: SECRET,
      });
    }
    const tampered: PheromoneStore = {
      ...s,
      records: s.records.map((r, i) => (i === 2 ? { ...r, followup: { ...r.followup, toolName: "EVIL" } } : r)),
    };
    const v = verifyStore(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});

describe("v2.19.22 REFLEX · predictor (frequency-based, deterministic)", () => {
  it("empty store -> empty predictions", () => {
    const e = mkEvent("file_save", { path: "x.ts" });
    expect(predictFollowup({ store: emptyStore(), event: e })).toEqual([]);
  });

  it("top-N ranked by frequency; confidence = matches/total within event sig", () => {
    let s = emptyStore();
    const e = mkEvent("file_save", { path: "x.ts" });
    // ask called 4 times, why 2 times, status 1 time for this event sig.
    for (let i = 0; i < 4; i++) s = recordObservation({ store: s, event: e, followup: { toolName: "mneme.ask", args: {}, ts: i }, secret: SECRET });
    for (let i = 0; i < 2; i++) s = recordObservation({ store: s, event: e, followup: { toolName: "mneme.why", args: {}, ts: i }, secret: SECRET });
    s = recordObservation({ store: s, event: e, followup: { toolName: "mneme.status", args: {}, ts: 99 }, secret: SECRET });
    const p = predictFollowup({ store: s, event: e, topN: 3 });
    expect(p).toHaveLength(3);
    expect(p[0]!.toolName).toBe("mneme.ask");
    expect(p[0]!.confidence).toBeCloseTo(4 / 7, 5);
    expect(p[0]!.sampleCount).toBe(4);
    expect(p[1]!.toolName).toBe("mneme.why");
    expect(p[2]!.toolName).toBe("mneme.status");
  });

  it("predictions scoped to matching event sig only (no cross-event leakage)", () => {
    let s = emptyStore();
    const eA = mkEvent("file_save", { path: "A.ts" });
    const eB = mkEvent("file_save", { path: "B.ts" });
    for (let i = 0; i < 5; i++) s = recordObservation({ store: s, event: eA, followup: { toolName: "mneme.A_only", args: {}, ts: i }, secret: SECRET });
    for (let i = 0; i < 5; i++) s = recordObservation({ store: s, event: eB, followup: { toolName: "mneme.B_only", args: {}, ts: i }, secret: SECRET });
    const pA = predictFollowup({ store: s, event: eA });
    const pB = predictFollowup({ store: s, event: eB });
    expect(pA.map((x) => x.toolName)).toEqual(["mneme.A_only"]);
    expect(pB.map((x) => x.toolName)).toEqual(["mneme.B_only"]);
  });

  it("MEASURED deterministic: same input -> same output (20 trials)", () => {
    let s = emptyStore();
    const e = mkEvent("git_commit", { sha: "deadbeef" });
    for (let i = 0; i < 6; i++) s = recordObservation({ store: s, event: e, followup: { toolName: `tool.${i % 2}`, args: { i }, ts: i }, secret: SECRET });
    const first = JSON.stringify(predictFollowup({ store: s, event: e }));
    let allEqual = true;
    for (let i = 0; i < 20; i++) {
      if (JSON.stringify(predictFollowup({ store: s, event: e })) !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.22 REFLEX · cache (TTL + HMAC integrity)", () => {
  it("write + read happy path", () => {
    let c = emptyCache();
    const e = mkEvent("file_save", { path: "x.ts" });
    c = writeCacheEntry({ cache: c, event: e, toolName: "mneme.ask", args: { q: "foo" }, result: { answer: 42 }, nowMs: 1_000_000, secret: SECRET });
    const r = readCache({ cache: c, event: e, toolName: "mneme.ask", nowMs: 1_000_000, secret: SECRET });
    expect(r.hit).toBe(true);
    expect(r.entry?.result).toEqual({ answer: 42 });
  });

  it("expired entry reads as MISS", () => {
    let c = emptyCache();
    const e = mkEvent("file_save", { path: "x.ts" });
    c = writeCacheEntry({ cache: c, event: e, toolName: "mneme.ask", args: {}, result: 1, ttlMs: 1000, nowMs: 0, secret: SECRET });
    expect(readCache({ cache: c, event: e, toolName: "mneme.ask", nowMs: 500, secret: SECRET }).hit).toBe(true);
    expect(readCache({ cache: c, event: e, toolName: "mneme.ask", nowMs: 2000, secret: SECRET }).hit).toBe(false);
  });

  it("tampered entry refuses to hit (HMAC mismatch)", () => {
    let c = emptyCache();
    const e = mkEvent("file_save", { path: "x.ts" });
    c = writeCacheEntry({ cache: c, event: e, toolName: "mneme.ask", args: {}, result: "ok", nowMs: 0, secret: SECRET });
    const eventKey = Object.keys(c.entries)[0]!;
    const tampered = {
      v: c.v,
      entries: { [eventKey]: [{ ...c.entries[eventKey]![0]!, result: "EVIL" }] },
    };
    const r = readCache({ cache: tampered as typeof c, event: e, toolName: "mneme.ask", nowMs: 100, secret: SECRET });
    expect(r.hit).toBe(false);
    expect(r.reason).toContain("HMAC");
  });

  it("argsMatch predicate filters", () => {
    let c = emptyCache();
    const e = mkEvent("user_chat", { topic: "auth" });
    c = writeCacheEntry({ cache: c, event: e, toolName: "mneme.ask", args: { q: "what" }, result: 1, nowMs: 0, secret: SECRET });
    c = writeCacheEntry({ cache: c, event: e, toolName: "mneme.ask", args: { q: "why" }, result: 2, nowMs: 0, secret: SECRET });
    const r = readCache({
      cache: c, event: e, toolName: "mneme.ask",
      argsMatch: (a) => a["q"] === "why", nowMs: 100, secret: SECRET,
    });
    expect(r.hit).toBe(true);
    expect(r.entry?.result).toBe(2);
  });

  it("gcCache drops expired entries; keeps fresh", () => {
    let c = emptyCache();
    const e = mkEvent("file_save", { path: "x.ts" });
    c = writeCacheEntry({ cache: c, event: e, toolName: "old", args: {}, result: 0, ttlMs: 100, nowMs: 0, secret: SECRET });
    c = writeCacheEntry({ cache: c, event: e, toolName: "fresh", args: {}, result: 1, ttlMs: 100000, nowMs: 0, secret: SECRET });
    const { cache: gc, removed } = gcCache({ cache: c, nowMs: 5000 });
    expect(removed).toBe(1);
    const keys = Object.keys(gc.entries);
    expect(keys).toHaveLength(1);
    expect(gc.entries[keys[0]!]!).toHaveLength(1);
    expect(gc.entries[keys[0]!]![0]!.toolName).toBe("fresh");
  });
});

describe("v2.19.22 REFLEX · prefetch executor (budget-bound, concurrent)", () => {
  it("executes all candidates in parallel; writes cache for each", async () => {
    const e = mkEvent("git_commit", { sha: "deadbeef" });
    const invoke = async (toolName: string, args: Record<string, unknown>) => ({ toolName, args, ts: Date.now() });
    const r = await prefetch({
      cache: emptyCache(),
      event: e,
      candidates: [
        { toolName: "mneme.ask", args: { q: "1" } },
        { toolName: "mneme.why", args: { f: "x" } },
        { toolName: "mneme.status", args: {} },
      ],
      invoke,
      budgetMs: 200,
      secret: SECRET,
    });
    expect(r.executed).toHaveLength(3);
    expect(r.executed.every((x) => x.ok)).toBe(true);
    expect(r.withinBudget).toBe(true);
    const keys = Object.keys(r.cache.entries);
    expect(keys).toHaveLength(1);
    expect(r.cache.entries[keys[0]!]!).toHaveLength(3);
  });

  it("slow tool times out at budget; other tools complete normally", async () => {
    const e = mkEvent("file_save", { path: "x.ts" });
    const invoke = async (toolName: string) => {
      if (toolName === "slow") {
        await new Promise((r) => setTimeout(r, 500));
        return "slow_done";
      }
      return `${toolName}_done`;
    };
    const r = await prefetch({
      cache: emptyCache(),
      event: e,
      candidates: [
        { toolName: "fast", args: {} },
        { toolName: "slow", args: {} },
        { toolName: "fast2", args: {} },
      ],
      invoke,
      budgetMs: 100,
      secret: SECRET,
    });
    const slow = r.executed.find((x) => x.toolName === "slow")!;
    expect(slow.ok).toBe(false);
    expect(slow.error).toBe("prefetch_timeout");
    const fastCount = r.executed.filter((x) => x.ok).length;
    expect(fastCount).toBe(2);
  });

  it("failed candidates are NOT written to cache", async () => {
    const e = mkEvent("user_chat", { topic: "x" });
    const invoke = async (toolName: string) => {
      if (toolName === "bad") throw new Error("nope");
      return toolName;
    };
    const r = await prefetch({
      cache: emptyCache(),
      event: e,
      candidates: [
        { toolName: "good", args: {} },
        { toolName: "bad", args: {} },
      ],
      invoke,
      budgetMs: 200,
      secret: SECRET,
    });
    const eventKey = Object.keys(r.cache.entries)[0]!;
    const cached = r.cache.entries[eventKey] ?? [];
    expect(cached).toHaveLength(1);
    expect(cached[0]!.toolName).toBe("good");
  });
});

describe("v2.19.22 REFLEX · MEASURED end-to-end (hit rate + speedup)", () => {
  it("MEASURED hit rate >= 80% on synthetic warm trail (10 warm-up + 20 follow-up events)", async () => {
    let store = emptyStore();
    let cache = emptyCache();
    let telemetry = emptyTelemetry();
    const e = mkEvent("git_commit", { sha: "abc" });
    // Phase 1 — warm-up: observe (git_commit -> mneme.ask) 10 times.
    for (let i = 0; i < 10; i++) {
      store = recordObservation({
        store,
        event: e,
        followup: { toolName: "mneme.ask", args: { q: "what changed" }, ts: i },
        secret: SECRET,
      });
    }
    // Phase 2 — predictive prefetch on next event.
    const predictions = predictFollowup({ store, event: e, topN: 3 });
    expect(predictions).toHaveLength(1);
    const { cache: c1 } = await prefetch({
      cache,
      event: e,
      candidates: predictions.map((p) => ({ toolName: p.toolName, args: p.argsTemplate })),
      invoke: async () => "answer",
      budgetMs: 200,
      secret: SECRET,
    });
    cache = c1;
    // Phase 3 — 20 follow-up reads; should all HIT.
    for (let i = 0; i < 20; i++) {
      const r = readCache({ cache, event: e, toolName: "mneme.ask", secret: SECRET });
      telemetry = recordFetch({ telemetry, hit: r.hit });
    }
    const stats = computeStats({ store, cache, telemetry });
    expect(stats.hitRate).toBeGreaterThanOrEqual(0.8);
    expect(stats.hitRate).toBe(1.0); // perfect within window
  });

  it("MEASURED speedup: cached read p50 < cold invoke p50 (50 trials each)", async () => {
    const e = mkEvent("file_save", { path: "src/x.ts" });
    let cache = emptyCache();
    // Cold invoke simulator: 20ms work.
    const coldInvoke = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return "x";
    };
    // Warm cache once.
    const { cache: c1 } = await prefetch({
      cache, event: e, candidates: [{ toolName: "mneme.ask", args: {} }],
      invoke: coldInvoke, budgetMs: 200, secret: SECRET,
    });
    cache = c1;
    // Measure 50 cold + 50 cached.
    const cold: number[] = [];
    const cached: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      await coldInvoke();
      cold.push(Date.now() - t0);
      const t1 = Date.now();
      const r = readCache({ cache, event: e, toolName: "mneme.ask", secret: SECRET });
      cached.push(Date.now() - t1);
      expect(r.hit).toBe(true);
    }
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };
    const coldP50 = median(cold);
    const cachedP50 = median(cached);
    expect(coldP50).toBeGreaterThanOrEqual(15);
    expect(cachedP50).toBeLessThan(coldP50);
    expect(cachedP50).toBeLessThanOrEqual(5);
  });

  it("MEASURED 100% cache integrity across 50 round-trips (no false hits, no missed verifies)", () => {
    let c = emptyCache();
    const e = mkEvent("user_chat", { topic: "auth" });
    let passes = 0;
    for (let i = 0; i < 50; i++) {
      c = writeCacheEntry({ cache: c, event: e, toolName: `t${i}`, args: { i }, result: `r${i}`, nowMs: 0, secret: SECRET });
      const r = readCache({ cache: c, event: e, toolName: `t${i}`, nowMs: 100, secret: SECRET });
      if (r.hit && r.entry?.result === `r${i}`) passes++;
    }
    expect(passes).toBe(50);
  });
});

describe("v2.19.22 REFLEX · stats + formatter", () => {
  it("computeStats reports hit rate from telemetry; expired cache entries counted separately", () => {
    const e = mkEvent("file_save", { path: "x.ts" });
    let store = emptyStore();
    store = recordObservation({ store, event: e, followup: { toolName: "t1", args: {}, ts: 1 }, secret: SECRET });
    store = recordObservation({ store, event: e, followup: { toolName: "t2", args: {}, ts: 2 }, secret: SECRET });
    let cache = emptyCache();
    cache = writeCacheEntry({ cache, event: e, toolName: "t1", args: {}, result: 1, ttlMs: 100, nowMs: 0, secret: SECRET });
    cache = writeCacheEntry({ cache, event: e, toolName: "t2", args: {}, result: 2, ttlMs: 100000, nowMs: 0, secret: SECRET });
    let tel = emptyTelemetry();
    tel = recordFetch({ telemetry: tel, hit: true });
    tel = recordFetch({ telemetry: tel, hit: true });
    tel = recordFetch({ telemetry: tel, hit: false });
    const s = computeStats({ store, cache, telemetry: tel, nowMs: 5000 });
    expect(s.totalRecords).toBe(2);
    expect(s.uniqueEventSigs).toBe(1);
    expect(s.totalCacheEntries).toBe(2);
    expect(s.expiredCacheEntries).toBe(1);
    expect(s.freshCacheEntries).toBe(1);
    expect(s.totalHits).toBe(2);
    expect(s.totalMisses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3, 5);
  });

  it("formatStatsLine renders single-line digest", () => {
    const stats = computeStats({ store: emptyStore(), cache: emptyCache(), telemetry: { hits: 7, misses: 3 } });
    const line = formatStatsLine(stats);
    expect(line).toContain("REFLEX");
    expect(line).toContain("70.0%");
  });
});
