import { describe, it, expect } from "vitest";
import { qSeppukuArena, chaosMonkey, bioFeedback, timeTravelAudit, liveKpi, formatGladiatorPulseLine, type ArenaContestant, type ChaosLie, type BioReading, type FutureScenario } from "./index.js";
import { createGenome } from "../bloodline/index.js";

const strongContestant: ArenaContestant = {
  strainId: "strong",
  label: "well-grounded answer",
  claim: "Postgres scales to 10k QPS",
  evidence: [
    { fact: "internal benchmark report", supportStrength: 0.95, sourceWeight: 0.95, sourceKind: "expert-database" },
    { fact: "AWS reference architecture", supportStrength: 0.9, sourceWeight: 0.9, sourceKind: "primary-document" },
  ],
  hallucinationFactor: 0,
};
const weakContestant: ArenaContestant = {
  strainId: "weak",
  label: "vibes only",
  claim: "Postgres scales to 10k QPS",
  evidence: [
    { fact: "vendor brochure", supportStrength: 0.7, sourceWeight: 0.20, sourceKind: "marketing-copy" },
  ],
  hallucinationFactor: 2,
};

describe("v2.2 NEURAL GLADIATOR · Q-SEPPUKU arena", () => {
  it("strong contestant wins; loser identified", () => {
    const r = qSeppukuArena({ contestants: [strongContestant, weakContestant] });
    expect(r.winner.strainId).toBe("strong");
    expect(r.loser.strainId).toBe("weak");
    expect(r.winnerScore).toBeGreaterThan(r.loserScore);
    expect(r.decisive).toBe(true);
  });

  it("genome receives reinforce + decay events", () => {
    const g = createGenome();
    qSeppukuArena({ contestants: [strongContestant, weakContestant], genome: g });
    expect(g.strains.get("strong")?.fitness).toBeGreaterThan(1.0);
    expect(g.strains.get("weak")?.fitness).toBeLessThan(1.0);
  });

  it("throws on < 2 contestants", () => {
    expect(() => qSeppukuArena({ contestants: [strongContestant] })).toThrow(/at least 2/);
  });
});

describe("v2.2 NEURAL GLADIATOR · CHAOS MONKEY", () => {
  it("perfect rejector scores high", async () => {
    const lies: ChaosLie[] = [
      { id: "l1", text: "[Super rare]", shouldReject: true },
      { id: "l2", text: "guaranteed authentic", shouldReject: true },
      { id: "l3", text: "100% verified", shouldReject: true },
    ];
    const r = await chaosMonkey({ lies, judge: async () => ({ rejected: true, latencyMs: 50 }) });
    expect(r.rejectionRate).toBe(1);
    expect(r.score).toBeGreaterThan(0.9);
  });

  it("missing rejector scores low", async () => {
    const lies: ChaosLie[] = [
      { id: "l1", text: "lie", shouldReject: true },
      { id: "l2", text: "lie", shouldReject: true },
    ];
    const r = await chaosMonkey({ lies, judge: async () => ({ rejected: false, latencyMs: 9999 }) });
    expect(r.rejectionRate).toBe(0);
    expect(r.score).toBeLessThan(0.4);
  });

  it("slow rejector scores lower than fast", async () => {
    const lies: ChaosLie[] = [{ id: "l1", text: "x", shouldReject: true }];
    const fast = await chaosMonkey({ lies, judge: async () => ({ rejected: true, latencyMs: 50 }) });
    const slow = await chaosMonkey({ lies, judge: async () => ({ rejected: true, latencyMs: 4000 }) });
    expect(fast.score).toBeGreaterThan(slow.score);
  });
});

