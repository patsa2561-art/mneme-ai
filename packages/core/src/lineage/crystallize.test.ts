/**
 * Crystallize — verify session aggregation, PII scrubbing, and the
 * end-to-end "session → signed chromosome on disk" pipeline.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crystallize } from "./crystallize.js";
import {
  startSession,
  recordAtom,
  recordConfess,
  recordCourtVerdict,
  recordKarmaDelta,
  recordTopic,
  _resetForTests,
} from "./working_memory.js";
import { listChromosomes, loadChromosome, verifyChromosome } from "./chromosome.js";
import { scrubDeep, scrubString } from "./pii_scrub.js";

function mkRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-crystallize-"));
}

beforeEach(() => _resetForTests());

describe("crystallize", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo();
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns null when no session is active", () => {
    expect(crystallize(repo, { endReason: "manual" })).toBeNull();
  });

  it("crystallizes an empty session into a valid chromosome", () => {
    startSession({ sessionId: "s1", vendor: "claude-opus-4-7", machineId: "abc123" });
    const r = crystallize(repo, { endReason: "manual" });
    expect(r).not.toBeNull();
    expect(r!.chromosome.session.totalCalls).toBe(0);
    expect(verifyChromosome(r!.chromosome).valid).toBe(true);
    expect(existsSync(join(repo, ".mneme/lineage/chromosomes"))).toBe(true);
  });

  it("aggregates atom invocations + co-fires into molecules", () => {
    startSession({ sessionId: "s2", vendor: "claude-opus-4-7", machineId: "abc123" });
    // Three sequences of A→B should form one molecule (fireCount=3).
    for (let i = 0; i < 3; i++) {
      recordAtom(repo, "mneme.memory.ask", {});
      recordAtom(repo, "mneme.audit.certify", {});
    }
    const r = crystallize(repo, { endReason: "manual" })!;
    expect(r.chromosome.atomKarmaDeltas["mneme.memory.ask"]?.invocations).toBe(3);
    expect(r.chromosome.atomKarmaDeltas["mneme.audit.certify"]?.invocations).toBe(3);
    // Note: co-fires are pair-based (recent[i-1], recent[i]) so we get
    // ask→certify (3 times) AND certify→ask (2 times — between ask's).
    // Both above the minFireCount=2 threshold.
    expect(r.chromosome.molecules.length).toBeGreaterThanOrEqual(1);
    expect(r.chromosome.molecules[0]!.atoms).toContain("mneme.memory.ask");
    expect(r.chromosome.molecules[0]!.atoms).toContain("mneme.audit.certify");
  });

  it("captures confess outcomes + lethal recessives", () => {
    startSession({ sessionId: "s3", vendor: "cursor-cmd-k", machineId: "def456" });
    recordAtom(repo, "mneme.memory.ask", {});
    recordConfess({ vendor: "cursor", verdict: "verified", selfConfidence: 0.8, hadHallucination: false }, "mneme.memory.ask");
    recordConfess({ vendor: "cursor", verdict: "hallucination", selfConfidence: 0.95, hadHallucination: true }, "mneme.legacy.bad");
    const r = crystallize(repo, { endReason: "manual" })!;
    expect(r.chromosome.confessOutcomes.verified).toBe(1);
    expect(r.chromosome.confessOutcomes.hallucination).toBe(1);
    expect(r.chromosome.confessOutcomes.avgSelfConfidence).toBeCloseTo(0.875, 2);
    expect(r.chromosome.lethalRecessives).toContain("mneme.legacy.bad");
  });

  it("captures court verdicts verbatim", () => {
    startSession({ sessionId: "s4", vendor: "claude-opus", machineId: "x" });
    recordCourtVerdict({ claim: "X is dead code", verdict: "motion_to_dismiss", evidenceBalance: -0.7, topWitnesses: ["abc1234"] });
    const r = crystallize(repo, { endReason: "manual" })!;
    expect(r.chromosome.courtVerdicts).toHaveLength(1);
    expect(r.chromosome.courtVerdicts[0]!.verdict).toBe("motion_to_dismiss");
  });

  it("derives constitution candidates from atoms that always co-fire", () => {
    startSession({ sessionId: "s5", vendor: "claude", machineId: "x" });
    // 5 perfect-pair sequences — should propose "always pair X with Y".
    for (let i = 0; i < 5; i++) {
      recordAtom(repo, "mneme.memory.why", {});
      recordAtom(repo, "mneme.audit.verify", {});
    }
    const r = crystallize(repo, { endReason: "manual" })!;
    const rules = r.chromosome.constitutionCandidates.filter((c) => c.rule.includes("Always pair"));
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it("scrubs emails + paths from topic + voice", () => {
    startSession({ sessionId: "s6", vendor: "claude", machineId: "x" });
    recordTopic("contacted alice@acme.com about /Users/alice/project/auth.ts");
    const r = crystallize(repo, { endReason: "manual" })!;
    const allText = JSON.stringify(r.chromosome);
    expect(allText).not.toContain("alice@acme.com");
    expect(allText).not.toContain("/Users/alice");
  });

  it("can disable scrub via opts (for tests of raw content)", () => {
    startSession({ sessionId: "s7", vendor: "claude", machineId: "x" });
    recordTopic("contacted alice@acme.com");
    const r = crystallize(repo, { endReason: "manual", scrub: false })!;
    expect(r.chromosome.topic.toLowerCase()).toContain("alice@acme.com");
  });

  it("crystallize is fast — < 500ms even with 1000 recorded atoms (perf budget guard)", () => {
    startSession({ sessionId: "s8", vendor: "claude", machineId: "x" });
    for (let i = 0; i < 1000; i++) {
      recordAtom(repo, `mneme.test.tool_${i % 25}`, { i });
      if (i % 3 === 0) recordKarmaDelta(`mneme.test.tool_${i % 25}`, 1);
    }
    const r = crystallize(repo, { endReason: "manual" })!;
    expect(r.durationMs).toBeLessThan(500);
    expect(r.chromosome.session.totalCalls).toBe(1000);
  });

  it("written chromosome reloads + verifies", () => {
    startSession({ sessionId: "s9", vendor: "claude", machineId: "x" });
    recordAtom(repo, "mneme.memory.ask", {});
    const r = crystallize(repo, { endReason: "manual" })!;
    const ids = listChromosomes(repo);
    expect(ids).toContain(r.chromosome.id);
    const reloaded = loadChromosome(repo, r.chromosome.id);
    expect(reloaded.contentHash).toBe(r.chromosome.contentHash);
    expect(verifyChromosome(reloaded).valid).toBe(true);
  });

  it("vendor + endReason flow through to the chromosome", () => {
    startSession({ sessionId: "s10", vendor: "codex-cli", machineId: "machineX" });
    const r = crystallize(repo, { endReason: "exit-signal", topic: "hotfix" })!;
    expect(r.chromosome.vendor).toBe("codex-cli");
    expect(r.chromosome.session.endReason).toBe("exit-signal");
    expect(r.chromosome.topic).toBe("hotfix");
  });
});

describe("PII scrub", () => {
  it("scrubs all known patterns from a payload", () => {
    const out = scrubDeep({
      msg: "see alice@acme.com or AKIAIOSFODNN7EXAMPLE",
      path: "/home/alice/secret.txt",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      ghToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("alice@acme.com");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).not.toContain("/home/alice");
    expect(text).not.toContain("550e8400-e29b");
    expect(text).not.toContain("ghp_abcdef");
    expect(text).toContain("<email>@acme.com");
  });

  it("is idempotent — scrubbing already-scrubbed text doesn't break it", () => {
    const once = scrubString("alice@acme.com");
    const twice = scrubString(once);
    expect(once).toBe(twice);
  });
});
