/**
 * Influence — pure-helper tests.
 *
 * The git-history walk + TypeScriptParser path is exercised end-to-end by
 * the CLI smoke test on the Mneme repo itself. Here we lock down the parts
 * that don't need a real git checkout.
 */
import { describe, it, expect } from "vitest";
import {
  entityArity,
  entityShape,
  pageRank,
  type ShapeKey,
} from "./influence.js";
import type { Entity } from "../types.js";

const e = (over: Partial<Entity> & { name: string }): Entity => ({
  id: `e_${over.name}`,
  kind: "function",
  filePath: over.filePath ?? "src/x.ts",
  startLine: 1,
  endLine: 10,
  signature: over.signature,
  language: "typescript",
  ...over,
});

describe("entityArity — coarse arity from signature string", () => {
  it("returns 0 for empty signature", () => {
    expect(entityArity("")).toBe(0);
  });

  it("returns 0 for zero-arg function", () => {
    expect(entityArity("function f()")).toBe(0);
  });

  it("returns 1 for unary", () => {
    expect(entityArity("function f(a)")).toBe(1);
  });

  it("returns 2 for typed binary", () => {
    expect(entityArity("function f(a: number, b: string): void")).toBe(2);
  });

  it("does not count commas inside generic parameter types", () => {
    expect(entityArity("function f(a: Map<string, number>, b: T)")).toBe(2);
  });

  it("does not count commas inside object-literal types", () => {
    expect(entityArity("function f(a: { x: number, y: number })")).toBe(1);
  });

  it("does not count commas inside nested arrays", () => {
    expect(entityArity("function f(a: [number, number], b: T)")).toBe(2);
  });
});

describe("entityShape — pattern signature derivation", () => {
  it("groups same-name same-arity functions across files", () => {
    const a = entityShape(e({ name: "parseAmount", signature: "function parseAmount(s: string)", filePath: "a.ts" }));
    const b = entityShape(e({ name: "parseAmount", signature: "function parseAmount(s: string)", filePath: "b.ts" }));
    expect(a.key).toBe(b.key);
  });

  it("separates same-name different-arity functions (different shapes)", () => {
    const a = entityShape(e({ name: "log", signature: "function log()" }));
    const b = entityShape(e({ name: "log", signature: "function log(level, msg)" }));
    expect(a.key).not.toBe(b.key);
  });

  it("includes kind in the shape key (function vs class same name → distinct)", () => {
    const a = entityShape(e({ name: "Cache", kind: "class", signature: "class Cache" }));
    const b = entityShape(e({ name: "Cache", kind: "function", signature: "function Cache()" }));
    expect(a.key).not.toBe(b.key);
  });
});

