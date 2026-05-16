import { describe, it, expect } from "vitest";
import { mineHistory, verifyReport, formatReportLine, type CommitRecord } from "./index.js";

function commit(over: Partial<CommitRecord>): CommitRecord {
  return {
    sha: "abc",
    authorEmail: "shin@example.com",
    ts: "2026-05-01T00:00:00Z",
    message: "feat: a thing",
    filesChanged: [],
    diffText: "",
    branch: "feature",
    ...over,
  };
}

describe("v2.19.7 · RETROACTIVE COMPILE — mine git history", () => {
  it("emits zero agreements when no commit message matches a pattern", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c1", message: "feat: random feature" }),
        commit({ sha: "c2", message: "fix: another thing" }),
      ],
    });
    expect(r.agreementsFound.length).toBe(0);
    expect(r.violations.length).toBe(0);
  });

  it("extracts a backdated agreement when commit message contains 'every commit must have a test'", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c1", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test going forward" }),
        commit({ sha: "c2", ts: "2026-05-02T00:00:00Z", message: "feat: add helper", filesChanged: ["src/foo.ts"] }),
      ],
    });
    expect(r.agreementsFound.length).toBe(1);
    expect(r.agreementsFound[0]!.sourceSha).toBe("c1");
    expect(r.agreementsFound[0]!.decisions.some((d) => d.pattern === "test_required")).toBe(true);
  });

  it("flags a SUBSEQUENT commit that violates the backdated agreement (test_required)", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c1", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test going forward" }),
        commit({ sha: "c2", ts: "2026-05-02T00:00:00Z", message: "feat: add helper", filesChanged: ["src/foo.ts"] }), // NO test → block
        commit({ sha: "c3", ts: "2026-05-03T00:00:00Z", message: "feat: another", filesChanged: ["src/bar.ts", "src/bar.test.ts"] }), // WITH test → ok
      ],
    });
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.violatingCommitSha).toBe("c2");
    expect(r.violations[0]!.severity).toBe("block");
    expect(r.brokenPromiseCount).toBe(1);
  });

  it("does NOT flag commits PRIOR to the agreement", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c0", ts: "2026-04-30T00:00:00Z", message: "feat: legacy", filesChanged: ["src/old.ts"] }), // before agreement
        commit({ sha: "c1", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test going forward" }),
      ],
    });
    expect(r.violations.length).toBe(0); // c0 predates the agreement
  });

  it("perDecisionStats aggregates violations per pattern", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c1", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test" }),
        commit({ sha: "c2", ts: "2026-05-02T00:00:00Z", message: "f1", filesChanged: ["src/a.ts"] }),
        commit({ sha: "c3", ts: "2026-05-03T00:00:00Z", message: "f2", filesChanged: ["src/b.ts"] }),
        commit({ sha: "c4", ts: "2026-05-04T00:00:00Z", message: "f3", filesChanged: ["src/c.ts", "src/c.test.ts"] }),
      ],
    });
    const stats = r.perDecisionStats.find((s) => s.pattern === "test_required")!;
    expect(stats).toBeDefined();
    expect(stats.violated).toBe(2); // c2 + c3 both violated
  });

  it("verifyReport detects tampering", () => {
    const r = mineHistory({
      commits: [
        commit({ sha: "c1", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test" }),
        commit({ sha: "c2", ts: "2026-05-02T00:00:00Z", message: "feat", filesChanged: ["src/foo.ts"] }),
      ],
    });
    expect(verifyReport(r)).toBe(true);
    const tampered = { ...r, brokenPromiseCount: 999 };
    expect(verifyReport(tampered)).toBe(false);
  });

  it("scans many commits without slowdown (sanity)", () => {
    const commits: CommitRecord[] = [
      commit({ sha: "c0", ts: "2026-05-01T00:00:00Z", message: "policy: every commit must have a test" }),
    ];
    for (let i = 1; i <= 50; i++) {
      commits.push(commit({ sha: `c${i}`, ts: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`, message: `feat ${i}`, filesChanged: [`src/${i}.ts`] }));
    }
    const r = mineHistory({ commits });
    expect(r.scannedCommits).toBe(51);
    expect(r.violations.length).toBe(50);
  });

  it("formatReportLine summarises", () => {
    const r = mineHistory({ commits: [] });
    expect(formatReportLine(r)).toContain("RETROACTIVE");
  });
});
