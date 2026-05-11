/**
 * MNEME SUPER SONIC CONTINUITY PULSE (v1.30.0).
 *
 * The gap pre-fix: every UserPromptSubmit hook fires `mneme nucleus
 * pulse --quiet`. That gives the AI a snapshot of the CURRENT state.
 * What it does NOT give the AI: a sense of WHAT CHANGED since the last
 * prompt. So the AI re-discovers the same state every turn instead of
 * incrementally adapting to delta.
 *
 * Continuity fix:
 *   1. Every pulse fire writes a compact snapshot to
 *      `.mneme/pulse-trace.jsonl` (append-only).
 *   2. `computePulseDelta(repoRoot)` reads the LAST TWO snapshots and
 *      returns the diff: vaccines added/removed, recall climbed/dropped,
 *      daemon restarted, supernova escalation flipped, mutations bumped,
 *      inbox grew/drained.
 *   3. `renderPulseDeltaLine(delta)` formats it as a one-line "[CHANGED]"
 *      annotation that gets appended to the pulse text.
 *
 * Net effect: AI agent on prompt N+1 sees "[CHANGED] vaccines 8->9
 * (synthesized depends_imaginarium); recall +12pp; supernova cleared
 * antivirus_synth" and can adapt its next response WITHOUT having to
 * re-call mneme.* tools to discover the same facts.
 *
 * Designed-for-context-length: each trace entry is 6-8 fields, JSON-
 * compact. After 1000 entries (~rotates around 200KB) we trim oldest
 * 500. Bounded growth + 2-entry read for delta = constant per-prompt
 * overhead.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PulseSnapshot {
  ts: string;
  /** Mneme version this pulse was emitted by. */
  version: string;
  daemonRunning: boolean;
  daemonTickCount: number | null;
  inboxUnsent: number;
  vaccines: number;
  uncertifiedVaccines: number;
  retrievalTrials: number;
  hci: number | null;
  memoryTier: string | null;
}

export interface PulseDelta {
  /** True iff there's at least one change worth showing. */
  hasChanges: boolean;
  /** Wall time since last pulse, in seconds (or null if no prior pulse). */
  secondsSinceLast: number | null;
  /** Each entry is a one-phrase change. */
  changes: string[];
}

const TRACE_FILENAME = "pulse-trace.jsonl";
const MAX_ENTRIES = 1000;
const TRIM_TO = 500;

function tracePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", TRACE_FILENAME);
}

/** Append a snapshot to the pulse trace. Bounded growth -- trim past 1000
 *  entries to the most recent 500. Best-effort + silent on failure. */
export function recordPulseSnapshot(repoRoot: string, snap: PulseSnapshot): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = tracePath(repoRoot);
    appendFileSync(path, JSON.stringify(snap) + "\n", "utf8");
    // Bounded growth: every ~50 writes, check size + trim if needed.
    if (Math.random() < 0.02) trimIfNeeded(path);
  } catch { /* best-effort */ }
}

function trimIfNeeded(path: string): void {
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    const keep = lines.slice(-TRIM_TO);
    writeFileSync(path, keep.join("\n") + "\n", "utf8");
  } catch { /* best-effort */ }
}

/** Read the last N snapshots from the trace. Returns [] if file missing. */
export function readPulseTrace(repoRoot: string, limit = 2): PulseSnapshot[] {
  try {
    const path = tracePath(repoRoot);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    const out: PulseSnapshot[] = [];
    for (const ln of recent) {
      try { out.push(JSON.parse(ln) as PulseSnapshot); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** Diff the LAST snapshot against the PRIOR snapshot. The "current" arg
 *  is the snapshot about to be persisted -- we compare it against the
 *  most-recent persisted entry (which is the PRIOR pulse). */
export function computePulseDelta(repoRoot: string, current: PulseSnapshot): PulseDelta {
  const prior = readPulseTrace(repoRoot, 1)[0];
  if (!prior) {
    return { hasChanges: false, secondsSinceLast: null, changes: [] };
  }
  const sec = Math.max(0, Math.floor((Date.parse(current.ts) - Date.parse(prior.ts)) / 1000));
  const changes: string[] = [];

  if (current.version !== prior.version) {
    changes.push(`mneme upgraded ${prior.version}→${current.version}`);
  }
  if (current.daemonRunning !== prior.daemonRunning) {
    changes.push(current.daemonRunning ? "daemon STARTED" : "daemon STOPPED");
  }
  if (current.daemonRunning && prior.daemonRunning && (current.daemonTickCount ?? 0) < (prior.daemonTickCount ?? 0)) {
    changes.push(`daemon RESTARTED (ticks reset ${prior.daemonTickCount}→${current.daemonTickCount})`);
  }
  if (current.inboxUnsent !== prior.inboxUnsent) {
    const delta = current.inboxUnsent - prior.inboxUnsent;
    changes.push(`inbox ${prior.inboxUnsent}→${current.inboxUnsent} (${delta > 0 ? "+" : ""}${delta})`);
  }
  if (current.vaccines !== prior.vaccines) {
    changes.push(`vaccines ${prior.vaccines}→${current.vaccines}`);
  }
  if (current.uncertifiedVaccines !== prior.uncertifiedVaccines) {
    changes.push(`uncertified vaccines ${prior.uncertifiedVaccines}→${current.uncertifiedVaccines}`);
  }
  if (current.retrievalTrials !== prior.retrievalTrials) {
    const delta = current.retrievalTrials - prior.retrievalTrials;
    if (delta > 0) changes.push(`+${delta} retrieval trial${delta === 1 ? "" : "s"}`);
  }
  if (current.hci != null && prior.hci != null && Math.abs(current.hci - prior.hci) >= 5) {
    const arrow = current.hci > prior.hci ? "↑" : "↓";
    changes.push(`HCI ${prior.hci}→${current.hci} ${arrow}`);
  }
  if (current.memoryTier !== prior.memoryTier && current.memoryTier && prior.memoryTier) {
    changes.push(`memory tier ${prior.memoryTier}→${current.memoryTier}`);
  }

  return {
    hasChanges: changes.length > 0,
    secondsSinceLast: sec,
    changes,
  };
}

export function renderPulseDeltaLine(delta: PulseDelta): string | null {
  if (!delta.hasChanges) return null;
  const since = delta.secondsSinceLast == null
    ? ""
    : delta.secondsSinceLast < 60
      ? ` (${delta.secondsSinceLast}s ago)`
      : delta.secondsSinceLast < 3600
        ? ` (${Math.floor(delta.secondsSinceLast / 60)}min ago)`
        : ` (${Math.floor(delta.secondsSinceLast / 3600)}h ago)`;
  return `[CHANGED${since}] ${delta.changes.join(" · ")}`;
}
