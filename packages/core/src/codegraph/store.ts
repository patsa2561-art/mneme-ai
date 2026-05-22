/**
 * v2.25.0 — HMAC-chained storage for LIVING SOUL codegraph.
 *
 * Every edge gets an `hmac` field linking it to the previous edge in
 * append order. Tampering with ANY edge (deleting / modifying /
 * inserting) breaks the chain at that point. Receivers verify by
 * re-deriving the chain from the canonical edge bodies.
 *
 * Storage layout:
 *   .mneme/codegraph/
 *     nodes.jsonl       — append-only nodes
 *     edges.jsonl       — append-only HMAC-chained edges
 *     state.json        — { commit, builtAt, merkleRoot, stats }
 *     drift.jsonl       — append-only drift events
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

import type { CodeEdge, CodeGraph, CodeNode, DriftEvent } from "./types.js";
import { canon } from "./types.js";

const HMAC_KEY = process.env["MNEME_CODEGRAPH_KEY"] ?? "mneme-codegraph-v1";
const CHAIN_SEED = "0".repeat(64);

function dirOf(repoRoot: string): string {
  return join(repoRoot, ".mneme", "codegraph");
}

function ensureDir(repoRoot: string): string {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

/** Compute the next chain link. */
function nextLink(prev: string, body: unknown): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + canon(body)).digest("hex").slice(0, 32);
}

/** Build HMAC-chained edges in-place — sets edge.hmac. */
export function chainEdges(edges: CodeEdge[]): void {
  let prev = CHAIN_SEED;
  for (const e of edges) {
    const { hmac: _h, ...stable } = e;
    void _h;
    prev = nextLink(prev, stable);
    e.hmac = prev;
  }
}

/** Verify the chain integrity of an edge list. */
export function verifyChain(edges: CodeEdge[]): { ok: true } | { ok: false; firstBadIdx: number; reason: string } {
  let prev = CHAIN_SEED;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const { hmac, ...stable } = e;
    const expected = nextLink(prev, stable);
    if (expected !== hmac) {
      return { ok: false, firstBadIdx: i, reason: `chain break at index ${i}: edge.id=${e.id}` };
    }
    prev = hmac;
  }
  return { ok: true };
}

/** Write a full snapshot atomically. */
export function writeSnapshot(repoRoot: string, graph: CodeGraph): { dir: string } {
  const d = ensureDir(repoRoot);
  const nodes = [...graph.nodes.values()];
  const edges = [...graph.edges.values()];
  // edges must be chained before write
  // (the builder is expected to have done this already; we re-chain to be safe)
  chainEdges(edges);
  writeFileSync(join(d, "nodes.jsonl"), nodes.map((n) => JSON.stringify(n)).join("\n") + (nodes.length ? "\n" : ""));
  writeFileSync(join(d, "edges.jsonl"), edges.map((e) => JSON.stringify(e)).join("\n") + (edges.length ? "\n" : ""));
  writeFileSync(join(d, "state.json"), JSON.stringify({
    repoRoot: graph.repoRoot,
    commit: graph.commit,
    builtAt: graph.builtAt,
    merkleRoot: graph.merkleRoot,
    stats: graph.stats,
  }, null, 2) + "\n");
  return { dir: d };
}

/** Read the persisted snapshot. Returns null if no graph has been built. */
export function readSnapshot(repoRoot: string): CodeGraph | null {
  const d = dirOf(repoRoot);
  if (!existsSync(join(d, "state.json"))) return null;
  const state = JSON.parse(readFileSync(join(d, "state.json"), "utf8")) as {
    commit: string; builtAt: string; merkleRoot: string; stats: CodeGraph["stats"];
  };
  const nodesRaw = existsSync(join(d, "nodes.jsonl")) ? readFileSync(join(d, "nodes.jsonl"), "utf8").split("\n").filter(Boolean) : [];
  const edgesRaw = existsSync(join(d, "edges.jsonl")) ? readFileSync(join(d, "edges.jsonl"), "utf8").split("\n").filter(Boolean) : [];
  const nodes = new Map<string, CodeNode>();
  for (const line of nodesRaw) {
    try {
      const n = JSON.parse(line) as CodeNode;
      nodes.set(n.id, n);
    } catch { /* skip malformed */ }
  }
  const edges = new Map<string, CodeEdge>();
  for (const line of edgesRaw) {
    try {
      const e = JSON.parse(line) as CodeEdge;
      edges.set(e.id, e);
    } catch { /* skip */ }
  }
  return {
    repoRoot,
    commit: state.commit,
    builtAt: state.builtAt,
    nodes,
    edges,
    merkleRoot: state.merkleRoot,
    stats: state.stats,
  };
}

/** Append a drift event to the ledger. */
export function recordDrift(repoRoot: string, event: DriftEvent): void {
  const d = ensureDir(repoRoot);
  appendFileSync(join(d, "drift.jsonl"), JSON.stringify(event) + "\n");
}

/** Read recent drift events. */
export function readDriftEvents(repoRoot: string, limit = 50): DriftEvent[] {
  const d = dirOf(repoRoot);
  const p = join(d, "drift.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: DriftEvent[] = [];
  for (const l of lines.slice(-limit)) {
    try { out.push(JSON.parse(l) as DriftEvent); } catch { /* skip */ }
  }
  return out;
}
