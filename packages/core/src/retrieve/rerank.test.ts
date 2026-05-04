import { describe, it, expect } from "vitest";
import { NoopReranker, QueryDensityReranker } from "./rerank.js";
import type { SearchResult, Commit } from "../types.js";

const c = (subject: string, body = "", score = 0.5): SearchResult => ({
  commit: {
    hash: subject,
    shortHash: subject,
    authorName: "x",
    authorEmail: "x@x",
    authorDate: "2025-01-01T00:00:00Z",
    committerDate: "2025-01-01T00:00:00Z",
    subject,
    body,
    parents: [],
    files: [],
  } satisfies Commit,
  score,
  matchedChunks: [],
});

describe("NoopReranker", () => {
  it("passes through and truncates to topK", async () => {
    const r = new NoopReranker();
    const out = await r.rerank("q", [c("a"), c("b"), c("c")], 2);
    expect(out.map((x) => x.commit.subject)).toEqual(["a", "b"]);
  });
});

describe("QueryDensityReranker", () => {
  const r = new QueryDensityReranker(0.5);

  it("promotes candidates that contain query terms", async () => {
    const out = await r.rerank(
      "stripe webhook idempotency",
      [
        c("unrelated documentation update", "", 0.8),
        c("stripe webhook idempotency dedup", "", 0.5),
      ],
      5,
    );
    expect(out[0]!.commit.subject).toBe("stripe webhook idempotency dedup");
  });

  it("falls back to original ranking when no query terms match", async () => {
    const out = await r.rerank(
      "xyzzyplugh",
      [c("alpha beta", "", 0.9), c("gamma delta", "", 0.5)],
      5,
    );
    expect(out[0]!.commit.subject).toBe("alpha beta");
  });

  it("respects alpha = 1 (pure first-stage score)", async () => {
    const pure = new QueryDensityReranker(1);
    const out = await pure.rerank(
      "something",
      [c("nothing", "", 0.9), c("something here", "", 0.5)],
      5,
    );
    expect(out[0]!.commit.subject).toBe("nothing");
  });

  it("ignores stopwords like 'why' and 'the'", async () => {
    const out = await r.rerank(
      "why does the webhook retry",
      [
        c("the why does this exist", "", 0.5),
        c("webhook retry mechanism", "", 0.5),
      ],
      5,
    );
    expect(out[0]!.commit.subject).toBe("webhook retry mechanism");
  });
});
