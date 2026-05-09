/**
 * Mneme Antivirus -- stability stress test.
 *
 * Goal: prove the antivirus subsystem is stable enough to run 24/7 for
 * months without crashing, leaking, or quietly drifting. We do this by
 * hammering each public surface with a load that simulates a long
 * session and asserting:
 *   - no thrown exceptions (best-effort means caught, not unhandled)
 *   - persisted files stay valid JSON after every cycle
 *   - byte counts grow but stay bounded (no unbounded list growth)
 *   - signatures still verify after many writes
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scan } from "./scan.js";
import { recordScan, readStats } from "./stats.js";
import { readPharmacopoeia, registerVaccine } from "./pharmacopoeia.js";
import { snapshotForChromosome, mergeInheritedVaccines } from "./lineage_vaccines.js";
import { runBenchmark, verifyEfficacySignature } from "./benchmark.js";
import { VAC_CITATIO_VIRIDIS } from "./vaccines.js";

function initRepo(root: string): void {
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "ci@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "CI"], { cwd: root });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: root });
}

describe("antivirus stability -- 24/7 stress", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-stab-"));
    initRepo(repo);
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("100 sequential scans do not throw or grow stats unboundedly", async () => {
    for (let i = 0; i < 100; i++) {
      const draft = `Iteration ${i}: see commit feed${i.toString(16).padStart(4, "0")}cafe1234 for details.`;
      const r = await scan(repo, draft);
      expect(r.scanId.length).toBeGreaterThan(0);
    }
    // recentScans is capped at 50 (verified in stats.test.ts); totalScans should equal 100.
    const s = readStats(repo);
    expect(s.totalScans).toBe(100);
    expect(s.recentScans.length).toBeLessThanOrEqual(50);
    // The stats file must still be valid JSON after 100 writes.
    const path = join(repo, ".mneme/antivirus/stats.json");
    expect(existsSync(path)).toBe(true);
    expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
  }, 60_000);

  it("stats file size stays bounded after 200 scans", async () => {
    for (let i = 0; i < 200; i++) {
      const draft = `Long: see commit feed${i.toString(16).padStart(4, "0")}cafe1234 by Aloysius${i}.`;
      await scan(repo, draft);
    }
    const path = join(repo, ".mneme/antivirus/stats.json");
    const size = statSync(path).size;
    // 50-entry cap on recentScans + small per-strain counters: should stay
    // under 100KB even with 200 scans.
    expect(size).toBeLessThan(100 * 1024);
  }, 90_000);

  it("benchmark signature is still verifiable after many runs", async () => {
    let lastEff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    for (let i = 0; i < 10; i++) {
      lastEff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    }
    const secret = Buffer.from(
      readFileSync(join(repo, ".mneme/antivirus/.bench-secret"), "utf8").trim(),
      "hex",
    );
    expect(verifyEfficacySignature(lastEff, VAC_CITATIO_VIRIDIS, secret)).toBe(true);
  }, 60_000);

  it("registering 50 vaccines stays under 200KB pharmacopoeia size", () => {
    const fakes = Array.from({ length: 50 }, (_, i) => ({
      ...VAC_CITATIO_VIRIDIS,
      id: `anti_test_${i}_v1`,
      version: `0.0.${i}`,
    }));
    for (const v of fakes) registerVaccine(repo, v, "local-developed");
    const path = join(repo, ".mneme/antivirus/pharmacopoeia.json");
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(200 * 1024);
    const p = readPharmacopoeia(repo);
    // 8 seed + 50 fakes
    expect(p.vaccines.length).toBeGreaterThanOrEqual(58);
  });

  it("100 inheritance merges do not corrupt the pharmacopoeia", () => {
    const sigs = snapshotForChromosome(repo);
    expect(sigs.length).toBe(8);
    for (let i = 0; i < 100; i++) {
      mergeInheritedVaccines(repo, [{ chromosomeId: `chrom-${i}`, signatures: sigs }]);
    }
    const p = readPharmacopoeia(repo);
    // After 100 merges of identical sigs, should still have 8 distinct
    // (id, version) pairs (no duplication).
    const keys = new Set(p.vaccines.map((v) => `${v.id}@${v.version}`));
    expect(keys.size).toBe(8);
  });

  it("scan handles empty draft, malformed text, very long draft without throwing", async () => {
    const cases = [
      "",                                                          // empty
      "   \n\t\r  ",                                               // whitespace
      "\x00\x01\x02 control bytes",                                // control chars
      "x".repeat(50_000),                                          // 50KB draft
      "🚀🧬💊 emoji 🦠🎯⚡",                                        // unicode
      "a".repeat(10) + " ".repeat(10) + "b".repeat(10),           // sparse
    ];
    for (const draft of cases) {
      const r = await scan(repo, draft, { recordStats: false });
      expect(r.scanId.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("stats survive malformed file (tolerates partial corruption)", () => {
    // Write garbage to stats.json
    const path = join(repo, ".mneme/antivirus/stats.json");
    mkdirSync(join(repo, ".mneme/antivirus"), { recursive: true });
    writeFileSync(path, "{ this is not json at all", "utf8");
    // Reading should NOT throw -- it should fall back to empty stats.
    const s = readStats(repo);
    expect(s.totalScans).toBe(0);
    // Recording a new scan should overwrite to a valid file.
    recordScan(repo, {
      scanId: "x", ranAt: new Date().toISOString(),
      draftLengthChars: 10, claimsExamined: 1, infections: 0,
      totalMs: 1, vaccinesUsed: [],
    }, {});
    const after = readStats(repo);
    expect(after.totalScans).toBe(1);
  });
});
