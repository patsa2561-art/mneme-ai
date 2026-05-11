import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateAutoshipReadiness, readCycleHistory, computeCycleStats,
  gateAuthorIsBot, gatePatchOnly, gateGreenCiHours, gateNoCriticalIssuesLinked,
  gateShipReadinessGreen, gateRateLimit, gateKillswitch,
  DEFAULT_AUTOSHIP_OPTIONS,
  type AutoshipPullRequest, type AutoshipOptions,
} from "./cycle.js";

function fakePr(overrides: Partial<AutoshipPullRequest> = {}): AutoshipPullRequest {
  return {
    number: 42,
    author: "mneme-evolve-bot",
    title: "fix: defensive guard in synthesize",
    branch: "evolve/synthesize-guard",
    baseVersion: "1.37.0",
    headVersion: "1.37.1",
    ciGreenSince: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),  // 25h ago
    linkedIssueNumbers: [],
    ...overrides,
  };
}

describe("autoship/cycle (AUTOPHAGY SHIPPER)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-as-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    // Default ship-readiness report = READY so most tests pass that gate.
    writeFileSync(
      join(repo, ".mneme/ship-readiness.json"),
      JSON.stringify({ verdict: "READY", failures: 0 }),
      "utf8",
    );
  });
  afterEach(() => {
    delete process.env["MNEME_AUTOSHIP_DISABLED"];
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  describe("individual gates", () => {
    it("gateAuthorIsBot: PASS for bot, FAIL for human", () => {
      const opts = { ...DEFAULT_AUTOSHIP_OPTIONS };
      expect(gateAuthorIsBot(fakePr(), opts).pass).toBe(true);
      expect(gateAuthorIsBot(fakePr({ author: "alice" }), opts).pass).toBe(false);
    });

    it("gatePatchOnly: PASS for x.y.z -> x.y.(z+1)", () => {
      expect(gatePatchOnly(fakePr({ baseVersion: "1.37.0", headVersion: "1.37.1" })).pass).toBe(true);
      expect(gatePatchOnly(fakePr({ baseVersion: "1.37.5", headVersion: "1.37.6" })).pass).toBe(true);
    });
    it("gatePatchOnly: FAIL for minor or major bump", () => {
      expect(gatePatchOnly(fakePr({ baseVersion: "1.37.0", headVersion: "1.38.0" })).pass).toBe(false);
      expect(gatePatchOnly(fakePr({ baseVersion: "1.37.0", headVersion: "2.0.0" })).pass).toBe(false);
    });
    it("gatePatchOnly: FAIL for unparseable versions", () => {
      expect(gatePatchOnly(fakePr({ baseVersion: "garbage", headVersion: "1.0.0" })).pass).toBe(false);
    });

    it("gateGreenCiHours: PASS when green long enough", () => {
      const opts: AutoshipOptions = { ...DEFAULT_AUTOSHIP_OPTIONS, minGreenHours: 24 };
      expect(gateGreenCiHours(fakePr(), opts).pass).toBe(true);
    });
    it("gateGreenCiHours: FAIL when CI not green at all", () => {
      const opts: AutoshipOptions = { ...DEFAULT_AUTOSHIP_OPTIONS };
      expect(gateGreenCiHours(fakePr({ ciGreenSince: null }), opts).pass).toBe(false);
    });
    it("gateGreenCiHours: FAIL when green for too short", () => {
      const opts: AutoshipOptions = { ...DEFAULT_AUTOSHIP_OPTIONS, minGreenHours: 24 };
      const pr = fakePr({ ciGreenSince: new Date(Date.now() - 60 * 60 * 1000).toISOString() }); // 1h
      expect(gateGreenCiHours(pr, opts).pass).toBe(false);
    });

    it("gateNoCriticalIssuesLinked: PASS when no overlap", () => {
      const r = gateNoCriticalIssuesLinked(fakePr({ linkedIssueNumbers: [101, 202] }), new Set([303]));
      expect(r.pass).toBe(true);
    });
    it("gateNoCriticalIssuesLinked: FAIL when at least one critical linked", () => {
      const r = gateNoCriticalIssuesLinked(fakePr({ linkedIssueNumbers: [101, 202] }), new Set([101]));
      expect(r.pass).toBe(false);
      expect(r.reason).toContain("#101");
    });

    it("gateShipReadinessGreen: PASS when verdict=READY", () => {
      expect(gateShipReadinessGreen(repo).pass).toBe(true);
    });
    it("gateShipReadinessGreen: FAIL when verdict=BLOCKED", () => {
      writeFileSync(
        join(repo, ".mneme/ship-readiness.json"),
        JSON.stringify({ verdict: "BLOCKED", failures: 2 }),
        "utf8",
      );
      expect(gateShipReadinessGreen(repo).pass).toBe(false);
    });
    it("gateShipReadinessGreen: FAIL when report missing", () => {
      const fresh = mkdtempSync(join(tmpdir(), "mneme-norep-"));
      try { expect(gateShipReadinessGreen(fresh).pass).toBe(false); }
      finally { rmSync(fresh, { recursive: true, force: true }); }
    });

    it("gateKillswitch: PASS by default; FAIL when env=1", () => {
      const opts = { ...DEFAULT_AUTOSHIP_OPTIONS };
      expect(gateKillswitch(opts, {}).pass).toBe(true);
      expect(gateKillswitch(opts, { MNEME_AUTOSHIP_DISABLED: "1" }).pass).toBe(false);
      expect(gateKillswitch(opts, { MNEME_AUTOSHIP_DISABLED: "true" }).pass).toBe(false);
    });

    it("gateRateLimit: PASS when no prior publishes; FAIL when at limit", () => {
      const opts: AutoshipOptions = { ...DEFAULT_AUTOSHIP_OPTIONS, repoRoot: repo, maxPublishesPerDay: 1 };
      // No log -> pass.
      expect(gateRateLimit(repo, opts).pass).toBe(true);
      // Persist a fake "merged-and-published" entry within last 24h.
      mkdirSync(join(repo, ".mneme/autoship"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/autoship/cycle.jsonl"),
        JSON.stringify({
          decidedAt: new Date().toISOString(),
          pr: { number: 1 }, gates: [], allPass: true,
          action: "merged-and-published",
        }) + "\n",
        "utf8",
      );
      expect(gateRateLimit(repo, opts).pass).toBe(false);
    });
  });

  describe("evaluateAutoshipReadiness composite", () => {
    it("happy path: all gates pass -> action='would-merge' in dry-run", () => {
      const d = evaluateAutoshipReadiness({ pr: fakePr(), options: { repoRoot: repo, execute: false } });
      expect(d.allPass).toBe(true);
      expect(d.action).toBe("would-merge");
    });
    it("human-authored PR: noop", () => {
      const d = evaluateAutoshipReadiness({ pr: fakePr({ author: "alice" }), options: { repoRoot: repo } });
      expect(d.allPass).toBe(false);
      expect(d.action).toBe("noop");
      expect(d.gates.find((g) => g.gate === "author-is-evolve-bot")?.pass).toBe(false);
    });
    it("minor bump: noop", () => {
      const d = evaluateAutoshipReadiness({ pr: fakePr({ baseVersion: "1.37.0", headVersion: "1.38.0" }), options: { repoRoot: repo } });
      expect(d.action).toBe("noop");
      expect(d.gates.find((g) => g.gate === "patch-only")?.pass).toBe(false);
    });
    it("CI green for too short: noop", () => {
      const d = evaluateAutoshipReadiness({
        pr: fakePr({ ciGreenSince: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() }),
        options: { repoRoot: repo, minGreenHours: 24 },
      });
      expect(d.action).toBe("noop");
    });
    it("killswitch tripped: action='killswitched'", () => {
      process.env["MNEME_AUTOSHIP_DISABLED"] = "1";
      const d = evaluateAutoshipReadiness({ pr: fakePr(), options: { repoRoot: repo, execute: true } });
      expect(d.action).toBe("killswitched");
    });
    it("ship-readiness BLOCKED: noop", () => {
      writeFileSync(
        join(repo, ".mneme/ship-readiness.json"),
        JSON.stringify({ verdict: "BLOCKED", failures: 1 }),
        "utf8",
      );
      const d = evaluateAutoshipReadiness({ pr: fakePr(), options: { repoRoot: repo } });
      expect(d.action).toBe("noop");
      expect(d.gates.find((g) => g.gate === "ship-readiness")?.pass).toBe(false);
    });
    it("decision is persisted to .mneme/autoship/cycle.jsonl", () => {
      evaluateAutoshipReadiness({ pr: fakePr(), options: { repoRoot: repo } });
      expect(existsSync(join(repo, ".mneme/autoship/cycle.jsonl"))).toBe(true);
    });
  });

  describe("readCycleHistory + computeCycleStats", () => {
    it("readCycleHistory returns persisted decisions", () => {
      evaluateAutoshipReadiness({ pr: fakePr({ number: 1 }), options: { repoRoot: repo } });
      evaluateAutoshipReadiness({ pr: fakePr({ number: 2 }), options: { repoRoot: repo } });
      const h = readCycleHistory(repo, 10);
      expect(h.length).toBe(2);
    });
    it("computeCycleStats aggregates rejection-reason histogram", () => {
      evaluateAutoshipReadiness({ pr: fakePr({ number: 1, author: "alice" }), options: { repoRoot: repo } });
      evaluateAutoshipReadiness({ pr: fakePr({ number: 2, baseVersion: "1.37.0", headVersion: "1.38.0" }), options: { repoRoot: repo } });
      const stats = computeCycleStats(repo);
      expect(stats.totalDecisions).toBe(2);
      expect(stats.rejectionsByGate["author-is-evolve-bot"]).toBe(1);
      expect(stats.rejectionsByGate["patch-only"]).toBe(1);
    });
  });

  describe("WILD: AUTOPHAGY safety invariants", () => {
    it("a HUMAN PR can NEVER trigger merged-and-published (regardless of other gates)", () => {
      const d = evaluateAutoshipReadiness({
        pr: fakePr({ author: "alice" }),
        options: { repoRoot: repo, execute: true },
      });
      expect(d.action).not.toBe("merged-and-published");
    });
    it("a MINOR bump can NEVER trigger merged-and-published", () => {
      const d = evaluateAutoshipReadiness({
        pr: fakePr({ baseVersion: "1.0.0", headVersion: "2.0.0" }),
        options: { repoRoot: repo, execute: true },
      });
      expect(d.action).not.toBe("merged-and-published");
    });
    it("killswitch ALWAYS wins over execute=true", () => {
      process.env["MNEME_AUTOSHIP_DISABLED"] = "1";
      const d = evaluateAutoshipReadiness({
        pr: fakePr(),
        options: { repoRoot: repo, execute: true },
      });
      expect(d.action).toBe("killswitched");
    });
  });
});
