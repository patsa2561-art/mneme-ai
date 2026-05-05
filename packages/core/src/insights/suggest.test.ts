import { describe, it, expect } from "vitest";
import { suggestFollowUps, extractTopicWord } from "./suggest.js";
import type { SearchResult, Commit } from "../types.js";

const cmt = (hash: string, subject: string, author = "alice", files: string[] = []): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: author,
  authorEmail: `${author}@example.com`,
  authorDate: "2024-08-12T00:00:00Z",
  committerDate: "2024-08-12T00:00:00Z",
  subject,
  body: "",
  parents: [],
  files,
});

const result = (hash: string, score: number, files: string[] = []): SearchResult => ({
  commit: cmt(hash, "subj", "alice", files),
  score,
  matchedChunks: [],
});

describe("extractTopicWord", () => {
  it("returns camelCase identifier when present", () => {
    expect(extractTopicWord("why does parseAmount throw?")).toBe("parseAmount");
  });

  it("returns path-like token when present", () => {
    expect(extractTopicWord("what about src/payment changes?")).toBe("src/payment");
  });

  it("returns the longest meaningful word otherwise", () => {
    expect(extractTopicWord("why is authentication broken")).toBe("authentication");
  });

  it("filters stop-words and code-noise words", () => {
    // 'the', 'how', 'does', 'use' filtered → longest remaining is "function"
    expect(extractTopicWord("how does the function use this")).toBe("function");
  });

  it("returns undefined when nothing concrete remains", () => {
    expect(extractTopicWord("why")).toBeUndefined();
    expect(extractTopicWord("the and or")).toBeUndefined();
  });
});

describe("suggestFollowUps", () => {
  it("returns no suggestions when results are empty", () => {
    expect(suggestFollowUps("anything", [])).toEqual([]);
  });

  it("suggests `mneme why <file>` when top result has files", () => {
    const out = suggestFollowUps("why does X exist?", [result("a", 0.05, ["src/payment.ts"])]);
    expect(out.find((s) => s.command.startsWith("mneme why"))).toBeDefined();
  });

  it("suggests `mneme story <topic>` when topic word is extractable", () => {
    const out = suggestFollowUps("how does authentication work?", [result("a", 0.05)]);
    expect(out.find((s) => s.command.startsWith("mneme story"))).toBeDefined();
  });

  it("suggests `mneme who-knows <topic>` with the topic", () => {
    const out = suggestFollowUps("authentication question", [result("a", 0.05)]);
    expect(out.find((s) => s.command.startsWith("mneme who-knows"))).toBeDefined();
  });

  it("suggests `mneme blast <commit>` when there are 2+ results", () => {
    const out = suggestFollowUps("auth", [result("abc1234", 0.05), result("def5678", 0.04)]);
    expect(out.find((s) => s.command.includes("blast"))).toBeDefined();
  });

  it("caps suggestions at 3", () => {
    const out = suggestFollowUps(
      "authentication question",
      [result("abc1234", 0.05, ["src/auth.ts"]), result("def5678", 0.04)],
    );
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("every suggestion has a non-empty command and reason", () => {
    const out = suggestFollowUps(
      "stripe webhook bigint",
      [result("a", 0.05, ["src/webhook.ts"]), result("b", 0.04)],
    );
    for (const s of out) {
      expect(s.command.length).toBeGreaterThan(5);
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });
});
