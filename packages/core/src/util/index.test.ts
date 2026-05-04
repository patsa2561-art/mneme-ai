import { describe, it, expect } from "vitest";
import { cosineSim, sha256Hex } from "./index.js";

describe("cosineSim", () => {
  it("matches the standalone cosine in retrieve/search", () => {
    expect(cosineSim(Float32Array.from([1, 0]), Float32Array.from([1, 0]))).toBeCloseTo(1, 6);
    expect(cosineSim(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
    expect(cosineSim(Float32Array.from([1, 0]), Float32Array.from([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it("returns 0 for mismatched length", () => {
    expect(cosineSim(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2]))).toBe(0);
  });

  it("returns 0 for zero vector (no NaN)", () => {
    expect(cosineSim(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});

describe("sha256Hex", () => {
  it("is deterministic for same inputs", async () => {
    const a = await sha256Hex("a", "b", "c");
    const b = await sha256Hex("a", "b", "c");
    expect(a).toBe(b);
  });
  it("differs for different inputs", async () => {
    const a = await sha256Hex("x");
    const b = await sha256Hex("y");
    expect(a).not.toBe(b);
  });
  it("is order-sensitive (hash of joined parts)", async () => {
    const a = await sha256Hex("a", "b");
    const b = await sha256Hex("b", "a");
    expect(a).not.toBe(b);
  });
  it("produces 64-char hex output", async () => {
    const h = await sha256Hex("anything");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
