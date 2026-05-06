import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  osc8,
  confidenceBadge,
  clusterFiles,
  commitUrl,
  truncate,
  unique,
  wrapText,
  renderAnswer,
} from "./render-answer.js";
import type { SearchResult, RepoMeta } from "@mneme-ai/core";

// Disable colors for deterministic test output
beforeEach(() => {
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("osc8 — clickable hyperlinks", () => {
  it("returns plain text when not on a TTY", () => {
    const wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(osc8("https://example.com", "click me")).toBe("click me");
    Object.defineProperty(process.stdout, "isTTY", { value: wasTTY, configurable: true });
  });

  it("returns plain text when url is undefined", () => {
    expect(osc8(undefined, "no link")).toBe("no link");
  });
});

describe("confidenceBadge", () => {
  it("returns a string for every confidence label", () => {
    expect(confidenceBadge("high")).toContain("HIGH");
    expect(confidenceBadge("medium")).toContain("MEDIUM");
    expect(confidenceBadge("low")).toContain("LOW");
    expect(confidenceBadge("none")).toContain("NO CONTEXT");
  });
});

describe("clusterFiles", () => {
  it("groups by top-2 path segments and counts", () => {
    const out = clusterFiles([
      "src/payment/service.ts",
      "src/payment/types.ts",
      "src/auth/middleware.ts",
      "tests/payment.test.ts",
    ]);
    const names = out.map((c) => c.name);
    expect(names).toContain("src/payment");
    expect(names).toContain("src/auth");
    expect(names).toContain("tests/payment.test.ts");
    const payment = out.find((c) => c.name === "src/payment")!;
    expect(payment.count).toBe(2);
    expect(payment.sample).toHaveLength(2);
  });

  it("orders clusters by descending count", () => {
    const out = clusterFiles([
      "src/auth/a.ts",
      "src/payment/p1.ts",
      "src/payment/p2.ts",
      "src/payment/p3.ts",
    ]);
    expect(out[0]!.name).toBe("src/payment");
    expect(out[0]!.count).toBe(3);
  });

  it("handles single-segment paths and empty input", () => {
    expect(clusterFiles([])).toEqual([]);
    expect(clusterFiles(["README.md"])[0]!.name).toBe("README.md");
  });

  it("samples no more than 2 representative paths", () => {
    const out = clusterFiles(Array.from({ length: 10 }, (_, i) => `src/x/file${i}.ts`));
    expect(out[0]!.sample.length).toBeLessThanOrEqual(2);
  });
});

describe("commitUrl", () => {
  it("builds GitHub commit URLs", () => {
    const repo: RepoMeta = { rootPath: "/", defaultBranch: "main", host: "github", owner: "x", repo: "y" };
    expect(commitUrl("abc123", repo)).toBe("https://github.com/x/y/commit/abc123");
  });

  it("returns undefined without owner/repo", () => {
    expect(commitUrl("abc123")).toBeUndefined();
    expect(commitUrl("abc123", { rootPath: "/", defaultBranch: "main" })).toBeUndefined();
  });

  it("supports gitlab and bitbucket", () => {
    expect(
      commitUrl("abc", { rootPath: "/", defaultBranch: "main", host: "gitlab", owner: "x", repo: "y" }),
    ).toContain("gitlab.com");
    expect(
      commitUrl("abc", { rootPath: "/", defaultBranch: "main", host: "bitbucket", owner: "x", repo: "y" }),
    ).toContain("bitbucket.org");
  });
});

describe("truncate", () => {
  it("returns input unchanged when under the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hello world", 8).length).toBe(8);
  });
});

