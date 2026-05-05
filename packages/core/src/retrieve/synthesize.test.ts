import { describe, it, expect } from "vitest";
import { synthesize, type SynthesisEnricher } from "./synthesize.js";
import type { SearchResult, Commit } from "../types.js";

const sampleCommit = (hash: string, subject: string, body = "", author = "alice", date = "2024-08-12"): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: author,
  authorEmail: `${author}@example.com`,
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject,
  body,
  parents: [],
  files: [],
});

const result = (hash: string, score: number, subject = "test commit", body = ""): SearchResult => ({
  commit: sampleCommit(hash, subject, body),
  score,
  matchedChunks: [],
});

describe("synthesize — no LLM (extractive fallback)", () => {
  it("returns no-context answer when confidence is none", async () => {
    const r = await synthesize("vague query", [], "none");
    expect(r.source).toBe("no-context");
    expect(r.evidenceCommitHashes).toEqual([]);
    expect(r.answer.toLowerCase()).toContain("no strong context");
  });

  it("returns no-context answer when results array is empty", async () => {
    const r = await synthesize("any query", [], "high");
    expect(r.source).toBe("no-context");
  });

  it("returns extractive answer when no enricher is provided", async () => {
    const r = await synthesize(
      "stripe bigint",
      [
        result("abc1234", 0.05, "Fix Stripe BigInt overflow"),
        result("def5678", 0.03, "Add observability for parseAmount"),
      ],
      "high",
    );
    expect(r.source).toBe("extractive");
    expect(r.answer).toContain("abc1234");
    expect(r.evidenceCommitHashes).toEqual(["abc1234", "def5678"]);
  });

  it("extractive answer uses different phrasing per confidence level", async () => {
    const high = await synthesize("q", [result("abc1234", 0.05, "subject")], "high");
    const medium = await synthesize("q", [result("abc1234", 0.05, "subject")], "medium");
    const low = await synthesize("q", [result("abc1234", 0.05, "subject")], "low");
    expect(high.answer).toContain("most likely");
    expect(medium.answer.toLowerCase()).toContain("possibly");
    expect(low.answer.toLowerCase()).toContain("verify");
  });

  it("extractive answer adapts to result count (1, 2, 3+)", async () => {
    const one = await synthesize("q", [result("abc1234", 0.05, "s1")], "high");
    const two = await synthesize("q", [result("abc1234", 0.05, "s1"), result("def5678", 0.04, "s2")], "high");
    const three = await synthesize(
      "q",
      [
        result("abc1234", 0.05, "s1"),
        result("def5678", 0.04, "s2"),
        result("ghi9012", 0.03, "s3"),
      ],
      "high",
    );
    expect(one.answer).toContain("abc1234");
    expect(one.answer).not.toContain("and");
    expect(two.answer).toContain("and");
    expect(three.answer).toContain("also");
  });
});

describe("synthesize — with LLM (enricher branch)", () => {
  const fakeEnricher = (returnText: string): SynthesisEnricher => ({
    name: "fake",
    enrich: async () => ({ text: returnText }),
  });

  it("uses LLM output when enricher succeeds", async () => {
    const r = await synthesize(
      "why does X exist?",
      [result("abc1234", 0.05, "subj")],
      "high",
      fakeEnricher("X exists because of Y. See `abc1234`."),
    );
    expect(r.source).toBe("llm");
    expect(r.answer).toContain("X exists because of Y");
  });

  it("falls back to extractive when LLM throws", async () => {
    const failingEnricher: SynthesisEnricher = {
      name: "fake-fail",
      enrich: async () => {
        throw new Error("ollama not reachable");
      },
    };
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05, "subj")],
      "high",
      failingEnricher,
    );
    expect(r.source).toBe("extractive");
    expect(r.answer).toContain("abc1234");
  });

  it("falls back to extractive when LLM returns empty", async () => {
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05, "subj")],
      "high",
      fakeEnricher("   "),
    );
    expect(r.source).toBe("extractive");
  });

  it('strips leading "Answer:" if the model echoed it', async () => {
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05, "subj")],
      "high",
      fakeEnricher('Answer: X is a thing because of Y.'),
    );
    expect(r.answer).not.toMatch(/^answer:/i);
    expect(r.answer).toContain("X is a thing");
  });

  it("strips wrapping quotes if any", async () => {
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05, "subj")],
      "high",
      fakeEnricher('"X exists because Y."'),
    );
    expect(r.answer).not.toMatch(/^"/);
    expect(r.answer).not.toMatch(/"$/);
  });

  it("strips trailing 'Sources:' / 'Citations:' blocks", async () => {
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05, "subj")],
      "high",
      fakeEnricher("X exists because Y.\n\nSources: abc1234, def5678"),
    );
    expect(r.answer.toLowerCase()).not.toContain("sources:");
  });

  it("evidenceCommitHashes is always populated when results > 0", async () => {
    const r = await synthesize(
      "q",
      [result("abc1234", 0.05), result("def5678", 0.03)],
      "high",
      fakeEnricher("answer"),
    );
    expect(r.evidenceCommitHashes).toEqual(["abc1234", "def5678"]);
  });
});

describe("synthesize — durationMs and bookkeeping", () => {
  it("durationMs is non-negative", async () => {
    const r = await synthesize("q", [], "none");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("echoes the confidence label", async () => {
    const r = await synthesize("q", [result("abc1234", 0.05, "s")], "medium");
    expect(r.confidence).toBe("medium");
  });
});
