import { describe, it, expect } from "vitest";
import { judgeMatch, dailyLeaderboard, formatArenaLine } from "./index.js";

describe("v2.18 · MNEME ARENA — public AI vendor showdown", () => {
  it("judges a 3-vendor match — winner is whoever passes most facts", () => {
    const v = judgeMatch({
      prompt: "What is 2+2?",
      taskClass: "fact_check",
      expectedFacts: [
        { description: "answer is 4", mustContain: ["4"] },
        { description: "no decimals", mustNotContain: ["3.5", "4.5"] },
      ],
      responses: [
        { vendor: "claude", text: "The answer is 4." },
        { vendor: "chatgpt", text: "It's 4 — exactly." },
        { vendor: "gemini", text: "I think it might be 3.5 or 4.5." },
      ],
    });
    expect(v.winner).toMatch(/claude|chatgpt/);
    expect(v.scored[0]!.factScore).toBe(1);
    const gemini = v.scored.find((s) => s.vendor === "gemini")!;
    expect(gemini.factScore).toBeLessThan(1);
  });

  it("brevity penalises padding", () => {
    const v = judgeMatch({
      prompt: "yes or no",
      taskClass: "explanation",
      expectedFacts: [{ description: "contains yes", mustContain: ["yes"] }],
      responses: [
        { vendor: "claude", text: "yes" },
        { vendor: "chatgpt", text: "yes" + " ".repeat(5000) + "yes yes yes" },
      ],
    });
    expect(v.winner).toBe("claude");
  });

  it("cost is tiebreaker when composite ties", () => {
    const v = judgeMatch({
      prompt: "x",
      taskClass: "code_generation",
      expectedFacts: [{ description: "contains foo", mustContain: ["foo"] }],
      responses: [
        { vendor: "claude", text: "foo bar baz qux", costUsd: 0.05 },
        { vendor: "chatgpt", text: "foo bar baz qux", costUsd: 0.01 },
      ],
    });
    expect(v.winner).toBe("chatgpt"); // cheaper wins on tie
  });

  it("regex check works", () => {
    const v = judgeMatch({
      prompt: "give me an email",
      taskClass: "structured_output",
      expectedFacts: [{ description: "valid email", mustMatch: "[a-z]+@[a-z]+\\.[a-z]+" }],
      responses: [
        { vendor: "claude", text: "user@example.com" },
        { vendor: "chatgpt", text: "no email here" },
      ],
    });
    expect(v.winner).toBe("claude");
  });

  it("fact weight matters", () => {
    const v = judgeMatch({
      prompt: "x",
      taskClass: "fact_check",
      expectedFacts: [
        { description: "minor", mustContain: ["a"], weight: 1 },
        { description: "MAJOR", mustContain: ["FOO"], weight: 10 },
      ],
      responses: [
        { vendor: "claude", text: "FOO bar baz" }, // passes both
        { vendor: "chatgpt", text: "a b c" }, // passes only minor
      ],
    });
    expect(v.winner).toBe("claude");
    expect(v.scored.find((s) => s.vendor === "chatgpt")!.factScore).toBeCloseTo(1 / 11, 2);
  });

  it("HMAC sig is 64 hex", () => {
    const v = judgeMatch({
      prompt: "x", taskClass: "other", expectedFacts: [], responses: [{ vendor: "claude", text: "x" }],
    });
    expect(v.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dailyLeaderboard aggregates wins per vendor on a given day", () => {
    const day = "2026-05-15";
    const verdicts = [];
    for (let i = 0; i < 5; i++) {
      verdicts.push(judgeMatch({
        prompt: "x", taskClass: "other", ts: `${day}T0${i}:00:00Z`,
        expectedFacts: [{ description: "ok", mustContain: ["ok"] }],
        responses: [
          { vendor: "claude", text: "ok" },
          { vendor: "chatgpt", text: "no" },
        ],
      }));
    }
    const board = dailyLeaderboard({ verdicts, day });
    expect(board.day).toBe(day);
    expect(board.rows[0]!.vendor).toBe("claude");
    expect(board.rows[0]!.wins).toBe(5);
    expect(board.rows[0]!.winRate).toBe(1);
  });

  it("formatArenaLine summarises", () => {
    const v = judgeMatch({
      prompt: "x", taskClass: "code_review", expectedFacts: [], responses: [{ vendor: "claude", text: "ok" }],
    });
    expect(formatArenaLine(v)).toContain("ARENA");
  });
});
