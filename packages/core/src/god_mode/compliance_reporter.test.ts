import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateComplianceReport } from "./compliance_reporter.js";

function seedLogs(repo: string, compliance: object[] = [], queue: object[] = [], replay: object[] = []): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  if (compliance.length > 0) writeFileSync(join(repo, ".mneme/ai-compliance.jsonl"), compliance.map((e) => JSON.stringify(e)).join("\n") + "\n");
  if (queue.length > 0) writeFileSync(join(repo, ".mneme/auto-action-queue.jsonl"), queue.map((e) => JSON.stringify(e)).join("\n") + "\n");
  if (replay.length > 0) writeFileSync(join(repo, ".mneme/replay.jsonl"), replay.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

describe("god_mode/compliance_reporter · empty / no logs", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-comp-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns 0 events + 100% gap when no logs exist", () => {
    const r = generateComplianceReport(repo);
    expect(r.totalEvents).toBe(0);
    expect(r.gaps.length).toBe(r.controls.length);
    expect(r.controls.every((c) => c.evidenceCount === 0)).toBe(true);
  });

  it("writes a markdown report to disk even with no events", () => {
    const r = generateComplianceReport(repo);
    expect(readFileSync(r.reportPath, "utf8")).toContain("audit-trail-ready evidence");
  });
});

describe("god_mode/compliance_reporter · evidence matching", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-comp-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("compliance entry with vendor field counts as ISO 8.4 evidence", () => {
    seedLogs(repo, [{ at: new Date().toISOString(), vendor: "claude", outcome: "executed" }]);
    const r = generateComplianceReport(repo);
    const c = r.controls.find((x) => x.framework === "ISO-42001" && x.controlId === "8.4")!;
    expect(c.evidenceCount).toBeGreaterThan(0);
  });

  it("queue entry with type=executed counts as SOC2 CC8.1 evidence", () => {
    seedLogs(repo, [], [{ at: new Date().toISOString(), type: "executed", action: "patch" }]);
    const r = generateComplianceReport(repo);
    const c = r.controls.find((x) => x.framework === "SOC2-CC" && x.controlId === "CC8.1")!;
    expect(c.evidenceCount).toBeGreaterThan(0);
  });

  it("replay entry with hash counts as SOC2 CC4.1 evidence", () => {
    seedLogs(repo, [], [], [{ at: new Date().toISOString(), hash: "abc123" }]);
    const r = generateComplianceReport(repo);
    const c = r.controls.find((x) => x.framework === "SOC2-CC" && x.controlId === "CC4.1")!;
    expect(c.evidenceCount).toBeGreaterThan(0);
  });

  it("entry outside window is excluded", () => {
    const longAgo = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
    seedLogs(repo, [{ at: longAgo, vendor: "claude", outcome: "executed" }]);
    const r = generateComplianceReport(repo);  // default 30-day window
    expect(r.totalEvents).toBe(0);
  });

  it("explicit windowStart/windowEnd is honored", () => {
    const longAgo = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
    seedLogs(repo, [{ at: longAgo, vendor: "claude", outcome: "executed" }]);
    const r = generateComplianceReport(repo, {
      windowStart: new Date(Date.now() - 200 * 86400 * 1000),
      windowEnd: new Date(),
    });
    expect(r.totalEvents).toBe(1);
  });
});

describe("god_mode/compliance_reporter · coverage math", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-comp-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("100% coverage when every control has at least one evidence entry", () => {
    const now = new Date().toISOString();
    seedLogs(repo,
      [{ at: now, vendor: "v", outcome: "executed" }, { at: now, outcome: "failed" }],
      [{ at: now, type: "executed", user: "operator" }],
      [{ at: now, hash: "h1" }],
    );
    const r = generateComplianceReport(repo);
    const totalCovered = Object.values(r.coverageByFramework).every((f) => f.percent === 100);
    expect(totalCovered).toBe(true);
    expect(r.gaps).toHaveLength(0);
  });

  it("partial coverage produces non-empty gap list", () => {
    seedLogs(repo, [{ at: new Date().toISOString(), vendor: "v", outcome: "executed" }]);
    const r = generateComplianceReport(repo);
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.gaps.length).toBeLessThan(r.controls.length);
  });
});

describe("god_mode/compliance_reporter · markdown rendering", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-comp-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("includes the 'audit-trail-ready evidence not certification' disclaimer", () => {
    const r = generateComplianceReport(repo);
    const md = readFileSync(r.reportPath, "utf8");
    expect(md).toContain("audit-trail-ready evidence");
    expect(md).toContain("not a certification");
  });

  it("includes coverage table with all 3 frameworks", () => {
    const r = generateComplianceReport(repo);
    const md = readFileSync(r.reportPath, "utf8");
    expect(md).toContain("| SOC2-CC |");
    expect(md).toContain("| ISO-42001 |");
    expect(md).toContain("| EU-AI-ACT |");
  });

  it("lists gaps when controls have no evidence", () => {
    const r = generateComplianceReport(repo);
    const md = readFileSync(r.reportPath, "utf8");
    expect(md).toContain("## Gaps");
  });

  it("does not list gaps when fully covered", () => {
    const now = new Date().toISOString();
    seedLogs(repo,
      [{ at: now, vendor: "v", outcome: "executed" }, { at: now, outcome: "failed" }],
      [{ at: now, type: "executed", user: "operator" }],
      [{ at: now, hash: "h1" }],
    );
    const r = generateComplianceReport(repo);
    const md = readFileSync(r.reportPath, "utf8");
    expect(md).not.toContain("## Gaps");
  });
});
