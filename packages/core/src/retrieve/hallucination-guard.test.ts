import { describe, it, expect } from "vitest";
import { findUnverifiedCitations, synthesize, type SynthesisEnricher } from "./synthesize.js";
import type { SearchResult } from "../types.js";

function mkResult(hash: string, subject = "init"): SearchResult {
  return {
    commit: {
      hash,
      shortHash: hash.slice(0, 7),
      authorName: "Alice",
      authorEmail: "a@x.com",
      authorDate: "2024-01-01",
      committerDate: "2024-01-01",
      subject,
      body: "",
      files: [],
      parents: [],
    },
    score: 0.05,
    matchedChunks: [],
  };
}

describe("findUnverifiedCitations", () => {
  it("returns empty when answer cites only evidence hashes", () => {
    const evidence = ["abc1234567890abc", "def9876543210def"];
    const answer = "Because of `abc1234`, see also `def9876`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual([]);
  });

  it("flags hashes that don't match any evidence", () => {
    const evidence = ["abc1234567890abc"];
    const answer = "Because of `abc1234`, also `bad9999`.";
    const unverified = findUnverifiedCitations(answer, evidence);
    expect(unverified).toContain("bad9999");
    expect(unverified).not.toContain("abc1234");
  });

  it("matches by prefix — short hash in answer + long hash in evidence", () => {
    const evidence = ["abc1234567890abcdef0000000000000000000000"];
    const answer = "See `abc1234`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual([]);
  });

  it("matches by prefix in either direction", () => {
    // Long hash in answer, short hash prefix in evidence
    const evidence = ["abc1234"];
    const answer = "See `abc1234567890`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual([]);
  });

  it("deduplicates repeated mentions", () => {
    const evidence = ["abc1234"];
    const answer = "See `bad9999`. Yes, `bad9999` again. And once more `bad9999`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual(["bad9999"]);
  });

  it("ignores backtick tokens that aren't hex (e.g. `mneme_ask`)", () => {
    const evidence = ["abc1234"];
    const answer = "Use `mneme_ask` and `npm install` — see `abc1234`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual([]);
  });

  it("is case-insensitive", () => {
    const evidence = ["ABC1234"];
    const answer = "See `abc1234`.";
    expect(findUnverifiedCitations(answer, evidence)).toEqual([]);
  });
});

describe("synthesize — audit mode", () => {
  it("refuses below confidence floor in audit mode", async () => {
    const out = await synthesize(
      "why does X exist?",
      [mkResult("abc1234")],
      "low",
      undefined,
      { auditMode: true, auditFloor: "medium" },
    );
    expect(out.source).toBe("audit-refused");
    expect(out.trustScore).toBe(0);
    expect(out.answer).toContain("Audit mode refused");
  });

  it("does NOT refuse when confidence meets floor", async () => {
    const out = await synthesize(
      "why does X exist?",
      [mkResult("abc1234")],
      "high",
      undefined,
      { auditMode: true, auditFloor: "medium" },
    );
    expect(out.source).toBe("extractive");
    expect(out.trustScore).toBeGreaterThan(0);
  });

  it("refuses when LLM cites unverified hashes in audit mode", async () => {
    const enricher: SynthesisEnricher = {
      name: "fake",
      enrich: async () => ({
        text: "Because of `bad9999` and `cafebabe`. Real reason `abc1234`.",
      }),
    };
    const out = await synthesize(
      "why does X exist?",
      [mkResult("abc1234567890abc")],
      "high",
      enricher,
      { auditMode: true },
    );
    expect(out.source).toBe("audit-refused");
    expect(out.unverifiedCitations).toEqual(expect.arrayContaining(["bad9999", "cafebabe"]));
  });

  it("returns LLM answer (with unverified flagged) when audit mode is OFF", async () => {
    const enricher: SynthesisEnricher = {
      name: "fake",
      enrich: async () => ({
        text: "Real reason `abc1234`. Also `bad9999`.",
      }),
    };
    const out = await synthesize(
      "why does X exist?",
      [mkResult("abc1234567890abc")],
      "high",
      enricher,
      // audit mode off (default)
    );
    expect(out.source).toBe("llm");
    expect(out.unverifiedCitations).toContain("bad9999");
    expect(out.trustScore).toBeLessThan(0.95);
  });
});

describe("synthesize — trust score", () => {
  it("trustScore is 0 for no-context", async () => {
    const out = await synthesize("vague", [], "none");
    expect(out.trustScore).toBe(0);
  });

  it("extractive trustScore depends on confidence", async () => {
    const high = await synthesize("q", [mkResult("abc1234")], "high");
    const med = await synthesize("q", [mkResult("abc1234")], "medium");
    const low = await synthesize("q", [mkResult("abc1234")], "low");
    expect(high.trustScore).toBeGreaterThan(med.trustScore);
    expect(med.trustScore).toBeGreaterThan(low.trustScore);
  });

  it("LLM with verified citations has higher trust than extractive", async () => {
    const enricher: SynthesisEnricher = {
      name: "fake",
      enrich: async () => ({ text: "See `abc1234`." }),
    };
    const llm = await synthesize("q", [mkResult("abc1234567890abc")], "high", enricher);
    const ext = await synthesize("q", [mkResult("abc1234567890abc")], "high");
    expect(llm.trustScore).toBeGreaterThan(ext.trustScore);
    expect(llm.unverifiedCitations).toEqual([]);
  });

  it("LLM with unverified citations has reduced trust", async () => {
    const enricher: SynthesisEnricher = {
      name: "fake",
      enrich: async () => ({ text: "See `abc1234` and `bad9999` and `cafebabe`." }),
    };
    const out = await synthesize("q", [mkResult("abc1234567890abc")], "high", enricher);
    expect(out.unverifiedCitations.length).toBeGreaterThanOrEqual(2);
    // Should be penalized
    expect(out.trustScore).toBeLessThan(0.7);
  });
});
