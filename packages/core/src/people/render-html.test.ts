/**
 * Tests for `render-html.ts` — the self-contained HTML renderer.
 *
 * Goals:
 *   - Output is a complete, valid HTML5 document
 *   - All CSS is inline (no <link rel="stylesheet">), no external scripts
 *   - No XSS — user-controlled strings are properly escaped
 *   - All expected sections appear
 */

import { describe, it, expect } from "vitest";
import { renderPassportHtml, renderNervousSystemHtml } from "./render-html.js";
import type { PassportData } from "./passport.js";
import type { NervousSystemData } from "./nervous-system.js";

// ─── fixtures ─────────────────────────────────────────────────────────

function passportFixture(over: Partial<PassportData> = {}): PassportData {
  const base: PassportData = {
    meta: {
      repoName: "test-repo",
      generatedAt: "2025-05-07T12:00:00Z",
      totalCommits: 100,
      repoAuthorCount: 4,
      notes: [],
    },
    identity: {
      name: "Alice Wonderland",
      email: "alice@x",
      dnaHash: "abc123def456",
      commitCount: 42,
      fromDate: "2024-01-01",
      toDate: "2025-04-30",
      activeDays: 18,
      repoCommitShare: 0.42,
    },
    dna: {
      author: "alice@x",
      hash: "abc123def456",
      commitCount: 42,
      fromDate: "2024-01-01",
      toDate: "2025-04-30",
      style: {
        filesPerCommit: 1.4,
        churnPerCommit: 38,
        testRatio: 0.4,
        issueRefRatio: 0.1,
        conventionalRatio: 0.6,
      },
      message: {
        avgSubjectLength: 50,
        imperativeRatio: 0.7,
        bodyRatio: 0.3,
        topVerbs: [{ verb: "fix", count: 12 }, { verb: "add", count: 8 }],
      },
      hours: {
        byHour: Array(24).fill(0).map((_, i) => (i >= 9 && i <= 17 ? 4 : 0)),
        byWeekday: [0, 6, 8, 7, 7, 8, 0],
        weekendRatio: 0.05,
        peakWindow: "10:00–11:00",
      },
      files: {
        topDirs: [{ dir: "src", share: 0.6 }, { dir: "tests", share: 0.3 }],
        topExts: [{ ext: "ts", share: 0.7 }, { ext: "md", share: 0.2 }],
      },
    } as unknown as PassportData["dna"],
    expertise: {
      knowledgeMass: 7.4,
      filesKnown: 18,
      filesStillFresh: 12,
      lastActiveAt: "2025-04-30T18:30:00Z",
      topFiles: [
        {
          filePath: "src/core.ts",
          knowledge: 0.92,
          lastTouchDaysAgo: 5,
          touchCount: 12,
          band: "fresh",
          refreshHint: "still strong",
        },
        {
          filePath: "src/util.ts",
          knowledge: 0.45,
          lastTouchDaysAgo: 60,
          touchCount: 4,
          band: "warm",
          refreshHint: "~30 min refresh",
        },
      ],
    },
    telepathySlot: {
      pairs: [
        {
          authorA: { name: "Alice", email: "alice@x" },
          authorB: { name: "Bob", email: "bob@x" },
          score: 1.42,
          events: 5,
          opportunities: 8,
          topTopic: { topic: "src/core", count: 4 },
          recentEvents: [],
          lastSeenAt: "2025-04-15T12:00:00Z",
        } as unknown as PassportData["telepathySlot"]["pairs"][number],
      ],
      pairsEvaluated: 12,
    },
    influenceSlot: {
      rank: 1,
      rankedOf: 4,
      pageRank: 0.4321,
      originatedShapesAdopted: 3,
      originatedShapesTotal: 5,
      adoptionsByOthers: 12,
      uniqueAdopters: 3,
      adoptionsByThisAuthor: 1,
      topShapes: [
        {
          shape: { key: "function:compose:2", kind: "function", name: "compose", arity: 2 },
          adoptions: 12,
          adopters: [{ email: "bob@x", name: "Bob", file: "src/b.ts" }],
        },
      ],
    },
    promiseSlot: {
      open: 2,
      kept: 5,
      stale: 1,
      total: 8,
      keepRate: 5 / 6,
      oldestStale: null,
      mostRecentKept: null,
      teamBaseline: { open: 3, kept: 8, stale: 4, keepRate: 8 / 12, authors: 3 },
    },
    fadingDomains: [
      { filePath: "src/legacy.ts", peakTouches: 8, currentKnowledge: 0.05, daysIdle: 540 },
    ],
    voice: [
      { phrase: "refactor", count: 12, authorRate: 0.04, teamRate: 0.01, weight: 0.05 },
    ],
    friction: null,
    limits: ["Local data only.", "Behavioural fingerprint, not a performance review."],
  };
  return { ...base, ...over };
}

