import { describe, it, expect } from "vitest";
import { timeTravelSearch, groupByPath, type SnapshotMatch } from "./time-travel.js";

const MATCHES: SnapshotMatch[] = [
  {
    commitHash: "a1b2c3",
    timestamp: "2024-01-15T00:00:00Z",
    path: "src/auth.ts",
    line: 42,
    snippet: "validateJWT(token)",
    baseRelevance: 0.9,
    ageDays: 365,
  },
  {
    commitHash: "d4e5f6",
    timestamp: "2024-08-01T00:00:00Z",
    path: "src/auth.ts",
    line: 50,
    snippet: "validateOpaqueToken(t)",
    baseRelevance: 0.85,
    ageDays: 180,
  },
  {
    commitHash: "g7h8i9",
    timestamp: "2025-02-10T00:00:00Z",
    path: "services/auth/v2/login.ts",
    line: 12,
    snippet: "validateSession(s)",
    baseRelevance: 0.7,
    ageDays: 30,
  },
];

describe("A5. Time-Travel Search", () => {
  it("returns matches with phase-adjusted scores", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 30 });
    expect(r.length).toBe(3);
    // The 30-day-old match should resonate with the 30-day query → highest score
    expect(r[0]!.commitHash).toBe("g7h8i9");
  });

  it("queryAgeDays=180 favors the 180-day-old match", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 180 });
    expect(r[0]!.commitHash).toBe("d4e5f6");
  });

  it("respects topK", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 30, topK: 1 });
    expect(r).toHaveLength(1);
  });

  it("empty matches → empty result", () => {
    expect(timeTravelSearch({ matches: [], queryAgeDays: 0 })).toEqual([]);
  });

  it("phaseScore ∈ [0,1]", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 30 });
    for (const x of r) {
      expect(x.phaseScore).toBeGreaterThanOrEqual(0);
      expect(x.phaseScore).toBeLessThanOrEqual(1);
    }
  });

  it("preserves baseRelevance for transparency", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 0 });
    for (const x of r) expect(typeof x.baseRelevance).toBe("number");
  });

  it("deterministic across runs", () => {
    const a = timeTravelSearch({ matches: MATCHES, queryAgeDays: 60 });
    const b = timeTravelSearch({ matches: MATCHES, queryAgeDays: 60 });
    expect(a).toEqual(b);
  });
});

describe("A5. Time-Travel — groupByPath", () => {
  it("groups results by file path", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 60 });
    const grouped = groupByPath(r);
    expect(grouped.size).toBe(2);
    expect(grouped.get("src/auth.ts")?.length).toBe(2);
    expect(grouped.get("services/auth/v2/login.ts")?.length).toBe(1);
  });

  it("orders each group by timestamp ASC (oldest first → story arc)", () => {
    const r = timeTravelSearch({ matches: MATCHES, queryAgeDays: 60 });
    const grouped = groupByPath(r);
    const auth = grouped.get("src/auth.ts")!;
    expect(auth[0]!.timestamp.localeCompare(auth[1]!.timestamp)).toBeLessThan(0);
  });
});
