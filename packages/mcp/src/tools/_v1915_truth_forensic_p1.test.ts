/**
 * v2.19.51 P1 LATENCY REGRESSION TEST.
 *
 * Pins the fix for the 9x parallel-verify slowdown user reported:
 *   v2.19.46: 50 parallel = 58ms/call avg
 *   v2.19.49: 50 parallel = 524ms/call avg
 *
 * Root cause: every parallel verify rebuilt the MCP catalog (buildAllTools)
 * AND walked the filesystem (countMnemeTools). 50 disk walks competing.
 *
 * Fix:
 *   1. Module-level memo on buildAllTools (30s TTL)
 *   2. Module-level memo on countMnemeTools (30s TTL)
 *   3. Module-level memo on buildLiveCatalog (30s TTL)
 *   4. withVerifyCache concurrency-coalesce on truth.forensic + truth.explain
 *      → 50 parallel identical claims = 1 pipeline run + 49 promise-coalesced.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { truthForensicTool, _resetLiveCatalogCache } from "./_v1915_truth_forensic.js";
import { verifyCache } from "@mneme-ai/core";
import { _resetBuildAllToolsCache } from "./_registry.js";
const { _resetVerifyCache, verifyCacheStats } = verifyCache;

const fakeRt = {
  meta: { rootPath: process.cwd() },
} as unknown as Parameters<typeof truthForensicTool.handler>[0];

describe("v2.19.51 P1 — 50 parallel verify latency", () => {
  beforeEach(() => {
    _resetVerifyCache();
    _resetLiveCatalogCache();
    _resetBuildAllToolsCache();
  });

  it("50 parallel IDENTICAL claims = 1 compute + 49 coalesced (sub-2s wall-time)", async () => {
    const claim = "mneme.truth.forensic is registered";
    const t0 = Date.now();

    const promises = Array.from({ length: 50 }, () =>
      truthForensicTool.handler(fakeRt, { claim }),
    );
    const results = await Promise.all(promises);

    const elapsed = Date.now() - t0;
    const stats = verifyCacheStats();

    // EVERY result must be a valid verdict object
    expect(results.length).toBe(50);
    for (const r of results) {
      expect(r).toHaveProperty("data");
      expect(r).toHaveProperty("wisdom");
    }

    // 50 parallel = 1 actual pipeline + 49 promise-shared
    expect(stats.totalMisses).toBe(1);
    expect(stats.totalCoalesced).toBe(49);

    // Sub-2s wall time on user's 9x-regression reproduction (was 26s).
    // Wide envelope for CI jitter — the assertion is "obviously fast".
    expect(elapsed).toBeLessThan(2000);
  }, 30_000);

  it("50 parallel DIFFERENT claims still complete within 10s (memo doesn't help; catalog memo still does)", async () => {
    const t0 = Date.now();

    const promises = Array.from({ length: 50 }, (_, i) =>
      truthForensicTool.handler(fakeRt, { claim: `mneme.tool${i}.X is registered` }),
    );
    const results = await Promise.all(promises);

    const elapsed = Date.now() - t0;
    const stats = verifyCacheStats();

    expect(results.length).toBe(50);
    // 50 distinct claims = 50 compute (no coalescing on different keys)
    expect(stats.totalMisses).toBe(50);
    expect(stats.totalCoalesced).toBe(0);
    // But catalog memo means catalog built ONCE not 50× → still fast
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);

  it("repeated single-call: 2nd, 3rd, 4th calls all hit the cache (totalHits == n-1)", async () => {
    const claim = "mneme.welcome is registered";

    await truthForensicTool.handler(fakeRt, { claim });
    await truthForensicTool.handler(fakeRt, { claim });
    await truthForensicTool.handler(fakeRt, { claim });
    await truthForensicTool.handler(fakeRt, { claim });

    const stats = verifyCacheStats();
    // 4 sequential calls, same key → 1 miss + 3 hits, 0 coalesced (serial).
    expect(stats.totalMisses).toBe(1);
    expect(stats.totalHits).toBe(3);
    expect(stats.totalCoalesced).toBe(0);
  });
});