function nervousFixture(over: Partial<NervousSystemData> = {}): NervousSystemData {
  const passport = passportFixture();
  const base: NervousSystemData = {
    meta: {
      repoName: "test-repo",
      generatedAt: "2025-05-07T12:00:00Z",
      totalCommits: 100,
      totalAuthors: 4,
      halfLifeDays: 180,
      rankedAuthorCount: 3,
    },
    hero: {
      headline: "3 cultural alphas · 2 invisible teams · 1 critical file",
      metrics: [
        { label: "Commits (12 weeks)", value: "12", subtitle: "100 total in repo", sparkline: [1,2,3,4,5,6,7,8,9,10,11,12] },
        { label: "Active authors", value: "4", subtitle: "1 originate reused patterns", sparkline: [1,1,2,2,3,3,4,4,4,4,4,4] },
        { label: "Files with live expert", value: "10 / 18", subtitle: "1 deep ghost files", sparkline: [3,3,2,2,1,1,1,1,2,2,2,3] },
        { label: "Latent pairs", value: "2", subtitle: "12 evaluated", sparkline: [0,0,1,1,1,2,2,2,2,2,2,2] },
      ],
    },
    alphas: [
      {
        rank: 1,
        name: "Alice",
        email: "alice@x",
        pageRank: 0.4321,
        originatedShapesAdopted: 3,
        adoptionsByOthers: 12,
        uniqueAdopters: 3,
        topShape: { kind: "function", name: "compose", arity: 2, adoptions: 12 },
      },
    ],
    telepathy: {
      pairs: [
        {
          authorA: { name: "Alice", email: "alice@x" },
          authorB: { name: "Bob", email: "bob@x" },
          score: 1.42,
          events: 5,
          opportunities: 8,
          topTopic: { topic: "src/core", count: 4 },
          recentEvents: [],
          lastSeenAt: "2025-04-15T12:00:00Z",
        } as unknown as NervousSystemData["telepathy"]["pairs"][number],
      ],
      pairsEvaluated: 12,
      distinctAuthorsInGrid: 2,
    },
    atrophy: {
      halfLifeDays: 180,
      criticalFiles: [
        {
          filePath: "src/legacy.ts",
          totalTouches: 8,
          tier: "at-risk",
          freshestKnowledge: 0.05,
          topKnower: { name: "Alice", email: "alice@x", knowledge: 0.05 },
          liveExpertCount: 0,
        },
      ],
      ghostedDeepFiles: 1,
      filesWithLiveExpert: 10,
      fileCount: 18,
    },
    passports: [passport],
    lobes: [
      {
        lobe: "packages/core/src",
        fileCount: 12,
        totalTouches: 120,
        topOwner: { name: "Alice", email: "alice@x", touches: 80 },
        freshestFile: { filePath: "packages/core/src/foo.ts", knowledge: 0.9 },
        ghostFile: { filePath: "packages/core/src/legacy.ts", daysIdle: 540, touches: 8 },
        concentrationPct: 0.5,
      },
    ],
    promises: { open: 2, kept: 5, stale: 1, keepRate: 5 / 6 },
    surprising: ["Cultural alpha: Alice — 12 adoptions of their patterns."],
    limits: ["Local data only.", "This map describes patterns, not people."],
  };
  return { ...base, ...over };
}

