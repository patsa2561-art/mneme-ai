/**
 * v2.25.0 — LIVING SOUL CODEGRAPH.
 *
 * What this is: a code graph (file dependencies + symbol references)
 * with 8 differentiation primitives the competitor (CodeGraph by
 * colbymchenry, v0.8.0) does not ship:
 *
 *   1. HMAC-chained provenance per edge (every edge cryptographically
 *      attested; tamper-evident across machines).
 *   2. Drift sentinel — daemon-hooked watcher emits a notification
 *      within ~200ms when a tracked file changes that would break an
 *      edge (e.g. function renamed, file deleted, import moved).
 *   3. Time-travel — graph state queryable at any git commit; supports
 *      "when was this edge first introduced?".
 *   4. Vendor attribution — every edge carries `touchedBy` (which AI
 *      vendor or human created/modified it) for cross-vendor audit.
 *   5. Hallucination vaccine — edges that an AI hallucinated (later
 *      proven wrong) get a permanent warning marker so future LLMs see
 *      "do not propose this edge again".
 *   6. Merkle root — every state of the graph has a Merkle root. Cross-
 *      machine sync = compare roots, fetch only the differences.
 *   7. MCP-CANDOR export — vendor-neutral graph schema; any MCP server
 *      can consume Mneme's graph.
 *   8. DREAMSPACE proposals — daemon nightly cycle proposes new edges
 *      based on co-change history (files X and Y always change together).
 *
 * Positioning: "CodeGraph maps your code. Mneme's LIVING SOUL knows
 * who touched it, when, why, and refuses to lie about what's there."
 */

import type { Severity } from "../mcp_fuzzer/types.js";

export type NodeKind =
  | "file"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "module"
  | "constant"
  | "external";  // npm dep, builtin, etc

export type EdgeKind =
  | "imports"          // file → file or file → external
  | "exports"          // module → symbol
  | "calls"            // function → function
  | "references"       // any → symbol
  | "extends"          // class → class
  | "implements"       // class → interface
  | "tests"            // test-file → tested-file
  | "co-changes";      // statistical: A and B always change together

export interface CodeNode {
  /** Stable id: `<kind>:<sha256(canonical)>:<short-name>`. */
  id: string;
  kind: NodeKind;
  /** File path relative to repoRoot (forward-slash). */
  path: string;
  /** Symbol name (function name / class name / etc); empty for files. */
  symbol?: string;
  /** Line where the symbol is declared (1-based). */
  line?: number;
  /** Detected language / file extension. */
  lang?: string;
}

export interface CodeEdge {
  /** Stable id: `<sha256(src+dst+kind)>`. */
  id: string;
  src: string;          // CodeNode.id
  dst: string;          // CodeNode.id
  kind: EdgeKind;
  /** Confidence in [0,1]. AST evidence = 1.0; statistical = lower. */
  confidence: number;
  /** ISO timestamp when this edge was last observed. */
  lastSeen: string;
  /** Vendor / human who created or last touched the edge. */
  touchedBy?: string;
  /** Commit at which this edge was first observed. */
  firstSeenCommit?: string;
  /** When true, this edge was hallucinated by an AI and later refuted. */
  vaccineWarning?: boolean;
  /** Optional explanation string for the warning. */
  warningReason?: string;
  /** HMAC link — chains every edge into a tamper-evident ledger. */
  hmac: string;
}

export interface CodeGraph {
  /** Repo root the graph was built against. */
  repoRoot: string;
  /** Commit SHA the graph reflects (or 'WORKING-TREE' if uncommitted). */
  commit: string;
  /** ISO timestamp when this graph was assembled. */
  builtAt: string;
  /** Nodes by id. */
  nodes: Map<string, CodeNode>;
  /** Edges by id. */
  edges: Map<string, CodeEdge>;
  /** Merkle root over the canonical edge list. */
  merkleRoot: string;
  /** Number of nodes + edges (denormalised for quick UI). */
  stats: { nodes: number; edges: number; byKind: Record<string, number> };
}

export interface DriftEvent {
  /** ISO timestamp of detection. */
  at: string;
  /** Edge id that drifted. */
  edgeId: string;
  /** What changed. */
  kind: "src-missing" | "dst-missing" | "src-renamed" | "dst-renamed" | "file-deleted" | "edge-stale";
  /** Optional human-readable reason. */
  reason: string;
  /** Severity to drive notifier urgency. */
  severity: Severity;
}

export interface ProposeEdge {
  src: string;
  dst: string;
  kind: EdgeKind;
  /** Evidence supporting the proposal (co-change count, similarity, etc). */
  evidenceScore: number;
  /** Why this edge is proposed. */
  rationale: string;
}

export interface BuildOptions {
  /** Restrict scan to these globs. */
  include?: string[];
  /** Skip these globs. */
  exclude?: string[];
  /** Max bytes per file (skip larger). */
  maxBytes?: number;
  /** Override the vendor attribution. Defaults to "mneme-daemon". */
  touchedBy?: string;
}

export interface QueryOptions {
  /** Return nodes by kind. */
  kind?: NodeKind;
  /** Return nodes whose path contains. */
  pathContains?: string;
  /** Return nodes whose symbol matches. */
  symbol?: string;
  /** Return edges where src is one of these. */
  srcIds?: string[];
  /** Return edges where dst is one of these. */
  dstIds?: string[];
  /** Return edges of these kinds. */
  edgeKinds?: EdgeKind[];
  /** Show only edges with vaccine warning. */
  warningsOnly?: boolean;
}

export interface QueryResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

/** Canonical (deterministic) JSON serialization. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
