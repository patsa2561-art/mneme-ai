import { describe, it, expect } from "vitest";
import { checkDrift, verifyDriftCheck, formatDriftLine } from "./index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withTmpPkg(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-drift-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mneme-ai", version }));
  return join(dir, "package.json");
}

describe("v2.19.2 · MCP DRIFT DETECTOR", () => {
  it("reports OK when serving == installed", () => {
    const p = withTmpPkg("2.19.2");
    const d = checkDrift({ servingVersion: "2.19.2", installedPackageJsonPath: p });
    expect(d.drift).toBe(false);
    expect(d.severity).toBe("ok");
    expect(verifyDriftCheck(d)).toBe(true);
  });

  it("reports WARN on patch-only mismatch", () => {
    const p = withTmpPkg("2.19.3");
    const d = checkDrift({ servingVersion: "2.19.2", installedPackageJsonPath: p });
    expect(d.drift).toBe(true);
    expect(d.severity).toBe("warn");
  });

  it("reports CRITICAL on minor+ bump (new tools likely added)", () => {
    const p = withTmpPkg("2.20.0");
    const d = checkDrift({ servingVersion: "2.19.2", installedPackageJsonPath: p });
    expect(d.drift).toBe(true);
    expect(d.severity).toBe("critical");
    expect(d.remedy).toContain("RESTART");
  });

  it("reports CRITICAL on user's actual scenario: v2.18 serving, v2.19.2 installed", () => {
    const p = withTmpPkg("2.19.2");
    const d = checkDrift({ servingVersion: "2.18.0", installedPackageJsonPath: p });
    expect(d.severity).toBe("critical");
    expect(d.remedy).toMatch(/v2\.18\/v2\.19/);
  });

  it("rejects tampered check", () => {
    const p = withTmpPkg("2.20.0");
    const d = checkDrift({ servingVersion: "2.18.0", installedPackageJsonPath: p });
    expect(verifyDriftCheck(d)).toBe(true);
    // Real tamper: flip severity from critical→ok to hide the drift.
    const tampered = { ...d, severity: "ok" as const, drift: false, message: "all good", remedy: "nothing" };
    expect(verifyDriftCheck(tampered)).toBe(false);
  });

  it("formatDriftLine summarises", () => {
    const p = withTmpPkg("2.19.2");
    const dOK = checkDrift({ servingVersion: "2.19.2", installedPackageJsonPath: p });
    expect(formatDriftLine(dOK)).toContain("clean");
    const p2 = withTmpPkg("2.20.0");
    const dDrift = checkDrift({ servingVersion: "2.18.0", installedPackageJsonPath: p2 });
    expect(formatDriftLine(dDrift)).toContain("DRIFT");
  });

  it("handles missing package.json gracefully (installedVersion=unknown, drift=false)", () => {
    const d = checkDrift({ servingVersion: "2.19.2", installedPackageJsonPath: "/non/existent/path/package.json" });
    expect(d.installedVersion).toBe("unknown");
    expect(d.drift).toBe(false); // can't compare; assume OK
  });
});
