import { describe, it, expect } from "vitest";
import { evaluateRequest, formatMutinyPulseLine, type RegretRecord } from "./index.js";

const redisRegret: RegretRecord = {
  id: "REG-2026-03",
  ts: Date.UTC(2026, 2, 14),
  topic: "Redis sessions",
  matchKeywords: ["redis", "session cache", "shared session"],
  story: "Memory leak with Redis-backed sessions broke prod 2026-03-14. Team rage-quit Redis.",
  severity: 0.85,
  scope: "commit a3f9b21",
};

const jwtRegret: RegretRecord = {
  id: "REG-2024-08",
  ts: Date.UTC(2024, 7, 1),
  topic: "JWT 5-min tolerance",
  matchKeywords: ["jwt tighten", "tighten jwt", "strict jwt"],
  story: "Tightening JWT broke Apple Sign-In DST.",
  severity: 0.6,
};

describe("v2.0 MUTINY · refuse-with-rationale", () => {
  it("approves request that doesn't match any regret", () => {
    const r = evaluateRequest({ request: "refactor users.service.ts", regretHistory: [redisRegret] });
    expect(r.verdict).toBe("approved");
    expect(r.matchedRegrets.length).toBe(0);
  });

  it("BLOCKS request that matches a high-severity regret", () => {
    const r = evaluateRequest({ request: "let's use Redis for sessions", regretHistory: [redisRegret] });
    expect(r.verdict).toBe("block");
    expect(r.matchedRegrets[0]!.id).toBe("REG-2026-03");
    expect(r.acknowledgementRequired).toContain("acknowledge REG-2026-03");
  });

  it("WARNS on a medium-severity match", () => {
    const r = evaluateRequest({ request: "let me tighten JWT verification", regretHistory: [jwtRegret] });
    expect(r.verdict).toBe("warn");
  });

  it("approves when user explicitly acknowledges by id", () => {
    const r = evaluateRequest({
      request: "use Redis for sessions",
      regretHistory: [redisRegret],
      acknowledgement: "acknowledge REG-2026-03 — yes I know it broke before, I want to try with TTL fix",
    });
    expect(r.verdict).toBe("approved");
  });

  it("matches via synonyms / matchKeywords (not just topic)", () => {
    const r = evaluateRequest({ request: "implement shared session cache", regretHistory: [redisRegret] });
    expect(r.verdict).toBe("block"); // matched 'shared session' keyword
  });

  it("returns the strongest matching regret when multiple match", () => {
    const r = evaluateRequest({ request: "use Redis + tighten JWT", regretHistory: [redisRegret, jwtRegret] });
    expect(r.verdict).toBe("block");
    expect(r.severity).toBeCloseTo(0.85, 2); // the Redis one wins
  });

  it("formatMutinyPulseLine produces compact summary", () => {
    const r = evaluateRequest({ request: "use Redis", regretHistory: [redisRegret] });
    expect(formatMutinyPulseLine(r)).toContain("MUTINY");
    expect(formatMutinyPulseLine(r)).toContain("verdict=block");
  });
});
