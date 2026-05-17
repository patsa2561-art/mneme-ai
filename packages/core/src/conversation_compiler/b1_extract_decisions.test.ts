/**
 * v2.19.33 B1 REGRESSION — extractDecisions undercounted multiple-clause EN
 * transcripts (BUG report 2026-05-17). Pins the canonical bug case forever
 * + A/B compares strict / balanced / liberal modes + verifies new
 * review_required pattern.
 */
import { describe, it, expect } from "vitest";
import { extractDecisions, runAgreement } from "./index.js";

describe("v2.19.33 B1 REGRESSION — multi-clause EN transcript", () => {
  // CANONICAL BUG: "every commit must pass test \n deploy needs 2 reviewers"
  // expected: 2 decisions ; pre-v2.19.33 actual: 1 decision.
  it("canonical bug: 'every commit must pass test \\n deploy needs 2 reviewers' → 2 decisions", () => {
    const d = extractDecisions({
      transcript: "every commit must pass test\ndeploy needs 2 reviewers",
    });
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d.some((x) => x.pattern === "test_required")).toBe(true);
    expect(d.some((x) => x.pattern === "review_required")).toBe(true);
    const rev = d.find((x) => x.pattern === "review_required");
    expect(rev?.params?.["minReviewers"]).toBe(2);
  });

  it("variant: 'all commits must have tests AND 3 approvals required' → 2 decisions", () => {
    const d = extractDecisions({
      transcript: "all commits must have tests.\n3 approvals required for merge.",
    });
    expect(d.some((x) => x.pattern === "test_required")).toBe(true);
    const rev = d.find((x) => x.pattern === "review_required");
    expect(rev?.params?.["minReviewers"]).toBe(3);
  });

  it("Thai variant: 'ทุก commit ต้อง pass test\\nPR ต้องมี 2 คน review' → 2 decisions", () => {
    const d = extractDecisions({
      transcript: "ทุก commit ต้อง pass test\nPR ต้องมี 2 คน review",
    });
    expect(d.some((x) => x.pattern === "test_required")).toBe(true);
    expect(d.some((x) => x.pattern === "review_required")).toBe(true);
  });

  it("3-clause transcript captures all 3 distinct patterns", () => {
    const d = extractDecisions({
      transcript: "Every commit must pass test.\nDeploy needs 2 reviewers.\nNever commit secrets.",
    });
    const patterns = new Set(d.map((x) => x.pattern));
    expect(patterns.has("test_required")).toBe(true);
    expect(patterns.has("review_required")).toBe(true);
    expect(patterns.has("no_secret_in_code")).toBe(true);
  });

  it("checker enforces minReviewers: 2 approvals when min=2 → ok", () => {
    const d = extractDecisions({ transcript: "deploy needs 2 reviewers" });
    const rev = d.find((x) => x.pattern === "review_required");
    expect(rev).toBeDefined();
    const agreement = {
      v: 1 as const, agreementId: "test-1", name: "test", decisions: [rev!],
      transcriptSha256: "x".repeat(64), sourceSha256: "y".repeat(64),
      generatedSource: "// generated", proposedBy: "test",
      compiledAt: new Date().toISOString(), sig: "z".repeat(64),
    };
    const results = runAgreement({ agreement, target: { approvalCount: 2 } as unknown as Parameters<typeof runAgreement>[0]["target"] });
    expect(results[0]!.ok).toBe(true);
  });

  it("checker enforces minReviewers: 1 approval when min=2 → blocked", () => {
    const d = extractDecisions({ transcript: "deploy needs 2 reviewers" });
    const rev = d.find((x) => x.pattern === "review_required");
    const agreement = {
      v: 1 as const, agreementId: "test-2", name: "test", decisions: [rev!],
      transcriptSha256: "x".repeat(64), sourceSha256: "y".repeat(64),
      generatedSource: "// generated", proposedBy: "test",
      compiledAt: new Date().toISOString(), sig: "z".repeat(64),
    };
    const results = runAgreement({ agreement, target: { approvalCount: 1 } as unknown as Parameters<typeof runAgreement>[0]["target"] });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.severity).toBe("block");
  });
});

