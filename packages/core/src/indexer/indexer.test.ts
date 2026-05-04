import { describe, it, expect } from "vitest";
import { buildChunks, splitBody } from "./indexer.js";
import type { Commit } from "../types.js";

const baseCommit = (overrides: Partial<Commit> = {}): Commit => ({
  hash: "abc1234567890abc1234567890abc1234567890a",
  shortHash: "abc1234",
  authorName: "Alice",
  authorEmail: "a@x.io",
  authorDate: "2025-01-01T00:00:00Z",
  committerDate: "2025-01-01T00:00:00Z",
  subject: "subject",
  body: "",
  parents: [],
  files: [],
  ...overrides,
});

describe("splitBody", () => {
  it("returns text unchanged when below limit", () => {
    expect(splitBody("hello world", 100)).toEqual(["hello world"]);
  });

  it("splits at paragraph boundaries", () => {
    const text = "para one\n\npara two that is much longer than allowed";
    const parts = splitBody(text, 20);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(60);
  });

  it("never produces empty parts", () => {
    const text = "a\n\n\n\nb\n\n\n\nc";
    const parts = splitBody(text, 5);
    for (const p of parts) expect(p.trim().length).toBeGreaterThan(0);
  });

  it("preserves order", () => {
    const parts = splitBody("ALPHA\n\nBETA\n\nGAMMA", 6);
    const joined = parts.join(" ");
    expect(joined.indexOf("ALPHA")).toBeLessThan(joined.indexOf("BETA"));
    expect(joined.indexOf("BETA")).toBeLessThan(joined.indexOf("GAMMA"));
  });
});

describe("buildChunks", () => {
  it("returns subject chunk for every commit with a subject", () => {
    const chunks = buildChunks([baseCommit({ subject: "fix payment bug" })]);
    expect(chunks.some((c) => c.kind === "subject" && c.text === "fix payment bug")).toBe(true);
  });

  it("emits body chunks separate from subject", () => {
    const chunks = buildChunks([
      baseCommit({ subject: "S", body: "explanation in the body" }),
    ]);
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(kinds.has("subject")).toBe(true);
    expect(kinds.has("body")).toBe(true);
  });

  it("emits PR chunks when present", () => {
    const chunks = buildChunks([
      baseCommit({ prTitle: "PR title", prBody: "PR body content" }),
    ]);
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(kinds.has("pr_title")).toBe(true);
    expect(kinds.has("pr_body")).toBe(true);
  });

  it("skips empty fields", () => {
    const chunks = buildChunks([baseCommit({ subject: "", body: "" })]);
    expect(chunks).toEqual([]);
  });

  it("produces deterministic chunk ids", () => {
    const c = baseCommit({ subject: "deterministic" });
    const a = buildChunks([c]);
    const b = buildChunks([c]);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it("chunks are uniquely keyed across commits", () => {
    const chunks = buildChunks([
      baseCommit({ hash: "1".repeat(40), shortHash: "1111111", subject: "shared" }),
      baseCommit({ hash: "2".repeat(40), shortHash: "2222222", subject: "shared" }),
    ]);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