describe("v2.2 NEURAL GLADIATOR · BIO-FEEDBACK", () => {
  it("high engagement + low load + fast reaction = high score", () => {
    const readings: BioReading[] = [
      { ts: 1, cognitiveLoad: 0.1, engagement: 0.9, reactionMs: 400 },
      { ts: 2, cognitiveLoad: 0.15, engagement: 0.85, reactionMs: 500 },
    ];
    const r = bioFeedback(readings);
    expect(r.score).toBeGreaterThan(0.7);
  });

  it("high cognitive load + slow reaction = low score", () => {
    const readings: BioReading[] = [
      { ts: 1, cognitiveLoad: 0.95, engagement: 0.1, reactionMs: 5000 },
    ];
    const r = bioFeedback(readings);
    expect(r.score).toBeLessThan(0.3);
  });

  it("empty readings → neutral 0.5", () => {
    const r = bioFeedback([]);
    expect(r.score).toBe(0.5);
  });
});

describe("v2.2 NEURAL GLADIATOR · TIME-TRAVEL audit", () => {
  it("all-good futures → high score, no block", async () => {
    const scenarios: FutureScenario[] = [
      { id: "s1", weight: 0.5, projection: async () => ({ outcome: "good", rationale: "ok" }) },
      { id: "s2", weight: 0.5, projection: async () => ({ outcome: "good", rationale: "ok" }) },
    ];
    const r = await timeTravelAudit({ answer: "x", scenarios });
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.shouldBlock).toBe(false);
  });

  it("catastrophic futures → block", async () => {
    const scenarios: FutureScenario[] = [
      { id: "s1", weight: 0.7, projection: async () => ({ outcome: "good", rationale: "ok" }) },
      { id: "s2", weight: 0.3, projection: async () => ({ outcome: "catastrophic", rationale: "boom" }) },
    ];
    const r = await timeTravelAudit({ answer: "x", scenarios });
    expect(r.shouldBlock).toBe(true);
    expect(r.catastropheRisk).toBeCloseTo(0.3, 2);
  });

  it("trace records every scenario", async () => {
    const scenarios: FutureScenario[] = [
      { id: "s1", weight: 1, projection: async () => ({ outcome: "neutral", rationale: "meh" }) },
    ];
    const r = await timeTravelAudit({ answer: "x", scenarios });
    expect(r.trace.length).toBe(1);
    expect(r.trace[0]!.outcome).toBe("neutral");
  });
});

describe("v2.2 NEURAL GLADIATOR · LIVE KPI aggregator", () => {
  it("all-perfect arenas → GOD-MODE / DEMON-MODE verdict", () => {
    const r = liveKpi({
      arena: { contestants: [], winner: strongContestant, loser: weakContestant, winnerScore: 1.0, loserScore: 0.1, decisive: true },
      chaos: { totalSamples: 1, rejected: 1, missed: 0, avgRejectMs: 50, rejectionRate: 1, score: 1, details: [] },
      bio: { count: 1, avgCognitiveLoad: 0, avgEngagement: 1, avgReactionMs: 400, score: 1 },
      timeTravel: { scenarios: 1, goodWeight: 1, neutralWeight: 0, badWeight: 0, catastrophicWeight: 0, catastropheRisk: 0, score: 1, trace: [], shouldBlock: false },
    });
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(["GOD-MODE", "DEMON-MODE"]).toContain(r.verdict);
  });

  it("all-empty inputs → ~50/100 OK verdict (neutral baseline)", () => {
    const r = liveKpi({});
    expect(r.score).toBeCloseTo(50, 0);
    expect(r.verdict).toBe("OK");
  });

  it("mixed arenas: strong arena + weak chaos = STRONG/OK", () => {
    const r = liveKpi({
      arena: { contestants: [], winner: strongContestant, loser: weakContestant, winnerScore: 0.95, loserScore: 0.1, decisive: true },
      chaos: { totalSamples: 1, rejected: 0, missed: 1, avgRejectMs: 0, rejectionRate: 0, score: 0.1, details: [] },
    });
    expect(["OK", "WEAK"]).toContain(r.verdict);
  });

  it("formatGladiatorPulseLine produces compact summary", () => {
    const r = liveKpi({});
    expect(formatGladiatorPulseLine(r)).toContain("LIVE-KPI");
  });
});