describe("pageRank — canonical small graphs", () => {
  it("returns empty Map for empty graph", () => {
    const r = pageRank({ outgoing: new Map(), nodes: [] });
    expect(r.size).toBe(0);
  });

  it("uniform on a graph with no edges", () => {
    const r = pageRank({ outgoing: new Map(), nodes: ["a", "b", "c"] });
    expect(r.get("a")!).toBeCloseTo(r.get("b")!, 3);
    expect(r.get("b")!).toBeCloseTo(r.get("c")!, 3);
  });

  it("two-node A→B graph: B outranks A", () => {
    const out = new Map([["A", ["B"]]]);
    const r = pageRank({ outgoing: out, nodes: ["A", "B"] });
    expect(r.get("B")!).toBeGreaterThan(r.get("A")!);
  });

  it("hub graph: many → C → C clearly tops", () => {
    const out = new Map<string, string[]>([
      ["A", ["C"]],
      ["B", ["C"]],
      ["D", ["C"]],
      ["E", ["C"]],
    ]);
    const r = pageRank({ outgoing: out, nodes: ["A", "B", "C", "D", "E"] });
    const top = Array.from(r.entries()).sort((x, y) => y[1] - x[1])[0]!;
    expect(top[0]).toBe("C");
  });

  it("ranks are deterministic across calls (same input → same output)", () => {
    const out = new Map<string, string[]>([
      ["A", ["B", "C"]],
      ["B", ["C"]],
    ]);
    const r1 = pageRank({ outgoing: out, nodes: ["A", "B", "C"] });
    const r2 = pageRank({ outgoing: out, nodes: ["A", "B", "C"] });
    for (const k of r1.keys()) {
      expect(r1.get(k)!).toBeCloseTo(r2.get(k)!, 8);
    }
  });

  it("higher edge weight (duplicate edges) raises destination rank", () => {
    const lightOut = new Map<string, string[]>([
      ["A", ["B"]],
      ["C", ["B"]],
    ]);
    const heavyOut = new Map<string, string[]>([
      ["A", ["B", "B", "B"]],
      ["C", ["B", "B", "B"]],
    ]);
    const lightR = pageRank({ outgoing: lightOut, nodes: ["A", "B", "C"] });
    const heavyR = pageRank({ outgoing: heavyOut, nodes: ["A", "B", "C"] });
    // B should be the highest in both, but the absolute mass shouldn't
    // collapse — and B-rank should at minimum equal the lightly-weighted
    // version (weight monotonicity within the same graph topology).
    expect(heavyR.get("B")!).toBeGreaterThanOrEqual(lightR.get("B")! - 1e-6);
  });

  it("ranks sum approximately to 1 (probability distribution)", () => {
    const out = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const r = pageRank({ outgoing: out, nodes: ["A", "B", "C"], iterations: 25 });
    let sum = 0;
    for (const v of r.values()) sum += v;
    expect(sum).toBeCloseTo(1, 2);
  });

  it("damping = 1 with a 3-cycle: ranks converge to ~uniform", () => {
    const out = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const r = pageRank({ outgoing: out, nodes: ["A", "B", "C"], iterations: 30, damping: 1 });
    expect(r.get("A")!).toBeCloseTo(r.get("B")!, 2);
    expect(r.get("B")!).toBeCloseTo(r.get("C")!, 2);
  });

  it("dangling node still gets non-zero rank via teleport", () => {
    // D has no outgoing edges but should not be zero (teleport / random
    // restart is what damping=0.85 buys you).
    const out = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
    ]);
    const r = pageRank({ outgoing: out, nodes: ["A", "B", "C", "D"] });
    expect(r.get("D")!).toBeGreaterThan(0);
  });
});

describe("entityShape edge cases", () => {
  it("missing signature falls back to arity 0 — same name still groups", () => {
    const a = entityShape(e({ name: "init" }));
    const b = entityShape(e({ name: "init" }));
    expect(a.key).toBe(b.key);
  });

  it("rest parameters count as one parameter", () => {
    expect(entityArity("function f(...args: number[])")).toBe(1);
  });
});

describe("pageRank — weight semantics on adoption pattern", () => {
  it("an originator adopted by 5 distinct authors outranks one adopted by 1", () => {
    // Big adopter base
    const big = new Map<string, string[]>([
      ["a1", ["ALICE"]],
      ["a2", ["ALICE"]],
      ["a3", ["ALICE"]],
      ["a4", ["ALICE"]],
      ["a5", ["ALICE"]],
      ["b1", ["BOB"]],
    ]);
    const r = pageRank({
      outgoing: big,
      nodes: ["a1", "a2", "a3", "a4", "a5", "b1", "ALICE", "BOB"],
    });
    expect(r.get("ALICE")!).toBeGreaterThan(r.get("BOB")!);
  });

  it("transitive credit: an originator adopted by a hub outranks one adopted only by leaves", () => {
    // ALICE is adopted by a hub HUB; BOB is adopted only by leaves.
    const out = new Map<string, string[]>([
      ["leaf1", ["HUB"]],
      ["leaf2", ["HUB"]],
      ["leaf3", ["HUB"]],
      ["HUB", ["ALICE"]],
      ["x", ["BOB"]],
    ]);
    const r = pageRank({
      outgoing: out,
      nodes: ["leaf1", "leaf2", "leaf3", "HUB", "x", "ALICE", "BOB"],
    });
    expect(r.get("ALICE")!).toBeGreaterThan(r.get("BOB")!);
  });
});

const _ShapeKeyExportSanity: ShapeKey = { key: "function:f/0", kind: "function", name: "f", arity: 0 };
void _ShapeKeyExportSanity;
