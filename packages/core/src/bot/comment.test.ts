import { describe, it, expect } from "vitest";
import {
  formatComment,
  escapeMd,
  truncate,
  humanDays,
  mentionFromEmail,
  type AtrophyReport,
  type GhostReport,
  type PromiseReport,
} from "./comment.js";
import type { AuditCertificate } from "../audit/certify.js";

function makeCert(overrides: Partial<AuditCertificate> = {}): AuditCertificate {
  return {
    sessionId: "abc1234",
    capturedAt: "2026-05-07T12:00:00.000Z",
    axes: {
      behavioralParity: { verdict: "pass", reason: "all sample commands match", details: [] },
      apiContractDrift: { verdict: "pass", reason: "API surface identical", details: [] },
      testPassRate: {
        verdict: "pass",
        reason: "no new test failures",
        before: "1645 passed / 0 failed (12 files)",
        after: "1645 passed / 0 failed (12 files)",
      },
      perfRegression: { verdict: "pass", reason: "worst-case +2.1%", deltaPercent: 2.1 },
      aiNarrative: { verdict: "pass", reason: "trust 1.00", checks: [] },
    },
    forensicAxes: { size: "pass", files: "pass", style: "pass", time: "pass" },
    overallVerdict: "pass",
    exitCode: 0,
    ...overrides,
  };
}

describe("formatComment — header", () => {
  it("renders the all-pass headline with checkmark", () => {
    const out = formatComment({ audit: makeCert() });
    expect(out).toContain("## 🤖 Mneme audit");
    expect(out).toContain("**Verdict: ✅ pass**");
    expect(out).toContain("9/9 axes green");
    expect(out).toContain("0 contradictions");
  });

  it("uses ❌ for fail verdict", () => {
    const cert = makeCert({ overallVerdict: "fail", exitCode: 1 });
    cert.axes.testPassRate = {
      verdict: "fail",
      reason: "3 new failures",
      before: "1645 / 0",
      after: "1642 / 3",
    };
    const out = formatComment({ audit: cert });
    expect(out).toContain("**Verdict: ❌ fail**");
    expect(out).toContain("❌ fail");
  });

  it("uses ⚠️ for warn verdict", () => {
    const cert = makeCert({ overallVerdict: "warn" });
    cert.axes.perfRegression = { verdict: "warn", reason: "12% slower", deltaPercent: 12 };
    const out = formatComment({ audit: cert });
    expect(out).toContain("**Verdict: ⚠️ warn**");
  });

  it("renders a no-cert headline when audit is null", () => {
    const out = formatComment({ audit: null });
    expect(out).toContain("Mneme — pull request scan");
    expect(out).not.toContain("5-axis breakdown");
  });
});

describe("formatComment — 5-axis table", () => {
  it("renders all five axes and escapes pipe characters in reasons", () => {
    const cert = makeCert();
    cert.axes.behavioralParity.reason = "exit 0 | exit 1 mismatch";
    const out = formatComment({ audit: cert });
    expect(out).toContain("📊 5-axis breakdown");
    expect(out).toContain("🎯 Behavioral parity");
    expect(out).toContain("📐 API contract drift");
    expect(out).toContain("✅ Test pass rate");
    expect(out).toContain("⚡ Perf regression");
    expect(out).toContain("📰 AI narrative");
    // pipe escaped
    expect(out).toContain("exit 0 \\| exit 1 mismatch");
  });

  it("includes the perf delta percentage", () => {
    const cert = makeCert();
    cert.axes.perfRegression = { verdict: "warn", reason: "ask 14% slower", deltaPercent: 14 };
    const out = formatComment({ audit: cert });
    expect(out).toContain("(14%)");
  });

  it("renders before → after for tests", () => {
    const cert = makeCert();
    cert.axes.testPassRate = {
      verdict: "warn",
      reason: "passing test count dropped",
      before: "100 passed / 0 failed (5 files)",
      after: "98 passed / 0 failed (5 files)",
    };
    const out = formatComment({ audit: cert });
    expect(out).toContain("100 passed / 0 failed (5 files) → 98 passed / 0 failed (5 files)");
  });
});

