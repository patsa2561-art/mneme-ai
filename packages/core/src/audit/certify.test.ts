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

/** Baseline that simulates "audit ran with no signal" — empty everything. */
function mkEmptyBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    capturedAt: "2026-05-07T00:00:00Z",
    headHash: "deadbeef",
    outputs: {},
    testPassRate: { passed: 0, failed: 0, files: 0 },
    apiSurface: {},
    perfMs: {},
    ...over,
  };
}

describe("audit/certify — combineVerdicts + classifyForensicAxis", () => {
  it("combineVerdicts: any fail beats warn beats skipped beats pass", () => {
    expect(combineVerdicts(["pass", "pass"])).toBe("pass");
    expect(combineVerdicts(["pass", "warn"])).toBe("warn");
    expect(combineVerdicts(["pass", "fail", "warn"])).toBe("fail");
    expect(combineVerdicts(["pass", "skipped"])).toBe("warn");
    expect(combineVerdicts([])).toBe("pass");
  });

  it("--strict promotes skipped → fail", () => {
    expect(combineVerdicts(["pass", "skipped"], { strict: true })).toBe("fail");
    expect(combineVerdicts(["pass", "pass"], { strict: true })).toBe("pass");
  });

  it("classifyForensicAxis maps anomaly scores → verdicts (with note)", () => {
    expect(classifyForensicAxis(0, "all good").verdict).toBe("pass");
    expect(classifyForensicAxis(0.4, "borderline").verdict).toBe("warn");
    expect(classifyForensicAxis(0.7, "high").verdict).toBe("fail");
    expect(classifyForensicAxis(1.0, "ceiling").verdict).toBe("fail");
  });

  it("classifyForensicAxis returns skipped when no data supplied", () => {
    const r = classifyForensicAxis(0);
    expect(r.verdict).toBe("skipped");
    expect(r.evidence.some((e) => /no data/.test(e.value))).toBe(true);
  });
});

describe("audit/certify — compareBehavioralParity", () => {
  it("pass when all sample hashes match — evidence shows each command's exit + line count + hash", () => {
    const before = mkBaseline();
    const r = compareBehavioralParity(before, { outputs: before.outputs });
    expect(r.verdict).toBe("pass");
    // evidence carries per-sample lines (every sample has an entry)
    expect(r.evidence.length).toBeGreaterThanOrEqual(3);
    expect(r.evidence.some((e) => e.label === "git_head" && /sha h1/.test(e.value))).toBe(true);
    // caveat exists (honest sample-size disclosure)
    expect(r.caveat).toMatch(/Sampling/);
  });

  it("expected drift on git_head/git_log = pass with explicit 'expected' note", () => {
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
    expect(r.evidence.some((e) => /expected/.test(e.value))).toBe(true);
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

  it("skipped when baseline has zero samples — never claims pass on empty data", () => {
    const before = mkEmptyBaseline();
    const r = compareBehavioralParity(before, { outputs: {} });
    expect(r.verdict).toBe("skipped");
    expect(r.confidence).toBe("low");
  });
});

describe("audit/certify — compareApiSurface", () => {
  it("pass when surface unchanged — evidence shows export count + surface hash", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, { apiSurface: b.apiSurface });
    expect(r.verdict).toBe("pass");
    // Evidence must include hash + count (sniper-grade proof of "identical").
    expect(r.evidence.some((e) => e.label === "exports scanned")).toBe(true);
    expect(r.evidence.some((e) => /surface hash/.test(e.label))).toBe(true);
    expect(r.evidence.some((e) => e.label === "removed" && e.value === "0")).toBe(true);
  });

  it("pass when only additions", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, {
      apiSurface: { core: ["foo", "bar", "newOne"], cli: ["baz"] },
    });
    expect(r.verdict).toBe("pass");
    expect(r.evidence.some((e) => e.value.includes("newOne"))).toBe(true);
  });

  it("fail when an export is removed — evidence flags the missing name", () => {
    const b = mkBaseline();
    const r = compareApiSurface(b, {
      apiSurface: { core: ["foo"], cli: ["baz"] },
    });
    expect(r.verdict).toBe("fail");
    expect(r.evidence.some((e) => e.value.includes("bar"))).toBe(true);
  });

  it("skipped when both sides empty — no exports to compare", () => {
    const r = compareApiSurface(mkEmptyBaseline(), { apiSurface: {} });
    expect(r.verdict).toBe("skipped");
  });
});

