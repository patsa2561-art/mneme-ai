/**
 * v2.32.0 — Primitive liveness ledger.
 *
 * Every time an MCP tool fires (or the universal CLI router invokes
 * a primitive), the caller can push a heartbeat row to
 * .mneme/flywheel/primitive_ledger.jsonl. FLYWHEEL HARVEST reads this
 * to detect dormant primitives.
 *
 * v2.32.0 ships the ledger primitive + harvest reader; wiring every
 * MCP tool to auto-push a heartbeat is a v2.32.x enhancement to avoid
 * cross-package coupling in v1. For now, tests + manual probes push
 * heartbeats explicitly.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Heartbeat {
  name: string;
  at: string;
  shippedAt?: string;
}

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "flywheel");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function ledgerPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "primitive_ledger.jsonl");
}

export function heartbeat(repoRoot: string, name: string, shippedAt?: string): void {
  try {
    const row: Heartbeat = { name, at: new Date().toISOString() };
    if (shippedAt) row.shippedAt = shippedAt;
    appendFileSync(ledgerPath(repoRoot), JSON.stringify(row) + "\n", "utf8");
  } catch { /* best-effort */ }
}

export function readHeartbeats(repoRoot: string, limit = 10000): Heartbeat[] {
  const p = ledgerPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const body = readFileSync(p, "utf8");
    const out: Heartbeat[] = [];
    for (const ln of body.split("\n").filter(Boolean).slice(-limit)) {
      try { out.push(JSON.parse(ln) as Heartbeat); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** Last-seen per primitive name. */
export function lastSeenMap(repoRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of readHeartbeats(repoRoot)) {
    const cur = out.get(b.name);
    if (!cur || b.at > cur) out.set(b.name, b.at);
  }
  return out;
}

/**
 * Snapshot of every primitive currently registered (name +
 * sinceVersion). Caller supplies this — we keep the dependency
 * surface tiny by accepting a parameter (so flywheel doesn't have to
 * cross-import the agent_manifest catalog).
 */
export interface PrimitiveSnapshot {
  name: string;
  sinceVersion?: string;
}
