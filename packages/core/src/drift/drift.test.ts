import { describe, it, expect } from "vitest";
import { analyzeDrift, offMissionScore, driftGauntlet, type Mission, type AgentAction } from "./index.js";

const mission: Mission = { goal: "refactor the auth module", scopeGlobs: ["src/auth/**"], keywords: ["auth", "token", "login", "refactor", "session"] };
const onMission = (n: number): AgentAction[] => Array.from({ length: n }, (_, i) => ({ turn: i + 1, summary: "refactor auth token session", files: [`src/auth/x${i}.ts`], riskClass: "write" as const }));

describe("v2.143 · DRIFT — Mission-Drift Detection (EWMA control chart)", () => {
  it("gauntlet is 100 (A/B test passes)", () => {
    expect(driftGauntlet().score).toBe(100);
  });

  it("A/B: on-mission is STABLE, a straying stream is DIVERGENT, score B>A", () => {
    const A = analyzeDrift(mission, onMission(10));
    const B = analyzeDrift(mission, [
      ...onMission(4),
      { turn: 5, summary: "billing dashboard css", files: ["src/billing/ui.ts"], riskClass: "write" },
      { turn: 6, summary: "marketing analytics", files: ["src/marketing/t.ts"], riskClass: "network" },
      { turn: 7, summary: "edit CI + global dep", files: [".github/ci.yml"], riskClass: "network" },
      { turn: 8, summary: "delete infra", files: ["infra/x.sh"], riskClass: "destructive" },
      { turn: 9, summary: "rewrite deploy", files: ["infra/d.sh"], riskClass: "destructive" },
      { turn: 10, summary: "purge db", files: ["scripts/purge.sh"], riskClass: "destructive" },
    ]);
    expect(A.band).toBe("STABLE");
    expect(B.band).toBe("DIVERGENT");
    expect(B.driftScore).toBeGreaterThan(A.driftScore + 0.1);
    expect(B.firstBreachTurn).toBeGreaterThanOrEqual(5);
  });

  it("recovery: returning to mission decays the EWMA", () => {
    const drifted = [
      ...onMission(4),
      { turn: 5, summary: "billing", files: ["src/billing/a.ts"], riskClass: "network" as const },
      { turn: 6, summary: "infra delete", files: ["infra/x.sh"], riskClass: "destructive" as const },
      { turn: 7, summary: "deploy rewrite", files: ["infra/d.sh"], riskClass: "destructive" as const },
    ];
    const peak = analyzeDrift(mission, drifted);
    const recovered = analyzeDrift(mission, [...drifted, ...Array.from({ length: 5 }, (_, i) => ({ turn: 8 + i, summary: "refactor auth token", files: [`src/auth/r${i}.ts`], riskClass: "write" as const }))]);
    expect(recovered.driftScore).toBeLessThan(peak.driftScore);
  });

  it("abstains UNKNOWN on thin data (never flags below minActions)", () => {
    expect(analyzeDrift(mission, onMission(3)).band).toBe("UNKNOWN");
  });

  it("off-mission signal is sound", () => {
    expect(offMissionScore({ turn: 1, summary: "refactor auth token", files: ["src/auth/x.ts"], riskClass: "write" }, mission)).toBeLessThan(0.35);
    expect(offMissionScore({ turn: 1, summary: "purge the production database", files: ["scripts/purge.sh"], riskClass: "destructive" }, mission)).toBeGreaterThan(0.6);
  });

  it("control-limit math: UCL > baseline, finite, breaches counted, series length matches", () => {
    const r = analyzeDrift(mission, onMission(8));
    expect(r.ucl).toBeGreaterThan(r.baseline.mean);
    expect(Number.isFinite(r.ucl)).toBe(true);
    expect(r.series).toHaveLength(8);
  });

  it("is total on hostile input", () => {
    expect(() => analyzeDrift(null as never, null as never)).not.toThrow();
    expect(() => offMissionScore(null as never, null as never)).not.toThrow();
    expect(() => analyzeDrift({ goal: "x" }, [{ turn: 1 } as never])).not.toThrow();
  });
});
