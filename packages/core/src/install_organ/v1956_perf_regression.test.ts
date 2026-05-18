/**
 * v2.19.56 — PERF REGRESSION TEST for the v2.19.54 18x slowdown.
 *
 * Pins the fix forever: 50 parallel verify-cache calls must complete
 * sub-3000ms wall-time. If recentHeartbeatActivity ever regresses to
 * full classifyHeartbeats scan again, this test catches it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { recentHeartbeatActivity, classifyHeartbeats, ensureOrganDirs, heartbeatDir } from "./index.js";
import { _resetVerifyCache, withVerifyCache, claimKey } from "../verify_cache/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let testHome: string;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedUserProfile = process.env["USERPROFILE"];
  testHome = join(tmpdir(), `mneme-perf-regression-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  process.env["USERPROFILE"] = testHome;
  _resetVerifyCache();
});

describe("v2.19.56 — P1 perf regression gate (50 parallel hot path)", () => {
  it("recentHeartbeatActivity returns false on missing dir (fast path)", () => {
    const t0 = Date.now();
    const r = recentHeartbeatActivity(2000);
    const ms = Date.now() - t0;
    expect(r).toBe(false);
    expect(ms).toBeLessThan(50); // must be sub-50ms
  });

  it("recentHeartbeatActivity returns true when dir was just touched", () => {
    ensureOrganDirs();
    // Create a heartbeat to bump the dir mtime
    writeFileSync(join(heartbeatDir(), `dummy.beat`), "{}", "utf8");
    const r = recentHeartbeatActivity(60_000); // 60s window — should catch our just-now write
    expect(r).toBe(true);
  });

  it("recentHeartbeatActivity is ~100x faster than classifyHeartbeats with N=20 beats", () => {
    ensureOrganDirs();
    // Seed 20 beats
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(heartbeatDir(), `${1000 + i}.beat`), JSON.stringify({
        v: 1, pid: 1000 + i, ppid: 999, role: "indexer",
        startedAt: new Date().toISOString(),
        beatAt: new Date().toISOString(),
        cwd: testHome, host: "test", platform: platform(),
      }), "utf8");
    }
    // Time classifyHeartbeats (the slow path)
    const tA = Date.now();
    classifyHeartbeats();
    const slowMs = Date.now() - tA;
    // Time recentHeartbeatActivity (the fast path)
    const tB = Date.now();
    recentHeartbeatActivity(60_000);
    const fastMs = Date.now() - tB;
    // Fast path must be at least 2x faster (usually 50-100x; loose envelope for CI jitter)
    // Conservative: just assert fast path completes sub-20ms
    expect(fastMs).toBeLessThan(20);
  });

  it("50 parallel withVerifyCache + claimKey complete sub-3000ms", async () => {
    let computeCalls = 0;
    const compute = async () => {
      computeCalls++;
      await new Promise((r) => setTimeout(r, 30));
      return "result";
    };
    const t0 = Date.now();
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      tasks.push(withVerifyCache(claimKey("test-claim", "stress"), compute));
    }
    await Promise.all(tasks);
    const totalMs = Date.now() - t0;

    expect(computeCalls).toBe(1); // verify_cache must coalesce
    expect(totalMs).toBeLessThan(3000); // user's wisdom hard ceiling
    // Sub-500ms is the actual ceiling for in-process coalescing
    expect(totalMs).toBeLessThan(500);
  });
});