describe("formatComment — atrophy section", () => {
  it("lists at-risk files with a request-review handle", () => {
    const atrophy: AtrophyReport = {
      atRiskFiles: [
        {
          filePath: "src/auth/jwt.ts",
          totalTouches: 4,
          tier: "at-risk",
          freshestKnowledge: 0.41,
          allKnowers: [
            { name: "Alice", email: "alice@example.com", knowledge: 0.41, lastTouchDaysAgo: 200, touchCount: 4 },
          ],
        },
      ],
      stats: { halfLifeDays: 180, fileCount: 1, filesWithLiveExpert: 0, ghostedFiles: 0 },
    };
    const out = formatComment({ audit: makeCert(), atrophy });
    expect(out).toContain("⏳ Knowledge atrophy");
    expect(out).toContain("`src/auth/jwt.ts`");
    expect(out).toContain("**41% fresh**");
    expect(out).toContain("@alice");
  });

  it("skips the atrophy block when atRiskFiles is empty", () => {
    const out = formatComment({
      audit: makeCert(),
      atrophy: {
        atRiskFiles: [],
        stats: { halfLifeDays: 180, fileCount: 0, filesWithLiveExpert: 0, ghostedFiles: 0 },
      },
    });
    expect(out).not.toContain("Knowledge atrophy");
  });

  it("renders 'no live expert' when knowers list is empty", () => {
    const atrophy: AtrophyReport = {
      atRiskFiles: [
        {
          filePath: "ghosted/file.ts",
          totalTouches: 1,
          tier: "at-risk",
          freshestKnowledge: 0.05,
          allKnowers: [],
        },
      ],
      stats: { halfLifeDays: 180, fileCount: 1, filesWithLiveExpert: 0, ghostedFiles: 1 },
    };
    const out = formatComment({ audit: makeCert(), atrophy });
    expect(out).toContain("no live expert");
  });
});

describe("formatComment — ghost + promise sections", () => {
  it("renders the ghost block with score + reason", () => {
    const ghost: GhostReport = {
      hauntedFiles: [
        { filePath: "src/dead.ts", score: 0.92, reason: "stale TODO + 200d untouched", lastTouchDaysAgo: 200 },
      ],
      totalCount: 1,
    };
    const out = formatComment({ audit: makeCert(), ghost });
    expect(out).toContain("👻 Ghost code");
    expect(out).toContain("`src/dead.ts`");
    expect(out).toContain("0.92");
  });

  it("renders the promise block with truncation on long promises", () => {
    const promise: PromiseReport = {
      open: 3,
      kept: 7,
      stale: 2,
      topOpen: [{ author: "Bob", promise: "x".repeat(150), ageDays: 42 }],
    };
    const out = formatComment({ audit: makeCert(), promise });
    expect(out).toContain("🤝 Promise-debt");
    expect(out).toContain("Open: **3**");
    // The 150-char promise should have been truncated to 100 with ellipsis.
    expect(out).toMatch(/x{99}…/);
  });
});

describe("formatComment — footer + determinism", () => {
  it("renders the footer with repo + sha context", () => {
    const out = formatComment({
      audit: makeCert(),
      context: { repo: "patsa2561-art/mneme-ai", sha: "deadbeefcafe1234" },
    });
    expect(out).toContain("Generated by [Mneme]");
    expect(out).toContain("`patsa2561-art/mneme-ai`");
    expect(out).toContain("`deadbee`");
    expect(out).toContain("all data computed locally");
  });

  it("output is deterministic — same input produces byte-identical output", () => {
    const cert = makeCert();
    const a = formatComment({ audit: cert, context: { sha: "abc" } });
    const b = formatComment({ audit: cert, context: { sha: "abc" } });
    expect(a).toBe(b);
  });
});

describe("escapeMd", () => {
  it("replaces newlines with spaces", () => {
    expect(escapeMd("line1\nline2")).toBe("line1 line2");
    expect(escapeMd("line1\r\nline2")).toBe("line1 line2");
  });
  it("escapes pipe characters", () => {
    expect(escapeMd("a|b|c")).toBe("a\\|b\\|c");
  });
  it("handles null/undefined", () => {
    // @ts-expect-error — verify runtime safety
    expect(escapeMd(null)).toBe("");
    // @ts-expect-error
    expect(escapeMd(undefined)).toBe("");
  });
});

describe("truncate", () => {
  it("returns input unchanged when shorter than n", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  it("truncates and appends ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});

describe("humanDays", () => {
  it("uses today/yesterday for very recent days", () => {
    expect(humanDays(0)).toBe("today");
    expect(humanDays(1.5)).toBe("yesterday");
  });
  it("uses days for under two weeks", () => {
    expect(humanDays(7)).toBe("7d ago");
  });
  it("uses weeks for under two months", () => {
    expect(humanDays(35)).toBe("5w ago");
  });
  it("uses months for under two years", () => {
    expect(humanDays(180)).toBe("6mo ago");
  });
  it("uses years for two years+", () => {
    expect(humanDays(800)).toBe("2.2y ago");
  });
});

describe("mentionFromEmail", () => {
  it("extracts a GitHub-noreply username", () => {
    expect(mentionFromEmail("12345+alice@users.noreply.github.com")).toBe("@alice");
  });
  it("uses the local-part for plain user emails", () => {
    expect(mentionFromEmail("alice@example.com")).toBe("@alice");
  });
  it("returns undefined for noreply addresses", () => {
    expect(mentionFromEmail("noreply@anthropic.com")).toBeUndefined();
    expect(mentionFromEmail("no-reply@example.com")).toBeUndefined();
  });
  it("returns undefined for non-email input", () => {
    expect(mentionFromEmail("not-an-email")).toBeUndefined();
    expect(mentionFromEmail("")).toBeUndefined();
  });
  it("returns undefined for local-parts with unsafe characters", () => {
    expect(mentionFromEmail("alice.bob+ci@example.com")).toBeUndefined();
  });
});
