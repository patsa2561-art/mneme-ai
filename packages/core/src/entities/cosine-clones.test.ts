import { describe, it, expect } from "vitest";
import { CosineCloneDetector } from "./cosine-clones.js";
import type { Entity } from "../types.js";

const e = (id: string, vec: number[]): Entity => ({
  id,
  kind: "function",
  name: id,
  filePath: `${id}.ts`,
  startLine: 1,
  endLine: 10,
  language: "typescript",
  embedding: Float32Array.from(vec),
});

describe("CosineCloneDetector", () => {
  const det = new CosineCloneDetector();

  it("returns no clusters when fewer than 2 entities have embeddings", async () => {
    expect(await det.detect({ entities: [] })).toEqual([]);
    expect(await det.detect({ entities: [e("a", [1, 0, 0])] })).toEqual([]);
  });

  it("clusters two near-identical entities", async () => {
    const out = await det.detect({
      entities: [e("a", [1, 0, 0]), e("b", [1, 0.01, 0])],
      threshold: 0.99,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("does not cluster orthogonal entities at any threshold", async () => {
    const out = await det.detect({
      entities: [e("a", [1, 0]), e("b", [0, 1])],
      threshold: 0.5,
    });
    expect(out).toEqual([]);
  });

  it("connects via transitive similarity (A↔B, B↔C → cluster {A,B,C})", async () => {
    const out = await det.detect({
      entities: [e("a", [1, 0, 0]), e("b", [0.95, 0.31, 0]), e("c", [0.85, 0.5, 0])],
      threshold: 0.92,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.members).toHaveLength(3);
  });

  it("threshold is monotone — higher threshold produces fewer clusters", async () => {
    const ents = [
      e("a", [1, 0, 0]),
      e("b", [0.95, 0.31, 0]),
      e("c", [0, 1, 0]),
      e("d", [0, 0.95, 0.31]),
    ];
    const loose = await det.detect({ entities: ents, threshold: 0.5 });
    const strict = await det.detect({ entities: ents, threshold: 0.99 });
    const looseCount = loose.reduce((n, c) => n + c.members.length, 0);
    const strictCount = strict.reduce((n, c) => n + c.members.length, 0);
    expect(strictCount).toBeLessThanOrEqual(looseCount);
  });

  it("respects maxClusterSize cap", async () => {
    const ents = Array.from({ length: 8 }, (_, i) =>
      e(`x${i}`, [1, i * 0.001, 0]),
    );
    const out = await det.detect({ entities: ents, threshold: 0.9, maxClusterSize: 3 });
    expect(out[0]!.members.length).toBe(3);
  });

  it("computes cohesion ∈ [threshold, 1]", async () => {
    const out = await det.detect({
      entities: [e("a", [1, 0, 0]), e("b", [1, 0.05, 0])],
      threshold: 0.9,
    });
    const c = out[0]!;
    expect(c.cohesion).toBeGreaterThanOrEqual(0.9);
    expect(c.cohesion).toBeLessThanOrEqual(1);
  });

  it("produces deterministic cluster ids (sorted member ids)", async () => {
    const a = await det.detect({
      entities: [e("a", [1, 0, 0]), e("b", [1, 0.01, 0])],
      threshold: 0.99,
    });
    const b = await det.detect({
      entities: [e("b", [1, 0.01, 0]), e("a", [1, 0, 0])],
      threshold: 0.99,
    });
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  it("ignores entities without embeddings", async () => {
    const noEmbed: Entity = {
      id: "no",
      kind: "function",
      name: "no",
      filePath: "no.ts",
      startLine: 1,
      endLine: 1,
      language: "typescript",
    };
    const out = await det.detect({
      entities: [e("a", [1, 0]), e("b", [1, 0.01]), noEmbed],
      threshold: 0.99,
    });
    expect(out[0]!.members.find((m) => m.id === "no")).toBeUndefined();
  });

  it("output is sorted by cluster size desc, then cohesion desc", async () => {
    const ents = [
      e("a1", [1, 0, 0]),
      e("a2", [1, 0.01, 0]),
      e("a3", [1, 0.02, 0]),
      e("b1", [0, 1, 0]),
      e("b2", [0, 1, 0.01]),
    ];
    const out = await det.detect({ entities: ents, threshold: 0.99 });
    expect(out).toHaveLength(2);
    expect(out[0]!.members.length).toBeGreaterThanOrEqual(out[1]!.members.length);
  });
});
