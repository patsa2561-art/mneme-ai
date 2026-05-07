/**
 * `mneme audit --certify --report` — smoke test against the EXACT scenario
 * the user complained about in v0.34: an audit run that returned `0 / 0`
 * test counts and `no commits with diffs to verify` and rubber-stamped
 * everything as "pass".
 *
 * The test asserts the v0.35 forensic-grade behavior: that scenario now
 * returns INSUFFICIENT DATA + skipped axes + low confidence + exit code
 * tied to --strict.  No more rubber-stamping.
 *
 * This is the regression guard for the bug class "audit lies when given
 * empty input".
 */
import { describe, it, expect } from "vitest";
import { renderMarkdownReport } from "./audit.js";
import { audit } from "@mneme-ai/core";

describe("audit smoke — the v0.34 'rubber-stamp on empty input' scenario", () => {
  it("recreates the bug case and verifies the forensic-grade output", () => {
    // Reconstruct the EXACT v0.34 input that produced the rubber-stamp:
    //   - empty test counts on both sides (0 / 0 / 0)
    //   - empty trace (no commits)
    //   - perf samples present (so perf isn't skipped)
    //   - no forensic scores (default = skipped)
    const empty: audit.Baseline = {
      capturedAt: "2026-05-07T13:39:00.000Z",
      headHash: "16939decafef00d",
      outputs: {
        git_head: { exitCode: 0, stdoutHash: "h", stdoutLines: 1 },
        node_version: { exitCode: 0, stdoutHash: "v", stdoutLines: 1 },
      },
      testPassRate: { passed: 0, failed: 0, files: 0 },
      apiSurface: { core: ["foo", "bar"] },
      perfMs: { git_head: 19, git_status: 24 },
    };
    const after: audit.Baseline = {
      ...empty,
      perfMs: { git_head: 20, git_status: 25 }, // 5.3% drift
    };

    const cert = audit.buildCertificate({
      sessionId: "16939de",
      beforeBaseline: empty,
      afterBaseline: after,
      trace: { fromHash: "x", toHash: "x", commits: [], filesChanged: [], insertions: 0, deletions: 0 },
      diffs: {},
    });

    // ── Verdicts: NO MORE RUBBER-STAMPING ─────────────────────────────
    // v0.34 said: "Test pass rate: pass (0/0 → 0/0)". That was a lie.
    expect(cert.axes.testPassRate.verdict).toBe("skipped");
    // v0.34 said: "AI narrative: pass — no commits with diffs to verify". Also a lie.
    expect(cert.axes.aiNarrative.verdict).toBe("skipped");
    // v0.34 said: "size/files/style/time: pass" with no evidence. Also rubber-stamping.
    expect(cert.forensicAxes.size.verdict).toBe("skipped");
    expect(cert.forensicAxes.files.verdict).toBe("skipped");

    // Behavioral parity + API + perf still verify (real data exists).
    expect(cert.axes.behavioralParity.verdict).toBe("pass");
    expect(cert.axes.apiContractDrift.verdict).toBe("pass");
    expect(cert.axes.perfRegression.verdict).toBe("pass");

    // Coverage: 3 verified, 2 skipped → medium confidence.
    expect(cert.coverage.verified).toBe(3);
    expect(cert.coverage.skipped).toBe(2);
    expect(cert.coverage.confidence).toBe("medium");

    // Without --strict the overall is `warn` (not pass!) because there
    // are skipped axes.  v0.34 reported PASS here.
    expect(cert.overallVerdict).toBe("warn");
    expect(cert.exitCode).toBe(0);

    // ── Render the markdown — verify evidence is present ──────────────
    const md = renderMarkdownReport(cert);

    // Headline carries coverage + confidence (not just "exit 0").
    expect(md).toContain("3/5 axes verified");
    expect(md).toContain("2 skipped");
    expect(md).toContain("medium confidence");

    // Per-axis evidence: behavioral parity must show every sample's hash.
    expect(md).toContain("**git_head**");
    expect(md).toContain("**node_version**");
    expect(md).toContain("sha h"); // sha prefix is rendered

    // Test pass rate axis must explain WHY skipped.
    expect(md).toContain("Test pass rate");
    expect(md).toContain("`skipped`");
    expect(md).toMatch(/no test command produced output/i);

    // AI narrative must explain WHY skipped (zero commits).
    expect(md).toContain("AI narrative");
    expect(md).toMatch(/nothing to verify|no AI-attributed commits/i);

    // Perf axis shows per-command before/after numbers.
    expect(md).toContain("**git_head**");
    expect(md).toContain("baseline 19 ms");
    expect(md).toContain("current 20 ms");

    // Caveats present (the "ⓘ" lines).
    expect(md).toContain("ⓘ");
    expect(md).toMatch(/Sampling/);
  });

  it("--strict promotes the same scenario to FAIL (compliance mode)", () => {
    const empty: audit.Baseline = {
      capturedAt: "2026-05-07T13:39:00.000Z",
      headHash: "h",
      outputs: { git_head: { exitCode: 0, stdoutHash: "h", stdoutLines: 1 } },
      testPassRate: { passed: 0, failed: 0, files: 0 },
      apiSurface: { core: ["foo"] },
      perfMs: { git_head: 19 },
    };
    const cert = audit.buildCertificate({
      sessionId: "x",
      beforeBaseline: empty,
      afterBaseline: empty,
      trace: { fromHash: "x", toHash: "x", commits: [], filesChanged: [], insertions: 0, deletions: 0 },
      diffs: {},
      strict: true,
    });
    expect(cert.overallVerdict).toBe("fail");
    expect(cert.exitCode).toBe(1);
  });

  it("real session with AI commit + tests → genuine PASS with high confidence", () => {
    // Sanity check: the new rules don't make every audit warn.  When
    // there's actual data, an actual PASS gets issued.
    const baseline: audit.Baseline = {
      capturedAt: "2026-05-07T00:00:00.000Z",
      headHash: "h1",
      outputs: { git_head: { exitCode: 0, stdoutHash: "h1", stdoutLines: 1 } },
      testPassRate: { passed: 1962, failed: 0, files: 141 },
      apiSurface: { core: ["foo", "bar"] },
      perfMs: { git_head: 19 },
    };
    const after: audit.Baseline = {
      ...baseline,
      headHash: "h2",
      testPassRate: { passed: 1965, failed: 0, files: 141 },
    };
    const cert = audit.buildCertificate({
      sessionId: "abc1234",
      beforeBaseline: baseline,
      afterBaseline: after,
      trace: {
        fromHash: "h1",
        toHash: "h2",
        commits: [
          {
            hash: "abc12345",
            shortHash: "abc1234",
            author: "AI",
            authorEmail: "noreply@anthropic.com",
            message: "Adds function fooBar",
            likelyAI: { vendor: "claude", confidence: 0.95 },
          },
        ],
        filesChanged: ["src/x.ts"],
        insertions: 5,
        deletions: 0,
      },
      diffs: {
        abc12345: { diff: "+ export function fooBar() {}", filesTouched: ["src/x.ts"] },
      },
      forensicScores: {
        size: { score: 0.1, note: "+5 lines vs author median 50 (z=0.4)" },
        files: { score: 0.1, note: "all files seen before" },
        style: { score: 0.1, note: "verb 'Adds' in author vocabulary" },
        time: { score: 0.1, note: "commit hour in author's window" },
      },
    });

    expect(cert.overallVerdict).toBe("pass");
    expect(cert.coverage.verified).toBe(5);
    expect(cert.coverage.skipped).toBe(0);
    expect(cert.coverage.confidence).toBe("high");

    // Test pass rate evidence shows real numbers.
    const md = renderMarkdownReport(cert);
    expect(md).toContain("1962 passed");
    expect(md).toContain("1965 passed");
    expect(md).toContain("+3 passed");
    expect(md).toContain("5/5 axes verified");
    expect(md).toContain("high confidence");
  });
});
