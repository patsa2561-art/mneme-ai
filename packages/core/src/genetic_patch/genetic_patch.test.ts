import { describe, it, expect } from "vitest";
import { proposePatch, verifyProposal, defaultAudit, formatProposalLine } from "./index.js";

describe("v2.19.7 · GENETIC PATCH — self-modifying child proposals", () => {
  it("proposePatch produces signed proposal + PR body + branch name", () => {
    const p = proposePatch({
      kind: "new_intent_phrase",
      targetPath: "packages/core/src/intent_router/index.ts",
      summary: "add intent phrase 'rotate keys'",
      changeInstructions: "Append a new Phrase to BUILTIN_PHRASES with canonical='rotate keys' + plan that calls mneme.aegis.rotate.",
      evidence: "Industry-standard key rotation cadence is 90 days. 5 customers asked. Benchmark: saves 3 minutes per rotation. First-of-its-kind for AI tooling.",
    });
    expect(p.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(p.proposalId).toMatch(/^gp-[0-9a-f]{14}$/);
    expect(p.branchName).toContain("mneme/auto-new-intent-phrase-");
    expect(p.prTitle).toContain("chore(genetic):");
    expect(p.prBody).toContain("AURELIAN audit");
    expect(verifyProposal(p)).toBe(true);
  });

  it("audit verdict SHIP when all 4 axes >= 80", () => {
    const p = proposePatch({
      kind: "new_conversation_pattern",
      targetPath: "packages/core/src/conversation_compiler/index.ts",
      summary: "add must_use_https rule",
      changeInstructions: "Append a new ExtractionRule for HTTPS-only.",
      evidence: "Industry-standard HTTPS requirement; first AI tool to recognise it as agreement pattern; SOTA benchmark on 100% catch rate; beats markdown ADR by composes orthogonal removable. No AI vendor ships this. First-of-its-kind never-before-seen pattern. Numbers: 100% catch on bench (50 tests), 3ms latency, 2x precision.",
      risks: "False positive on legacy HTTP-only code; composes onto existing pattern registry; orthogonal addition; removable cleanly via splice from RULES[]; root cause addressed via additive registry extension.",
    });
    expect(p.audit.verdict).toBe("SHIP");
    expect(p.shouldAdvance).toBe(true);
  });

  it("audit verdict REJECT when evidence is thin", () => {
    const p = proposePatch({
      kind: "tune_threshold",
      targetPath: "x.ts",
      summary: "tune",
      changeInstructions: "...",
      evidence: "felt like it",
    });
    expect(p.audit.verdict).not.toBe("SHIP");
  });

  it("verifyProposal detects tampering", () => {
    const p = proposePatch({
      kind: "other", targetPath: "x.ts", summary: "x", changeInstructions: "y", evidence: "z",
    });
    const tampered = { ...p, summary: "MALICIOUS REWRITE" };
    expect(verifyProposal(tampered)).toBe(false);
  });

  it("caller can override audit (BYO-audit)", () => {
    const p = proposePatch({
      kind: "other", targetPath: "x.ts", summary: "x", changeInstructions: "y", evidence: "z",
      audit: { delta: 99, worldClass: 99, wisdom: 99, wildness: 99, verdict: "SHIP", reasons: ["overridden"] },
    });
    expect(p.audit.verdict).toBe("SHIP");
    expect(p.shouldAdvance).toBe(true);
  });

  it("defaultAudit picks up metric tokens + comparison + novelty words", () => {
    const audit = defaultAudit({
      kind: "other", targetPath: "x", summary: "x",
      changeInstructions: "x",
      evidence: "Industry-standard benchmark proves 90% F1 vs prior; first-of-its-kind composes orthogonally; root cause addressed; additive only.",
    });
    expect(audit.delta).toBeGreaterThanOrEqual(60);
    expect(audit.worldClass).toBeGreaterThanOrEqual(60);
    expect(audit.wildness).toBeGreaterThanOrEqual(60);
    expect(audit.wisdom).toBeGreaterThanOrEqual(60);
  });

  it("formatProposalLine summarises with verdict icon", () => {
    const p = proposePatch({
      kind: "other", targetPath: "x", summary: "x", changeInstructions: "y", evidence: "z",
    });
    expect(formatProposalLine(p)).toContain("GENETIC");
    expect(formatProposalLine(p)).toContain(p.audit.verdict);
  });
});
