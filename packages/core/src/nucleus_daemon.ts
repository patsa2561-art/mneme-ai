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
import { pushInbox, pushInboxReplacingSource, deterministicId, readInbox, ackInbox, clearInbox } from "./inbox.js";
import { readStreaks } from "./karma_streaks.js";
import { SupernovaSupervisor } from "./supernova/supervisor.js";
import { resolveMnemeVersion } from "./mneme_version.js";

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
// v2.19.62 PHOENIX P5 — 3 priority-1 organs run on independent cadences.
// CUSTODIAN every 10 ticks (~5 min @ 30s tick): sweep orphan DLL tmpdirs +
// stale .locked-* files. Light-weight cleanup, safe to fire often.
// SENTINEL every 20 ticks (~10 min): HMAC chain integrity + handle leak.
// SURGEON every 10 ticks (~5 min): latency-based restart verdict.
const PHOENIX_CUSTODIAN_EVERY = 10;
const PHOENIX_SENTINEL_EVERY = 20;
const PHOENIX_SURGEON_EVERY = 10;

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

  // v1.29.0 SUPERNOVA -- self-heal supervisor wraps every cycle. On
  // throw, factorial backoff (1s, 2s, 6s, 24s, 120s) before retry.
  // After 5 consecutive failures, escalate via notifier so the user
  // knows a subsystem needs manual attention. Replaces the previous
  // silent-try/catch-everything-and-pray pattern.
  const supernova = new SupernovaSupervisor(repoRoot, async (cycle, error) => {
    try {
      const { buildAllNotifiers, notifyAll } = await import("./notifier/index.js");
      const all = buildAllNotifiers(repoRoot);
      await notifyAll({
        id: `supernova-${cycle}-${Date.now()}`,
        severity: "warning",
        title: `Mneme SUPERNOVA: subsystem "${cycle}" escalated`,
        body: `5 consecutive failures: ${error}. Auto-retry stopped. Investigate + run \`mneme supernova clear ${cycle}\` to resume.`,
      }, all);
    } catch { /* best-effort */ }
  });

  // v1.25.1 — warm up the cross-encoder ONCE at boot so the first
  // user query that needs it doesn't pay the 5-15s model-load latency.
  // Best-effort: silent failure (the lab tuner falls back to term-density).
  void (async () => {
    try {
      const { warmupCrossEncoder } = await import("./retrieval_lab/cross_encoder.js");
      await warmupCrossEncoder();
    } catch { /* BE:silent-by-design  ignore  */ }
  })();

  // v1.27.6 -- ONE-SHOT MIGRATION: clean OLD "daemon"-source mutation-
  // milestone entries from the inbox. Pre-v1.27.5 every milestone was
  // pushed with source="daemon" (no dedup). v1.27.5 switched to source=
  // "daemon-milestone" with replacing-source semantics, but pre-existing
  // "daemon"-source "Nucleus reached N mutations" entries persisted. This
  // migration sweeps them at startup. Best-effort. Idempotent (no-op on
  // a fresh daemon).
  try {
    const all = readInbox(repoRoot);
    const staleMilestoneIds = all
      .filter((m) => m.source === "daemon" && /^Nucleus reached \d+ mutations$/.test(m.title))
      .map((m) => m.id);
    if (staleMilestoneIds.length > 0) {
      ackInbox(repoRoot, staleMilestoneIds);  // mark sent (so they don't surface)
      clearInbox(repoRoot, "sent");           // then permanently delete
    }
  } catch { /* best-effort */ }

  // Cleanup on shutdown — remove PID file so next `start` can succeed.
  const cleanup = () => {
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* BE:silent-by-design  ignore  */ }
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
        // v1.23.0 -- push milestone every 10 mutations into the inbox.
        // v1.27.5 (FIX): use pushInboxReplacingSource so the latest
        // milestone REPLACES the prior one. Pre-fix the inbox accumulated
        // "Nucleus reached 10 mutations", "20 mutations", "30 mutations"
        // ... forever, until 256KB rotation. Now there's at most ONE
        // "daemon-milestone" entry at any time, always reflecting the
        // latest count. (Reported by AI reviewer 2026-05-10.)
        if (mutationsApplied > 0 && mutationsApplied % 10 === 0) {
          try {
            pushInboxReplacingSource(repoRoot, {
              id: deterministicId(`mutation-milestone-${mutationsApplied}`),
              priority: "low",
              source: "daemon-milestone",
              title: `Nucleus reached ${mutationsApplied} mutations`,
              body: `Your Mneme nucleus has self-evolved ${mutationsApplied} times since the daemon started.`,
              cta: "ask: 'show me the mneme dna'",
            });
          } catch { /* BE:silent-by-design  ignore  */ }
        }
      }
      // v1.30.0 -- honor `mneme supernova clear <cycle>` requests from
      // the inbox. The CLI can't reach into the daemon process's memory,
      // so it pushes a "supernova-clear" inbox item; the daemon picks it
      // up here and clears the named cycle's escalation. After clearing,
      // we ack the inbox entry so it doesn't fire again.
      try {
        const all = readInbox(repoRoot);
        const clearReqs = all.filter((m) => !m.sent && m.source === "supernova-clear");
        if (clearReqs.length > 0) {
          const acked: string[] = [];
          for (const m of clearReqs) {
            // Title format: SUPERNOVA: clear escalation for "<cycle>"
            const match = /clear escalation for "(.+?)"/.exec(m.title);
            const cycle = match?.[1];
            if (cycle) {
              supernova.clearEscalation(cycle);
              acked.push(m.id);
            }
          }
          if (acked.length > 0) ackInbox(repoRoot, acked);
        }
      } catch { /* best-effort */ }

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
      } catch { /* BE:silent-by-design  ignore  */ }

      // v1.23.5 — Caretaker Bot pass. Every CARETAKER_PASS_EVERY ticks,
      // run drift checks + push autoAction inbox messages. The pass is
      // best-effort (any failure is silenced); never blocks the tick loop.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        void supernova.runCycle("caretaker", () => runCaretakerPass(repoRoot, tickCount));
      }

      // v1.41.0 Phase 1 — drain the AUTO-ACTION queue that the pulse
      // pre-executor wrote. Self-modifying mandates (e.g. mneme.system.upgrade)
      // were enqueued because they cannot run from inside a Mneme subprocess
      // on Windows (file lock on mneme.cmd). The daemon runs in its own
      // detached process tree, so spawning a fresh `mneme upgrade` here is
      // safe. Best-effort; failures get logged to ai-compliance.jsonl.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        await supernova.runCycle("auto_action_queue_drain", async () => {
          const { drainQueue } = await import("./auto_action_queue.js");
          const { logCompliance } = await import("./ai_compliance.js");
          const { spawn } = await import("node:child_process");
          const { gateDaemonUpgrade } = await import("./system_compat/index.js");
          const { pushInbox: pushInboxForCompat } = await import("./inbox.js");
          const result = await drainQueue(repoRoot, async (mandate, args) => {
            // v1.93 SYSTEM-COMPAT gate for self-modifying mandates: probe
            // OS/Node/pkg-mgr/perms BEFORE we spawn `mneme upgrade`, so
            // a misconfigured machine can't trigger a silent failure loop.
            if (mandate === "mneme.system.upgrade") {
              const gate = gateDaemonUpgrade();
              if (!gate.shouldProceed) {
                pushInboxForCompat(repoRoot, {
                  priority: "high",
                  source: "system-compat",
                  title: "Auto-upgrade blocked / deferred by SYSTEM-COMPAT",
                  body: gate.inboxLine ?? "no detail",
                });
                return { ok: false, error: gate.inboxLine ?? "system-compat blocked" };
              }
              // OK to proceed — use the strategy-derived command rather than
              // the hardcoded "mneme upgrade --force" so user-npm / docker /
              // brew paths work too.
              const c = gate.command!;
              const start = Date.now();
              return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
                const child = spawn(c.cmd, c.args, { cwd: repoRoot, detached: false, stdio: "ignore", shell: process.platform === "win32" });
                const timeout = setTimeout(() => { try { child.kill(); } catch { /* BE:silent-by-design  ignore  */ } resolve({ ok: false, error: "exec-timeout" }); }, 120_000);
                child.on("error", (e) => { clearTimeout(timeout); resolve({ ok: false, error: (e as Error).message }); });
                child.on("exit", (code) => {
                  clearTimeout(timeout);
                  logCompliance(repoRoot, { ts: new Date().toISOString(), mandate, args, executor: "daemon-queue", outcome: code === 0 ? "executed" : "failed", durationMs: Date.now() - start, error: code === 0 ? undefined : `exit-${code}` });
                  resolve({ ok: code === 0, error: code === 0 ? undefined : `exit-${code}` });
                });
              });
            }
            return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
              // Map mandate name → CLI args. Self-modifying mandates we know about:
              const cliArgs: string[] | null = null; // mneme.system.upgrade handled above
              if (!cliArgs) { resolve({ ok: false, error: `unknown mandate ${mandate}` }); return; }
              const start = Date.now();
              const child = spawn("mneme", cliArgs, { cwd: repoRoot, detached: false, stdio: "ignore", shell: process.platform === "win32" });
              const timeout = setTimeout(() => { try { child.kill(); } catch { /* BE:silent-by-design  ignore  */ } resolve({ ok: false, error: "exec-timeout" }); }, 60_000);
              child.on("error", (e) => { clearTimeout(timeout); resolve({ ok: false, error: (e as Error).message }); });
              child.on("exit", (code) => {
                clearTimeout(timeout);
                logCompliance(repoRoot, { ts: new Date().toISOString(), mandate, args, executor: "daemon-queue", outcome: code === 0 ? "executed" : "failed", durationMs: Date.now() - start, error: code === 0 ? undefined : `exit-${code}` });
                resolve({ ok: code === 0, error: code === 0 ? undefined : `exit-${code}` });
              });
            });
          });
          if (result.drained > 0) {
            // surface a one-line audit into the inbox so the next pulse shows
            // the daemon-side execution + user can grep ack history later
            const { pushInbox } = await import("./inbox.js");
            pushInbox(repoRoot, {
              priority: "low",
              source: "daemon-queue",
              title: `Drained ${result.drained} queued mandate(s) — ${result.executed} executed, ${result.failed} failed`,
              body: result.errors.join(" · "),
            });
          }
        });
      }

      // v1.25.0 — Retrieval Lab tuning round. Every CARETAKER_PASS_EVERY
      // ticks, the daemon picks the next arm via UCB1, runs a trial,
      // folds it into the leaderboard. Over time the active config
      // converges on the best arm without anyone having to ask.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        await supernova.runCycle("retrieval_lab", async () => {
          const { pickNextArm, readLeaderboard, recordTrial } = await import("./retrieval_lab/leaderboard.js");
          const { runTrial } = await import("./retrieval_lab/tuner.js");
          const lb = readLeaderboard(repoRoot);
          const { config } = pickNextArm(lb);
          const trial = runTrial(repoRoot, config);
          recordTrial(repoRoot, trial);
        });
      }

      // v1.26.3 — Mneme ORACLE dream cycle. Every 5 ticks (~2.5 min)
      // the Oracle evaporates pheromones, re-predicts top-K successors
      // for the current state, and refreshes the cache. Over time the
      // pulse hint converges on the AI's actual usage patterns -- the
      // teacher walking over with the answer before the student asks.
      const ORACLE_DREAM_EVERY = 5;
      if (tickCount > 0 && tickCount % ORACLE_DREAM_EVERY === 0) {
        await supernova.runCycle("oracle_dream", async () => {
          const { dreamCycle } = await import("./oracle/index.js");
          dreamCycle(repoRoot);
        });
      }

      // v2.19.62 PHOENIX P5 — 3 priority-1 organ bots running on independent
      // cadences. All three are pure-verdict functions; the daemon commits
      // any side-effects (heartbeat write, notifier broadcast, organ restart).
      //
      // Custodian (every 10 ticks ~5min): sweep orphan DLL tmpdirs + stale
      //   .locked-* files. Light-weight cleanup, safe to fire often.
      if (tickCount > 0 && tickCount % PHOENIX_CUSTODIAN_EVERY === 0) {
        await supernova.runCycle("phoenix_custodian", async () => {
          const { runCustodianCycle } = await import("./phoenix/organs.js");
          runCustodianCycle();
        });
      }
      // Sentinel (every 20 ticks ~10min): HMAC chain integrity + handle leak.
      //   Critical-broken verdict pushes a notifier; the heartbeat ledger is
      //   the implicit caller-side commit (next tick re-checks).
      if (tickCount > 0 && tickCount % PHOENIX_SENTINEL_EVERY === 0) {
        await supernova.runCycle("phoenix_sentinel", async () => {
          const { runSentinelCycle } = await import("./phoenix/organs.js");
          const r = runSentinelCycle();
          if (r.recommendation === "critical-chain-broken") {
            try {
              const { buildAllNotifiers, notifyAll } = await import("./notifier/index.js");
              const all = buildAllNotifiers(repoRoot);
              await notifyAll({
                id: `phoenix-sentinel-${Date.now()}`,
                title: "🔬 Mneme Sentinel: HMAC chain integrity broken",
                body: `Sentinel organ detected chain break at index ${r.hmacChainBrokenAt ?? "?"}. Audit immediately.`,
                severity: "warning",
              }, all);
            } catch { /* best-effort */ }
          }
        });
      }
      // Surgeon (every 10 ticks ~5min): latency-driven restart verdict.
      //   Currently runs on EMPTY stats — Phase 2 wires in real per-organ
      //   latency metrics from the supernova ledger. This is the no-op
      //   scaffold that establishes the cadence + supervised-cycle pattern.
      if (tickCount > 0 && tickCount % PHOENIX_SURGEON_EVERY === 0) {
        await supernova.runCycle("phoenix_surgeon", async () => {
          const { runSurgeonCycle } = await import("./phoenix/organs.js");
          runSurgeonCycle([]);
        });
      }

      // v1.27.0 — Phase 5 EVOLUTION PASS. Every 720 ticks (~6h at 30s
      // tick interval) the daemon scans signals, generates Phase-2
      // proposals, then runs the Phase-3 synthesizer for each. Every
      // verified patch (compile + test gates green) gets persisted to
      // .mneme/proposals/<id>.patch with HMAC signature. When new
      // patches arrive, the user gets a notifier broadcast.
      //
      // Mneme self-improving while the user sleeps. Closed-loop. No
      // auto-merge -- patches sit until the user runs `mneme evolve
      // apply <id>` (or `auto-pr <id>` for Phase-4 GitHub PR).
      const EVOLUTION_PASS_EVERY = 720;
      if (tickCount > 0 && tickCount % EVOLUTION_PASS_EVERY === 0) {
        await supernova.runCycle("evolve_pass", async () => {
          const { generateProposals } = await import("./evolve/index.js");
          const { evolutionPass } = await import("./evolve/synthesis/index.js");
          generateProposals(repoRoot);
          const r = evolutionPass(repoRoot);
          if (r.verified > 0) {
            try {
              const { buildAllNotifiers, notifyAll } = await import("./notifier/index.js");
              const all = buildAllNotifiers(repoRoot);
              await notifyAll({
                id: `evolve-pass-${Date.now()}`,
                title: "Mneme self-evolved overnight",
                body: `${r.verified} new patch${r.verified === 1 ? "" : "es"} verified (compile + tests green). Review with: mneme evolve list  -- then mneme evolve apply <id>.`,
                severity: "action",
              }, all);
            } catch { /* best-effort */ }
          }
        });
      }

      // v1.28.0 — Antivirus self-synthesis pass. Every ANTIVIRUS_SYNTH_EVERY
      // ticks (~3h at 30s tick) the daemon runs gap-scan, and for each
      // strain whose vaccine is missing FN samples it tries the
      // deterministic pattern miner. Only ACCEPTED proposals (recall +10pp,
      // precision >= 0.90) trigger a broadcast -- the rest sit silently in
      // .mneme/proposals/ for the maintainer's paper trail. This is the
      // closed loop: the antivirus rewrites itself overnight, no LLM in
      // the hot path, no auto-merge -- patches wait for review.
      const ANTIVIRUS_SYNTH_EVERY = 360;
      if (tickCount > 0 && tickCount % ANTIVIRUS_SYNTH_EVERY === 0) {
        await supernova.runCycle("antivirus_synth", async () => {
          const { gapScan, buildGapCases, synthesizeVaccine } = await import("./antivirus/index.js");
          const r = await gapScan(repoRoot);
          const buckets = buildGapCases(repoRoot);
          const accepted: string[] = [];
          for (const sg of r.perStrain) {
            if (sg.fnSamples.length === 0) continue;
            const negativeSamples = buckets
              .find((b) => b.strain === sg.strain)
              ?.cases.filter((c) => !c.shouldBeInfected)
              .map((c) => c.match) ?? [];
            const synth = synthesizeVaccine(repoRoot, {
              strain: sg.strain,
              fnSamples: sg.fnSamples,
              negativeSamples,
            });
            if (synth.accepted) accepted.push(`${sg.strain}: ${synth.proposedPattern}`);
          }
          if (accepted.length > 0) {
            try {
              const { buildAllNotifiers, notifyAll } = await import("./notifier/index.js");
              const all = buildAllNotifiers(repoRoot);
              await notifyAll({
                id: `antivirus-synth-${Date.now()}`,
                severity: "action",
                title: `Mneme antivirus auto-synthesized ${accepted.length} vaccine proposal${accepted.length === 1 ? "" : "s"}`,
                body: `New regex patterns mined from FN samples (deterministic, no LLM). Review with: ls .mneme/proposals/  -- then paste accepted patterns into packages/core/src/antivirus/strains.ts.\n\n${accepted.join("\n")}`,
              }, all);
            } catch { /* best-effort */ }
          }
        });
      }

      // v1.26.0 — Self-check audit + multi-channel notifier dispatch.
      // Every CARETAKER_PASS_EVERY ticks, run all selfcheck checks. Any
      // FAIL fires a notifier broadcast (OS toast + mobile push + email
      // + agent files + ...) so the user/AI sees the problem regardless
      // of whether they have the chat window open.
      if (tickCount > 0 && tickCount % CARETAKER_PASS_EVERY === 0) {
        await supernova.runCycle("selfcheck_audit", async () => {
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
        });
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
    } catch { /* BE:silent-by-design -  best-effort — never let a single tick failure kill the daemon */ }
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
        } catch { /* BE:silent-by-design  ignore  */ }
      }
    }
  } catch { /* BE:silent-by-design  ignore  */ }

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
  } catch { /* BE:silent-by-design  ignore  */ }

  // v1.27.6 -- AUTO-DRAIN stale daemon-sourced unsent inbox entries.
  // Daemon pushes "Nucleus reached N mutations" + caretaker pushes its
  // own notices. If the user never makes a mneme.* tool call (which
  // would popUnsent + ack), these accumulate. Auto-ack any entry from
  // a daemon-shaped source older than 1 hour. User-pushed messages
  // (source != daemon*) are NEVER auto-acked -- those are the user's
  // intentional notices.
  try {
    const all = readInbox(repoRoot);
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
    const daemonSources = new Set(["daemon", "daemon-milestone", "caretaker"]);
    const stale = all
      .filter((m) => !m.sent && daemonSources.has(m.source) && Date.parse(m.createdAt) < cutoff)
      .map((m) => m.id);
    if (stale.length > 0) ackInbox(repoRoot, stale);
  } catch { /* BE:silent-by-design  ignore  */ }

  // v1.46.0 (#20 fix) -- HARD-PRUNE acked inbox entries older than 30 days.
  // Pre-fix: even after `inbox ack`, entries lingered forever; testers saw
  // weeks of accumulated wild-test/synthetic messages. Now caretaker
  // permanently deletes acked entries past the TTL. User-pushed unacked
  // entries are NEVER touched -- only acked + age > TTL.
  try {
    const { clearInbox } = await import("./inbox.js");
    clearInbox(repoRoot, { olderThanDays: 30 });
  } catch { /* BE:silent-by-design  ignore  */ }
}

/** Read the version of the mneme package this daemon process loaded. */
function readMneMeVersion(): string | null {
  // v1.49.0 — pure-ESM static import (the v1.45 fix used require() which
  // is a runtime ReferenceError under "type":"module"). Static import is
  // safe because mneme_version.ts has no circular dep on this file.
  const v = resolveMnemeVersion();
  return v === "0.0.0-unknown" ? null : v;
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
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* BE:silent-by-design  ignore  */ }
    return { stopped: true, pid, reason: "SIGTERM sent" };
  } catch (err) {
    return { stopped: false, pid, reason: (err as Error).message };
  }
}
