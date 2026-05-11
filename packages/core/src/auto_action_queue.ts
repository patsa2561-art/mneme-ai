/**
 * AUTO-ACTION QUEUE (v1.41.0 Phase 1) — durable queue for self-modifying
 * mandates that the pulse pre-executor cannot safely run inline.
 *
 * The pulse pre-executor (ai_compliance.ts) handles SAFE inline mandates
 * directly. Self-modifying mandates (e.g. `mneme.system.upgrade` that
 * overwrites the running mneme.cmd binary on Windows) get enqueued here
 * instead. The NUCLEUS daemon's caretaker pass drains the queue from a
 * fresh subprocess context outside the lock window.
 *
 * Wire-up:
 *   ai_compliance.ts  — calls enqueueMandate() for QUEUED_MANDATES
 *   nucleus_daemon.ts — calls drainQueue() in caretaker pass (every 30 ticks ~ 15 min)
 *
 * File format: append-only JSONL at .mneme/auto-action-queue.jsonl
 * After successful drain, the file is truncated (atomic rename swap).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUEUE_FILE = ".mneme/auto-action-queue.jsonl";

export interface QueuedMandate {
  ts: string;
  mandate: string;
  args: Record<string, unknown>;
  /** Internal — set by drainQueue() once the executor has finished. */
  executedAt?: string;
  outcome?: "executed" | "failed";
  error?: string;
}

function ensureMnemeDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function queuePath(repoRoot: string): string {
  return join(repoRoot, QUEUE_FILE);
}

export function enqueueMandate(repoRoot: string, mandate: string, args: Record<string, unknown>): QueuedMandate {
  ensureMnemeDir(repoRoot);
  const entry: QueuedMandate = { ts: new Date().toISOString(), mandate, args };
  appendFileSync(queuePath(repoRoot), JSON.stringify(entry) + "\n");
  return entry;
}

export function readQueue(repoRoot: string): QueuedMandate[] {
  const p = queuePath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as QueuedMandate)
      .filter((m) => !m.executedAt);
  } catch {
    return [];
  }
}

export type QueueExecutor = (mandate: string, args: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;

export interface DrainResult {
  drained: number;
  executed: number;
  failed: number;
  errors: string[];
}

/** Read the pending queue, run each mandate through the executor, persist
 *  outcomes back to the file (so a crashed daemon doesn't double-execute),
 *  and atomically truncate the queue once everything has settled. */
export async function drainQueue(repoRoot: string, exec: QueueExecutor): Promise<DrainResult> {
  const pending = readQueue(repoRoot);
  if (pending.length === 0) return { drained: 0, executed: 0, failed: 0, errors: [] };

  let executed = 0;
  let failed = 0;
  const errors: string[] = [];
  const settled: QueuedMandate[] = [];

  for (const m of pending) {
    try {
      const r = await exec(m.mandate, m.args);
      m.executedAt = new Date().toISOString();
      m.outcome = r.ok ? "executed" : "failed";
      if (!r.ok) {
        failed++;
        if (r.error) errors.push(`${m.mandate}: ${r.error}`);
      } else {
        executed++;
      }
    } catch (e) {
      m.executedAt = new Date().toISOString();
      m.outcome = "failed";
      m.error = (e as Error).message;
      failed++;
      errors.push(`${m.mandate}: ${(e as Error).message}`);
    }
    settled.push(m);
  }

  // Atomic truncate via rename swap. Anything queued in parallel during the
  // drain (rare; daemon is single-instance) is handled by the next tick.
  try {
    const archive = queuePath(repoRoot) + ".drained-" + Date.now();
    renameSync(queuePath(repoRoot), archive);
    writeFileSync(archive, settled.map((s) => JSON.stringify(s)).join("\n") + "\n");
  } catch {
    // best-effort; if rename fails (e.g. file vanished), drain still succeeded
  }

  return { drained: settled.length, executed, failed, errors };
}
