import { describe, expect, it } from "vitest";
import { EMBEDDER_REGISTRY, availableEmbedders } from "./embedder_registry.js";

describe("embedder_registry", () => {
  it("registers exactly 5 backends", () => {
    expect(Object.keys(EMBEDDER_REGISTRY).length).toBe(5);
  });

  it("bundled-bge-small is always available (free)", () => {
    expect(EMBEDDER_REGISTRY["bundled-bge-small"].available()).toBe(true);
  });

  it("bundled-bge-m3 is always available (free, larger)", () => {
    expect(EMBEDDER_REGISTRY["bundled-bge-m3"].available()).toBe(true);
  });

  it("voyage-3 needs VOYAGE_API_KEY", () => {
    const had = process.env["VOYAGE_API_KEY"];
    delete process.env["VOYAGE_API_KEY"];
    expect(EMBEDDER_REGISTRY["voyage-3"].available()).toBe(false);
    if (had) process.env["VOYAGE_API_KEY"] = had;
  });

  it("openai-3-small / large need OPENAI_API_KEY", () => {
    const had = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    expect(EMBEDDER_REGISTRY["openai-3-small"].available()).toBe(false);
    expect(EMBEDDER_REGISTRY["openai-3-large"].available()).toBe(false);
    if (had) process.env["OPENAI_API_KEY"] = had;
  });

  it("availableEmbedders includes both free backends at minimum", () => {
    const ids = availableEmbedders().map((e) => e.id);
    expect(ids).toContain("bundled-bge-small");
    expect(ids).toContain("bundled-bge-m3");
  });

  it("each backend declares dim + execMode + label", () => {
    for (const e of Object.values(EMBEDDER_REGISTRY)) {
      expect(e.dim).toBeGreaterThan(0);
      expect(["in-process", "remote-api"]).toContain(e.execMode);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });
});
