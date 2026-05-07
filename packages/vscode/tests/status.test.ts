import { describe, it, expect } from "vitest";
import { formatVerdict } from "../src/status/statusBarItem.js";
import type { AuditCertificate } from "@mneme-ai/core/public";

function cert(v: "pass" | "warn" | "fail"): AuditCertificate {
  return {
    sessionId: "t",
    capturedAt: "2026-01-15T00:00:00.000Z",
    overallVerdict: v,
    exitCode: v === "fail" ? 1 : 0,
    axes: {} as AuditCertificate["axes"],
    forensicAxes: { size: "pass", files: "pass", style: "pass", time: "pass" },
  };
}

describe("formatVerdict", () => {
  it("idle when no certificate present", () => {
    const badge = formatVerdict(null);
    expect(badge.text).toContain("idle");
    expect(badge.text).toContain("$(info)");
    expect(badge.tooltip).toContain("no audit run yet");
    expect(badge.backgroundColor).toBeUndefined();
  });

  it("pass uses the check icon and no color override", () => {
    const badge = formatVerdict(cert("pass"));
    expect(badge.text).toContain("$(check)");
    expect(badge.text).toContain("pass");
    expect(badge.backgroundColor).toBeUndefined();
  });

  it("warn uses the warning icon and warn background", () => {
    const badge = formatVerdict(cert("warn"));
    expect(badge.text).toContain("$(warning)");
    expect(badge.backgroundColor).toBe("statusBarItem.warningBackground");
  });

  it("fail uses the error icon and error background", () => {
    const badge = formatVerdict(cert("fail"));
    expect(badge.text).toContain("$(error)");
    expect(badge.backgroundColor).toBe("statusBarItem.errorBackground");
    expect(badge.tooltip).toContain("contradicted");
  });
});
