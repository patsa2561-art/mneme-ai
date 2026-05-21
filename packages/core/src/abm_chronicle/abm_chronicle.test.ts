import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  genesis, tick, simulate, chronicle, loadState,
  detectDecisionDrift, anchorPoint,
  type AgentSeed, type AgentState, type SimState,
} from "./index.js";

const FRUGAL: AgentSeed = {
  name: "Frugal Frieda",
  personality: { spending: 0.1, risk: 0.1, optimism: 0.5, agreeableness: 0.6, energy: 0.7 },
  initialBudget: 1000,
  goals: ["save for retirement"],
};
const SPENDER: AgentSeed = {
  name: "Splurgy Sam",
  personality: { spending: 0.9, risk: 0.6, optimism: 0.8, agreeableness: 0.5, energy: 0.6 },
  initialBudget: 1000,
  goals: ["enjoy life"],
};
const RISKER: AgentSeed = {
  name: "Risky Rita",
  personality: { spending: 0.5, risk: 0.95, optimism: 0.7, agreeableness: 0.4, energy: 0.8 },
  initialBudget: 1000,
  goals: ["10x my money"],
};

describe("abm_chronicle", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-abm-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("genesis", () => {
    it("creates HMAC-signed birth certs for every seed", () => {
      const state = genesis(repo, [FRUGAL, SPENDER, RISKER]);
      expect(state.agents.length).toBe(3);
      for (const a of state.agents) {
        expect(a.birthCert.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
        expect(a.budget).toBe(1000);
        expect(a.alive).toBe(true);
        expect(a.totalDrift).toBe(0);
        expect(a.anchorCount).toBe(0);
      }
      expect(state.tick).toBe(0);
      expect(state.config.anchorEveryTicks).toBe(30);
      expect(state.config.driftThreshold).toBeCloseTo(0.30);
    });

    it("persists state to .mneme/abm/state.json and an events ledger", () => {
      const state = genesis(repo, [FRUGAL]);
      expect(existsSync(join(repo, ".mneme/abm/state.json"))).toBe(true);
      expect(existsSync(join(repo, ".mneme/abm/events.jsonl"))).toBe(true);
      const reloaded = loadState(repo);
      expect(reloaded?.simId).toBe(state.simId);
    });

    it("respects custom anchorEveryTicks + driftThreshold overrides", () => {
      const state = genesis(repo, [FRUGAL], { anchorEveryTicks: 10, driftThreshold: 0.1 });
      expect(state.config.anchorEveryTicks).toBe(10);
      expect(state.config.driftThreshold).toBeCloseTo(0.1);
    });
  });

  describe("tick + decision engine", () => {
    it("advances the world clock by one day per tick", async () => {
      const state = genesis(repo, [FRUGAL]);
      await tick(repo, state);
      expect(state.tick).toBe(1);
      expect(state.worldClock.day).toBe(1);
      await simulate(repo, state, 29);
      expect(state.tick).toBe(30);
      // day cycles 1..30
      expect(state.worldClock.day).toBeGreaterThanOrEqual(1);
      expect(state.worldClock.day).toBeLessThanOrEqual(30);
    });

    it("every alive agent makes exactly one decision per tick", async () => {
      const state = genesis(repo, [FRUGAL, SPENDER]);
      await tick(repo, state);
      const t1 = state.events.filter((e) => e.kind === "decision" && (e as any).tick === 1);
      expect(t1.length).toBe(2);
    });

    it("writes events to the HMAC-chained ledger", async () => {
      const state = genesis(repo, [FRUGAL]);
      await simulate(repo, state, 5);
      const events = readFileSync(join(repo, ".mneme/abm/events.jsonl"), "utf8").trim().split("\n");
      // 1 genesis + 5 decisions
      expect(events.length).toBeGreaterThanOrEqual(6);
      for (const line of events) {
        const e = JSON.parse(line);
        expect(["genesis", "decision", "anchor", "death", "hallucination_cascade"]).toContain(e.kind);
      }
    });
  });

  describe("detectDecisionDrift", () => {
    it("flags an out-of-character splurge as drift for a low-spending agent", () => {
      const state = genesis(repo, [FRUGAL]);
      const agent = state.agents[0]!;
      const driftDecision = {
        tick: 1, agentId: agent.agentId, action: "splurge",
        cashFlow: -500, energyDelta: 0,
        reasoning: "I splurged 500 on something extravagant — felt right.",
      };
      const d = detectDecisionDrift(agent, driftDecision);
      expect(d.score).toBeGreaterThan(0.3);
      expect(d.color === "yellow" || d.color === "red").toBe(true);
      expect(d.reason).toContain("out-of-character");
    });

    it("does NOT flag in-character spending for a high-spending agent", () => {
      const state = genesis(repo, [SPENDER]);
      const agent = state.agents[0]!;
      const decision = {
        tick: 1, agentId: agent.agentId, action: "spend_luxury",
        cashFlow: -100, energyDelta: 0.05,
        reasoning: "I bought something nice for myself — life is short.",
      };
      const d = detectDecisionDrift(agent, decision);
      // Sam's spending=0.9 so this is in-character; should NOT be red.
      expect(d.color).not.toBe("red");
    });

    it("flags an out-of-character panic-sell for a low-risk agent", () => {
      const state = genesis(repo, [FRUGAL]);
      const agent = state.agents[0]!;
      const decision = {
        tick: 5, agentId: agent.agentId, action: "panic_sell",
        cashFlow: 200, energyDelta: -0.1,
        reasoning: "I sold everything in a panic — markets felt off.",
      };
      const d = detectDecisionDrift(agent, decision);
      expect(d.score).toBeGreaterThan(0.2);
      expect(d.reason).toContain("out-of-character");
    });
  });

  describe("anchorPoint intervention", () => {
    it("returns null when drift is below threshold", () => {
      const state = genesis(repo, [FRUGAL], { driftThreshold: 0.5 });
      const agent = state.agents[0]!;
      // currentPersonality == birthCert.personality → drift = 0
      const r = anchorPoint(repo, state, agent);
      expect(r).toBeNull();
      expect(agent.anchorCount).toBe(0);
    });

    it("fires + recalibrates toward birth cert when drift > threshold", () => {
      const state = genesis(repo, [FRUGAL], { driftThreshold: 0.2 });
      const agent = state.agents[0]!;
      // Manually drift spending high to trigger
      const before = agent.currentPersonality.spending;
      agent.currentPersonality.spending = 0.9;
      const r = anchorPoint(repo, state, agent);
      expect(r).not.toBeNull();
      expect(r!.driftBefore).toBeGreaterThan(0.2);
      expect(r!.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(agent.anchorCount).toBe(1);
      // Pull-back: new spending should be MUCH closer to birth cert than 0.9
      expect(agent.currentPersonality.spending).toBeLessThan(0.5);
      expect(agent.currentPersonality.spending).toBeGreaterThan(before);
    });

    it("auto-fires every anchorEveryTicks during simulate()", async () => {
      const state = genesis(repo, [FRUGAL, SPENDER, RISKER], { anchorEveryTicks: 10, driftThreshold: 0.05 });
      await simulate(repo, state, 30);
      const anchors = state.events.filter((e) => e.kind === "anchor");
      // 3 anchor ticks (10, 20, 30) × up to 3 agents → likely > 0
      expect(anchors.length).toBeGreaterThan(0);
    });
  });

  describe("chronicle (full report)", () => {
    it("emits per-agent stats + narrative after a 100-tick simulation", async () => {
      const state = genesis(repo, [FRUGAL, SPENDER, RISKER], { anchorEveryTicks: 20, driftThreshold: 0.15 });
      await simulate(repo, state, 100);
      const r = chronicle(state);
      expect(r.ticksRan).toBe(100);
      expect(r.agentCount).toBe(3);
      expect(r.perAgent.length).toBe(3);
      expect(r.totalDecisions).toBeGreaterThan(0);
      expect(r.narrative.length).toBeGreaterThan(40);
      expect(r.narrative).toContain("agents");
      for (const a of r.perAgent) {
        expect(a.name).toBeTruthy();
        expect(typeof a.budget).toBe("number");
        expect(typeof a.alive).toBe("boolean");
        expect(a.finalDriftFromBirth).toBeGreaterThanOrEqual(0);
        expect(a.finalDriftFromBirth).toBeLessThanOrEqual(1);
      }
    });

    it("survives a 360-tick (1-year) simulation without crashing", async () => {
      const state = genesis(repo, [FRUGAL, SPENDER], { anchorEveryTicks: 30 });
      await simulate(repo, state, 360);
      const r = chronicle(state);
      expect(r.ticksRan).toBe(360);
      // 30/30/12 = year boundary
      expect(state.worldClock.year).toBeGreaterThanOrEqual(1);
    });
  });

  describe("end-to-end: reload after process restart", () => {
    it("loadState then tick continues seamlessly", async () => {
      const state = genesis(repo, [FRUGAL]);
      await simulate(repo, state, 5);
      const tickAfterFirst = state.tick;
      // Reload from disk (simulates process restart).
      const reloaded = loadState(repo);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.tick).toBe(tickAfterFirst);
      await tick(repo, reloaded!);
      expect(reloaded!.tick).toBe(tickAfterFirst + 1);
    });
  });
});
