/**
 * v2.25.0 — Query API for LIVING SOUL codegraph.
 */

import type { CodeGraph, CodeEdge, CodeNode, QueryOptions, QueryResult } from "./types.js";

export function query(graph: CodeGraph, opts: QueryOptions): QueryResult {
  let nodes = [...graph.nodes.values()];
  let edges = [...graph.edges.values()];

  if (opts.kind) nodes = nodes.filter((n) => n.kind === opts.kind);
  if (opts.pathContains) {
    const p = opts.pathContains;
    nodes = nodes.filter((n) => n.path.includes(p));
  }
  if (opts.symbol) {
    const s = opts.symbol;
    nodes = nodes.filter((n) => (n.symbol ?? "").toLowerCase().includes(s.toLowerCase()));
  }
  if (opts.srcIds) {
    const set = new Set(opts.srcIds);
    edges = edges.filter((e) => set.has(e.src));
  }
  if (opts.dstIds) {
    const set = new Set(opts.dstIds);
    edges = edges.filter((e) => set.has(e.dst));
  }
  if (opts.edgeKinds) {
    const set = new Set(opts.edgeKinds);
    edges = edges.filter((e) => set.has(e.kind));
  }
  if (opts.warningsOnly) {
    edges = edges.filter((e) => e.vaccineWarning === true);
  }

  return { nodes, edges };
}

/** Find all incoming and outgoing edges for a node. */
export function neighbours(graph: CodeGraph, nodeId: string): { incoming: CodeEdge[]; outgoing: CodeEdge[]; node: CodeNode | null } {
  const node = graph.nodes.get(nodeId) ?? null;
  const incoming: CodeEdge[] = [];
  const outgoing: CodeEdge[] = [];
  for (const e of graph.edges.values()) {
    if (e.dst === nodeId) incoming.push(e);
    if (e.src === nodeId) outgoing.push(e);
  }
  return { node, incoming, outgoing };
}

/** Mark an edge as a vaccine warning (e.g. an AI hallucinated this edge). */
export function markVaccineWarning(graph: CodeGraph, edgeId: string, reason: string): boolean {
  const e = graph.edges.get(edgeId);
  if (!e) return false;
  e.vaccineWarning = true;
  e.warningReason = reason;
  return true;
}
