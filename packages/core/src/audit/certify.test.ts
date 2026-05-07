import { describe, it, expect } from "vitest";
import {
  buildCertificate,
  classifyForensicAxis,
  combineVerdicts,
  compareApiSurface,
  compareBehavioralParity,
  comparePerf,
  compareTestPassRate,
  evaluateNarrativeAxis,
} from "./certify.js";
import type { Baseline } from "./baseline.js";
import type { SessionTrace } from "./trace.js";

function mkBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    capturedAt: "2026-05-07T00:00:00Z",
    headHash: "abc123def",
    outputs: {
      git_head: { exitCode: 0, stdoutHash: "h1", stdoutLines: 1 },
      git_log_20: { exitCode: 0, stdoutHash: "h2", stdoutLines: 20 },
      node_version: { exitCode: 0, stdoutHash: "h3", stdoutLines: 1 },
    },
    testPassRate: { passed: 100, failed: 0, files: 5 },
    apiSurface: { core: ["foo", "bar"], cli: ["baz"] },
    perfMs: { git_status: 10, git_head: 5 },
    ...over,
  };
}

describe("audit/certify — combineVerdicts + classifyForensicAxis", () => {
  it("combineVerdicts: any fail beats warn beats pass", () => {
    expect(combineVerdicts(["pass", "pass"])).toBe("pass");
    expect(combineVerdicts(["pass", "warn"])).toBe("warn");
    expect(combineVerdicts(["pass", "fail", "warn"])).toBe("fail");
    expect(combineVerdicts([])).toBe("pass");
  });

  it("classifyForensicAxis maps anomaly scores → verdicts", () => {
    expect(classifyForensicAxis(0)).toBe("pass");
    expect(classifyForensicAxis(0.4)).toBe("warn");
    expect(classifyForensicAxis(0.7)).toBe("fail");
    expect(classifyForensicAxis(1.0)).toBe("fail");
  });
});

describe("audit/certify — compareBehavioralParity", () => {
  it("pass when all sample hashes match", () => {
    const before = mkBaseline();
    const r = compareBehavioralParity(before, { outputs: before.outputs });
    expect(r.verdict).toBe("pass");
  });

  it("expected drift on git_head/git_log = pass with note", () => {
    const before = mkBaseline();
    const after = {
      outputs: {
        git_head: { exitCode: 0, stdoutHash: "h1-different", stdoutLines: 1 },
        git_log_20: { exitCode: 0, stdoutHash: "h2-different", stdoutLines: 22 },
        node_version: { exitCode: 0, stdoutHash: "h3", stdoutLines: 1 },
      },
    };
    const r = compareBehavioralParity(before, after);
    expect(r.verdict).toBe("pass");
    expect(r.details.some((d) => d.includes("expected"))).toBe(true);
  });

  it("warn when an unexpected sample drifts (e.g. node_version)", () => {
    const before = mkBaseline();
    const after = {
      outputs: {
        ...before.outputs,
        node_version: { exitCode: 0, stdoutHash: "different", stdoutLines: 1 },
      },
    };
    const r = compareBehavioralParity(before, after);
    expect(r.verdict).toBe("warn");
  });

  it("fail when an exit code changes (any sample)", () => {
    const before = mkBaseline();
    const after = {
      outputs: {
        ...before.outputs,
        git_head: { exitCode: 1, stdoutHash: "h1", stdoutLines: 1 },
      },
    };
    const r = compareBehavioralParity(before, after);
    expect(r.verdict).toBe("fail");
  });
});

describe("audit/certify — compareApiSurface", () => {
  it("pass when surface unchanged", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, { apiSurface: b.apiSurface });
    expect(r.verdict).toBe("pass");
  });

  it("pass when only additions", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, {
      apiSurface: { core: ["foo", "bar", "newOne"], cli: ["baz"] },
    });
    expect(r.verdict).toBe("pass");
    expect(r.details.some((d) => d.includes("newOne"))).toBe(true);
  });

  it("fail when an export is removed", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, {
      apiSurface: { core: ["foo"], cli: ["baz"] },
    });
    expect(r.verdict).toBe("fail");
    expect(r.details.some((d) => d.includes("bar"))).toBe(true);
  });
});

describe("audit/certify — compareTestPassRate", () => {
  it("pass when nothing regresses", () => {
    const b = mkBaseline();
    const r = compareTestPassRate(b, {
      testPassRate: { passed: 100, failed: 0, files: 5 },
    });
    expect(r.verdict).toBe("pass");
  });

  it("fail when failures appear", () => {
    const b = mkBaseline();
    const r = compareTestPassRate(b, {
      testPassRate: { passed: 99, failed: 1, files: 5 },
    });
    expect(r.verdict).toBe("fail");
  });

  it("warn when passing count drops without new failures", () => {
    const b = mkBaseline();
    const r = compareTestPassRate(b, {
      testPassRate: { passed: 95, failed: 0, files: 5 },
    });
    expect(r.verdict).toBe("warn");
  });
});

