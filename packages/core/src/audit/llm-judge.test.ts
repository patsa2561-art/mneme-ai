import { describe, expect, it } from "vitest";
import { verifyLlmJudge, parseLlmVerdict, type LlmAdapter } from "./llm-judge.js";

const baseInput = {
  commitHash: "a1b2c3d4e5f6",
  commitSubject: "fix: typo in README",
  commitBody: "",
  addedLines: ["+ README updated"],
  removedLines: ["- README old"],
};

const cleanPassResponse = `{
  "pass": 0.92,
  "warn": 0.05,
  "fail": 0.02,
  "skipped": 0.01,
  "rationale": "Subject matches diff scope; no contradiction.",
  "selfConfidence": 0.85
}`;

describe("parseLlmVerdict", () => {
  it("parses valid JSON", () => {
    const r = parseLlmVerdict(cleanPassResponse);
    expect(r).toBeTruthy();
    expect(r!.distribution.collapsed).toBe("pass");
    expect(r!.rationale).toContain("Subject matches");
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + cleanPassResponse + "\n```";
    const r = parseLlmVerdict(wrapped);
    expect(r).toBeTruthy();
  });

  it("recovers from chatty preamble (extracts JSON block)", () => {
    const chatty = "Here's my analysis:\n\n" + cleanPassResponse + "\n\nI hope this helps.";
    const r = parseLlmVerdict(chatty);
    expect(r).toBeTruthy();
  });

  it("returns null on no-JSON output", () => {
    expect(parseLlmVerdict("I don't know how to grade this.")).toBeNull();
  });

  it("returns null when required keys are missing", () => {
    expect(parseLlmVerdict('{"pass":0.5,"warn":0.5}')).toBeNull();
  });

  it("clamps selfConfidence to [0,1]", () => {
    const out = parseLlmVerdict(`{
      "pass":1,"warn":0,"fail":0,"skipped":0,
      "rationale":"x","selfConfidence":2.5
    }`);
    expect(out!.selfConfidence).toBeLessThanOrEqual(1);
    expect(out!.selfConfidence).toBeGreaterThanOrEqual(0);
  });

  it("normalises slightly-off distributions (sums close to but not exactly 1.0)", () => {
    // distribution() handles renormalisation; parser should not fail
    const out = parseLlmVerdict(`{
      "pass":0.5,"warn":0.5,"fail":0.5,"skipped":0,
      "rationale":"x","selfConfidence":0.5
    }`);
    expect(out).toBeTruthy();
    // After renormalisation: each ≈ 0.333 + 0.333 + 0.333
    const sum = out!.distribution.pass + out!.distribution.warn + out!.distribution.fail + out!.distribution.skipped;
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe("verifyLlmJudge", () => {
  const adapter = (response: string): LlmAdapter => ({
    enrich: async () => ({ text: response }),
  });

  it("returns a verifier vote on clean LLM output", async () => {
    const v = await verifyLlmJudge(baseInput, { adapter: adapter(cleanPassResponse) });
    expect(v.verifier).toBe("llm-judge");
    expect(v.distribution.collapsed).toBe("pass");
    expect(v.rationale).toContain("Subject matches");
  });

  it("returns skipped vote on adapter error", async () => {
    const broken: LlmAdapter = { enrich: async () => { throw new Error("network down"); } };
    const v = await verifyLlmJudge(baseInput, { adapter: broken });
    expect(v.distribution.collapsed).toBe("skipped");
    expect(v.rationale).toContain("network down");
  });

  it("returns skipped vote on empty LLM output", async () => {
    const v = await verifyLlmJudge(baseInput, { adapter: adapter("") });
    expect(v.distribution.collapsed).toBe("skipped");
    expect(v.rationale).toContain("empty");
  });

  it("returns skipped vote on malformed JSON", async () => {
    const v = await verifyLlmJudge(baseInput, { adapter: adapter("not json at all") });
    expect(v.distribution.collapsed).toBe("skipped");
    expect(v.rationale).toContain("malformed JSON");
  });

  it("caps diff lines per side at the supplied diffCap", async () => {
    const seen: string[] = [];
    const probe: LlmAdapter = {
      enrich: async (input) => {
        seen.push(input.user);
        return { text: cleanPassResponse };
      },
    };
    const longInput = {
      ...baseInput,
      addedLines: Array.from({ length: 200 }, (_, i) => `added line ${i}`),
    };
    await verifyLlmJudge(longInput, { adapter: probe, diffCap: 10 });
    // Only first 10 lines should appear in the prompt
    expect(seen[0]).toContain("added line 0");
    expect(seen[0]).toContain("added line 9");
    expect(seen[0]).not.toContain("added line 11");
    expect(seen[0]).toContain("truncated");
  });

  it("default mode is adversarial (system prompt mentions 'lies' or 'contradictions')", async () => {
    const seen: string[] = [];
    const probe: LlmAdapter = {
      enrich: async (input) => {
        seen.push(input.system);
        return { text: cleanPassResponse };
      },
    };
    await verifyLlmJudge(baseInput, { adapter: probe });
    expect(seen[0].toLowerCase()).toMatch(/contradiction|adversarial|hide|lie/);
  });
});