describe("audit/certify — compareTestPassRate", () => {
  it("pass when nothing regresses — evidence shows before/after/delta", () => {
    const b = mkBaseline();
    const r = compareTestPassRate(b, {
      testPassRate: { passed: 100, failed: 0, files: 5 },
    });
    expect(r.verdict).toBe("pass");
    expect(r.evidence.some((e) => e.label === "before")).toBe(true);
    expect(r.evidence.some((e) => e.label === "after")).toBe(true);
    expect(r.evidence.some((e) => e.label === "delta")).toBe(true);
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

  it("CRITICAL: skipped (NEVER pass) when both sides report 0/0 — no tests ran", () => {
    // This is the v0.27 bug: 0/0 was reported as "pass · no new test failures".
    // Forensic-grade: report "skipped" with explicit diagnosis.
    const r = compareTestPassRate(mkEmptyBaseline(), {
      testPassRate: { passed: 0, failed: 0, files: 0 },
    });
    expect(r.verdict).toBe("skipped");
    expect(r.confidence).toBe("low");
    expect(r.caveat).toMatch(/test/);
  });
});

describe("audit/certify — comparePerf", () => {
  it("pass when no degradation — evidence shows each command's before/after/%", () => {
    const b = mkBaseline();
    const r = comparePerf(b, { perfMs: { git_status: 10, git_head: 5 } });
    expect(r.verdict).toBe("pass");
    expect(r.evidence.some((e) => e.label === "git_status" && /baseline 10/.test(e.value))).toBe(true);
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

  it("skipped when no overlapping samples", () => {
    const r = comparePerf(mkEmptyBaseline(), { perfMs: {} });
    expect(r.verdict).toBe("skipped");
  });
});

describe("audit/certify — evaluateNarrativeAxis", () => {
  it("CRITICAL: skipped (NEVER pass) when zero commits — nothing to verify", () => {
    // v0.27 bug: this returned `pass · no commits with diffs to verify`.
    const trace: SessionTrace = {
      fromHash: "x",
      toHash: "y",
      commits: [],
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    };
    const r = evaluateNarrativeAxis({ trace, diffs: {} });
    expect(r.verdict).toBe("skipped");
    expect(r.evidence.some((e) => e.label === "AI commits" && e.value === "0")).toBe(true);
  });

  it("skipped when only human commits in window — no AI to audit", () => {
    const trace: SessionTrace = {
      fromHash: "x",
      toHash: "y",
      commits: [
        {
          hash: "abc",
          shortHash: "abc",
          author: "Alice",
          authorEmail: "alice@example.com",
          message: "Refactor handler.",
        },
      ],
      filesChanged: ["src/handler.ts"],
      insertions: 1,
      deletions: 0,
    };
    const r = evaluateNarrativeAxis({
      trace,
      diffs: { abc: { diff: "+ x", filesTouched: ["src/handler.ts"] } },
    });
    expect(r.verdict).toBe("skipped");
  });

  it("fail when any claim is contradicted (AI commit detected via email)", () => {
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
          likelyAI: { vendor: "claude", confidence: 0.95 },
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

  it("pass when AI narratives verify cleanly — evidence carries per-commit trust", () => {
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
          likelyAI: { vendor: "claude", confidence: 0.95 },
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
    expect(r.evidence.some((e) => e.label === "abc")).toBe(true);
  });
});

describe("audit/certify — buildCertificate end-to-end", () => {
  it("clean baseline+trace → pass + exit 0 (with full coverage)", () => {
    const before = mkBaseline();
    // Same-shape "after" baseline (test counts unchanged).  Add an AI commit
    // so the narrative axis isn't skipped.  Pass forensic scores explicitly —
    // the post-v0.35 default is `skipped` (no rubber-stamping).
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [
          {
            hash: "abc",
            shortHash: "abc",
            author: "AI",
            authorEmail: "noreply@anthropic.com",
            message: "Adds function fooBar.",
            likelyAI: { vendor: "claude", confidence: 0.95 },
          },
        ],
        filesChanged: ["src/x.ts"],
        insertions: 1,
        deletions: 0,
      },
      diffs: {
        abc: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] },
      },
      forensicScores: {
        size: { score: 0.1, note: "+10 lines vs author median 50 (z=0.4)" },
        files: { score: 0.1, note: "all files seen before" },
        style: { score: 0.1, note: "verb 'Adds' in author vocabulary" },
        time: { score: 0.1, note: "commit hour in author's window" },
      },
    });
    expect(cert.overallVerdict).toBe("pass");
    expect(cert.exitCode).toBe(0);
    expect(cert.coverage.verified).toBe(5);
    expect(cert.coverage.skipped).toBe(0);
    expect(cert.axes.behavioralParity.verdict).toBe("pass");
    expect(cert.axes.aiNarrative.verdict).toBe("pass");
    expect(cert.insufficientData).toBeUndefined();
  });

  it("CRITICAL: empty trace + identical baselines → insufficientData (NEVER pass)", () => {
    // The v0.27 bug case: "0 passed / 0 failed (0 files) → 0 passed / 0 failed (0 files)"
    // got reported as a clean PASS.  Now we refuse to certify and explain why.
    const empty = mkEmptyBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: empty,
      afterBaseline: empty,
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
    expect(cert.insufficientData).toBeDefined();
    expect(cert.insufficientData?.reason).toMatch(/nothing to certify/);
    // Without --strict, falls back to warn (not a green light).
    expect(cert.overallVerdict).toBe("warn");
    // Skipped axes: parity, api, tests, perf, narrative — all 5 should be skipped.
    expect(cert.coverage.skipped).toBe(5);
    expect(cert.coverage.verified).toBe(0);
    expect(cert.coverage.confidence).toBe("low");
    expect(cert.axes.testPassRate.verdict).toBe("skipped");
    expect(cert.axes.aiNarrative.verdict).toBe("skipped");
  });

  it("--strict promotes insufficientData → fail", () => {
    const empty = mkEmptyBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: empty,
      afterBaseline: empty,
      trace: {
        fromHash: "x",
        toHash: "x",
        commits: [],
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      diffs: {},
      strict: true,
    });
    expect(cert.overallVerdict).toBe("fail");
    expect(cert.exitCode).toBe(1);
  });

  it("--strict promotes any skipped axis → fail (e.g. no test command)", () => {
    const before = mkBaseline({
      // outputs/api populated, but tests + perf skipped (empty).
      testPassRate: { passed: 0, failed: 0, files: 0 },
      perfMs: {},
    });
    const after = before;
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
            message: "Adds function fooBar.",
            likelyAI: { vendor: "claude", confidence: 0.95 },
          },
        ],
        filesChanged: ["src/x.ts"],
        insertions: 1,
        deletions: 0,
      },
      diffs: {
        abc: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] },
      },
      strict: true,
    });
    expect(cert.axes.testPassRate.verdict).toBe("skipped");
    expect(cert.axes.perfRegression.verdict).toBe("skipped");
    expect(cert.overallVerdict).toBe("fail"); // strict promotes skipped → fail
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
            likelyAI: { vendor: "claude", confidence: 0.95 },
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

  it("forensic axes default to skipped when no scores supplied (NEVER 'pass' on no data)", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [
          {
            hash: "abc",
            shortHash: "abc",
            author: "AI",
            authorEmail: "noreply@anthropic.com",
            message: "Adds function fooBar.",
            likelyAI: { vendor: "claude", confidence: 0.95 },
          },
        ],
        filesChanged: ["src/x.ts"],
        insertions: 1,
        deletions: 0,
      },
      diffs: {
        abc: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] },
      },
    });
    expect(cert.forensicAxes.size.verdict).toBe("skipped");
    expect(cert.forensicAxes.files.verdict).toBe("skipped");
    expect(cert.forensicAxes.style.verdict).toBe("skipped");
    expect(cert.forensicAxes.time.verdict).toBe("skipped");
  });

  it("forensic axes propagate to overall when high score (with note)", () => {
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
      forensicScores: {
        size: { score: 0.8, note: "+5000 line commit, 8x author median" },
        files: { score: 0.1, note: "all files seen before" },
        style: { score: 0.1, note: "verb in vocabulary" },
        time: { score: 0.1, note: "in author's window" },
      },
    });
    expect(cert.overallVerdict).toBe("fail");
    expect(cert.forensicAxes.size.verdict).toBe("fail");
    expect(cert.forensicAxes.size.evidence.some((e) => e.label === "note")).toBe(true);
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

  it("evidence arrays contain real strings (never empty for verified axes)", () => {
    const before = mkBaseline();
    const cert = buildCertificate({
      sessionId: "sess1",
      beforeBaseline: before,
      afterBaseline: before,
      trace: {
        fromHash: "x",
        toHash: "y",
        commits: [
          {
            hash: "abc",
            shortHash: "abc",
            author: "AI",
            authorEmail: "noreply@anthropic.com",
            message: "Adds function fooBar.",
            likelyAI: { vendor: "claude", confidence: 0.95 },
          },
        ],
        filesChanged: ["src/x.ts"],
        insertions: 1,
        deletions: 0,
      },
      diffs: {
        abc: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] },
      },
    });
    // Every verified axis must carry concrete evidence (not just a verdict).
    expect(cert.axes.behavioralParity.evidence.length).toBeGreaterThan(0);
    expect(cert.axes.apiContractDrift.evidence.length).toBeGreaterThan(0);
    expect(cert.axes.testPassRate.evidence.length).toBeGreaterThan(0);
    expect(cert.axes.perfRegression.evidence.length).toBeGreaterThan(0);
    expect(cert.axes.aiNarrative.evidence.length).toBeGreaterThan(0);
    // Every axis has a confidence rating.
    expect(["high", "medium", "low"]).toContain(cert.axes.behavioralParity.confidence);
  });
});
