/**
 * v2.22.2 — MISSION RECORDER.
 *
 * Black-box for AI-agent decision flows. Every recorded event is:
 *   - Monotonically time-stamped (Lamport counter as fallback; NTP
 *     timestamps when caller supplies them)
 *   - HMAC-chain-linked (`prev` references the previous event's sig)
 *   - Causal-DAG-linked (`causedBy[]` references parent event IDs;
 *     forms a directed acyclic graph across logical chains)
 *   - Tamper-evident (chain verification surfaces broken indices)
 *
 * Replay engine: given a starting event ID, walk forward through the
 * causal DAG, returning the ordered chain. For verbs whose contract
 * is `read-only`, the replay engine can re-execute deterministically
 * (caller supplies the executor function).
 *
 * Composes with:
 *   - conductor (extends conductor receipts with causal links)
 *   - consent_fabric (events log as Consent Fabric receipts too)
 *   - overshoot_tracer (compares planned plan to recorded trace)
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/mission_recorder";
const LOG = "events.jsonl";
const KEY_FILE = "recorder.key";
const CLOCK_FILE = "lamport.json";

export interface MissionEvent {
  v: 1;
  /** Stable id. */
  id: string;
  /** ISO timestamp. */
  ts: string;
  /** Monotonic Lamport counter. */
  lamport: number;
  /** Optional NTP-anchored unix nanos. */
  ntpNanos?: string;
  /** Event kind. */
  kind: string;
  /** Optional verb / actor / surface. */
  verb?: string;
  actor?: string;
  /** Free-form metadata (already privacy-redacted by caller). */
  meta?: Record<string, unknown>;
  /** Parent event IDs this event was caused by. */
  causedBy: string[];
  /** Previous event sig in this file (chain). */
  prev: string;
  /** HMAC sig. */
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }
function clockPath(repoRoot: string): string { return join(dir(repoRoot), CLOCK_FILE); }

function readLamport(repoRoot: string): number {
  const p = clockPath(repoRoot);
  if (!existsSync(p)) return 0;
  try { return JSON.parse(readFileSync(p, "utf8")).c ?? 0; } catch { return 0; }
}

function writeLamport(repoRoot: string, c: number): void {
  writeFileSync(clockPath(repoRoot), JSON.stringify({ c }), "utf8");
}

export interface RecordOptions {
  kind: string;
  verb?: string;
  actor?: string;
  meta?: Record<string, unknown>;
  /** Parent event IDs (forms the causal DAG). */
  causedBy?: string[];
  /** Optional NTP anchor; format: unix nanoseconds as decimal string. */
  ntpNanos?: string;
}

/** Record one event. Monotonic via Lamport counter; HMAC-chained via
 *  `prev`; causal-DAG via `causedBy`. */
export function recordEvent(repoRoot: string, opts: RecordOptions): MissionEvent {
  const k = key(repoRoot);
  const all = listEvents(repoRoot);
  const lamport = Math.max(readLamport(repoRoot), all.length > 0 ? all[all.length - 1]!.lamport : 0) + 1;
  writeLamport(repoRoot, lamport);
  const ts = new Date().toISOString();
  const id = "ev_" + randomBytes(4).toString("hex");
  const causedBy = opts.causedBy ?? [];
  const prev = all.length > 0 ? all[all.length - 1]!.sig : "genesis";
  const metaJson = opts.meta ? JSON.stringify(opts.meta) : "";
  const canonical = `${ts}|${lamport}|${opts.kind}|${opts.verb ?? ""}|${opts.actor ?? ""}|${metaJson}|${causedBy.join(",")}|${prev}`;
  const sig = sign(canonical, k);
  const ev: MissionEvent = {
    v: 1, id, ts, lamport, kind: opts.kind, causedBy, prev, sig,
    ...(opts.verb ? { verb: opts.verb } : {}),
    ...(opts.actor ? { actor: opts.actor } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
    ...(opts.ntpNanos ? { ntpNanos: opts.ntpNanos } : {}),
  };
  appendFileSync(logPath(repoRoot), JSON.stringify(ev) + "\n", "utf8");
  return ev;
}

export function listEvents(repoRoot: string): MissionEvent[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as MissionEvent; } catch { return null; } }).filter((e): e is MissionEvent => !!e);
  } catch { return []; }
}

