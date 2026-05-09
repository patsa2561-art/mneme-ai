import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStreaks, seedStreaksForDemo, recomputeAchievements, noteOutcome } from "./karma_streaks.js";

describe("seedStreaksForDemo — v1.23.2", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-streaks-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("plants a self-consistent seed history (totalVerified > 0 implies bestStreak > 0)", () => {
    const s = seedStreaksForDemo(repo);
    expect(s.totalVerified).toBe(18);
    expect(s.bestVerifiedStreak).toBe(7);
    // The contradiction the user reported (verified=18 but best=0) is gone.
    expect(s.bestVerifiedStreak).toBeGreaterThan(0);
  });

  it("unlocks the expected achievements on a fresh seed (>= 5)", () => {
    const s = seedStreaksForDemo(repo);
    expect(s.unlocked.length).toBeGreaterThanOrEqual(5);
    const ids = s.unlocked.map((a) => a.id);
    expect(ids).toContain("first_verified");
    expect(ids).toContain("streak_5");
    expect(ids).toContain("fuzz_clean_10");
    expect(ids).toContain("court_win_5");
    expect(ids).toContain("fuzz_hunter");
    expect(ids).toContain("no_hallucination");
  });

  it("is idempotent: re-seeding a real session is a no-op", () => {
    // Plant a real outcome first.
    noteOutcome(repo, { outcome: "verified", vendor: "claude" });
    const before = readStreaks(repo);
    const after = seedStreaksForDemo(repo);
    expect(after.totalVerified).toBe(before.totalVerified);
  });

  it("records all 3 seed vendors in byVendor", () => {
    const s = seedStreaksForDemo(repo);
    expect(s.byVendor["seed:claude-opus-4-7"]).toBeDefined();
    expect(s.byVendor["seed:cursor-cmd-k"]).toBeDefined();
    expect(s.byVendor["seed:codex-cli"]).toBeDefined();
  });
});

describe("recomputeAchievements", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-streaks-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("does not double-unlock", () => {
    const s = seedStreaksForDemo(repo);
    const count1 = s.unlocked.length;
    recomputeAchievements(s);
    expect(s.unlocked.length).toBe(count1);
  });
});