describe("audit/certify — comparePerf", () => {
  it("pass when no degradation", () => {
    const b = mkBaseline();
    const r = comparePerf(b, { perfMs: { git_status: 10, git_head: 5 } });
    expect(r.verdict).toBe("pass");
  });

  it("warn when 10..25% slower", () => {
    const b = mkBaseline();
    const r = comparePerf(b, { perfMs: { git_status: 12, git_head: 5 } });
    expect(r.verdict).toBe("warn");
    expect(r.deltaPercent).toBeCloseTo(20, 0);
  });

  it("fail when >25% slower", () => {
    const b = mkBaseline();
    const r = comparePerf(b, { perfMs: { git_status: 20, git_head: 5 } });
    expect(r.verdict).toBe("fail");
    expect(r.deltaPercent).toBeCloseTo(100, 0);
  });
});

describe("audit/certify — evaluateNarrativeAxis", () => {
  it("pass when no commits", () => {
    const trace: SessionTrace = {
      fromHash: "x",
      toHash: "y",
      commits: [],
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    };
    const r = evaluateNarrativeAxis({ trace, diffs: {} });
    expect(r.verdict).toBe("pass");
  });

  it("fail when any claim is contradicted", () => {
    const trace: SessionTrace = {
      fromHash: "x",
      toHash: "y",
      commits: [
        {
          hash: "abc",
          shortHash: "abc",
          author: "AI",
          authorEmail: "noreply@anthropic.com",
          message: "Tweak handler. No change to db.ts.",
        },
      ],
      filesChanged: ["src/db.ts"],
      insertions: 1,
      deletions: 0,
    };
    const r = evaluateNarrativeAxis({
      trace,
      diffs: { abc: { diff: "+ x", filesTouched: ["src/handler.ts", "src/db.ts"] } },
    });
    expect(r.verdict).toBe("fail");
    expect(r.checks).toHaveLength(1);
  });

  it("pass when narratives verify cleanly", () => {
    const trace: SessionTrace = {
      fromHash: "x",
      toHash: "y",
      commits: [
        {
          hash: "abc",
          shortHash: "abc",
          author: "AI",
          authorEmail: "noreply@anthropic.com",
          message: "Adds function fooBar.",
        },
      ],
      filesChanged: ["src/x.ts"],
      insertions: 1,
      deletions: 0,
    };
    const r = evaluateNarrativeAxis({
      trace,
      diffs: { abc: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] } },
    });
    expect(r.verdict).toBe("pass");
  });
});

describe("audit/certify — buildCertificate end-to-end", () => {
  it("clean baseline+trace → pass + exit 0", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [],
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      diffs: {},
    });
    expect(cert.overallVerdict).toBe("pass");
    expect(cert.exitCode).toBe(0);
    expect(cert.axes.behavioralParity.verdict).toBe("pass");
    expect(cert.axes.apiContractDrift.verdict).toBe("pass");
    expect(cert.axes.testPassRate.verdict).toBe("pass");
    expect(cert.axes.perfRegression.verdict).toBe("pass");
    expect(cert.axes.aiNarrative.verdict).toBe("pass");
  });

  it("fabricated regression → overall fail + exit 1", () => {
    const before = mkBaseline();
    const after = mkBaseline({
      apiSurface: { core: ["foo"], cli: ["baz"] }, // bar removed
      testPassRate: { passed: 99, failed: 1, files: 5 },
      perfMs: { git_status: 30, git_head: 5 },
    });
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: after,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [
          {
            hash: "abc",
            shortHash: "abc",
            author: "AI",
            authorEmail: "noreply@anthropic.com",
            message: "Refactor. No change to core/foo.ts.",
          },
        ],
        filesChanged: ["core/foo.ts"],
        insertions: 1,
        deletions: 1,
      },
      diffs: {
        abc: { diff: "+ x\n- y", filesTouched: ["core/foo.ts"] },
      },
    });
    expect(cert.overallVerdict).toBe("fail");
    expect(cert.exitCode).toBe(1);
    expect(cert.axes.apiContractDrift.verdict).toBe("fail");
    expect(cert.axes.testPassRate.verdict).toBe("fail");
    expect(cert.axes.perfRegression.verdict).toBe("fail");
    expect(cert.axes.aiNarrative.verdict).toBe("fail");
  });

  it("forensic axes default to pass when no scores supplied", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "x",
        commits: [],
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      diffs: {},
    });
    expect(cert.forensicAxes.size).toBe("pass");
    expect(cert.forensicAxes.files).toBe("pass");
    expect(cert.forensicAxes.style).toBe("pass");
    expect(cert.forensicAxes.time).toBe("pass");
  });

  it("forensic axes propagate to overall when high score", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "x",
        commits: [],
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      diffs: {},
      forensicScores: { size: 0.8, files: 0.1, style: 0.1, time: 0.1 },
    });
    expect(cert.overallVerdict).toBe("fail");
    expect(cert.forensicAxes.size).toBe("fail");
  });

  it("sessionId + capturedAt are populated", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "my-session",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [],
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      diffs: {},
    });
    expect(cert.sessionId).toBe("my-session");
    expect(cert.capturedAt).toMatch(/^\d{4}-/);
  });
});
