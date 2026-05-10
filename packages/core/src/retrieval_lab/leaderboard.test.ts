import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLeaderboard, recordTrial, pickNextArm, activeConfig, paretoFrontier,
} from "./leaderboard.js";
import { CANDIDATE_CONFIGS } from "./configs.js";
import { runTrial, verifyTrial } from "./tuner.js";
import { readFileSync } from "node:fs";

describe("retrieval_lab leaderboard", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-rl-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("starts empty with all candidate arms registered", () => {
    const lb = readLeaderboard(repo);
    expect(lb.entries.length).toBe(CANDIDATE_CONFIGS.length);
    expect(lb.totalTrials).toBe(0);
    expect(lb.entries.every((e) => e.trialCount === 0)).toBe(true);
  });

  it("UCB1 picks an untried arm first", () => {
    const lb = readLeaderboard(repo);
    const { reason } = pickNextArm(lb);
    expect(reason).toBe("untried");
  });

  it("recordTrial folds into the running mean + bumps trialCount", () => {
    const cfg = CANDIDATE_CONFIGS[0]!;
    const trial = runTrial(repo, cfg);
    const lb = recordTrial(repo, trial);
    const e = lb.entries.find((x) => x.configId === cfg.id)!;
    expect(e.trialCount).toBe(1);
    expect(e.meanComposite).toBeCloseTo(trial.compositeScore, 4);
  });

  it("after 2 trials per arm, active config is the highest mean", () => {
    for (const cfg of CANDIDATE_CONFIGS) {
      recordTrial(repo, runTrial(repo, cfg));
      recordTrial(repo, runTrial(repo, cfg));
    }
    const lb = readLeaderboard(repo);
    expect(lb.totalTrials).toBe(CANDIDATE_CONFIGS.length * 2);
    const stable = lb.entries.filter((e) => e.trialCount >= 2);
    stable.sort((a, b) => b.meanComposite - a.meanComposite);
    expect(lb.active).toBe(stable[0]!.configId);
  });

  it("activeConfig returns a real RetrievalConfig", () => {
    const c = activeConfig(repo);
    expect(c.id.length).toBeGreaterThan(0);
    expect(typeof c.semanticWeight).toBe("number");
  });

  it("paretoFrontier returns at least 1 entry once trials exist", () => {
    for (const cfg of CANDIDATE_CONFIGS) recordTrial(repo, runTrial(repo, cfg));
    const lb = readLeaderboard(repo);
    expect(paretoFrontier(lb).length).toBeGreaterThan(0);
  });

  it("trial signature is HMAC-verifiable", () => {
    const cfg = CANDIDATE_CONFIGS[0]!;
    const trial = runTrial(repo, cfg);
    const secret = Buffer.from(
      readFileSync(join(repo, ".mneme/retrieval/.tuner-secret"), "utf8").trim(),
      "hex",
    );
    expect(verifyTrial(trial, secret)).toBe(true);
  });

  it("running trial twice produces DIFFERENT results (per-trial noise)", () => {
    const cfg = CANDIDATE_CONFIGS[0]!;
    const a = runTrial(repo, cfg);
    const b = runTrial(repo, cfg);
    expect(a.trialId).not.toBe(b.trialId);
    expect(a.compositeScore).not.toBe(b.compositeScore);
  });
});
