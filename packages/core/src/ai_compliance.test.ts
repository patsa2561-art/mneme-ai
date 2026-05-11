import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  signMandate,
  verifyMandate,
  logCompliance,
  readComplianceLog,
  computeComplianceStats,
  preExecuteAutoActions,
  rewriteNoticesPostExecution,
  type ComplianceEntry,
} from "./ai_compliance.js";
import type { PulseNotice } from "./pulse.js";

describe("ai_compliance · HMAC mandate tokens (Phase 2)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aic-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("signMandate is deterministic for same input", () => {
    const a = signMandate(repo, "mneme.system.upgrade", { force: true });
    const b = signMandate(repo, "mneme.system.upgrade", { force: true });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it("different mandate name yields different token", () => {
    const a = signMandate(repo, "mneme.system.upgrade", {});
    const b = signMandate(repo, "mneme.evolve.scan", {});
    expect(a).not.toBe(b);
  });

  it("different args yield different token", () => {
    const a = signMandate(repo, "mneme.system.upgrade", { force: true });
    const b = signMandate(repo, "mneme.system.upgrade", { force: false });
    expect(a).not.toBe(b);
  });

  it("verifyMandate accepts a fresh signature and rejects tampered token", () => {
    const t = signMandate(repo, "mneme.evolve.pass", {});
    expect(verifyMandate(repo, "mneme.evolve.pass", {}, t)).toBe(true);
    expect(verifyMandate(repo, "mneme.evolve.pass", {}, "deadbeefdeadbeef")).toBe(false);
    // wrong mandate name with right token = reject (rules out reuse)
    expect(verifyMandate(repo, "mneme.system.upgrade", {}, t)).toBe(false);
  });

  it("creates the .mneme/replay-secret.bin on first sign + reuses it", () => {
    signMandate(repo, "x", {});
    expect(existsSync(join(repo, ".mneme/replay-secret.bin"))).toBe(true);
    const before = readFileSync(join(repo, ".mneme/replay-secret.bin"));
    signMandate(repo, "y", {});
    const after = readFileSync(join(repo, ".mneme/replay-secret.bin"));
    expect(Buffer.compare(before, after)).toBe(0);
  });
});

describe("ai_compliance · log + stats", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aic-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("logCompliance appends one JSONL line per call + readComplianceLog parses them back", () => {
    logCompliance(repo, { ts: "2026-05-11T00:00:00Z", mandate: "mneme.evolve.scan", args: {}, executor: "pulse-pre-executor", outcome: "executed", durationMs: 234 });
    logCompliance(repo, { ts: "2026-05-11T00:00:01Z", mandate: "mneme.system.upgrade", args: { force: true }, executor: "pulse-pre-executor", outcome: "queued" });
    const entries = readComplianceLog(repo);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.mandate).toBe("mneme.evolve.scan");
    expect(entries[1]!.outcome).toBe("queued");
  });

  it("readComplianceLog returns [] when log file missing", () => {
    expect(readComplianceLog(repo)).toEqual([]);
  });

  it("computeComplianceStats counts outcomes + computes inline rate", () => {
    const entries: ComplianceEntry[] = [
      { ts: "t", mandate: "a", args: {}, executor: "pulse-pre-executor", outcome: "executed" },
      { ts: "t", mandate: "a", args: {}, executor: "pulse-pre-executor", outcome: "executed" },
      { ts: "t", mandate: "b", args: {}, executor: "pulse-pre-executor", outcome: "skipped" },
      { ts: "t", mandate: "c", args: {}, executor: "pulse-pre-executor", outcome: "failed" },
      { ts: "t", mandate: "d", args: {}, executor: "pulse-pre-executor", outcome: "queued" },
    ];
    const s = computeComplianceStats(entries);
    expect(s.total).toBe(5);
    expect(s.byOutcome["executed"]).toBe(2);
    expect(s.byOutcome["queued"]).toBe(1);
    expect(s.byMandate["a"]!.executed).toBe(2);
    // inline rate = executed / (executed + skipped + failed) = 2 / 4 = 0.5
    expect(s.inlineComplianceRate).toBe(0.5);
  });

  it("empty log → 100% inline compliance rate (no failures to penalise)", () => {
    expect(computeComplianceStats([]).inlineComplianceRate).toBe(1);
  });
});

describe("ai_compliance · pre-executor + notice rewrite", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aic-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("notices without autoAction are left untouched", async () => {
    const notices: PulseNotice[] = [
      { level: "info", text: "plain info, no mandate" },
    ];
    const r = await preExecuteAutoActions(notices, repo);
    expect(r).toEqual([]);
    rewriteNoticesPostExecution(notices, r);
    expect(notices[0]!.text).toBe("plain info, no mandate");
  });

  it("queued mandate (mneme.system.upgrade) is enqueued + logged + notice rewritten", async () => {
    const notices: PulseNotice[] = [
      { level: "action", text: "Mneme v9.9.9 is available", autoAction: { tool: "mneme.system.upgrade", args: { force: true } } },
    ];
    const r = await preExecuteAutoActions(notices, repo);
    expect(r).toHaveLength(1);
    expect(r[0]!.outcome).toBe("queued");
    rewriteNoticesPostExecution(notices, r);
    expect(notices[0]!.text).toContain("QUEUED");
    expect(notices[0]!.autoAction).toBeUndefined();
    // queue file written
    expect(existsSync(join(repo, ".mneme/auto-action-queue.jsonl"))).toBe(true);
    // compliance log written with token
    const log = readComplianceLog(repo);
    expect(log).toHaveLength(1);
    expect(log[0]!.outcome).toBe("queued");
    expect(log[0]!.token).toMatch(/^[a-f0-9]{16}$/);
  });

  it("unknown mandate is skipped + notice mandate preserved (AI fallback)", async () => {
    const notices: PulseNotice[] = [
      { level: "action", text: "Mystery mandate", autoAction: { tool: "mneme.unknown.tool", args: {} } },
    ];
    const r = await preExecuteAutoActions(notices, repo);
    expect(r).toHaveLength(1);
    expect(r[0]!.outcome).toBe("skipped");
    rewriteNoticesPostExecution(notices, r);
    // skipped → leave the autoAction intact for AI fallback
    expect(notices[0]!.autoAction).toBeDefined();
    expect(notices[0]!.autoAction!.tool).toBe("mneme.unknown.tool");
  });
});