export function findEvent(repoRoot: string, id: string): MissionEvent | null {
  return listEvents(repoRoot).find((e) => e.id === id) ?? null;
}

/** Walk forward through the causal DAG from a starting event, returning
 *  the ordered chain (BFS). Each event is included at most once even
 *  if it has multiple predecessors. */
export function traceCausalChain(repoRoot: string, fromId: string, maxDepth = 32): MissionEvent[] {
  const all = listEvents(repoRoot);
  const byId = new Map(all.map((e) => [e.id, e]));
  const visited = new Set<string>();
  const out: MissionEvent[] = [];
  const seedById = new Map<string, string[]>(); // id → list of children
  for (const e of all) {
    for (const parent of e.causedBy) {
      if (!seedById.has(parent)) seedById.set(parent, []);
      seedById.get(parent)!.push(e.id);
    }
  }
  const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const ev = byId.get(id);
    if (!ev) continue;
    out.push(ev);
    if (depth >= maxDepth) continue;
    const children = seedById.get(id) ?? [];
    for (const c of children) queue.push({ id: c, depth: depth + 1 });
  }
  return out;
}

/** Verify the chain integrity end-to-end. Returns `{ok}` or first
 *  broken index + reason. */
export function verifyChain(repoRoot: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = listEvents(repoRoot);
  if (all.length === 0) return { ok: true };
  const k = key(repoRoot);
  let lastSig = "genesis";
  let lastLamport = 0;
  for (let i = 0; i < all.length; i++) {
    const e = all[i]!;
    if (e.prev !== lastSig) return { ok: false, brokenAt: i, reason: `event ${i} prev=${e.prev.slice(0, 8)} expected ${lastSig.slice(0, 8)}` };
    if (e.lamport <= lastLamport) return { ok: false, brokenAt: i, reason: `event ${i} lamport=${e.lamport} did not advance past ${lastLamport}` };
    const metaJson = e.meta ? JSON.stringify(e.meta) : "";
    const canonical = `${e.ts}|${e.lamport}|${e.kind}|${e.verb ?? ""}|${e.actor ?? ""}|${metaJson}|${e.causedBy.join(",")}|${e.prev}`;
    if (sign(canonical, k) !== e.sig) return { ok: false, brokenAt: i, reason: `event ${i} signature mismatch` };
    lastSig = e.sig;
    lastLamport = e.lamport;
  }
  return { ok: true };
}

/** Replay a causal chain by re-invoking the caller-supplied executor
 *  for each event in order. The executor receives the original event
 *  and may produce a synthetic outcome. Suitable only for verbs whose
 *  effects are deterministic from `meta`. Caller is responsible for
 *  enforcing that constraint. */
export interface ReplayOutcome {
  eventId: string;
  ok: boolean;
  detail?: string;
}

export type ReplayExecutor = (ev: MissionEvent) => Promise<{ ok: boolean; detail?: string }> | { ok: boolean; detail?: string };

export async function replayFrom(repoRoot: string, fromId: string, exec: ReplayExecutor): Promise<ReplayOutcome[]> {
  const chain = traceCausalChain(repoRoot, fromId);
  const out: ReplayOutcome[] = [];
  for (const ev of chain) {
    const r = await exec(ev);
    out.push({ eventId: ev.id, ok: r.ok, ...(r.detail ? { detail: r.detail } : {}) });
    if (!r.ok) break;
  }
  return out;
}

export function formatChain(events: MissionEvent[]): string {
  if (events.length === 0) return "🛰  MISSION RECORDER — empty chain";
  const lines = [`🛰  MISSION RECORDER — ${events.length} event(s)`, ""];
  for (const e of events) {
    const causes = e.causedBy.length > 0 ? `←${e.causedBy.map((c) => c.slice(-4)).join(",")}` : "";
    lines.push(`  L${e.lamport.toString().padStart(4)}  ${e.id}  ${e.kind.padEnd(20)} ${e.verb ?? ""}  ${causes}`);
  }
  return lines.join("\n");
}
