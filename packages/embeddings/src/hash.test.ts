import { describe, it, expect } from "vitest";
import { HashEmbedder } from "./hash.js";

describe("HashEmbedder", () => {
  const embedder = new HashEmbedder(64);

  it("produces vectors of the configured dimension", async () => {
    const [v] = await embedder.embed(["hello world"]);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v!.length).toBe(64);
  });

  it("is deterministic — same input → same output", async () => {
    const [a] = await embedder.embed(["fix stripe webhook"]);
    const [b] = await embedder.embed(["fix stripe webhook"]);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it("normalizes vectors to unit length", async () => {
    const [v] = await embedder.embed(["arbitrary text content"]);
    let norm = 0;
    for (let i = 0; i < v!.length; i++) norm += v![i]! * v![i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("handles empty input gracefully", async () => {
    const [v] = await embedder.embed([""]);
    expect(v).toBeInstanceOf(Float32Array);
  });

  it("similar inputs are more similar than dissimilar", async () => {
    const big = new HashEmbedder(512);
    const [a] = await big.embed(["fix stripe webhook crash on bigint amount"]);
    const [b] = await big.embed(["fix stripe webhook bug for bigint"]);
    const [c] = await big.embed(["unrelated documentation update for readme"]);
    const sim = (x: Float32Array, y: Float32Array): number => {
      let d = 0;
      for (let i = 0; i < x.length; i++) d += x[i]! * y[i]!;
      return d;
    };
    expect(sim(a!, b!)).toBeGreaterThan(sim(a!, c!));
  });

  it("reports a stable name", () => {
    expect(embedder.name).toBe("hash:fnv-256");
  });
});
