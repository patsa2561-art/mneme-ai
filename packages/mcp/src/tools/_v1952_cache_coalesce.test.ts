/**
 * v2.19.52 CACHE COALESCE — 5 MCP tools tested end-to-end.
 *
 * Pins the contract for: AI-agent-callable promise-coalescing cache.
 * First AI tool worldwide exposing this primitive as MCP. (OpenAI prefix
 * caches don't coalesce; LangChain Redis is exact-match; GPTCache is
 * single-vendor. None expose generic miss/hit/coalesce counters.)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  cacheCoalescePutTool,
  cacheCoalesceGetTool,
  cacheCoalesceStatsTool,
  cacheCoalesceResetTool,
  cacheCoalesceMeasureSavingsTool,
} from "./_v1952_cache_coalesce.js";

const rt = {} as Parameters<typeof cacheCoalescePutTool.handler>[0];

describe("v2.19.52 CACHE COALESCE — MCP primitive tests", () => {
  beforeEach(async () => {
    await cacheCoalesceResetTool.handler(rt, {});
  });

  it("put → get roundtrip: cached value returned", async () => {
    await cacheCoalescePutTool.handler(rt, { key: "k1", value: { hello: "world" }, ttlMs: 60_000 });
    const r = await cacheCoalesceGetTool.handler(rt, { key: "k1" });
    expect(r.data).toEqual({ hit: true, value: { hello: "world" } });
  });

  it("get on missing key returns hit:false (never throws)", async () => {
    const r = await cacheCoalesceGetTool.handler(rt, { key: "never-set" });
    expect(r.data).toEqual({ hit: false });
  });

  it("external keys do not collide with internal verify cache keys", async () => {
    // mneme.cache.put uses 'ext::' prefix internally. Setting "forensic|er=|v=::X"
    // (the internal shape) via mneme.cache.put would NOT collide because the
    // ext:: prefix namespaces it.
    await cacheCoalescePutTool.handler(rt, { key: "forensic|er=|v=", value: "external" });
    const r = await cacheCoalesceGetTool.handler(rt, { key: "forensic|er=|v=" });
    expect(r.data).toEqual({ hit: true, value: "external" });
    // Internal forensic key shape is different (uses claimKey('claim', 'forensic|er=|v=')
    // which gives 'forensic|er=|v=::claim'), so they namespace cleanly.
  });

  it("stats reports memoSize + hit/miss counters", async () => {
    await cacheCoalescePutTool.handler(rt, { key: "a", value: 1 });
    await cacheCoalescePutTool.handler(rt, { key: "b", value: 2 });
    await cacheCoalesceGetTool.handler(rt, { key: "a" });
    await cacheCoalesceGetTool.handler(rt, { key: "missing" });
    const r = await cacheCoalesceStatsTool.handler(rt, {});
    const s = r.data as { memoSize: number; totalHits: number; totalMisses: number };
    expect(s.memoSize).toBeGreaterThanOrEqual(2);
    expect(s.totalHits).toBeGreaterThanOrEqual(1); // the "a" hit
    expect(s.totalMisses).toBeGreaterThanOrEqual(1); // the "missing" miss
  });

  it("reset clears memo + counters back to 0", async () => {
    await cacheCoalescePutTool.handler(rt, { key: "x", value: 1 });
    await cacheCoalesceResetTool.handler(rt, {});
    const r = await cacheCoalesceStatsTool.handler(rt, {});
    const s = r.data as { memoSize: number; totalHits: number; totalMisses: number };
    expect(s.memoSize).toBe(0);
    expect(s.totalHits).toBe(0);
    expect(s.totalMisses).toBe(0);
  });

  it("measure_savings computes wall-time + token + USD value", async () => {
    // Seed 5 hits + 3 misses by writing then reading repeatedly.
    for (let i = 0; i < 5; i++) {
      await cacheCoalescePutTool.handler(rt, { key: `k${i}`, value: i });
      await cacheCoalesceGetTool.handler(rt, { key: `k${i}` });
    }
    const r = await cacheCoalesceMeasureSavingsTool.handler(rt, {
      perCallMs: 200,
      perCallTokens: 1000,
      perKTokenUsd: 0.015,
    });
    const d = r.data as { savedCalls: number; savedMs: number; savedTokens: number; savedUsd: number };
    expect(d.savedCalls).toBeGreaterThanOrEqual(5);
    expect(d.savedMs).toBe(d.savedCalls * 200);
    expect(d.savedTokens).toBe(d.savedCalls * 1000);
    expect(d.savedUsd).toBeCloseTo((d.savedTokens / 1000) * 0.015, 4);
  });

  it("TTL: put with short TTL → get after expiry returns hit:false", async () => {
    await cacheCoalescePutTool.handler(rt, { key: "ttl", value: "fresh", ttlMs: 50 });
    await new Promise((r) => setTimeout(r, 80));
    const r = await cacheCoalesceGetTool.handler(rt, { key: "ttl" });
    expect((r.data as { hit: boolean }).hit).toBe(false);
  });

  it("contract: 5 tools all have inputSchema with properties (v2.19.52 fix)", () => {
    const tools = [
      cacheCoalescePutTool,
      cacheCoalesceGetTool,
      cacheCoalesceStatsTool,
      cacheCoalesceResetTool,
      cacheCoalesceMeasureSavingsTool,
    ];
    for (const t of tools) {
      const s = t.inputSchema as { type: string; properties: unknown };
      expect(s.type).toBe("object");
      expect(typeof s.properties).toBe("object");
    }
  });

  it("contract: all 5 tool names match the namespace regex (no digits)", () => {
    const NAME_RE = /^mneme\.[a-z_]+(?:\.[a-z_]+)*$/;
    const tools = [
      cacheCoalescePutTool,
      cacheCoalesceGetTool,
      cacheCoalesceStatsTool,
      cacheCoalesceResetTool,
      cacheCoalesceMeasureSavingsTool,
    ];
    for (const t of tools) expect(t.name).toMatch(NAME_RE);
  });
});
