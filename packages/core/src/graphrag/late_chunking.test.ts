import { describe, expect, it } from "vitest";
import { lateChunkEmbed } from "./late_chunking.js";

describe("late chunking embed", () => {
  // Mock embedder that returns deterministic vectors so we can verify mixing.
  const mockEmbed = async (texts: string[]): Promise<number[][]> => {
    return texts.map((t) => {
      // 4-dim vector based on text content
      const sum = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      return [sum % 13, sum % 17, sum % 19, sum % 23];
    });
  };

  it("returns empty when chunks empty", async () => {
    const r = await lateChunkEmbed({ fullText: "hello", chunks: [], embed: mockEmbed });
    expect(r.vectors.length).toBe(0);
  });

  it("mixes chunk + full-doc embedding by alpha", async () => {
    const r = await lateChunkEmbed({
      fullText: "the full document body here",
      chunks: [{ id: "1", text: "first chunk" }, { id: "2", text: "second chunk" }],
      embed: mockEmbed,
      alpha: 0.5,
    });
    expect(r.vectors.length).toBe(2);
    expect(r.contextApplied).toBe(true);
    expect(r.alpha).toBe(0.5);
  });

  it("normalizes mixed vectors (L2 norm == 1)", async () => {
    const r = await lateChunkEmbed({
      fullText: "doc",
      chunks: [{ id: "1", text: "ch1" }],
      embed: mockEmbed,
      alpha: 0.3,
    });
    const v = r.vectors[0]!;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("falls back gracefully when embedder throws", async () => {
    const failing = async (): Promise<number[][]> => { throw new Error("offline"); };
    const r = await lateChunkEmbed({
      fullText: "doc", chunks: [{ id: "1", text: "ch" }], embed: failing,
    });
    expect(r.contextApplied).toBe(false);
    expect(r.vectors.length).toBe(0);
  });
});
