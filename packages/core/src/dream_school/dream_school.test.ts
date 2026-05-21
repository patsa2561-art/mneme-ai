import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, loadReport, formatReport, ALL_SCENARIOS } from "./index.js";

describe("dream_school", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-dream-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("run with one scenario produces a report with that outcome", async () => {
    const r = await run(repo, ["aws-region-sunset"]);
    expect(r.scenariosRun).toBe(1);
    expect(r.outcomes.length).toBe(1);
    expect(r.outcomes[0]!.scenarioId).toBe("aws-region-sunset");
    expect(typeof r.outcomes[0]!.lesson).toBe("string");
    expect(r.outcomes[0]!.lesson.length).toBeGreaterThan(20);
  }, 20000);

  it("run with all 6 scenarios works + topLessons has up to 3", async () => {
    const r = await run(repo, ALL_SCENARIOS);
    expect(r.scenariosRun).toBe(6);
    expect(r.outcomes.length).toBe(6);
    expect(r.topLessons.length).toBeLessThanOrEqual(3);
  }, 60000);

  it("writes morning report to .mneme/dream_school/", async () => {
    await run(repo, ["dep-deprecation"]);
    expect(existsSync(join(repo, ".mneme/dream_school/morning_report.json"))).toBe(true);
  }, 20000);

  it("loadReport returns the saved report", async () => {
    await run(repo, ["ddos-launch-day"]);
    const loaded = loadReport(repo);
    expect(loaded?.scenariosRun).toBe(1);
    expect(loaded?.outcomes[0]?.scenarioId).toBe("ddos-launch-day");
  }, 20000);

  it("formatReport prints the morning summary", async () => {
    const r = await run(repo, ["vendor-pricing-3x"]);
    const out = formatReport(r);
    expect(out).toContain("DREAM SCHOOL");
    expect(out).toContain("vendor-pricing-3x");
    expect(out).toContain("Top 3 lessons");
  }, 20000);

  it("ALL_SCENARIOS contains 6 named scenarios", () => {
    expect(ALL_SCENARIOS.length).toBe(6);
    expect(ALL_SCENARIOS).toContain("aws-region-sunset");
    expect(ALL_SCENARIOS).toContain("compliance-audit");
  });
});
