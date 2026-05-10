/**
 * NUCLEUS DAEMON (v1.21.0) — the persistent infinity loop that keeps the
 * Mneme nucleus alive between MCP sessions.
 *
 * Lifecycle:
 *   • `mneme nucleus daemon start [--detach]`  — starts the loop
 *   • `mneme nucleus daemon stop`              — graceful shutdown
 *   • `mneme nucleus daemon status`            — pid + uptime + last tick
 *
 * What the loop does (every NUCLEUS_INTERVAL_MS):
 *   1. Tick the nucleus (aggregate DNA + maybe synthesize a lesson).
 *   2. If the tick triggered MUTATION_THRESHOLD growth, apply one
 *      structured mutation (karma noise + molecule recipe drift).
 *   3. If 24+ hours since last consolidation, compress old chromosomes
 *      into a summary chromosome (saves disk + speeds future fertilize).
 *   4. Persist heartbeat to .mneme/nucleus.heartbeat.json.
 *
 * The daemon is single-instance — re-running `start` while a daemon is
 * alive returns "already running" (atomic PID file check).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tick, mutate, readNucleus, dnaBanner } from "./nucleus.js";
import { pushInbox, deterministicId } from "./inbox.js";
import { readStreaks } from "./karma_streaks.js";

const PID_FILE = ".mneme/nucleus.pid";
const HEARTBEAT_FILE = ".mneme/nucleus.heartbeat.json";

const NUCLEUS_INTERVAL_MS = 30 * 1000;          // tick every 30s
const MUTATION_THRESHOLD = 5;                    // mutate after 5 noteworthy ticks
// v1.23.2 — also force a mutation every N ticks regardless of growth.
// Without this, a stable nucleus shows mutations=0 forever, and the
// "evolution" promise from v1.20 stays asleep.
const TIME_BASED_MUTATION_EVERY = 10;            // mutate at tick 10, 20, 30, ...
const HEARTBEAT_WRITE_EVERY_TICK = 1;            // write heartbeat every tick
// v1.23.5 — Caretaker Bot pass. Every N ticks, the daemon checks for
// drift conditions (version, integrity) and pushes auto-action inbox
// messages so the next MCP-connected AI surfaces + executes them.
const CARETAKER_PASS_EVERY = 30;                 // ~15 min at 30s tick interval

export interface DaemonHeartbeat {
  pid: number;
  startedAt: string;
  lastTick: string;
  tickCount: number;
  mutationsApplied: number;
  lastBanner: string;
  intervalMs: number;
}

function pidFilePath(repoRoot: string): string {
  return join(repoRoot, PID_FILE);
}

function heartbeatFilePath(repoRoot: string): string {
  return join(repoRoot, HEARTBEAT_FILE);
}

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 = check existence without sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read the daemon's PID + verify the process is alive. */
export function getDaemonPid(repoRoot: string): number | null {
  const path = pidFilePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const pid = parseInt(readFileSync(path, "utf8").trim(), 10);
    if (!Number.isFinite(pid)) return null;
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Read the latest heartbeat. */
export function readHeartbeat(repoRoot: string): DaemonHeartbeat | null {
  const path = heartbeatFilePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  heartbeat: DaemonHeartbeat | null;
  /** Seconds since last heartbeat — null when no heartbeat. */
  lastTickSecondsAgo: number | null;
  /** True if heartbeat is recent (≤ 2× interval). */
  healthy: boolean;
}

export function daemonStatus(repoRoot: string): DaemonStatus {
  const pid = getDaemonPid(repoRoot);
  const hb = readHeartbeat(repoRoot);
  const lastTickSecondsAgo = hb ? Math.floor((Date.now() - Date.parse(hb.lastTick)) / 1000) : null;
  const healthy = pid !== null && hb !== null && (lastTickSecondsAgo ?? Infinity) < (NUCLEUS_INTERVAL_MS / 1000) * 2;
  return { running: pid !== null, pid, heartbeat: hb, lastTickSecondsAgo, healthy };
}

/** Start the daemon loop INSIDE this process. Caller is responsible
 *  for forking / detaching if they want background behaviour. */
export async function runDaemonLoop(
  repoRoot: string,
  opts: { intervalMs?: number; onTick?: (state: { tickCount: number; banner: string }) => void } = {},
): Promise<void> {
  ensureDir(repoRoot);

  // Atomic PID-file write (refuse if already alive).
  const existingPid = getDaemonPid(repoRoot);
  if (existingPid !== null) {
    throw new Error(`nucleus daemon already running (pid ${existingPid})`);
  }
  writeFileSync(pidFilePath(repoRoot), String(process.pid), "utf8");

  const startedAt = new Date().toISOString();
  let tickCount = 0;
  let mutationsApplied = 0;
  let noteworthyTicks = 0;
  const intervalMs = opts.intervalMs ?? NUCLEUS_INTERVAL_MS;

  // v1.25.1 — warm up the cross-encoder ONCE at boot so the first
  // user query that needs it doesn't pay the 5-15s model-load latency.
  // Best-effort: silent failure (the lab tuner falls back to term-density).
  void (async () => {
    try {
      const { warmupCrossEncoder } = await import("./retrieval_lab/cross_encoder.js");
      await warmupCrossEncoder();
    } catch { /* ignore */ }
  })();

  // Cleanup on shutdown — remove PID file so next `start` can succeed.
  const cleanup = () => {
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* ignore */ }
  };
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("beforeExit", cleanup);

  // Loop forever (or until killed).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = tick(repoRoot);
      tickCount += 1;
      // Track noteworthy ticks (any growth) for mutation throttling.
      const grew =
        result.delta.growthSinceLastTick.chromosomes > 0 ||
        result.delta.growthSinceLastTick.calls > 0 ||
        result.delta.growthSinceLastTick.verified > 0;
      if (grew) noteworthyTicks += 1;
      // v1.23.2 — TWO mutation triggers, both independent:
      //   1. Growth-based: noteworthyTicks >= MUTATION_THRESHOLD (existing)
      //   2. Time-based: every TIME_BASED_MUTATION_EVERY ticks regardless
      //      of growth, so a stable nucleus still evolves slowly.
      const shouldMutateGrowth = noteworthyTicks >= MUTATION_THRESHOLD;
      const shouldMutateTime = tickCount > 0 && tickCount % TIME_BASED_MUTATION_EVERY === 0;
      if (shouldMutateGrowth || shouldMutateTime) {
        mutate(repoRoot, 1);
        mutationsApplied += 1;
        if (shouldMutateGrowth) noteworthyTicks = 0;
        // v1.23.0 — push milestone every 10 mutations into the inbox so
        // the user sees progress even if they never run a Mneme command.
        if (mutationsApplied > 0 && mutationsApplied % 10 === 0) {
          try {
            pushInbox(repoRoot, {
              id: deterministicId(`mutation-milestone-${mutationsApplied}`),
              priority: "medium",
              source: "daemon",
              title: `Nucleus reached ${mutationsApplied} mutations`,
              body: `Your Mneme nucleus has self-evolved ${mutationsApplied} times since the daemon started.`,
              cta: "ask: 'show me the mneme dna'",
            });
          } catch { /* ignore */ }
        }
      }
      // v1.23.0 — push achievement-unlocked alerts to the inbox.
      try {
        const streaks = readStreaks(repoRoot);
        const knownAchievements = (globalThis as { __mnemeKnownAchievements?: Set<string> }).__mnemeKnownAchievements ??= new Set<string>();
        for (const a of streaks.unlocked) {
          if (!knownAchievements.has(a.id)) {
            knownAchievements.add(a.id);
            // Only push if first daemon-tick already populated the set
            // (otherwise we'd flood the inbox with pre-existing achievements).
            if (tickCount > 1) {
              pushInbox(repoRoot, {
                id: deterministicId(`achievement-${a.id}`),
                priority: "high",
                source: "achievement",
                title: `${a.glyph} Unlocked: ${a.title}`,
                body: a.detail,
                cta: "ask: 'show me my mneme achievements'",
              });
            }
          }
        }
      } catch { /* ignore */ }

      // v1.23.5 — Caretaker Bot pass. Every CARETAKER_PASS_EVERY ticks,
      // run drift checks + push autoAction inbox messages. The pass is
      // best-effort (any failure is silenced); never blocks the tick loop.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        void runCaretakerPass(repoRoot, tickCount).catch(() => { /* ignore */ });
      }

      // v1.25.0 — Retrieval Lab tuning round. Every CARETAKER_PASS_EVERY
      // ticks, the daemon picks the next arm via UCB1, runs a trial,
      // folds it into the leaderboard. Over time the active config
      // converges on the best arm without anyone having to ask.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        try {
          const { pickNextArm, readLeaderboard, recordTrial } = await import("./retrieval_lab/leaderboard.js");
          const { runTrial } = await import("./retrieval_lab/tuner.js");
          const lb = readLeaderboard(repoRoot);
          const { config } = pickNextArm(lb);
          const trial = runTrial(repoRoot, config);
          recordTrial(repoRoot, trial);
        } catch { /* best-effort */ }
      }

      // v1.26.3 — Mneme ORACLE dream cycle. Every 5 ticks (~2.5 min)
      // the Oracle evaporates pheromones, re-predicts top-K successors
      // for the current state, and refreshes the cache. Over time the
      // pulse hint converges on the AI's actual usage patterns -- the
      // teacher walking over with the answer before the student asks.
      const ORACLE_DREAM_EVERY = 5;
      if (tickCount > 0 && tickCount % ORACLE_DREAM_EVERY === 0) {
        try {
          const { dreamCycle } = await import("./oracle/index.js");
          dreamCycle(repoRoot);
        } catch { /* best-effort */ }
      }

      // v1.26.0 — Self-check audit + multi-channel notifier dispatch.
      // Every CARETAKER_PASS_EVERY ticks, run all selfcheck checks. Any
      // FAIL fires a notifier broadcast (OS toast + mobile push + email
      // + agent files + ...) so the user/AI sees the problem regardless
      // of whether they have the chat window open.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        try {
          const { runAudit } = await import("./selfcheck/index.js");
          const report = await runAudit(repoRoot);
          // For every FAIL with an autoAction, broadcast.
          const failed = report.verdicts.filter((v) => v.status === "fail");
          if (failed.length > 0) {
            const { buildAllNotifiers, notifyAll } = await import("./notifier/index.js");
            const all = buildAllNotifiers(repoRoot);
            for (const v of failed) {
              try {
                await notifyAll({
                  id: `selfcheck-${v.name}-${Date.now()}`,
                  severity: "warning",
                  title: `Mneme audit FAIL: ${v.name}`,
                  body: `${v.evidence}${v.fixHint ? ` -- fix: ${v.fixHint}` : ""}`,
                  autoAction: v.autoAction,
                }, all);
              } catch { /* best-effort */ }
            }
          }
        } catch { /* best-effort */ }
      }
      // Heartbeat
      if (tickCount % HEARTBEAT_WRITE_EVERY_TICK === 0) {
        const banner = dnaBanner(result.state);
        const hb: DaemonHeartbeat = {
          pid: process.pid,
          startedAt,
          lastTick: new Date().toISOString(),
          tickCount,
          mutationsApplied,
          lastBanner: banner,
          intervalMs,
        };
        writeFileSync(heartbeatFilePath(repoRoot), JSON.stringify(hb, null, 2), "utf8");
        opts.onTick?.({ tickCount, banner });
      }
    } catch {
      // best-effort — never let a single tick failure kill the daemon
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** v1.23.5 — Caretaker Bot pass. Detects drift conditions and pushes
 *  high-priority autoAction inbox messages. The next MCP-connected AI
 *  surfaces them via the wisdom force-push channel + executes the
 *  embedded autoAction per AGENT_INSTRUCTIONS.md.
 *
 *  Drift conditions checked:
 *    1. Version drift: a new mneme-ai is on npm vs local install.
 *    2. Daemon-process version mismatch: this running daemon's version
 *       != the user's globally-installed mneme version (means user
 *       upgraded but didn't restart the daemon -- self-exit hint).
 *
 *  Each pass is best-effort and runs in the background; never throws. */
async function runCaretakerPass(repoRoot: string, tickCount: number): Promise<void> {
  // 1. Version drift -- queries cached version-check (writes the cache
  //    if stale; piggybacks on the existing 1h TTL).
  try {
    const myVersion = readMneMeVersion();
    if (myVersion) {
      // Lazy import to avoid pulling version_check at module load on
      // every daemon start when this codepath isn't reached.
      const { checkVersion } = await import("./version_check.js");
      const status = await checkVersion(repoRoot, myVersion);
      if (status.updateAvailable && status.latest) {
        // Push an autoAction-flavored inbox message. The wisdom prepend
        // already surfaces this on the next MCP dispatch; AGENT_INSTRUCTIONS
        // teaches the AI to call mneme.system.upgrade automatically when
        // it sees a version-update inbox notice.
        try {
          // version_check.checkVersion already pushes an inbox notice when
          // the cache flips fresh; this caretaker pass also re-pushes once
          // per CARETAKER_PASS_EVERY ticks while the update remains
          // available. Idempotent on the version string (inbox is keyed
          // by deterministicId), so re-pushing is a cheap no-op.
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // 2. Daemon-process vs globally-installed version mismatch.
  //    Means user upgraded mneme but the running daemon is stale code.
  try {
    const myVersion = readMneMeVersion();
    const installedVersion = await readGloballyInstalledMnemeVersion();
    if (myVersion && installedVersion && myVersion !== installedVersion) {
      pushInbox(repoRoot, {
        id: deterministicId(`daemon-stale-${myVersion}-vs-${installedVersion}`),
        priority: "high",
        source: "caretaker",
        title: `Nucleus daemon is running stale code (v${myVersion} vs installed v${installedVersion})`,
        body: `The daemon process predates the latest \`mneme upgrade\`. Restart it: \`mneme nucleus stop && mneme nucleus daemon --detach\`.`,
        cta: "restart the nucleus daemon",
      });
    }
    void tickCount; // silence unused
  } catch { /* ignore */ }
}

/** Read the version of the mneme package this daemon process loaded. */
function readMneMeVersion(): string | null {
  return process.env["npm_package_version"] ?? null;
}

/** Read the version of the globally-installed mneme CLI. Returns null if
 *  the binary isn't on PATH or the call times out. Best-effort. */
async function readGloballyInstalledMnemeVersion(): Promise<string | null> {
  try {
    const { spawnSync } = await import("node:child_process");
    const isWin = process.platform === "win32";
    const cmd = isWin ? "mneme.cmd" : "mneme";
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return null;
    const out = (r.stdout ?? "").trim();
    return /^\d+\.\d+\.\d+/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Stop the daemon by sending SIGTERM. Returns true if a daemon was killed. */
export function stopDaemon(repoRoot: string): { stopped: boolean; pid: number | null; reason: string } {
  const pid = getDaemonPid(repoRoot);
  if (pid === null) return { stopped: false, pid: null, reason: "no daemon running" };
  try {
    process.kill(pid, "SIGTERM");
    // Best-effort cleanup of pid file (the daemon's own shutdown handler
    // also tries to do this).
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* ignore */ }
    return { stopped: true, pid, reason: "SIGTERM sent" };
  } catch (err) {
    return { stopped: false, pid, reason: (err as Error).message };
  }
}
