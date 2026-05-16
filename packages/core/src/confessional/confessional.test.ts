import { describe, it, expect } from "vitest";
import { auditDiff, verifyReceipt, formatConfessionalLine } from "./index.js";

describe("v2.19 · MNEME CONFESSIONAL — vendor-agnostic pre-merge audit", () => {
  it("approves primary when all vendors pass the same facts", () => {
    const r = auditDiff({
      primary: { vendor: "grok", text: "The answer is 4." },
      peers: [
        { vendor: "claude", text: "The answer is 4." },
        { vendor: "chatgpt", text: "It's 4." },
      ],
      taskClass: "fact_check",
      expectedFacts: [{ description: "contains 4", mustContain: ["4"] }],
    });
    expect(r.verdict).toBe("approve");
    expect(r.divergence).toBeLessThanOrEqual(0);
  });

  it("flags primary when peers all agree and primary diverges", () => {
    const r = auditDiff({
      primary: { vendor: "grok", text: "I think the answer might be 3 or maybe 5." },
      peers: [
        { vendor: "claude", text: "The answer is 4." },
        { vendor: "chatgpt", text: "The answer is 4." },
      ],
      taskClass: "fact_check",
      expectedFacts: [{ description: "contains 4", mustContain: ["4"] }],
    });
    expect(["flag", "block"]).toContain(r.verdict);
    expect(r.divergence).toBeGreaterThan(0);
  });

  it("blocks primary on severe divergence (>2× threshold)", () => {
    const r = auditDiff({
      primary: { vendor: "grok", text: "blah blah blah no signal" },
      peers: [
        { vendor: "claude", text: "FOO BAR BAZ — the answer is 4 exactly." },
        { vendor: "chatgpt", text: "FOO BAR BAZ — the answer is 4." },
      ],
      taskClass: "fact_check",
      expectedFacts: [
        { description: "must say FOO", mustContain: ["FOO"] },
        { description: "must say BAR", mustContain: ["BAR"] },
        { description: "must say BAZ", mustContain: ["BAZ"] },
        { description: "must say 4", mustContain: ["4"] },
      ],
      divergenceThreshold: 0.20,
    });
    expect(r.verdict).toBe("block");
  });

  it("blocks primary on absolute composite below hardBlockBelow", () => {
    const r = auditDiff({
      primary: { vendor: "grok", text: "blah" },
      peers: [{ vendor: "claude", text: "blah" }], // both fail
      taskClass: "code_generation",
      expectedFacts: [
        { description: "must FOO", mustContain: ["FOO"], weight: 10 },
      ],
      hardBlockBelow: 0.50,
    });
    expect(r.verdict).toBe("block");
    expect(r.reasons.some((s) => s.includes("hard-block"))).toBe(true);
  });

  it("works for every supported vendor as primary", () => {
    const vendors = ["claude", "chatgpt", "gemini", "cursor", "copilot", "codex", "llama", "mistral", "qwen", "deepseek", "perplexity", "other"] as const;
    for (const v of vendors) {
      const r = auditDiff({
        primary: { vendor: v, text: "ok" },
        peers: [{ vendor: v === "claude" ? "chatgpt" : "claude", text: "ok" }],
        taskClass: "other",
        expectedFacts: [{ description: "contains ok", mustContain: ["ok"] }],
      });
      expect(r.primaryVendor).toBe(v);
      expect(r.verdict).toBe("approve");
    }
  });

  it("surfaces peer-confirmed misses on flagged/blocked verdicts", () => {
    const r = auditDiff({
      primary: { vendor: "grok", text: "blah" },
      peers: [
        { vendor: "claude", text: "FOO and BAR" },
        { vendor: "chatgpt", text: "FOO and BAR" },
      ],
      taskClass: "fact_check",
      expectedFacts: [
        { description: "must FOO", mustContain: ["FOO"] },
        { description: "must BAR", mustContain: ["BAR"] },
      ],
    });
    expect(r.verdict).not.toBe("approve");
    expect(r.reasons.some((s) => s.includes("Peer-confirmed miss"))).toBe(true);
  });

  it("verifyReceipt detects tampering", () => {
    const r = auditDiff({
      primary: { vendor: "claude", text: "x" },
      peers: [{ vendor: "chatgpt", text: "x" }],
      taskClass: "other",
      expectedFacts: [{ description: "contains x", mustContain: ["x"] }],
    });
    expect(verifyReceipt(r).ok).toBe(true);
    const tampered = { ...r, verdict: "approve" as const, primaryComposite: 999 };
    expect(verifyReceipt(tampered).ok).toBe(false);
  });

  it("throws clearly when peers is empty (caller error)", () => {
    expect(() => auditDiff({
      primary: { vendor: "claude", text: "x" },
      peers: [],
      taskClass: "other",
      expectedFacts: [],
    })).toThrow(/at least one peer/);
  });

  it("headline + formatConfessionalLine summarise verdict", () => {
    const r = auditDiff({
      primary: { vendor: "claude", text: "ok" },
      peers: [{ vendor: "chatgpt", text: "ok" }],
      taskClass: "other",
      expectedFacts: [{ description: "contains ok", mustContain: ["ok"] }],
    });
    expect(formatConfessionalLine(r)).toContain("CONFESSIONAL");
    expect(r.headline).toContain(r.primaryVendor);
  });

  it("measurable improvement: divergence is bounded and consistent", () => {
    // The same input must produce the same divergence — deterministic measurement.
    const args = {
      primary: { vendor: "claude" as const, text: "answer 4" },
      peers: [
        { vendor: "chatgpt" as const, text: "answer 4" },
        { vendor: "gemini" as const, text: "answer 4" },
      ],
      taskClass: "fact_check" as const,
      expectedFacts: [{ description: "contains 4", mustContain: ["4"] }],
    };
    const a = auditDiff({ ...args, ts: "2026-01-01T00:00:00Z" });
    const b = auditDiff({ ...args, ts: "2026-01-01T00:00:00Z" });
    expect(a.divergence).toBe(b.divergence);
    expect(a.primaryComposite).toBe(b.primaryComposite);
  });
});