// ─── passport HTML ────────────────────────────────────────────────────

describe("renderPassportHtml — document structure", () => {
  it("starts with a doctype declaration", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("contains <html>, <head>, <body>", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).toMatch(/<html\b/i);
    expect(html).toMatch(/<head\b/i);
    expect(html).toMatch(/<body\b/i);
  });

  it("CSS is inline — no <link rel=\"stylesheet\"> tags", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
  });

  it("contains a <style> block (inline CSS)", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
  });

  it("contains no <script> tags (no executable JS)", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).not.toMatch(/<script\b/i);
  });

  it("renders the engineer's name in the hero", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).toMatch(/Alice Wonderland/);
  });

  it("renders every passport section heading", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).toMatch(/DNA fingerprint/);
    expect(html).toMatch(/Expertise map/);
    expect(html).toMatch(/Latent collaborators/);
    expect(html).toMatch(/Cultural footprint/);
    expect(html).toMatch(/Promise ledger/);
    expect(html).toMatch(/Knowledge atrophy clock/);
    expect(html).toMatch(/Voice fingerprint/);
    expect(html).toMatch(/honest limits/i);
  });

  it("escapes HTML-special characters in user-controlled strings (XSS-safe)", () => {
    const evil = passportFixture({
      identity: {
        name: "<script>alert(1)</script>",
        email: "alice@x",
        dnaHash: "abc",
        commitCount: 1,
        fromDate: "2024-01-01",
        toDate: "2024-01-02",
        activeDays: 1,
        repoCommitShare: 0.5,
      },
    });
    const html = renderPassportHtml(evil);
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("does not include the friction section when not provided", () => {
    const html = renderPassportHtml(passportFixture({ friction: null }));
    expect(html).not.toMatch(/Engineering friction/);
  });

  it("includes the friction section when provided", () => {
    const html = renderPassportHtml(
      passportFixture({
        friction: {
          pairs: [
            {
              a: "alice@x",
              b: "bob@x",
              total: 4,
              topFile: "src/x.ts",
              lastClashAt: "2025-04-01T00:00:00Z",
            } as unknown as NonNullable<PassportData["friction"]>["pairs"][number],
          ],
          totalEvents: 4,
        },
      }),
    );
    expect(html).toMatch(/Engineering friction/);
  });

  it("renders the privacy stripe", () => {
    const html = renderPassportHtml(passportFixture());
    expect(html).toMatch(/Local data, local report/);
  });
});

// ─── nervous-system HTML ──────────────────────────────────────────────

describe("renderNervousSystemHtml — document structure", () => {
  it("starts with a doctype declaration", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("CSS is inline — no <link rel=\"stylesheet\">", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
  });

  it("contains no <script> tags", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).not.toMatch(/<script\b/i);
  });

  it("includes every nervous-system section heading", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).toMatch(/Cultural alphas/);
    expect(html).toMatch(/Latent-collaboration heatmap/);
    expect(html).toMatch(/Atrophy critical list/);
    expect(html).toMatch(/Brain lobes/);
    expect(html).toMatch(/Promise debt/);
    expect(html).toMatch(/honest limits/i);
  });

  it("renders the repo name in the title", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).toMatch(/test-repo/);
  });

  it("embeds a mini-passport for each top contributor", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).toMatch(/Mini-passport/);
    expect(html).toMatch(/Alice Wonderland/);
  });

  it("escapes HTML-special characters in surprising findings", () => {
    const evil = nervousFixture({ surprising: ["<img src=x onerror=alert(1)>"] });
    const html = renderNervousSystemHtml(evil);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
  });

  it("renders inline SVG sparklines (no external image refs)", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html).toMatch(/<svg[\s\S]+sparkline/);
    // No external <img src="https://..."> tags either.
    expect(html).not.toMatch(/<img\b[^>]+src=["']https?:/i);
  });

  it("end-to-end smoke: output is non-empty and large enough to be useful", () => {
    const html = renderNervousSystemHtml(nervousFixture());
    expect(html.length).toBeGreaterThan(5000);
  });
});
