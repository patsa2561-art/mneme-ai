import { describe, expect, it } from "vitest";
import type { NervousSystemData, PassportData, TelepathyPair } from "../types.js";
import { computeGraphWisdom } from "./graphWisdom.js";

function passport(over: Partial<PassportData["identity"]> = {}, files: string[] = []): PassportData {
  return {
    meta: {
      repoName: "test",
      generatedAt: "2026-05-09T00:00:00Z",
      totalCommits: 100,
      repoAuthorCount: 5,
      notes: [],
    },
    identity: {
      name: "Author",
      email: "author@x",
      dnaHash: "h",
      commitCount: 10,
      fromDate: "2026-01-01T00:00:00Z",
      toDate: "2026-05-01T00:00:00Z",
      activeDays: 30,
      repoCommitShare: 0.1,
      ...over,
    },
    expertise: {
      knowledgeMass: 1,
      filesKnown: files.length,
      filesStillFresh: files.length,
      lastActiveAt: "2026-05-01T00:00:00Z",
      topFiles: files.map((filePath) => ({
        filePath,
        knowledge: 0.5,
        lastTouchDaysAgo: 1,
        touchCount: 1,
        band: "fresh" as const,
        refreshHint: "",
      })),
    },
    influenceSlot: null,
    telepathySlot: { pairs: [], pairsEvaluated: 0 },
  };
}

function pair(a: PassportData, b: PassportData, topic = "general"): TelepathyPair {
  return {
    authorA: { name: a.identity.name, email: a.identity.email },
    authorB: { name: b.identity.name, email: b.identity.email },
    events: 5,
    opportunities: 10,
    score: 0.5,
    topTopic: { topic, count: 5 },
    lastSeenAt: "2026-05-01T00:00:00Z",
  };
}

function ns(passports: PassportData[], pairs: TelepathyPair[] = []): NervousSystemData {
  return {
    meta: {
      repoName: "test",
      generatedAt: "2026-05-09T00:00:00Z",
      totalCommits: 100,
      totalAuthors: passports.length,
      halfLifeDays: 60,
      rankedAuthorCount: 0,
    },
    hero: { headline: "", metrics: [] },
    alphas: [],
    telepathy: { pairs, pairsEvaluated: pairs.length, distinctAuthorsInGrid: passports.length },
    atrophy: { halfLifeDays: 60, criticalFiles: [], ghostedDeepFiles: 0, filesWithLiveExpert: 0, fileCount: 0 },
    passports,
    lobes: [],
    limits: [],
  };
}

describe("computeGraphWisdom — empty / trivial cases", () => {
  it("returns empty wisdom when there are no passports", () => {
    const w = computeGraphWisdom(ns([]));
    expect(w.totalNodes).toBe(0);
    expect(w.totalEdges).toBe(0);
    expect(w.isolated).toEqual([]);
    expect(w.repoFirstCommit).toBeNull();
    expect(w.repoLastCommit).toBeNull();
  });

  it("computes real repo first/last push from min/max of passport dates", () => {
    const a = passport({ email: "a@x", fromDate: "2024-09-12T00:00:00Z", toDate: "2025-12-01T00:00:00Z" });
    const b = passport({ email: "b@x", fromDate: "2025-06-01T00:00:00Z", toDate: "2026-05-09T00:00:00Z" });
    const w = computeGraphWisdom(ns([a, b]));
    expect(w.repoFirstCommit).toBe("2024-09-12");
    expect(w.repoLastCommit).toBe("2026-05-09");
    expect(w.repoSpanDays).toBeGreaterThan(500);
  });
});

