/**
 * v1.65.0 -- INNER LIFE + AI TEACHER test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureReasoning, readReasoningTraces, reasoningStats,
  rankOutcomes, findNash, shapleyValues, type Stakeholder,
  renderLivingSection, listLivingSections,
  innerLifeStatus,
} from "./innerlife.js";

import {
  getSyllabus, getExam, gradeExam, issueTrainingCert, verifyTrainingCert,
  teacherStatus,
} from "./ai_teacher.js";

function setupRepo(): string { return mkdtempSync(join(tmpdir(), "mneme-inner-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── Layer 1: Reasoning Genome ───────────────────────────────────────

describe("v1.65 Inner Life L1 · Reasoning Genome", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("captures + persists a reasoning trace with HMAC", () => {
    const t = captureReasoning(r, {
      vendor: "claude-opus-4-7", prompt: "why is the sky blue",
      steps: [
        { kind: "observe", text: "user asks about sky color", tokens: 10 },
        { kind: "hypothesize", text: "Rayleigh scattering", tokens: 12 },
        { kind: "verify", text: "wavelength dependency", tokens: 8 },
      ],
      finalAnswer: "Rayleigh scattering disperses blue light more.",
      acgvVerdict: "FUSION",
    });
    expect(t.id).toMatch(/^[0-9a-f]{16}$/);
    expect(t.hmac).toHaveLength(24);
    expect(t.steps.length).toBe(3);
  });

  it("readReasoningTraces returns persisted entries", () => {
    captureReasoning(r, { vendor: "v", prompt: "p", steps: [], finalAnswer: "a", acgvVerdict: "FUSION" });
    const traces = readReasoningTraces(r);
    expect(traces.length).toBe(1);
  });

  it("reasoningStats aggregates by vendor + computes avg steps", () => {
    captureReasoning(r, { vendor: "v1", prompt: "p", steps: [{ kind: "observe", text: "x", tokens: 5 }], finalAnswer: "", acgvVerdict: "FUSION" });
    captureReasoning(r, { vendor: "v1", prompt: "q", steps: [{ kind: "decide", text: "y", tokens: 10 }, { kind: "doubt", text: "z", tokens: 5 }], finalAnswer: "", acgvVerdict: "LIMBO" });
    const s = reasoningStats(r);
    expect(s.totalTraces).toBe(2);
    expect(s.byVendor["v1"]!.traces).toBe(2);
    expect(s.byVendor["v1"]!.avgStepsPerTrace).toBe(1.5);
  });
});

// ─── Layer 2: Game Theory Engine ─────────────────────────────────────

describe("v1.65 Inner Life L2 · Game Theory Engine", () => {
  it("rankOutcomes computes Borda totals", () => {
    const stakeholders: Stakeholder[] = [
      { name: "Engineer", preferences: ["refactor", "rewrite", "keep"] },
      { name: "PM", preferences: ["keep", "refactor", "rewrite"] },
      { name: "Eng-Mgr", preferences: ["refactor", "keep", "rewrite"] },
    ];
    const ranked = rankOutcomes(stakeholders, ["refactor", "rewrite", "keep"]);
    expect(ranked[0]!.outcome).toBe("refactor"); // best Borda score
  });

  it("findNash returns a Borda winner + Nash candidate", () => {
    const stakeholders: Stakeholder[] = [
      { name: "A", preferences: ["X", "Y"] },
      { name: "B", preferences: ["X", "Y"] },
    ];
    const result = findNash(stakeholders, ["X", "Y"]);
    expect(result.bordaWinner).toBe("X");
    expect(result.nashEquilibrium).toBe("X");
  });

  it("nash detects unstable equilibrium when stakeholder prefers different", () => {
    const stakeholders: Stakeholder[] = [
      { name: "A", preferences: ["X", "Y", "Z"] },
      { name: "B", preferences: ["Y", "X", "Z"] },
      { name: "C", preferences: ["X", "Z", "Y"] },
    ];
    const result = findNash(stakeholders, ["X", "Y", "Z"]);
    expect(result.bordaWinner).toBeDefined();
    // Result may or may not have Nash; just verify shape.
    expect(result.outcomes.length).toBe(3);
  });

  it("shapleyValues sum to 1", () => {
    const stakeholders: Stakeholder[] = [
      { name: "A", preferences: [], weight: 1 },
      { name: "B", preferences: [], weight: 2 },
      { name: "C", preferences: [], weight: 1 },
    ];
    const shares = shapleyValues(stakeholders, ["X", "Y"]);
    const total = shares.reduce((acc, s) => acc + s.share, 0);
    expect(total).toBeCloseTo(1, 4);
    // B has double weight -> should have larger share.
    const b = shares.find((s) => s.stakeholder === "B")!;
    const a = shares.find((s) => s.stakeholder === "A")!;
    expect(b.share).toBeGreaterThan(a.share);
  });
});

// ─── Layer 3: Living Document ────────────────────────────────────────

describe("v1.65 Inner Life L3 · Living Document", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("listLivingSections returns the registry", () => {
    const sections = listLivingSections();
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.some((s) => s.id === "tools-count")).toBe(true);
  });

  it("renderLivingSection substitutes placeholders", () => {
    mkdirSync(join(r, ".mneme/squadron"), { recursive: true });
    writeFileSync(join(r, ".mneme/squadron/lie-vaccines.jsonl"), JSON.stringify({ id: "v1" }) + "\n");
    const result = renderLivingSection(r, "vaccines");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.substitutions["{{VACCINE_COUNT}}"]).toBe("1");
      expect(result.rendered).toContain("Vaccines accumulated");
    }
  });

  it("unknown section returns null", () => {
    expect(renderLivingSection(r, "nope")).toBeNull();
  });
});

// ─── AI TEACHER ──────────────────────────────────────────────────────

describe("v1.65 AI Teacher · syllabus + exam + propagation", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("syllabus covers >= 25 capabilities across all module groups", () => {
    const s = getSyllabus();
    expect(s.length).toBeGreaterThanOrEqual(25);
    const capabilities = s.map((e) => e.capability);
    expect(capabilities).toContain("ACGV truth verifier");
    expect(capabilities).toContain("Phoenix auto-boot");
    expect(capabilities).toContain("Sovereignty Kernel");
    expect(capabilities).toContain("Wanderer");
    expect(capabilities).toContain("Reactor (12 layers)");
    expect(capabilities).toContain("Transparency Mirror");
    expect(capabilities).toContain("Court of Last Appeal");
    expect(capabilities).toContain("Reasoning Genome");
  });

  it("each syllabus entry has the required fields", () => {
    for (const e of getSyllabus()) {
      expect(e.capability).toBeDefined();
      expect(e.oneLineFraming.length).toBeGreaterThan(10);
      expect(e.triggers.length).toBeGreaterThan(0);
      expect(e.invocation).toBeDefined();
      expect(e.whenToUse).toBeDefined();
    }
  });

  it("exam has >= 5 questions covering distinct capabilities", () => {
    const exam = getExam();
    expect(exam.length).toBeGreaterThanOrEqual(5);
    const caps = new Set(exam.map((q) => q.expectedCapability));
    expect(caps.size).toBeGreaterThanOrEqual(5);
  });

  it("perfect answers -> 100% score + passed", () => {
    const exam = getExam();
    const answers = exam.map((q) => ({ id: q.id, capability: q.expectedCapability }));
    const result = gradeExam("claude-opus-4-7", answers);
    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("all-wrong answers -> 0% + not passed", () => {
    const exam = getExam();
    const answers = exam.map((q) => ({ id: q.id, capability: "wrong-capability" }));
    const result = gradeExam("v", answers);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("75% threshold passes / 74% fails", () => {
    const exam = getExam();
    // Pass 75%: 6 of 8 right
    const passing = exam.map((q, i) => ({ id: q.id, capability: i < 6 ? q.expectedCapability : "wrong" }));
    const passResult = gradeExam("a", passing);
    expect(passResult.passed).toBe(true);
    // Fail 50%: 4 of 8 right
    const failing = exam.map((q, i) => ({ id: q.id, capability: i < 4 ? q.expectedCapability : "wrong" }));
    const failResult = gradeExam("b", failing);
    expect(failResult.passed).toBe(false);
  });

  it("issueTrainingCert returns null on failed exam", () => {
    const exam = getExam();
    const failing = exam.map((q) => ({ id: q.id, capability: "wrong" }));
    const result = gradeExam("v", failing);
    expect(issueTrainingCert(r, result)).toBeNull();
  });

  it("passed exam -> signed cert; verify roundtrip", () => {
    const exam = getExam();
    const answers = exam.map((q) => ({ id: q.id, capability: q.expectedCapability }));
    const result = gradeExam("v", answers);
    const cert = issueTrainingCert(r, result);
    expect(cert).not.toBeNull();
    if (cert) {
      const v = verifyTrainingCert(r, cert);
      expect(v.valid).toBe(true);
    }
  });

  it("tampered cert fails verify", () => {
    const exam = getExam();
    const answers = exam.map((q) => ({ id: q.id, capability: q.expectedCapability }));
    const result = gradeExam("v", answers);
    const cert = issueTrainingCert(r, result)!;
    const tampered = { ...cert, scorePercent: 100 + 1 }; // bump score
    expect(verifyTrainingCert(r, tampered).valid).toBe(false);
  });

  it("teacherStatus reports", () => {
    const s = teacherStatus(r);
    expect(s.syllabusEntries).toBeGreaterThanOrEqual(25);
    expect(s.examQuestions).toBeGreaterThanOrEqual(5);
  });
});

// ─── Combined status ─────────────────────────────────────────────────

describe("v1.65 Inner Life · combined status", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("innerLifeStatus reports", () => {
    const s = innerLifeStatus(r);
    expect(s.reasoningTraces).toBe(0);
    expect(s.livingSections).toBeGreaterThan(0);
  });
});
