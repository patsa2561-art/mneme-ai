/**
 * v2.25.0 — Merkle root over the LIVING SOUL codegraph.
 *
 * Why: CodeGraph (the competitor) requires full re-index per machine.
 * Mneme stores each edge with an HMAC link, then builds a Merkle tree
 * over the canonical edge list. Two machines compare their root (32
 * bytes); identical → graphs match without transmitting the full graph.
 * Different → drill down via tree level until you find the divergent
 * subtree. Cross-machine sync cost ≈ O(log N) instead of O(N).
 *
 * The tree is binary; leaves are SHA-256 of canonical edge JSON; inner
 * nodes are SHA-256 of left || right concatenated. Empty graphs return
 * a fixed sentinel hash.
 */

import { createHash } from "node:crypto";
import type { CodeEdge } from "./types.js";
import { canon } from "./types.js";

const EMPTY_ROOT = "e".repeat(64);

function sha(buf: string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Leaf hash for one edge (canonical JSON, sha256).
 *
 * Strips:
 *   - hmac      — chain-position; varies per-position even with same content
 *   - lastSeen  — wall-clock; varies across rebuilds of same structure
 *
 * So the leaf hash represents the STRUCTURAL identity of the edge
 * (src, dst, kind, confidence, vendor attribution, vaccine warnings) —
 * not the snapshot timestamp. This makes the Merkle root deterministic
 * across rebuilds (and across machines for the same commit). */
export function leafHash(edge: CodeEdge): string {
  const { hmac: _h, lastSeen: _t, ...stable } = edge;
  void _h; void _t;
  return sha(canon(stable));
}

/** Compute the Merkle root over a sorted edge list. */
export function merkleRoot(edges: CodeEdge[]): string {
  if (edges.length === 0) return EMPTY_ROOT;
  // Sort by id for deterministic ordering across machines.
  const sorted = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  let layer = sorted.map(leafHash);
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left; // duplicate last for odd count
      next.push(sha(left + right));
    }
    layer = next;
  }
  return layer[0]!;
}

/**
 * Compare two Merkle roots. Identical roots = identical edge sets.
 * Different roots = at least one edge differs.
 *
 * For partial-sync diagnostics, callers can drill into subtrees by
 * exchanging the layer-1 hashes; this primitive returns the top-level
 * verdict only.
 */
export function rootsMatch(a: string, b: string): boolean {
  return a === b && a !== EMPTY_ROOT;
}

/** Test-only sentinel. */
export const __EMPTY_ROOT_SENTINEL = EMPTY_ROOT;
