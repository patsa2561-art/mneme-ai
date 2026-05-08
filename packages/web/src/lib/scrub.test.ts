import { describe, expect, it } from "vitest";
import type { NervousSystemData, PassportData } from "../types.js";
import { scrubData, computeTimeBounds } from "./scrub.js";

function passport(over: Partial<PassportData["expertise"]> = {}, identityOver: Partial<PassportData["identity"]> = {}): PassportData {
  return {
    meta: {
      repoName: "test",
      generatedAt: "2026-05-01T00:00:00Z",
      totalCommits: 10,
      repoAuthorCount: 1,
      notes: [],
    },
    identity: {
      name: "A",
      email: "a@x",
      dnaHash: "abc",
      commitCount: 10,
      fromDate: "2025-01-01",
      toDate: "2026-05-01",
      activeDays: 100,
      repoCommitShare: 1,
      ...identityOver,
    },
    expertise: {
      knowledgeMass: 42,
      filesKnown: 5,
      filesStillFresh: 3,
      lastActiveAt: "2026-05-01T00:00:00Z",
      topFiles: [],
      ...over,
    },
    influenceSlot: null,
    telepathySlot: { pairs: [], pairsEvaluated: 0 },
  };
}

function emptyData(passports: PassportData[]): NervousSystemData {
  return {
    meta: {
      repoName: "test",
      generatedAt: "2026-05-01T00:00:00Z",
      totalCommits: 10,
      totalAuthors: passports.length,
      halfLifeDays: 60,
      rankedAuthorCount: 0,
    },
    hero: { headline: "", metrics: [] },
    alphas: [],
    telepathy: { pairs: [], pairsEvaluated: 0, distinctAuthorsInGrid: 0 },
    atrophy: {
      halfLifeDays: 60,
      criticalFiles: [],
      ghostedDeepFiles: 0,
      filesWithLiveExpert: 0,
      fileCount: 0,
    },
    passports,
    lobes: [],
    limits: [],
  };
}

describe("scrubData — empty topFiles preserves synthesized knowledgeMass", () => {
  it("keeps knowledgeMass non-zero when topFiles is empty (live-mode case)", () => {
    const data = emptyData([passport({ knowledgeMass: 42, topFiles: [], filesKnown: 0 })]);
    const t = Date.parse("2026-05-01T00:00:00Z");
    const out = scrubData(data, t);
    expect(out.passports[0]!.expertise.knowledgeMass).toBe(42);
    expect(out.passports[0]!.expertise.filesStillFresh).toBe(3); // also preserved
  });

  it("recomputes knowledgeMass from per-file decay when topFiles is non-empty", () => {
    const data = emptyData([
      passport({
        knowledgeMass: 999, // would be wrong if preserved
        filesKnown: 1,
        filesStillFresh: 1,
        topFiles: [
          {
            filePath: "x.ts",
            knowledge: 0.9,
            lastTouchDaysAgo: 0,
            touchCount: 10,
            band: "fresh",
            refreshHint: "still strong",
          },
        ],
      }),
    ]);
    const t = Date.parse("2026-05-01T00:00:00Z");
    const out = scrubData(data, t);
    // mass is recomputed — should NOT be 999
    expect(out.passports[0]!.expertise.knowledgeMass).not.toBe(999);
    expect(out.passports[0]!.expertise.knowledgeMass).toBeGreaterThan(0);
  });

  it("drops authors whose fromDate is in the future relative to scrub time", () => {
    const data = emptyData([
      passport({}, { email: "early@x", fromDate: "2024-01-01" }),
      passport({}, { email: "late@x", fromDate: "2027-01-01" }),
    ]);
    const t = Date.parse("2026-01-01T00:00:00Z");
    const out = scrubData(data, t);
    expect(out.passports.map((p) => p.identity.email)).toEqual(["early@x"]);
  });
});

describe("computeTimeBounds — max bound always extends to now", () => {
  it("includes Date.now() in the max bound even if the data is older", () => {
    const oldGen = "2024-01-01T00:00:00Z";
    const data = {
      meta: {
        repoName: "test",
        generatedAt: oldGen,
        totalCommits: 0,
        totalAuthors: 0,
        halfLifeDays: 60,
        rankedAuthorCount: 0,
      },
      hero: { headline: "", metrics: [] },
      alphas: [],
      telepathy: { pairs: [], pairsEvaluated: 0, distinctAuthorsInGrid: 0 },
      atrophy: {
        halfLifeDays: 60,
        criticalFiles: [],
        ghostedDeepFiles: 0,
        filesWithLiveExpert: 0,
        fileCount: 0,
      },
      passports: [],
      lobes: [],
      limits: [],
    } as NervousSystemData;
    const bounds = computeTimeBounds(data);
    expect(bounds).not.toBeNull();
    expect(bounds!.max).toBeGreaterThan(Date.parse(oldGen));
  });
});
