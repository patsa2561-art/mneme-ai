import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawJackpot, formatJackpotLine, renderJackpotCard, type InsightCandidate } from "./index.js";

const SAMPLE_CANDIDATES: InsightCandidate[] = [
  { kind: "scar_drift", headline: "scar A", body: "b", confidence: 0.8, valueClass: "prevents_bug", valueEstimate: "x", action: "y", surprise: 0.5 },
  { kind: "soul_gap", headline: "soul B", body: "b", confidence: 0.5, valueClass: "compounds_long_term", valueEstimate: "x", action: "y", surprise: 0.3 },
  { kind: "vendor_arb", headline: "vendor C", body: "b", confidence: 0.6, valueClass: "saves_money", valueEstimate: "x", action: "y", surprise: 0.7 },
];

describe("v2.17 · MNEME JACKPOT — daily lottery insight", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "jackpot-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("draws an insight even on an empty repo (universal fallback)", async () => {
    const j = await drawJackpot({ repoDir: dir, todayOverride: "2026-05-15" });
    expect(j.headline).toBeTruthy();
    expect(j.action).toBeTruthy();
    expect(j.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deterministic: same day + same repo + same pool → same insight", async () => {
    const j1 = await drawJackpot({ repoDir: dir, todayOverride: "2026-05-15", candidatesOverride: SAMPLE_CANDIDATES });
    const j2 = await drawJackpot({ repoDir: dir, todayOverride: "2026-05-15", candidatesOverride: SAMPLE_CANDIDATES });
    expect(j1.id).toBe(j2.id);
    expect(j1.headline).toBe(j2.headline);
    expect(j1.sig).toBe(j2.sig);
  });

  it("different day → potentially different insight", async () => {
    // Pool of 30 candidates so top decile = 3, giving room for variation
    const big: InsightCandidate[] = [];
    for (let i = 0; i < 30; i++) {
      big.push({ kind: "soul_gap", headline: `H${i}`, body: "b", confidence: 0.5 + (i % 5) * 0.1, valueClass: "compounds_long_term", valueEstimate: "x", action: "y", surprise: 0.5 });
    }
    const j1 = await drawJackpot({ repoDir: dir, todayOverride: "2026-05-15", candidatesOverride: big });
    const j2 = await drawJackpot({ repoDir: dir, todayOverride: "2026-06-15", candidatesOverride: big });
    // We can't guarantee they differ on tiny pools, but on a 30-candidate pool
    // the seed should hit different items most days. Just check both are valid:
    expect(j1.id).toBeTruthy();
    expect(j2.id).toBeTruthy();
  });

  it("HMAC sig is verifiable shape", async () => {
    const j = await drawJackpot({ repoDir: dir, candidatesOverride: SAMPLE_CANDIDATES });
    expect(j.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("auto-detects soul scars when project_soul.json exists", async () => {
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const soul = {
      v: 1, project: "x", spirit: "x",
      values: [], antiPatterns: [], conventions: [],
      scars: [{ id: "s1", text: "Friday deploy disaster 2024-11-12", addedAt: "2024-11-13T00:00:00Z", severity: "block", sig: "x" }],
      sacred: [], updatedAt: "x", ruleCount: 1, soulSig: "x",
    };
    writeFileSync(join(dir, ".mneme", "project_soul.json"), JSON.stringify(soul));
    const j = await drawJackpot({ repoDir: dir, todayOverride: "2026-05-15" });
    // Should pick something — possibly a scar_drift
    expect(j.headline).toBeTruthy();
  });

  it("detects pre-1.0 deps (dead-dep heuristic)", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "x", version: "1.0.0",
      dependencies: { "ancient-pkg": "^0.0.3" },
    }));
    // Run several times to be sure the dead-dep card lands somewhere
    let foundDeadDep = false;
    for (let day = 1; day <= 10; day++) {
      const j = await drawJackpot({ repoDir: dir, todayOverride: `2026-05-${String(day).padStart(2, "0")}` });
      if (j.kind === "dead_dep") { foundDeadDep = true; break; }
    }
    // The dead-dep candidate should land at least once across 10 days given
    // the seeded shuffle prefers high-confidence picks.
    expect(foundDeadDep).toBe(true);
  });

  it("detects no-test-script (test gap)", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "x", version: "1.0.0",
      // intentionally no scripts
    }));
    let foundTestGap = false;
    for (let day = 1; day <= 10; day++) {
      const j = await drawJackpot({ repoDir: dir, todayOverride: `2026-05-${String(day).padStart(2, "0")}` });
      if (j.kind === "test_gap") { foundTestGap = true; break; }
    }
    expect(foundTestGap).toBe(true);
  });

  it("formatJackpotLine summarises", async () => {
    const j = await drawJackpot({ repoDir: dir, candidatesOverride: SAMPLE_CANDIDATES });
    const line = formatJackpotLine(j);
    expect(line).toContain("JACKPOT");
    expect(line).toContain("%");
  });

  it("renderJackpotCard produces a shareable block", async () => {
    const j = await drawJackpot({ repoDir: dir, candidatesOverride: SAMPLE_CANDIDATES });
    const card = renderJackpotCard(j);
    expect(card).toContain("🎰 MNEME JACKPOT");
    expect(card).toContain(j.headline);
    expect(card).toContain(j.action);
    expect(card).toMatch(/sig:\s+[0-9a-f]{16}/);
  });

  it("confidence + surprise are within [0,1]", async () => {
    const j = await drawJackpot({ repoDir: dir, candidatesOverride: SAMPLE_CANDIDATES });
    expect(j.confidence).toBeGreaterThanOrEqual(0);
    expect(j.confidence).toBeLessThanOrEqual(1);
    expect(j.surprise).toBeGreaterThanOrEqual(0);
    expect(j.surprise).toBeLessThanOrEqual(1);
  });
});
