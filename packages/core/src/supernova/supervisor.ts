/**
 * MNEME SUPERNOVA -- self-heal supervisor (v1.29.0).
 *
 * The problem: the nucleus daemon's internal cycles (oracle, antivirus
 * auto-synth, evolve pass, caretaker, retrieval lab tuner, selfcheck)
 * each run in their own try/catch block. If one throws, the catch
 * silently swallows the error AND that cycle never re-runs until the
 * next scheduled tick -- which might be 6+ hours away. Worse: a cycle
 * that crashes consistently (e.g. due to a corrupted state file) keeps
 * crashing for the rest of the daemon's life with no escalation.
 *
 * SUPERNOVA fixes this:
 *
 *   1. Every cycle is wrapped in `supervisor.runCycle(name, fn)`.
 *   2. On success: clear the restart counter, log "ok" entry.
 *   3. On failure: increment counter, schedule a retry with FACTORIAL
 *      backoff: attempt N waits N! seconds (1, 2, 6, 24, 120 -- capped
 *      at 5! = 120s to prevent fork-bomb behavior).
 *   4. Every restart attempt is appended to `.mneme/supernova.jsonl`.
 *   5. After 5 consecutive failures, escalate via notifier so the user
 *      knows a subsystem needs manual attention.
 *
 * Why factorial backoff? Per project guidance the user explicitly asked
 * for "n! factorial หรือ math ที่แปลกกว่านี้". Factorial gives:
 *   - Aggressive retry on first failure (1s) -- catches transient blips.
 *   - Steeply growing back-off (1, 2, 6, 24, 120) -- protects from
 *     pathological self-loops while still allowing recovery within ~3min.
 *   - Hard cap at 5! = 120s. Beyond that we escalate, not retry.
 *
 * Ghost sniper (v1.28.1+): self-heal is silent unless escalation
 * triggers. The user only sees "supervisor escalated antivirus_synth
 * after 5 consecutive failures" -- not every retry attempt.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SupernovaEntry {
  ts: string;
  cycle: string;
  outcome: "ok" | "failed" | "escalated";
  attempt: number;
  /** Wait until this timestamp before re-running. Only set when outcome=failed. */
  retryAt?: string;
  /** Truncated error message (200 chars) when outcome=failed. */
  error?: string;
  /** Wall-time the cycle took, in ms. Only set when outcome=ok. */
  durationMs?: number;
}

export interface SupernovaState {
  /** Per-cycle restart counter -- resets to 0 on success. */
  attempts: Record<string, number>;
  /** Per-cycle next-retry timestamp (ms since epoch). 0 means "ready to run". */
  cooldownUntil: Record<string, number>;
  /** Per-cycle escalation flag -- once true, stop auto-retrying until cleared. */
  escalated: Record<string, boolean>;
}

const SUPERNOVA_LOG_FILENAME = "supernova.jsonl";
const ESCALATION_THRESHOLD = 5;        // 5 consecutive failures -> escalate
const HARD_CAP_FACTORIAL = 5;          // wait at most 5! = 120s

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function logPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", SUPERNOVA_LOG_FILENAME);
}

function appendLog(repoRoot: string, entry: SupernovaEntry): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
  } catch { /* best-effort */ }
}

/** Read the last N entries from the supernova log. Useful for the
 *  status report + tests. */
export function readSupernovaLog(repoRoot: string, limit = 100): SupernovaEntry[] {
  try {
    const raw = readFileSync(logPath(repoRoot), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const out: SupernovaEntry[] = [];
    for (const ln of lines.slice(-limit)) {
      try { out.push(JSON.parse(ln) as SupernovaEntry); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

export class SupernovaSupervisor {
  readonly state: SupernovaState = {
    attempts: {},
    cooldownUntil: {},
    escalated: {},
  };

  constructor(
    private readonly repoRoot: string,
    /** Optional callback fired exactly once per cycle when it escalates. */
    private readonly onEscalate?: (cycle: string, error: string) => void | Promise<void>,
  ) {}

  /** Call this to attempt a cycle. Internally:
   *    - if cooldown not expired: skips silently (returns "skipped")
   *    - if escalated: skips silently (returns "escalated-quiet")
   *    - else: run fn(); on throw schedule factorial-backoff retry +
   *      maybe escalate; on success clear counters */
  async runCycle(cycle: string, fn: () => Promise<void> | void): Promise<"ok" | "failed" | "skipped" | "escalated-quiet"> {
    const now = Date.now();
    if (this.state.escalated[cycle]) return "escalated-quiet";
    if ((this.state.cooldownUntil[cycle] ?? 0) > now) return "skipped";
    const attempt = (this.state.attempts[cycle] ?? 0);
    const t0 = now;
    try {
      await fn();
      // Success: clear counters, log ok.
      this.state.attempts[cycle] = 0;
      this.state.cooldownUntil[cycle] = 0;
      appendLog(this.repoRoot, {
        ts: new Date().toISOString(),
        cycle, outcome: "ok",
        attempt: attempt + 1,
        durationMs: Date.now() - t0,
      });
      return "ok";
    } catch (e) {
      const nextAttempt = attempt + 1;
      this.state.attempts[cycle] = nextAttempt;
      const errMsg = ((e as Error)?.message ?? String(e)).slice(0, 200);
      // Should we escalate?
      if (nextAttempt >= ESCALATION_THRESHOLD) {
        this.state.escalated[cycle] = true;
        appendLog(this.repoRoot, {
          ts: new Date().toISOString(),
          cycle, outcome: "escalated",
          attempt: nextAttempt,
          error: errMsg,
        });
        try { await this.onEscalate?.(cycle, errMsg); } catch { /* */ }
        return "failed";
      }
      // Otherwise schedule factorial-backoff retry.
      const factorialN = Math.min(nextAttempt, HARD_CAP_FACTORIAL);
      const waitSec = factorial(factorialN);
      const retryAt = now + waitSec * 1000;
      this.state.cooldownUntil[cycle] = retryAt;
      appendLog(this.repoRoot, {
        ts: new Date().toISOString(),
        cycle, outcome: "failed",
        attempt: nextAttempt,
        retryAt: new Date(retryAt).toISOString(),
        error: errMsg,
      });
      return "failed";
    }
  }

  /** Manually clear an escalated cycle (after maintainer fixed the
   *  underlying issue). Resets attempt counter so retries resume. */
  clearEscalation(cycle: string): void {
    this.state.escalated[cycle] = false;
    this.state.attempts[cycle] = 0;
    this.state.cooldownUntil[cycle] = 0;
  }

  /** Snapshot of current state for status displays. */
  snapshot(): {
    cycles: Array<{ cycle: string; attempts: number; escalated: boolean; cooldownRemainingSec: number }>;
  } {
    const allCycles = new Set<string>([
      ...Object.keys(this.state.attempts),
      ...Object.keys(this.state.cooldownUntil),
      ...Object.keys(this.state.escalated),
    ]);
    const now = Date.now();
    return {
      cycles: Array.from(allCycles).map((c) => ({
        cycle: c,
        attempts: this.state.attempts[c] ?? 0,
        escalated: this.state.escalated[c] ?? false,
        cooldownRemainingSec: Math.max(0, Math.ceil(((this.state.cooldownUntil[c] ?? 0) - now) / 1000)),
      })),
    };
  }
}

/** Pure helper: compute the next factorial backoff for an attempt count.
 *  Exposed for tests + display. Capped at 5! = 120s. */
export function factorialBackoffSeconds(attempt: number): number {
  if (attempt <= 0) return 0;
  return factorial(Math.min(attempt, HARD_CAP_FACTORIAL));
}
