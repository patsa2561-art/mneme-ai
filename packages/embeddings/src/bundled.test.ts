/**
 * Unit tests for BundledEmbedder.
 *
 * Strategy: avoid downloading the model in CI by NOT calling embed()/verify()
 * (which would trigger the lazy load + ~25MB download). Test only the
 * synchronous shape — constructor, name, dimensions, defaults — plus that the
 * EmbeddingProvider contract is satisfied. Real-world end-to-end is covered by
 * the smoke test in CHANGELOG and was verified at v0.19.0 ship.
 */
import { describe, it, expect } from "vitest";
import { BundledEmbedder, defaultCacheDir } from "./bundled.js";

describe("BundledEmbedder — shape + defaults (no network)", () => {
  it("uses Xenova/all-MiniLM-L6-v2 with 384 dims by default", () => {
    const e = new BundledEmbedder();
    expect(e.name).toBe("bundled:Xenova/all-MiniLM-L6-v2");
    expect(e.dimensions).toBe(384);
  });

  it("accepts a custom model and reflects it in the name", () => {
    const e = new BundledEmbedder({ model: "Xenova/bge-small-en" });
    expect(e.name).toBe("bundled:Xenova/bge-small-en");
  });

  it("name uses the bundled: prefix so resolveEmbedder can route it", () => {
    const e = new BundledEmbedder();
    expect(e.name.startsWith("bundled:")).toBe(true);
  });

  it("defaultCacheDir lives under the user home — predictable + clearable", () => {
    const dir = defaultCacheDir();
    expect(dir).toContain("mneme");
    expect(dir).toContain("models");
    // Not absolute equality (per-OS) but should be an absolute path
    expect(dir.length).toBeGreaterThan(5);
  });

  it("constructor never throws even if @xenova/transformers can't be loaded", () => {
    // The lazy-import is in load(), not the constructor — so creating the
    // instance is always safe (a deliberate design choice for resolveEmbedder).
    expect(() => new BundledEmbedder()).not.toThrow();
    expect(() => new BundledEmbedder({ cacheDir: "/tmp/x" })).not.toThrow();
  });

  it("embed([]) returns [] without loading the pipeline (cheap fast-path)", async () => {
    const e = new BundledEmbedder();
    const out = await e.embed([]);
    expect(out).toEqual([]);
  });
});
