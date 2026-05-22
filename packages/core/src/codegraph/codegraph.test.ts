// v2.25.0 — LIVING SOUL CODEGRAPH unit tests.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildGraph, graphSignature, verifyChain, chainEdges,
  merkleRoot, leafHash, __EMPTY_ROOT_SENTINEL,
  query, neighbours, markVaccineWarning,
  detectDrift, edgesTouchedBy,
  writeSnapshot, readSnapshot,
} from "./index.js";
import type { CodeEdge } from "./types.js";

function mkTinyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-codegraph-test-"));
  // src/a.ts: imports ./b + ./external
  // src/b.ts: exports function foo
  // src/c.ts: imports ./b, calls foo (we won't extract call edges in v2.25.0; just imports)
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "a.ts"),
    `import { foo } from "./b.js";\nimport pkg from "some-external";\nexport function alpha() { return foo(); }\n`,
  );
  writeFileSync(
    join(dir, "src", "b.ts"),
    `export function foo() { return 1; }\nexport const X = 42;\nexport interface Bar { y: number }\n`,
  );
  writeFileSync(
    join(dir, "src", "c.ts"),
    `import { foo } from "./b.js";\nexport class Cee {}\n`,
  );
  return dir;
}

describe("codegraph — builder", () => {
  let repo: string;
  beforeEach(() => { repo = mkTinyRepo(); });

  it("builds the graph with expected node + edge counts", () => {
    const g = buildGraph(repo);
    // 3 file nodes + 1 external + symbols (alpha / foo / X / Bar / Cee = 5)
    expect(g.nodes.size).toBeGreaterThanOrEqual(8);
    // imports: a→b, a→external, c→b = 3 ; exports: alpha + foo + X + Bar + Cee = 5
    expect(g.edges.size).toBeGreaterThanOrEqual(8);
    expect(g.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(g.merkleRoot).not.toBe(__EMPTY_ROOT_SENTINEL);
  });

  it("merkle root is deterministic across rebuilds", () => {
    const a = buildGraph(repo);
    const b = buildGraph(repo);
    expect(a.merkleRoot).toBe(b.merkleRoot);
  });

  it("graphSignature is stable across rebuilds (same commit + edge set)", () => {
    const a = buildGraph(repo);
    const b = buildGraph(repo);
    expect(graphSignature(a)).toBe(graphSignature(b));
  });

  it("file edges reach the right symbols", () => {
    const g = buildGraph(repo);
    const exportEdges = [...g.edges.values()].filter((e) => e.kind === "exports");
    const symbols = exportEdges.map((e) => g.nodes.get(e.dst)?.symbol).filter(Boolean);
    expect(symbols).toEqual(expect.arrayContaining(["foo", "alpha", "X", "Bar", "Cee"]));
  });
});

describe("codegraph — HMAC chain", () => {
  it("verifyChain accepts a freshly-chained edge list", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const edges = [...g.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    const r = verifyChain(edges);
    expect(r.ok).toBe(true);
  });

  it("verifyChain detects a tampered edge", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const edges = [...g.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    // tamper: change confidence on the middle edge but DON'T re-chain
    const mid = Math.floor(edges.length / 2);
    edges[mid]!.confidence = 0.0001;
    const r = verifyChain(edges);
    expect(r.ok).toBe(false);
  });

  it("verifyChain detects an inserted edge", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const edges = [...g.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    const fake: CodeEdge = {
      id: "fake",
      src: "x",
      dst: "y",
      kind: "imports",
      confidence: 1,
      lastSeen: new Date().toISOString(),
      hmac: "deadbeef",
    };
    edges.splice(1, 0, fake);
    const r = verifyChain(edges);
    expect(r.ok).toBe(false);
  });
});

describe("codegraph — Merkle", () => {
  it("empty edge list returns the sentinel", () => {
    expect(merkleRoot([])).toBe(__EMPTY_ROOT_SENTINEL);
  });

  it("single edge yields a stable leaf hash", () => {
    const e: CodeEdge = {
      id: "abc",
      src: "x",
      dst: "y",
      kind: "imports",
      confidence: 1,
      lastSeen: "2026-05-22T00:00:00.000Z",
      hmac: "ignored-for-leaf",
    };
    const leaf = leafHash(e);
    expect(leaf).toMatch(/^[0-9a-f]{64}$/);
    // root over 1 edge = the leaf hash itself
    expect(merkleRoot([e])).toBe(leaf);
  });

  it("changing any edge field changes the root", () => {
    const repo = mkTinyRepo();
    const g1 = buildGraph(repo);
    const edges1 = [...g1.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edges2 = JSON.parse(JSON.stringify(edges1)) as CodeEdge[];
    edges2[0]!.kind = "calls" as never; // mutate
    chainEdges(edges2); // re-chain
    expect(merkleRoot(edges1)).not.toBe(merkleRoot(edges2));
  });
});

describe("codegraph — query", () => {
  it("filters nodes by kind", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const r = query(g, { kind: "function" });
    expect(r.nodes.every((n) => n.kind === "function")).toBe(true);
    expect(r.nodes.length).toBeGreaterThan(0);
  });

  it("filters edges by warningsOnly", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const first = [...g.edges.values()][0]!;
    markVaccineWarning(g, first.id, "hallucinated by AI X");
    const r = query(g, { warningsOnly: true });
    expect(r.edges.length).toBe(1);
    expect(r.edges[0]!.vaccineWarning).toBe(true);
  });

  it("neighbours returns incoming + outgoing", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const fileB = [...g.nodes.values()].find((n) => n.kind === "file" && n.path.endsWith("b.ts"))!;
    const nb = neighbours(g, fileB.id);
    expect(nb.node?.id).toBe(fileB.id);
    // b.ts has 2 incoming imports (from a + c) and 3 outgoing exports (foo, X, Bar)
    expect(nb.incoming.length).toBeGreaterThanOrEqual(2);
    expect(nb.outgoing.length).toBeGreaterThanOrEqual(3);
  });
});

describe("codegraph — drift", () => {
  it("reports zero drift on a freshly-built graph", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const d = detectDrift(g);
    expect(d.events.length).toBe(0);
    expect(d.brokenEdges).toBe(0);
  });

  it("detects drift when a file is deleted", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    rmSync(join(repo, "src", "b.ts"));
    const d = detectDrift(g);
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.brokenEdges).toBeGreaterThan(0);
    // The b.ts deletion breaks: a → b imports, c → b imports, and exports edges from b
    expect(d.missingFiles).toBeGreaterThanOrEqual(1);
  });

  it("edgesTouchedBy returns edges that involve the changed paths", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    const touched = edgesTouchedBy(g, ["src/b.ts"]);
    // src/b.ts is imported by a + c, AND has 3 export edges → ≥ 5 edges
    expect(touched.length).toBeGreaterThanOrEqual(5);
  });
});

describe("codegraph — snapshot round-trip", () => {
  it("writes and reads back the same graph", () => {
    const repo = mkTinyRepo();
    const g = buildGraph(repo);
    writeSnapshot(repo, g);
    const re = readSnapshot(repo);
    expect(re).not.toBeNull();
    expect(re!.merkleRoot).toBe(g.merkleRoot);
    expect(re!.nodes.size).toBe(g.nodes.size);
    expect(re!.edges.size).toBe(g.edges.size);
    expect(re!.commit).toBe(g.commit);
  });
});
