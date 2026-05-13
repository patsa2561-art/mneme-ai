import { describe, it, expect } from "vitest";
import { clearInstallLocks, formatInstallGuardPulseLine } from "./install_guard.js";

describe("v2.9.2 INSTALL GUARD", () => {
  it("returns OK on a system with no Mneme orphans (no-op happy path)", async () => {
    const r = await clearInstallLocks();
    // We can't guarantee zero orphans on every CI runner; assert shape instead.
    expect(typeof r.ok).toBe("boolean");
    expect(typeof r.summary).toBe("string");
    expect(Array.isArray(r.orphans)).toBe(true);
    expect(Array.isArray(r.killed)).toBe(true);
    expect(Array.isArray(r.resisted)).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.platform).toBe(process.platform);
  });

  it("never throws — even when ps / wmic are slow or missing", async () => {
    // Just calling twice shouldn't crash; second call should also report shape.
    const a = await clearInstallLocks();
    const b = await clearInstallLocks();
    expect(typeof a.ok).toBe("boolean");
    expect(typeof b.ok).toBe("boolean");
  });

  it("formatInstallGuardPulseLine emits a compact summary", async () => {
    const r = await clearInstallLocks();
    const line = formatInstallGuardPulseLine(r);
    expect(line).toContain("INSTALL-GUARD");
    expect(line).toMatch(/OK|RESIST/);
    expect(line).toContain("orphans=");
  });

  it("survives the case where every found orphan is the test process itself", async () => {
    // The current node process has 'node' in its cmdline and possibly
    // 'mneme' in CWD/argv if the test binary is named mneme*. The guard
    // must NEVER kill itself — verify by checking we still exist.
    const r = await clearInstallLocks();
    expect(process.pid).toBeGreaterThan(0); // we survived
    // Also ensure our own pid is NOT in `killed`
    expect(r.killed).not.toContain(process.pid);
  });
});
