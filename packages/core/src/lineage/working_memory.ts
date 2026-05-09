/**
 * Working memory — accumulates atom invocations + outcomes during a live
 * session. Aggregated into a chromosome at session end.
 *
 * The MCP layer feeds this in real-time via record* helpers. The aggregate
 * lives in memory (process-local) plus an append-only mirror at
 * `.mneme/lineage/working/<sessionId>.jsonl` for crash recovery.
 *
 * Performance budget:
 *   - record* helpers must be < 50µs amortized (called per tool dispatch)
 *   - flushToDisk every N records (default 25) to bound disk I/O
 *   - on session end, summarize() returns a complete in-memory aggregate
 *     in O(records) — no disk re-read
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AtomKarmaDelta, MoleculeRecord, CourtVerdictRecord } from "./types.js";

interface ConfessRecord {
  vendor: string;
  verdict: "verified" | "partially_verified" | "hallucination" | "unverifiable";
  selfConfidence: number;
  hadHallucination: boolean;
}

interface WorkingMemorySnapshot {
  sessionId: string;
  startedAt: string;
  vendor: string;
  machineId: string;
  totalCalls: number;
  /** tool name → karma delta + counters */
  atoms: Map<string, AtomKarmaDelta>;
  /** Pairs of atoms that fired in adjacent dispatches (Hebbian co-fire). */
  coFires: Map<string, number>;
  /** Captured court verdicts. */
  courtVerdicts: CourtVerdictRecord[];
  /** Captured confess outcomes. */
  confessRecords: ConfessRecord[];
  /** Free-text topics extracted from queries / responses. */
  topicCounts: Map<string, number>;
  /** Tools that confess marked as hallucination — culled from inheritance. */
  lethalRecessives: Set<string>;
  /** Recent atom history for Hebbian pairing. */
  recentAtoms: string[];
}

/** Per-process singleton — one MCP server = one session = one snapshot. */
let snapshot: WorkingMemorySnapshot | null = null;

const FLUSH_BATCH = 25;
let pendingFlushCount = 0;

function ensureSnapshot(opts: { sessionId: string; vendor: string; machineId: string }): WorkingMemorySnapshot {
  if (snapshot) return snapshot;
  snapshot = {
    sessionId: opts.sessionId,
    startedAt: new Date().toISOString(),
    vendor: opts.vendor,
    machineId: opts.machineId,
    totalCalls: 0,
    atoms: new Map(),
    coFires: new Map(),
    courtVerdicts: [],
    confessRecords: [],
    topicCounts: new Map(),
    lethalRecessives: new Set(),
    recentAtoms: [],
  };
  return snapshot;
}

/** Bootstrap working memory for a new session. Called once at MCP boot. */
export function startSession(opts: { sessionId: string; vendor: string; machineId: string }): void {
  snapshot = null; // reset
  ensureSnapshot(opts);
}

/** Read the active snapshot (or null if not started). */
export function getSnapshot(): WorkingMemorySnapshot | null {
  return snapshot;
}

// ─── Recording helpers ────────────────────────────────────────────────

/** Record one tool dispatch. Updates atom counter + Hebbian co-fire pair. */
export function recordAtom(repoRoot: string, tool: string, _args: unknown): void {
  if (!snapshot) return;
  const a = snapshot.atoms.get(tool) ?? { karma: 0, invocations: 0, verified: 0, hallucinations: 0 };
  a.invocations += 1;
  snapshot.atoms.set(tool, a);
  snapshot.totalCalls += 1;

  // Hebbian co-fire: pair the new atom with the most recent one.
  const prev = snapshot.recentAtoms[snapshot.recentAtoms.length - 1];
  if (prev && prev !== tool) {
    const pair = [prev, tool].sort().join("|");
    snapshot.coFires.set(pair, (snapshot.coFires.get(pair) ?? 0) + 1);
  }
  snapshot.recentAtoms.push(tool);
  if (snapshot.recentAtoms.length > 50) snapshot.recentAtoms.shift();

  maybeFlush(repoRoot);
}

/** Record a karma delta — typically from confess outcomes or fuzz hits.
 *  Mirrors mneme.aletheia.karma but local to the session. */
