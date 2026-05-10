import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readLineage, recordApply, verifyChain, trackRecordFor, lineageStats,
} from "./lineage.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mneme-lineage-"));
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  // Seed a deterministic secret so HMAC is reproducible across tests.
  writeFileSync(join(repo, ".mneme/.evolve-secret"), "test-secret-deadbeef", "utf8");
});
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

describe("lineage -- chain mechanics", () => {
  it("readLineage returns [] on fresh repo", () => {
    expect(readLineage(repo)).toEqual([]);
  });

  it("recordApply chains entries (each links to previous signature)", () => {
    const a = recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: "abc1234", signalSummary: "sig-a" });
    const b = recordApply(repo, { templateId: "T1", proposalId: "p2", gitCommitBefore: "def5678", signalSummary: "sig-b" });
    expect(a.index).toBe(1);
    expect(b.index).toBe(2);
    expect(a.prevSignature).toBe("0".repeat(64));
    expect(b.prevSignature).toBe(a.signature);
    expect(a.signature).not.toBe(b.signature);
  });

  it("verifyChain returns ok for an untampered chain", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    recordApply(repo, { templateId: "T2", proposalId: "p2", gitCommitBefore: null, signalSummary: "" });
    const r = verifyChain(repo);
    expect(r.ok).toBe(true);
    expect(r.brokenAt).toBeNull();
    expect(r.total).toBe(2);
  });

  it("verifyChain detects tampering at the broken link", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    recordApply(repo, { templateId: "T1", proposalId: "p2", gitCommitBefore: null, signalSummary: "" });
    // Tamper: swap templateId on entry 2.
    const path = join(repo, ".mneme/proposals/_lineage.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const e = JSON.parse(lines[1]!) as Record<string, unknown>;
    e["templateId"] = "TAMPERED";
    lines[1] = JSON.stringify(e);
    writeFileSync(path, lines.join("\n") + "\n", "utf8");
    const r = verifyChain(repo);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });

  it("verifyChain handles an empty chain", () => {
    expect(verifyChain(repo).ok).toBe(true);
  });
});

describe("trackRecordFor", () => {
  it("returns 0.5 for a template never applied", () => {
    expect(trackRecordFor(repo, "Tnew").score).toBe(0.5);
  });

  it("scales upward with successful accepts", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    expect(trackRecordFor(repo, "T1").score).toBeCloseTo(0.70, 2);
    recordApply(repo, { templateId: "T1", proposalId: "p2", gitCommitBefore: null, signalSummary: "" });
    expect(trackRecordFor(repo, "T1").score).toBeCloseTo(0.75, 2);
    recordApply(repo, { templateId: "T1", proposalId: "p3", gitCommitBefore: null, signalSummary: "" });
    expect(trackRecordFor(repo, "T1").score).toBeCloseTo(0.80, 2);
  });

  it("saturates at 0.95 even with many accepts", () => {
    for (let i = 0; i < 20; i++) {
      recordApply(repo, { templateId: "T1", proposalId: `p${i}`, gitCommitBefore: null, signalSummary: "" });
    }
    expect(trackRecordFor(repo, "T1").score).toBe(0.95);
  });

  it("filters per-template -- T2 not affected by T1's history", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    recordApply(repo, { templateId: "T1", proposalId: "p2", gitCommitBefore: null, signalSummary: "" });
    expect(trackRecordFor(repo, "T2").totalAccepts).toBe(0);
    expect(trackRecordFor(repo, "T2").score).toBe(0.5);
  });

  it("lastAppliedAt reflects most recent entry", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    const a = trackRecordFor(repo, "T1");
    expect(a.lastAppliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("lineageStats", () => {
  it("aggregates across templates", () => {
    recordApply(repo, { templateId: "T1", proposalId: "p1", gitCommitBefore: null, signalSummary: "" });
    recordApply(repo, { templateId: "T2", proposalId: "p2", gitCommitBefore: null, signalSummary: "" });
    recordApply(repo, { templateId: "T1", proposalId: "p3", gitCommitBefore: null, signalSummary: "" });
    const s = lineageStats(repo);
    expect(s.totalEntries).toBe(3);
    expect(s.perTemplate).toHaveLength(2);
    const t1 = s.perTemplate.find((t) => t.templateId === "T1")!;
    expect(t1.totalAccepts).toBe(2);
    expect(s.chain.ok).toBe(true);
  });
});
