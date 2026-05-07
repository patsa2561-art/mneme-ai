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
      behavioralParity: {
        verdict: "pass",
        reason: "all sample commands match the baseline",
        details: [],
        evidence: [
          { label: "git_head", value: "exit 0 · 1 line · sha abc12345", ok: true },
          { label: "node_version", value: "exit 0 · 1 line · sha def67890", ok: true },
        ],
        caveat: "Sampling: 3 of 12 commands a real CI would run.",
        confidence: "medium",
      },
      apiContractDrift: {
        verdict: "pass",
        reason: "API surface identical (47 exports, hash matches)",
        details: [],
        evidence: [
          { label: "exports scanned", value: "47 across 5 package(s)" },
          { label: "added", value: "0", ok: true },
          { label: "removed", value: "0", ok: true },
          { label: "surface hash (after)", value: "sha256:xyz789abc" },
        ],
        caveat: "Surface = top-level public exports.",
        confidence: "high",
      },
      testPassRate: {
        verdict: "pass",
        reason: "no new test failures",
        details: [],
        before: "100 passed / 0 failed (5 files)",
        after: "100 passed / 0 failed (5 files)",
        evidence: [
          { label: "before", value: "100 passed / 0 failed (5 files)" },
          { label: "after", value: "100 passed / 0 failed (5 files)", ok: true },
          { label: "delta", value: "+0 passed · +0 failed · +0 file(s)", ok: true },
        ],
        confidence: "high",
      },
      perfRegression: {
        verdict: "pass",
        reason: "no perf regression",
        details: [],
        deltaPercent: 0,
        evidence: [
          { label: "git_head", value: "baseline 5 ms → current 5 ms (+0%)", ok: true },
        ],
        confidence: "medium",
      },
      aiNarrative: {
        verdict: "pass",
        reason: "narrative trust 1.00",
        details: [],
        checks: [],
        evidence: [
          { label: "AI commits checked", value: "1", ok: true },
          { label: "claims verified", value: "2", ok: true },
        ],
        confidence: "high",
      },
    },
    forensicAxes: {
      size: { verdict: "pass", score: 0.1, reason: "well within median", evidence: [{ label: "score", value: "0.10" }] },
      files: { verdict: "pass", score: 0.1, reason: "all files seen", evidence: [{ label: "score", value: "0.10" }] },
      style: { verdict: "pass", score: 0.1, reason: "verb in vocab", evidence: [{ label: "score", value: "0.10" }] },
      time: { verdict: "pass", score: 0.1, reason: "in window", evidence: [{ label: "score", value: "0.10" }] },
    },
    overallVerdict: "pass",
    coverage: { verified: 5, skipped: 0, total: 5, confidence: "high" },
    exitCode: 0,
    ...over,
  };
}

describe("mneme audit — markdown report (forensic-grade)", () => {
  it("renders a valid markdown skeleton for a passing certificate", () => {
    const md = renderMarkdownReport(mkCert());
    expect(md).toContain("# AI Audit Trust Certificate");
    expect(md).toContain("`abc1234`");
    expect(md).toContain("PASS");
    // Headline carries coverage + confidence
    expect(md).toContain("5/5 axes verified");
    expect(md).toContain("high confidence");
    // Verdict table
    expect(md).toContain("| Axis | Verdict | Confidence | Reason |");
    expect(md).toContain("Behavioral parity");
    expect(md).toContain("API contract drift");
    expect(md).toContain("Test pass rate");
    expect(md).toContain("Perf regression");
    expect(md).toContain("AI narrative");
    // Per-axis evidence section
    expect(md).toContain("## Per-Axis Evidence");
    expect(md).toContain("## Forensic Axes");
  });

  it("renders evidence bullets per axis (the FACTS — sniper-grade)", () => {
    const md = renderMarkdownReport(mkCert());
    // Every axis gets evidence bullets in the report
    expect(md).toContain("**git_head**");
    expect(md).toContain("**exports scanned**");
    expect(md).toContain("**before**");
    expect(md).toContain("**after**");
    expect(md).toContain("**AI commits checked**");
    // Caveats surface as italic ⓘ lines
    expect(md).toContain("ⓘ Sampling");
  });

  it("FAIL prominently when overall verdict is fail; reason in the table", () => {
    const cert = mkCert({
      overallVerdict: "fail",
      exitCode: 1,
      axes: {
        ...mkCert().axes,
        apiContractDrift: {
          verdict: "fail",
          reason: "1 export(s) removed — silent breaking change",
          details: ["removed: core.foo"],
          evidence: [
            { label: "removed", value: "1", ok: false },
            { label: "removed (sample)", value: "core.foo", ok: false },
          ],
          confidence: "high",
        },
      },
    });
    const md = renderMarkdownReport(cert);
    expect(md).toContain("FAIL");
    expect(md).toContain("(exit 1)");
    expect(md).toContain("silent breaking change");
    expect(md).toContain("**removed**");
  });

  it("INSUFFICIENT DATA tripwire surfaces in the header — refuses to certify", () => {
    const cert = mkCert({
      overallVerdict: "warn",
      coverage: { verified: 0, skipped: 5, total: 5, confidence: "low" },
      insufficientData: {
        reason: "no AI-attributed commits AND no measurable change",
        hint: "Capture a baseline, run an AI session, then re-run --certify.",
      },
    });
    const md = renderMarkdownReport(cert);
    expect(md).toContain("INSUFFICIENT DATA");
    expect(md).toContain("Capture a baseline");
    expect(md).toContain("0/5 axes verified");
  });

  it("includes per-commit narrative checks when present", () => {
    const cert = mkCert({
      axes: {
        ...mkCert().axes,
        aiNarrative: {
          verdict: "fail",
          reason: "1 commit-message claim(s) contradicted by diff",
          details: [],
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
          evidence: [{ label: "claims contradicted", value: "1", ok: false }],
          confidence: "high",
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

  it("forensic axes are listed even when all pass (with reason)", () => {
    const md = renderMarkdownReport(mkCert());
    expect(md).toContain("**size**");
    expect(md).toContain("**files**");
    expect(md).toContain("**style**");
    expect(md).toContain("**time**");
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