describe("computeGraphWisdom — isolated-node classification", () => {
  it("flags a tool account (TOKEN suffix) and never recommends connecting it", () => {
    const tool = passport({ name: "RENOVATE_TOKEN", email: "renovate@x", commitCount: 5, activeDays: 5 });
    const human = passport({ name: "Alice", email: "alice@x" });
    const w = computeGraphWisdom(ns([tool, human]));
    const iso = w.isolated.find((i) => i.email === "renovate@x");
    expect(iso?.reason).toBe("tool-account");
    expect(iso?.reasonLabel).toBe("TOOL ACCOUNT");
    expect(iso?.explain).toContain("service-account");
  });

  it("flags a bot (renovate name) with cadence-mismatch explanation", () => {
    const bot = passport({ name: "renovate[bot]", email: "renovate@bot", commitCount: 8, activeDays: 4 });
    const human = passport({ name: "Alice", email: "alice@x" });
    const w = computeGraphWisdom(ns([bot, human]));
    const iso = w.isolated.find((i) => i.email === "renovate@bot");
    expect(iso?.reason).toBe("bot");
    expect(iso?.explain).toMatch(/bot|CI|cadence/i);
  });

  it("flags a drive-by author (1 commit) with the actual commit date", () => {
    const drive = passport(
      { name: "Drive By", email: "drive@x", commitCount: 1, activeDays: 1, fromDate: "2026-04-15T10:00:00Z", toDate: "2026-04-15T10:00:00Z" },
      ["docs/README.md"],
    );
    const human = passport({ name: "Alice", email: "alice@x" });
    const w = computeGraphWisdom(ns([drive, human]));
    const iso = w.isolated.find((i) => i.email === "drive@x");
    expect(iso?.reason).toBe("drive-by");
    expect(iso?.explain).toContain("2026-04-15");
    expect(iso?.evidence.some((e) => e.includes("docs/README.md"))).toBe(true);
  });

  it("flags a solo-day author (multiple commits, all on one day)", () => {
    const solo = passport({ name: "Solo", email: "solo@x", commitCount: 4, activeDays: 1, fromDate: "2026-03-10T08:00:00Z", toDate: "2026-03-10T18:00:00Z" });
    const human = passport({ name: "Alice", email: "alice@x" });
    const w = computeGraphWisdom(ns([solo, human]));
    const iso = w.isolated.find((i) => i.email === "solo@x");
    expect(iso?.reason).toBe("solo-day");
    expect(iso?.explain).toContain("4 commits");
  });

  it("flags a time-island author (window doesn't overlap anyone)", () => {
    const island = passport({
      name: "Island",
      email: "island@x",
      commitCount: 6,
      activeDays: 4,
      fromDate: "2024-01-01T00:00:00Z",
      toDate: "2024-02-15T00:00:00Z",
    });
    const peer = passport({
      name: "Peer",
      email: "peer@x",
      fromDate: "2025-06-01T00:00:00Z",
      toDate: "2026-05-01T00:00:00Z",
    });
    const w = computeGraphWisdom(ns([island, peer]));
    const iso = w.isolated.find((i) => i.email === "island@x");
    expect(iso?.reason).toBe("time-island");
    expect(iso?.explain).toContain("2024-01-01");
    expect(iso?.explain).toContain("2024-02-15");
    expect(iso?.evidence.some((e) => e.includes("0 of 1"))).toBe(true);
  });

  it("flags a file-island author (overlaps in time but not in files)", () => {
    const islandAuthor = passport(
      { name: "Niche", email: "niche@x", commitCount: 5, activeDays: 3 },
      ["packages/niche/index.ts"],
    );
    const peer = passport({ name: "Mainline", email: "main@x" }, ["packages/core/index.ts"]);
    const w = computeGraphWisdom(ns([islandAuthor, peer]));
    const iso = w.isolated.find((i) => i.email === "niche@x");
    expect(iso?.reason).toBe("file-island");
    expect(iso?.explain).toContain("packages/niche/index.ts");
  });
});

describe("computeGraphWisdom — connected components + headline", () => {
  it("treats a connected pair as a single component (size 2) with no isolated nodes", () => {
    const a = passport({ name: "A", email: "a@x" });
    const b = passport({ name: "B", email: "b@x" });
    const w = computeGraphWisdom(ns([a, b], [pair(a, b, "infra")]));
    expect(w.components).toHaveLength(1);
    expect(w.components[0]!.size).toBe(2);
    expect(w.components[0]!.dominantTopic).toBe("infra");
    expect(w.isolated).toHaveLength(0);
    expect(w.headline).toContain("fully connected");
  });

  it("identifies a bridge node only when component size ≥ 3", () => {
    const a = passport({ name: "A", email: "a@x" });
    const b = passport({ name: "B", email: "b@x" });
    const c = passport({ name: "C", email: "c@x" });
    const w = computeGraphWisdom(ns([a, b, c], [pair(a, b), pair(b, c)]));
    expect(w.components[0]!.size).toBe(3);
    expect(w.components[0]!.bridge?.email).toBe("b@x");
  });

  it("headline calls out multiple disconnected islands", () => {
    const a = passport({ name: "A", email: "a@x" });
    const b = passport({ name: "B", email: "b@x" });
    const c = passport({ name: "C", email: "c@x" });
    const d = passport({ name: "D", email: "d@x" });
    const w = computeGraphWisdom(ns([a, b, c, d], [pair(a, b), pair(c, d)]));
    expect(w.components).toHaveLength(2);
    expect(w.headline).toContain("disconnected islands");
  });

  it("orders isolated nodes by interestingness — file/time islands first, bots/tools last", () => {
    const tool = passport({ name: "CI_TOKEN", email: "ci@x" });
    const bot = passport({ name: "dependabot[bot]", email: "dep@x" });
    const driveBy = passport({ name: "Drive", email: "d@x", commitCount: 1, activeDays: 1 });
    const niche = passport({ name: "Niche", email: "n@x" }, ["niche.ts"]);
    const peer = passport({ name: "Peer", email: "p@x" }, ["main.ts"]);
    const w = computeGraphWisdom(ns([tool, bot, driveBy, niche, peer]));
    expect(w.isolated[0]!.reason).toBe("file-island");
    expect(w.isolated.at(-1)!.reason).toBe("tool-account");
  });
});
