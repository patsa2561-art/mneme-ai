import { describe, it, expect } from "vitest";
import { SnnEmbedder } from "./snn.js";

describe("v2.19.16 SnnEmbedder · EmbeddingProvider contract", () => {
  it("exposes name + dimensions consistent with config", () => {
    const e = new SnnEmbedder({ populations: 16, neuronsPerPop: 32 });
    expect(e.name).toBe("snn:lif-32x64");
    expect(e.dimensions).toBe(16 * 32);
  });

  it("default dimensions = 2048 (32 × 64)", () => {
    const e = new SnnEmbedder();
    expect(e.dimensions).toBe(2048);
  });

  it("embed() returns Float32Array per input text, length = dimensions", async () => {
    const e = new SnnEmbedder({ populations: 8, neuronsPerPop: 8 });
    const r = await e.embed(["hello world", "the quick brown fox"]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeInstanceOf(Float32Array);
    expect(r[0]!.length).toBe(64);
    expect(r[1]!.length).toBe(64);
  });

  it("is deterministic: same seed + same text → same vector", async () => {
    const a = new SnnEmbedder({ seed: 42 });
    const b = new SnnEmbedder({ seed: 42 });
    const [va] = await a.embed(["deterministic test"]);
    const [vb] = await b.embed(["deterministic test"]);
    expect(Array.from(va!)).toEqual(Array.from(vb!));
  });

  it("differs across different seeds (per-machine phenotype)", async () => {
    const a = new SnnEmbedder({ seed: 1 });
    const b = new SnnEmbedder({ seed: 2 });
    const [va] = await a.embed(["same text"]);
    const [vb] = await b.embed(["same text"]);
    expect(Array.from(va!)).not.toEqual(Array.from(vb!));
  });

  it("handles empty array without throwing", async () => {
    const e = new SnnEmbedder();
    const r = await e.embed([]);
    expect(r).toHaveLength(0);
  });

  it("handles empty string without throwing", async () => {
    const e = new SnnEmbedder();
    const r = await e.embed([""]);
    expect(r[0]!.length).toBe(2048);
  });
});
