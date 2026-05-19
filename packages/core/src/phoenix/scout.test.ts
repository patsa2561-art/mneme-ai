/**
 * v2.19.62 PHOENIX P4 step 1 — SCOUT deep tests.
 *
 * Network-free: we inject a fake fetcher so we test the verdict logic +
 * cache behavior + safe-default unreachable semantics deterministically.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  runScoutCycle,
  compareVersions,
  clearScoutCache,
  scoutCacheSize,
  PROTOCOL_VERSION,
} from "./scout.js";

describe("v2.19.62 compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.2")).toBeGreaterThan(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("0.9.99", "1.0.0")).toBeLessThan(0);
  });

  it("strips leading v prefix", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("strips pre-release suffix", () => {
    expect(compareVersions("1.2.3-alpha", "1.2.3")).toBe(0);
  });

  it("handles missing patch level", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.3", "1.2.99")).toBeGreaterThan(0);
  });

  it("handles non-numeric segments as 0", () => {
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
  });

  it("handles real Mneme version progressions", () => {
    expect(compareVersions("2.19.62", "2.19.61")).toBeGreaterThan(0);
    expect(compareVersions("2.19.61", "2.19.62")).toBeLessThan(0);
    expect(compareVersions("2.19.62", "2.19.62")).toBe(0);
    expect(compareVersions("3.0.0", "2.19.62")).toBeGreaterThan(0);
  });
});

describe("v2.19.62 runScoutCycle verdicts", () => {
  beforeEach(() => clearScoutCache());

  it("returns up-to-date when running == latest", async () => {
    const r = await runScoutCycle("2.19.62", {
      fetchLatest: async () => ({ version: "2.19.62", httpStatus: 200 }),
    });
    expect(r.verdict).toBe("up-to-date");
    expect(r.latestVersion).toBe("2.19.62");
    expect(r.runningVersion).toBe("2.19.62");
  });

  it("returns upgrade-available when running < latest", async () => {
    const r = await runScoutCycle("2.19.61", {
      fetchLatest: async () => ({ version: "2.19.62", httpStatus: 200 }),
    });
    expect(r.verdict).toBe("upgrade-available");
    expect(r.latestVersion).toBe("2.19.62");
  });

  it("returns up-to-date when running > latest (running ahead)", async () => {
    const r = await runScoutCycle("3.0.0", {
      fetchLatest: async () => ({ version: "2.19.62", httpStatus: 200 }),
    });
    expect(r.verdict).toBe("up-to-date");
  });

  it("returns unreachable when fetcher throws", async () => {
    const r = await runScoutCycle("2.19.62", {
      fetchLatest: async () => { throw new Error("ENOTFOUND"); },
    });
    expect(r.verdict).toBe("unreachable");
    expect(r.latestVersion).toBeNull();
    expect(r.reachability.error).toContain("ENOTFOUND");
  });

  it("propagates httpStatus from thrown error", async () => {
    const r = await runScoutCycle("2.19.62", {
      fetchLatest: async () => {
        const e = new Error("HTTP 503") as Error & { httpStatus: number };
        e.httpStatus = 503;
        throw e;
      },
    });
    expect(r.verdict).toBe("unreachable");
    expect(r.reachability.httpStatus).toBe(503);
  });

  it("NEVER throws — even on totally broken fetcher", async () => {
    await expect(runScoutCycle("2.19.62", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchLatest: async () => { throw null as any; },
    })).resolves.toBeDefined();
  });

  it("returns report shape with correct organ + version fields", async () => {
    const r = await runScoutCycle("2.19.62", {
      fetchLatest: async () => ({ version: "2.19.62" }),
    });
    expect(r.v).toBe(PROTOCOL_VERSION);
    expect(r.organ).toBe("scout");
    expect(typeof r.ts).toBe("string");
    expect(r.packageName).toBe("mneme-ai");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("respects custom packageName", async () => {
    let calledWithPkg = "";
    const r = await runScoutCycle("1.0.0", {
      packageName: "@mneme-ai/core",
      fetchLatest: async (_reg, pkg) => { calledWithPkg = pkg; return { version: "1.0.0" }; },
    });
    expect(calledWithPkg).toBe("@mneme-ai/core");
    expect(r.packageName).toBe("@mneme-ai/core");
  });
});

describe("v2.19.62 runScoutCycle caching", () => {
  beforeEach(() => clearScoutCache());

  it("caches successful fetch + cacheHit=true on second call", async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; return { version: "2.19.62" }; };
    const r1 = await runScoutCycle("2.19.62", { fetchLatest: fetcher });
    expect(r1.cacheHit).toBe(false);
    const r2 = await runScoutCycle("2.19.62", { fetchLatest: fetcher });
    expect(r2.cacheHit).toBe(true);
    expect(fetchCount).toBe(1); // Only the first call hit the fetcher
  });

  it("cache invalidates after TTL", async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; return { version: "2.19.62" }; };
    let fakeNow = 1_000_000;
    const r1 = await runScoutCycle("2.19.62", { fetchLatest: fetcher, cacheTtlMs: 1000, now: () => fakeNow });
    expect(r1.cacheHit).toBe(false);
    fakeNow += 999;
    const r2 = await runScoutCycle("2.19.62", { fetchLatest: fetcher, cacheTtlMs: 1000, now: () => fakeNow });
    expect(r2.cacheHit).toBe(true);
    fakeNow += 100; // total > 1000, past TTL
    const r3 = await runScoutCycle("2.19.62", { fetchLatest: fetcher, cacheTtlMs: 1000, now: () => fakeNow });
    expect(r3.cacheHit).toBe(false);
    expect(fetchCount).toBe(2);
  });

  it("caches unreachable failures too (avoids hammering on offline)", async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; throw new Error("offline"); };
    const r1 = await runScoutCycle("2.19.62", { fetchLatest: fetcher });
    expect(r1.verdict).toBe("unreachable");
    const r2 = await runScoutCycle("2.19.62", { fetchLatest: fetcher });
    expect(r2.cacheHit).toBe(true);
    expect(fetchCount).toBe(1);
  });

  it("different packages cached independently", async () => {
    const r1 = await runScoutCycle("1.0.0", {
      packageName: "pkg-a",
      fetchLatest: async () => ({ version: "1.0.0" }),
    });
    const r2 = await runScoutCycle("1.0.0", {
      packageName: "pkg-b",
      fetchLatest: async () => ({ version: "2.0.0" }),
    });
    expect(r1.latestVersion).toBe("1.0.0");
    expect(r2.latestVersion).toBe("2.0.0");
    expect(scoutCacheSize()).toBe(2);
  });

  it("clearScoutCache resets cache size to 0", async () => {
    await runScoutCycle("1.0.0", { fetchLatest: async () => ({ version: "1.0.0" }) });
    expect(scoutCacheSize()).toBeGreaterThan(0);
    clearScoutCache();
    expect(scoutCacheSize()).toBe(0);
  });
});
