import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOvernight, DEFAULT_BUDGET, type Actor } from "./runner.js";
import { mockReviewer } from "./conscience.js";
import { spawnQuarkJury } from "./quark_jury.js";

function makeSilentActor(qScore: number, description = "did the work"): Actor {
  return async (input) => ({
    description: `${description} (round ${input.roundNumber})`,
    qScore,
    costEstimateUsd: 0.001,
  });
}

describe("overnight runner", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-over-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("runs to maxRounds when nothing trips a stop guard", async () => {
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "test goal", workItemKind: "evolve-patch" },
      actor: makeSilentActor(2.0),
      baseReviewer: mockReviewer("base", 8, true),
      budget: { ...DEFAULT_BUDGET, maxRounds: 3 },
    });
    expect(session.rounds.length).toBe(3);
    expect(session.stopReason).toBe("complete");
    expect(session.totalYield).toBeGreaterThan(0);
  });

  it("stops on reject-streak", async () => {
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "fail goal" },
      actor: makeSilentActor(-1),
      baseReviewer: mockReviewer("base", 2, false),
      budget: { ...DEFAULT_BUDGET, maxRounds: 5, rejectStreakStop: 2 },
    });
    expect(session.rounds.length).toBe(2);            // stops after 2 rejects
    expect(session.stopReason).toContain("reject-streak");
  });

  it("stops on negative-Q streak", async () => {
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "regress" },
      actor: makeSilentActor(-2),                     // negative Q
      baseReviewer: mockReviewer("base", 8, true),    // jury accepts
      budget: { ...DEFAULT_BUDGET, maxRounds: 5, negativeQStreakStop: 2 },
    });
    expect(session.rounds.length).toBe(2);
    expect(session.stopReason).toContain("negative-q-streak");
  });

  it("stops when actor throws", async () => {
    const throwingActor: Actor = async () => { throw new Error("boom"); };
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "boom" },
      actor: throwingActor,
      baseReviewer: mockReviewer("base", 8, true),
      budget: { ...DEFAULT_BUDGET, maxRounds: 3 },
    });
    expect(session.rounds.length).toBe(0);
    expect(session.stopReason).toContain("actor-error");
    expect(session.stopReason).toContain("boom");
  });

  it("writes per-round + final REPORT.md artifacts", async () => {
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "artifact test" },
      actor: makeSilentActor(1.5),
      baseReviewer: mockReviewer("base", 8, true),
      budget: { ...DEFAULT_BUDGET, maxRounds: 2 },
    });
    expect(existsSync(session.reportPath)).toBe(true);
    expect(existsSync(join(repo, ".mneme/overnight", session.sessionId, "round-1.md"))).toBe(true);
    expect(existsSync(join(repo, ".mneme/overnight", session.sessionId, "round-2.md"))).toBe(true);
    const report = readFileSync(session.reportPath, "utf8");
    expect(report).toContain("Mneme Overnight Report");
    expect(report).toContain(session.sessionId);
  });

  it("explicit jury overrides baseReviewer 6-quark spawn", async () => {
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "explicit jury" },
      actor: makeSilentActor(0),
      jury: [mockReviewer("explicit", 9, true)],   // single juror
      budget: { ...DEFAULT_BUDGET, maxRounds: 1 },
    });
    expect(session.rounds[0]!.fusion.flavors.length).toBe(0);   // no quark wrap = no flavors detected
  });

  it("appends a summary line to .mneme/overnight/sessions.jsonl", async () => {
    await runOvernight({
      repoRoot: repo,
      goal: { description: "session log test" },
      actor: makeSilentActor(1),
      baseReviewer: mockReviewer("base", 8, true),
      budget: { ...DEFAULT_BUDGET, maxRounds: 1 },
    });
    const logPath = join(repo, ".mneme/overnight/sessions.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("session log test");
  });

  it("budget-time stops before maxRounds when wall time is exceeded", async () => {
    // Simulate: 0-second budget = should stop at round 1 (entering loop at 0+).
    const session = await runOvernight({
      repoRoot: repo,
      goal: { description: "tight budget" },
      actor: makeSilentActor(1),
      baseReviewer: mockReviewer("base", 8, true),
      budget: { ...DEFAULT_BUDGET, maxRounds: 5, maxWallSec: 0 },
    });
    expect(session.stopReason).toBe("budget-time");
    expect(session.rounds.length).toBe(0);
  });
});
