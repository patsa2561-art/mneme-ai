/**
 * `mneme audit` — CLI integration test.
 *
 * We exercise the dispatcher and the markdown report renderer directly.
 * For modes that hit git/npm we use canned baselines + traces so the
 * test is deterministic on any host.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdownReport } from "./audit.js";
import { audit } from "@mneme-ai/core";

type AuditCertificate = audit.AuditCertificate;

function mkCert(over: Partial<AuditCertificate> = {}): AuditCertificate {
  return {
    sessionId: "abc1234",
    capturedAt: "2026-05-07T12:00:00Z",
    axes: {
      behavioralParity: { verdict: "pass", reason: "all sample commands match the baseline", details: [] },
      apiContractDrift: { verdict: "pass", reason: "API surface identical", details: [] },
      testPassRate: {
        verdict: "pass",
        reason: "no new test failures",
        before: "100 passed / 0 failed (5 files)",
        after: "100 passed / 0 failed (5 files)",
      },
      perfRegression: { verdict: "pass", reason: "no perf regression", deltaPercent: 0 },
      aiNarrative: { verdict: "pass", reason: "narrative trust 1.00", checks: [] },
    },
    forensicAxes: { size: "pass", files: "pass", style: "pass", time: "pass" },
    overallVerdict: "pass",
    exitCode: 0,
    ...over,
  };
}

describe("mneme audit — markdown report", () => {
  it("renders a valid markdown skeleton for a passing certificate", () => {
    const md = renderMarkdownReport(mkCert());
    expect(md).toContain("# AI Audit Trust Certificate");
    expect(md).toContain("`abc1234`");
    expect(md).toContain("PASS");
    expect(md).toContain("| Axis | Verdict | Reason |");
    expect(md).toContain("Behavioral parity");
    expect(md).toContain("API contract drift");
    expect(md).toContain("Test pass rate");
    expect(md).toContain("Perf regression");
    expect(md).toContain("AI narrative");
    expect(md).toContain("## Forensic Axes");
  });

  it("renders FAIL prominently when overall verdict is fail", () => {
    const cert = mkCert({
      overallVerdict: "fail",
      exitCode: 1,
      axes: {
        ...mkCert().axes,
        apiContractDrift: {
          verdict: "fail",
          reason: "1 export(s) removed — silent breaking change",
          details: ["removed: core.foo"],
        },
      },
    });
    const md = renderMarkdownReport(cert);
    expect(md).toContain("FAIL");
    expect(md).toContain("(exit 1)");
    expect(md).toContain("silent breaking change");
  });

  it("includes per-commit narrative checks when present", () => {
    const cert = mkCert({
      axes: {
        ...mkCert().axes,
        aiNarrative: {
          verdict: "fail",
          reason: "1 commit-message claim(s) contradicted by diff",
          checks: [
            {
              commitHash: "deadbeef0000",
              claims: [],
              filesTouched: ["src/db.ts"],
              verifications: [
                {
                  claim: "no change to db.ts",
                  verdict: "contradicted",
                  reason: 'claim says "db.ts" untouched, but diff modifies it',
                },
              ],
              narrativeTrustScore: 0,
            },
          ],
        },
      },
      overallVerdict: "fail",
      exitCode: 1,
    });
    const md = renderMarkdownReport(cert);
    expect(md).toContain("## Per-Commit Narrative Checks");
    expect(md).toContain("### deadbee (trust 0.00)");
    expect(md).toContain("contradicted");
    expect(md).toContain("no change to db.ts");
  });

  it("forensic axes are listed even when all pass", () => {
    const md = renderMarkdownReport(mkCert());
    expect(md).toContain("- size: pass");
    expect(md).toContain("- files: pass");
    expect(md).toContain("- style: pass");
    expect(md).toContain("- time: pass");
  });

  it("exit code is preserved in the report header", () => {
    expect(renderMarkdownReport(mkCert({ exitCode: 0 }))).toContain("(exit 0)");
    expect(renderMarkdownReport(mkCert({ exitCode: 1 }))).toContain("(exit 1)");
  });
});

describe("mneme audit — dispatcher boundary", () => {
  it("the audit module re-exports through @mneme-ai/core/audit", async () => {
    const mod = await import("@mneme-ai/core");
    expect(mod.audit).toBeDefined();
    expect(typeof mod.audit.captureBaseline).toBe("function");
    expect(typeof mod.audit.traceSession).toBe("function");
    expect(typeof mod.audit.verifyNarrative).toBe("function");
    expect(typeof mod.audit.buildCertificate).toBe("function");
  });
});
