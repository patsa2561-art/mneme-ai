/**
 * v2.25.0 — Drift sentinel for LIVING SOUL codegraph.
 *
 * Compares the persisted snapshot against the current working tree and
 * emits one DriftEvent per broken edge:
 *   - file deleted (src or dst missing)
 *   - file renamed (symbol moved to another path)
 *   - edge stale (file mtime > builtAt by > N hours)
 *
 * Pure-IO; no daemon required. The daemon can call this on every tick
 * + fan-out severity ≥ "high" events to the notifier so the user gets
 * a heads-up before the AI starts editing the wrong file.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { CodeGraph, DriftEvent, CodeEdge } from "./types.js";
import { recordDrift } from "./store.js";

const STALE_HOURS = 24;

export interface DriftSummary {
  events: DriftEvent[];
  brokenEdges: number;
  staleEdges: number;
  missingFiles: number;
}

/** Scan the graph against the current working tree. */
export function detectDrift(graph: CodeGraph, opts: { record?: boolean } = {}): DriftSummary {
  const events: DriftEvent[] = [];
  const now = Date.now();
  const builtAtMs = Date.parse(graph.builtAt);
  const staleThreshold = STALE_HOURS * 3600 * 1000;

  // Cache file existence + mtime
  const fileMeta = new Map<string, { exists: boolean; mtime: number }>();
  function fileOf(path: string) {
    let m = fileMeta.get(path);
    if (m) return m;
    const abs = resolve(graph.repoRoot, path);
    if (!existsSync(abs)) {
      m = { exists: false, mtime: 0 };
    } else {
      try {
        const st = statSync(abs);
        m = { exists: true, mtime: st.mtimeMs };
      } catch { m = { exists: false, mtime: 0 }; }
    }
    fileMeta.set(path, m);
    return m;
  }

  let brokenEdges = 0;
  let staleEdges = 0;
  let missingFiles = 0;
  const missingPathSet = new Set<string>();

  for (const edge of graph.edges.values()) {
    const src = graph.nodes.get(edge.src);
    const dst = graph.nodes.get(edge.dst);
    if (!src || !dst) continue;

    // Skip edges to external deps; we can't trivially check existence.
    if (dst.kind !== "external") {
      const dstMeta = fileOf(dst.path);
      if (!dstMeta.exists) {
        brokenEdges++;
        if (!missingPathSet.has(dst.path)) { missingFiles++; missingPathSet.add(dst.path); }
        const ev: DriftEvent = {
          at: new Date().toISOString(),
          edgeId: edge.id,
          kind: edge.kind === "imports" ? "dst-missing" : "file-deleted",
          reason: `dst file ${dst.path} no longer exists (edge.kind=${edge.kind})`,
          severity: edge.kind === "imports" ? "high" : "medium",
        };
        events.push(ev);
        continue;
      }
    }
    const srcMeta = fileOf(src.path);
    if (!srcMeta.exists) {
      brokenEdges++;
      if (!missingPathSet.has(src.path)) { missingFiles++; missingPathSet.add(src.path); }
      events.push({
        at: new Date().toISOString(),
        edgeId: edge.id,
        kind: "src-missing",
        reason: `src file ${src.path} no longer exists`,
        severity: "high",
      });
      continue;
    }
    // Edge-stale check (only flag if mtime > builtAt by > 24h)
    if (now - builtAtMs > staleThreshold && srcMeta.mtime > builtAtMs + staleThreshold) {
      staleEdges++;
      events.push({
        at: new Date().toISOString(),
        edgeId: edge.id,
        kind: "edge-stale",
        reason: `src file ${src.path} changed > ${STALE_HOURS}h after graph was built`,
        severity: "low",
      });
    }
  }

  if (opts.record) {
    for (const ev of events) recordDrift(graph.repoRoot, ev);
  }

  return { events, brokenEdges, staleEdges, missingFiles };
}

/** Filter edges that would BREAK if a file is renamed/deleted. */
export function edgesTouchedBy(graph: CodeGraph, paths: string[]): CodeEdge[] {
  const pathSet = new Set(paths.map((p) => p.replace(/\\/g, "/")));
  const out: CodeEdge[] = [];
  for (const e of graph.edges.values()) {
    const s = graph.nodes.get(e.src);
    const d = graph.nodes.get(e.dst);
    if (s && pathSet.has(s.path)) { out.push(e); continue; }
    if (d && pathSet.has(d.path)) { out.push(e); }
  }
  return out;
}
