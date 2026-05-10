import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotForChromosome, mergeInheritedConfigs } from "./lineage_retrieval.js";
import { recordTrial, readLeaderboard } from "./leaderboard.js";
import { runTrial } from "./tuner.js";
import { CANDIDATE_CONFIGS } from "./configs.js";

describe("Lamarckian retrieval-config inheritance", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-rl-lin-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("snapshotForChromosome returns top-3 (or fewer) tried entries", () => {
    for (let i = 0; i < 3; i++) {
      recordTrial(repo, runTrial(repo, CANDIDATE_CONFIGS[i]!));
    }
    const snap = snapshotForChromosome(repo);
    expect(snap.length).toBeLessThanOrEqual(3);
    expect(snap.length).toBeGreaterThan(0);
    expect(snap[0]!.meanComposite).toBeGreaterThanOrEqual(snap[snap.length - 1]!.meanComposite);
  });

  it("snapshot is empty when no trials run", () => {
    expect(snapshotForChromosome(repo).length).toBe(0);
  });

  it("mergeInheritedConfigs adopts higher-mean inherited entries", () => {
    // Local: trial config 0 once.
    recordTrial(repo, runTrial(repo, CANDIDATE_CONFIGS[0]!));
    const before = readLeaderboard(repo).entries.find((e) => e.configId === CANDIDATE_CONFIGS[0]!.id)!;

    // Inherited signature with a much-higher composite.
    const inherited = [{
      chromosomeId: "ancestor-1",
      signatures: [{
        configId: CANDIDATE_CONFIGS[0]!.id,
        config: CANDIDATE_CONFIGS[0]!,
        trialCount: 10,
        meanComposite: 0.99,
        meanPrecisionAtK: 0.99, meanRecallAtK: 0.99, meanNdcgAtK: 0.99,
        meanLatencyMs: 50,
        capturedAt: new Date().toISOString(),
      }],
    }];
    const touched = mergeInheritedConfigs(repo, inherited);
    expect(touched).toBeGreaterThan(0);

    const after = readLeaderboard(repo).entries.find((e) => e.configId === CANDIDATE_CONFIGS[0]!.id)!;
    expect(after.meanComposite).toBeGreaterThan(before.meanComposite);
  });

  it("mergeInheritedConfigs IGNORES lower-mean inherited entries", () => {
    // Local: trial config 0 once + boost it to high score by a few more.
    for (let i = 0; i < 5; i++) recordTrial(repo, runTrial(repo, CANDIDATE_CONFIGS[0]!));
    const before = readLeaderboard(repo).entries.find((e) => e.configId === CANDIDATE_CONFIGS[0]!.id)!;
    const inherited = [{
      chromosomeId: "weak-ancestor",
      signatures: [{
        configId: CANDIDATE_CONFIGS[0]!.id,
        config: CANDIDATE_CONFIGS[0]!,
        trialCount: 1,
        meanComposite: 0.0001,  // way lower than local
        meanPrecisionAtK: 0, meanRecallAtK: 0, meanNdcgAtK: 0, meanLatencyMs: 9999,
        capturedAt: new Date().toISOString(),
      }],
    }];
    const touched = mergeInheritedConfigs(repo, inherited);
    expect(touched).toBe(0);
    const after = readLeaderboard(repo).entries.find((e) => e.configId === CANDIDATE_CONFIGS[0]!.id)!;
    expect(after.meanComposite).toBeCloseTo(before.meanComposite, 4);
  });
});