describe("v2.19.33 B1 A/B MODES — strict vs balanced vs liberal", () => {
  // MEASURED A/B: same transcript, count decisions per mode.
  // We expect: strict ≤ balanced ≤ liberal (precision ↓ → recall ↑).
  const noisyTranscript = [
    "Every commit must pass test.",                  // RULE: test_required
    "Deploy needs 2 reviewers.",                     // RULE: review_required (new in v2.19.33)
    "You should also lint the code.",                // manual (liberal only — soft 'should')
    "Let's keep the README in sync with releases.",  // manual (liberal — soft 'let's')
    "Everyone must follow the security guidelines.", // manual (balanced+liberal — strong 'must')
    "Random sentence about food.",                   // ignored
  ].join("\n");

  it("strict mode: only RULES match — no manual fallback", () => {
    const d = extractDecisions({ transcript: noisyTranscript, mode: "strict" });
    expect(d.every((x) => x.pattern !== "manual")).toBe(true);
    // RULES hit: test_required + review_required = 2
    expect(d.length).toBe(2);
  });

  it("balanced mode (default): RULES + strong manual verbs", () => {
    const d = extractDecisions({ transcript: noisyTranscript, mode: "balanced" });
    // RULES: 2 + manual ('must'): 1 (security guidelines) = 3
    expect(d.length).toBe(3);
    expect(d.some((x) => x.pattern === "manual")).toBe(true);
  });

  it("liberal mode: RULES + permissive manual ('should', 'let's')", () => {
    const d = extractDecisions({ transcript: noisyTranscript, mode: "liberal" });
    // Should capture: 2 RULES + 'should lint' + 'let's keep README' + 'must follow'
    expect(d.length).toBeGreaterThanOrEqual(4);
  });

  it("ORDERING: strict ≤ balanced ≤ liberal (recall increases)", () => {
    const s = extractDecisions({ transcript: noisyTranscript, mode: "strict" });
    const b = extractDecisions({ transcript: noisyTranscript, mode: "balanced" });
    const l = extractDecisions({ transcript: noisyTranscript, mode: "liberal" });
    expect(s.length).toBeLessThanOrEqual(b.length);
    expect(b.length).toBeLessThanOrEqual(l.length);
  });

  it("default mode (omitted) === balanced", () => {
    const def = extractDecisions({ transcript: noisyTranscript });
    const bal = extractDecisions({ transcript: noisyTranscript, mode: "balanced" });
    expect(def.length).toBe(bal.length);
    expect(def.map((d) => d.pattern).sort()).toEqual(bal.map((d) => d.pattern).sort());
  });
});

describe("v2.19.33 B1 SENTENCE SPLIT — boundary handling", () => {
  it("splits on newline first (Thai-friendly)", () => {
    const d = extractDecisions({
      transcript: "ทุก commit ต้อง pass test\nห้าม push main ตรงๆ",
    });
    expect(d.length).toBeGreaterThanOrEqual(2);
  });

  it("splits on period+capital boundary (English)", () => {
    const d = extractDecisions({
      transcript: "Every commit must pass test. Deploy needs 2 reviewers.",
    });
    expect(d.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT split on version numbers (v2.19.32 stays intact)", () => {
    const d = extractDecisions({
      transcript: "every commit must pass test before merging v2.19.32",
    });
    expect(d.some((x) => x.pattern === "test_required")).toBe(true);
  });

  it("RESILIENCE: 100 random multi-clause transcripts never crash", () => {
    const verbs = ["must", "needs", "required", "should", "ห้าม", "ต้อง"];
    const nouns = ["commit", "deploy", "PR", "review", "test", "secret", "console.log"];
    for (let i = 0; i < 100; i++) {
      const sentences = Array.from({ length: 5 }, () => {
        const v = verbs[Math.floor(Math.random() * verbs.length)];
        const n = nouns[Math.floor(Math.random() * nouns.length)];
        return `${i}: ${n} ${v} something at ${Date.now()}`;
      });
      const transcript = sentences.join("\n");
      // No specific assertion — just that it doesn't throw.
      const result = extractDecisions({ transcript, mode: "balanced" });
      expect(Array.isArray(result)).toBe(true);
    }
  });
});