describe("unique", () => {
  it("removes duplicates preserving first-seen order", () => {
    expect(unique([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
    expect(unique(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});

describe("wrapText", () => {
  it("respects width by splitting on word boundaries", () => {
    const out = wrapText("the quick brown fox jumps over the lazy dog", 20, "");
    for (const line of out) expect(line.length).toBeLessThanOrEqual(20);
  });

  it("preserves paragraph breaks", () => {
    const out = wrapText("para one.\n\npara two.", 80, "");
    expect(out).toContain("");
  });

  it("applies indent to every line", () => {
    const out = wrapText("hello world this is a long sentence to wrap", 20, "    ");
    for (const line of out) {
      if (line.trim().length > 0) expect(line.startsWith("    ")).toBe(true);
    }
  });

  it("handles empty input", () => {
    expect(wrapText("", 80, "")).toEqual([]);
  });
});

describe("renderAnswer — full top-level rendering", () => {
  const sampleResult = (hash: string, score: number, subject: string, files: string[] = []): SearchResult => ({
    commit: {
      hash,
      shortHash: hash.slice(0, 7),
      authorName: "alice",
      authorEmail: "alice@example.com",
      authorDate: "2024-08-12T00:00:00Z",
      committerDate: "2024-08-12T00:00:00Z",
      subject,
      body: "",
      parents: [],
      files,
    },
    score,
    matchedChunks: [],
  });

  it("renders the question, badge, and answer sections", () => {
    const out = renderAnswer({
      question: "why does X exist?",
      synthesized: {
        answer: "Because Y. See abc1234.",
        source: "llm",
        confidence: "high",
        evidenceCommitHashes: ["abc1234"],
        durationMs: 200,
        unverifiedCitations: [],
        trustScore: 0.95,
      },
      results: [sampleResult("abc1234", 0.05, "Fix X")],
    });
    expect(out).toContain("why does X exist?");
    expect(out).toContain("HIGH CONFIDENCE");
    expect(out).toContain("Answer");
    expect(out).toContain("Because Y");
    expect(out).toContain("Evidence");
    expect(out).toContain("Fix X");
  });

  it("omits Evidence/Files sections for no-context", () => {
    const out = renderAnswer({
      question: "vague",
      synthesized: {
        answer: "No strong context found.",
        source: "no-context",
        confidence: "none",
        evidenceCommitHashes: [],
        durationMs: 0,
        unverifiedCitations: [],
        trustScore: 0.8,
      },
      results: [],
    });
    expect(out).toContain("NO CONTEXT FOUND");
    expect(out).toContain("No strong context");
    expect(out).not.toContain("◆ Evidence");
    expect(out).not.toContain("⊕ Files");
  });

  it("shows file clusters when results have files", () => {
    const out = renderAnswer({
      question: "stripe bigint",
      synthesized: {
        answer: "Top match: abc1234.",
        source: "extractive",
        confidence: "high",
        evidenceCommitHashes: ["abc1234"],
        durationMs: 0,
        unverifiedCitations: [],
        trustScore: 0.8,
      },
      results: [sampleResult("abc1234", 0.05, "Fix BigInt", ["src/payment/svc.ts", "src/payment/types.ts"])],
    });
    expect(out).toContain("Files");
    expect(out).toContain("src/payment");
  });

  it("includes feedback CTA when feedbackId is provided", () => {
    const out = renderAnswer({
      question: "q",
      synthesized: {
        answer: "answer",
        source: "extractive",
        confidence: "high",
        evidenceCommitHashes: ["abc1234"],
        durationMs: 0,
        unverifiedCitations: [],
        trustScore: 0.8,
      },
      results: [sampleResult("abc1234", 0.05, "subj")],
      feedbackId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
    });
    expect(out).toContain("Was this useful");
    expect(out).toContain("12345678");
  });

  it("caps Evidence at top-3 even if more results exist", () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      sampleResult(`abc${i}123`, 0.05 - i * 0.005, `Subject ${i}`),
    );
    const out = renderAnswer({
      question: "q",
      synthesized: {
        answer: "answer",
        source: "extractive",
        confidence: "high",
        evidenceCommitHashes: results.map((r) => r.commit.hash).slice(0, 3),
        durationMs: 0,
        unverifiedCitations: [],
        trustScore: 0.8,
      },
      results,
    });
    expect(out).toContain("(showing 3 of 8)");
    expect(out).toContain("Subject 0");
    expect(out).toContain("Subject 2");
    expect(out).not.toContain("Subject 5");
  });
});
