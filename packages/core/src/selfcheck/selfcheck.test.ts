import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, readReport, verdictsForPulse, ALL_CHECKS, recurringSelfRecheck } from "./index.js";

describe("Mneme self-check audit", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-sc-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("registers >= 12 built-in checks", () => {
    expect(ALL_CHECKS.length).toBeGreaterThanOrEqual(12);
    for (const c of ALL_CHECKS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("runAudit returns a report with all checks recorded", async () => {
    const r = await runAudit(repo);
    expect(r.totalChecks).toBe(ALL_CHECKS.length);
    expect(r.verdicts.length).toBe(ALL_CHECKS.length);
    expect(r.passed + r.warned + r.failed + r.skipped).toBe(ALL_CHECKS.length);
    expect(r.banner.length).toBeGreaterThan(0);
  });

  it("runAudit persists report to .mneme/selfcheck/last.json", async () => {
    await runAudit(repo);
    expect(existsSync(join(repo, ".mneme/selfcheck/last.json"))).toBe(true);
    const back = readReport(repo);
    expect(back).not.toBeNull();
    expect(back!.totalChecks).toBe(ALL_CHECKS.length);
  });

  it("verdicts sorted: fail > warn > skip > pass", async () => {
    const r = await runAudit(repo);
    const RANK: Record<string, number> = { fail: 3, warn: 2, skip: 1, pass: 0 };
    for (let i = 1; i < r.verdicts.length; i++) {
      const prev = r.verdicts[i - 1]!;
      const cur = r.verdicts[i]!;
      expect(RANK[prev.status]).toBeGreaterThanOrEqual(RANK[cur.status]!);
    }
  });

  it("verdictsForPulse returns at most 3 lines, only fail/warn", async () => {
    const r = await runAudit(repo);
    const lines = verdictsForPulse(r);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) {
      expect(l).toMatch(/AUDIT (FAIL|WARN)/);
    }
  });

  it("version-up-to-date check passes when current==latest", async () => {
    writeFileSync(join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "1.26.0", latest: "1.26.0" }), "utf8");
    const r = await runAudit(repo);
    const v = r.verdicts.find((x) => x.name === "version-up-to-date");
    expect(v?.status).toBe("pass");
  });

  it("version-up-to-date check FAILS when current<latest + emits autoAction", async () => {
    writeFileSync(join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "1.0.0", latest: "9.9.9" }), "utf8");
    const r = await runAudit(repo);
    const v = r.verdicts.find((x) => x.name === "version-up-to-date");
    expect(v?.status).toBe("fail");
    expect(v?.autoAction?.tool).toBe("mneme.system.upgrade");
  });

  it("recurringSelfRecheck loops at least once", async () => {
    const calls: number[] = [];
    const r = await recurringSelfRecheck(repo, {
      intervalMs: 1, maxIterations: 2,
      onIteration: (rep) => calls.push(rep.totalChecks),
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(r.totalChecks).toBe(ALL_CHECKS.length);
  }, 10_000);
});