export function recordKarmaDelta(tool: string, delta: number): void {
  if (!snapshot) return;
  const a = snapshot.atoms.get(tool) ?? { karma: 0, invocations: 0, verified: 0, hallucinations: 0 };
  a.karma += delta;
  snapshot.atoms.set(tool, a);
}

export function recordConfess(opts: ConfessRecord, tool?: string): void {
  if (!snapshot) return;
  snapshot.confessRecords.push(opts);
  if (opts.verdict === "verified" && tool) {
    const a = snapshot.atoms.get(tool) ?? { karma: 0, invocations: 0, verified: 0, hallucinations: 0 };
    a.verified += 1;
    snapshot.atoms.set(tool, a);
  } else if (opts.verdict === "hallucination" && tool) {
    const a = snapshot.atoms.get(tool) ?? { karma: 0, invocations: 0, verified: 0, hallucinations: 0 };
    a.hallucinations += 1;
    snapshot.atoms.set(tool, a);
    snapshot.lethalRecessives.add(tool);
  }
}

export function recordCourtVerdict(v: CourtVerdictRecord): void {
  if (!snapshot) return;
  snapshot.courtVerdicts.push(v);
}

export function recordTopic(topic: string): void {
  if (!snapshot || !topic.trim()) return;
  const t = topic.trim().slice(0, 60).toLowerCase();
  snapshot.topicCounts.set(t, (snapshot.topicCounts.get(t) ?? 0) + 1);
}

// ─── Disk mirror (crash recovery) ─────────────────────────────────────

function workingDir(repoRoot: string): string {
  return join(repoRoot, ".mneme/lineage/working");
}

function workingPath(repoRoot: string, sessionId: string): string {
  return join(workingDir(repoRoot), `${sessionId}.jsonl`);
}

function maybeFlush(repoRoot: string): void {
  pendingFlushCount += 1;
  if (pendingFlushCount < FLUSH_BATCH) return;
  pendingFlushCount = 0;
  flushToDisk(repoRoot);
}

/** Flush the snapshot summary to disk so a crashed process can recover. */
export function flushToDisk(repoRoot: string): void {
  if (!snapshot) return;
  try {
    const dir = workingDir(repoRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const summary = {
      ts: new Date().toISOString(),
      totalCalls: snapshot.totalCalls,
      atoms: Object.fromEntries(snapshot.atoms),
      topAtoms: [...snapshot.atoms.entries()]
        .sort((a, b) => b[1].invocations - a[1].invocations)
        .slice(0, 10)
        .map(([n]) => n),
    };
    appendFileSync(workingPath(repoRoot, snapshot.sessionId), JSON.stringify(summary) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

/** List orphan working sessions (process crashed before crystallize). */
export function listOrphans(repoRoot: string): string[] {
  const dir = workingDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
}

/** Read a working session's last summary line — used for orphan recovery. */
export function readLastWorkingSummary(repoRoot: string, sessionId: string): unknown {
  const p = workingPath(repoRoot, sessionId);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, "utf8").trimEnd().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  try { return JSON.parse(lines[lines.length - 1]!); } catch { return null; }
}

// ─── Summarization helpers ────────────────────────────────────────────

/** Build the molecule list from accumulated co-fires. */
export function summarizeMolecules(snap: WorkingMemorySnapshot, minFireCount = 2): MoleculeRecord[] {
  const out: MoleculeRecord[] = [];
  for (const [pair, count] of snap.coFires) {
    if (count < minFireCount) continue;
    const atoms = pair.split("|").sort();
    const karma = atoms.reduce((s, a) => s + (snap.atoms.get(a)?.karma ?? 0), 0);
    out.push({
      name: deriveMoleculeName(atoms),
      atoms,
      fireCount: count,
      karma,
    });
  }
  return out.sort((a, b) => b.fireCount - a.fireCount);
}

function deriveMoleculeName(atoms: string[]): string {
  // Strip namespace prefixes for readability — mneme.X.y → X_y.
  const short = atoms
    .map((a) => a.replace(/^mneme\./, "").replace(/\./g, "_"))
    .join("__");
  return short.slice(0, 80);
}

/** Top N topics from the topic counts map. */
export function topTopics(snap: WorkingMemorySnapshot, n = 3): string[] {
  return [...snap.topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/** Reset working memory — only for tests. */
export function _resetForTests(): void {
  snapshot = null;
  pendingFlushCount = 0;
}
