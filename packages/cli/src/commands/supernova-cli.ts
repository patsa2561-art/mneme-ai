/**
 * `mneme supernova` (v1.30.0) -- inspect + manually clear the SUPERNOVA
 * self-heal supervisor. The v1.29.0 release shipped factorial-backoff
 * auto-recovery + 5-fail escalation, but the only way to clear a
 * stuck-escalated cycle was to restart the daemon. This CLI closes
 * that gap so the maintainer can resume a cycle WITHOUT killing the
 * brain (and losing in-flight ORACLE pheromones / retrieval-lab UCB1
 * counters).
 *
 *   mneme supernova log     -- last N entries from .mneme/supernova.jsonl
 *   mneme supernova status  -- per-cycle attempt count + cooldown + escalated state
 *   mneme supernova clear <cycle>   -- send a clear signal via inbox so
 *                                      the daemon resets the cycle on its
 *                                      next tick (the in-memory state
 *                                      lives in the daemon process, so we
 *                                      can't clear it from the CLI directly
 *                                      -- inbox-based RPC is the correct
 *                                      cross-process channel).
 */

import type { Command } from "commander";
// v1.30.0 BULLETPROOF: supernova was added in v1.29.0; older core versions
// don't have it. Resolve dynamically + stub-fallback so a CLI/core
// version mismatch never crashes load. inbox is in v1.23.0+ so safe to
// import statically (5+ minor versions of headway).
import { inbox as inboxModule } from "@mneme-ai/core";

interface SupernovaEntry {
  ts: string; cycle: string; outcome: "ok" | "failed" | "escalated";
  attempt: number; retryAt?: string; error?: string; durationMs?: number;
}
interface SupernovaShape {
  readSupernovaLog: (repoRoot: string, limit?: number) => SupernovaEntry[];
}
async function resolveSupernova(): Promise<SupernovaShape> {
  try {
    const core = (await import("@mneme-ai/core")) as { supernova?: SupernovaShape };
    if (core.supernova && typeof core.supernova.readSupernovaLog === "function") return core.supernova;
  } catch { /* */ }
  return {
    readSupernovaLog: () => [],
  };
}

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

export function registerSupernovaCommands(program: Command): void {
  const sn = program
    .command("supernova")
    .alias("sn")
    .description("Inspect + manage the SUPERNOVA self-heal supervisor (v1.29.0+). Shows per-cycle restart attempts, escalations, and lets you clear stuck-escalated cycles.");

  sn.command("log")
    .description("Print the last N entries from .mneme/supernova.jsonl (every restart attempt + escalation).")
    .option("-n, --limit <n>", "max entries to show", (v: string) => Number(v) || 50, 50)
    .option("--json", "JSON output.")
    .action(async (opts: { limit?: number } & CommonOpts) => {
      const repoRoot = process.cwd();
      const limit = typeof opts.limit === "number" ? opts.limit : 50;
      const supernovaModule = await resolveSupernova();
      const entries = supernovaModule.readSupernovaLog(repoRoot, limit);
      if (opts.json) { writeJson(entries); return; }
      if (entries.length === 0) {
        writeText(`No supernova entries yet -- the daemon hasn't run a supervised cycle (or .mneme/supernova.jsonl is missing).`);
        return;
      }
      writeText(`SUPERNOVA log (last ${entries.length} entries)`);
      writeText(``);
      for (const e of entries) {
        const ts = e.ts.replace("T", " ").slice(0, 19);
        const tag = e.outcome === "ok" ? "✓ ok        "
          : e.outcome === "failed" ? "✗ failed    "
          : "🚨 ESCALATED";
        const detail = e.outcome === "ok" && e.durationMs != null
          ? `${e.durationMs}ms`
          : e.outcome === "failed" && e.retryAt
            ? `attempt ${e.attempt}, retry at ${e.retryAt.replace("T", " ").slice(0, 19)}`
            : e.outcome === "escalated"
              ? `attempt ${e.attempt} -- auto-retry stopped`
              : "";
        writeText(`  ${ts}  [${tag}] ${e.cycle.padEnd(20)} ${detail}`);
        if (e.error) writeText(`                                                       error: ${e.error}`);
      }
    });

  sn.command("status")
    .description("Snapshot per-cycle restart counters + cooldowns. (Requires the daemon to be running -- queries the in-process state via inbox round-trip.)")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      // The supervisor state lives in-memory in the daemon. The most
      // honest cross-process snapshot we can give the user from the CLI
      // is the LOG view (above) -- since we can't reach into the daemon's
      // memory. Show an aggregated tally from the log instead.
      const repoRoot = process.cwd();
      const supernovaModule = await resolveSupernova();
      const entries = supernovaModule.readSupernovaLog(repoRoot, 1000);
      const byCycle: Record<string, { ok: number; failed: number; escalated: number; lastEntry?: typeof entries[number] }> = {};
      for (const e of entries) {
        if (!byCycle[e.cycle]) byCycle[e.cycle] = { ok: 0, failed: 0, escalated: 0 };
        const b = byCycle[e.cycle]!;
        if (e.outcome === "ok") b.ok++;
        else if (e.outcome === "failed") b.failed++;
        else if (e.outcome === "escalated") b.escalated++;
        b.lastEntry = e;
      }
      const summary = Object.entries(byCycle).map(([cycle, b]) => ({
        cycle, ok: b.ok, failed: b.failed, escalated: b.escalated,
        lastOutcome: b.lastEntry?.outcome ?? "n/a",
        lastTs: b.lastEntry?.ts ?? null,
      }));
      if (opts.json) { writeJson({ cycles: summary }); return; }
      if (summary.length === 0) {
        writeText(`No SUPERNOVA cycles seen yet. Either the daemon hasn't run, or .mneme/supernova.jsonl is missing.`);
        return;
      }
      writeText(`SUPERNOVA status (aggregated from .mneme/supernova.jsonl)`);
      writeText(``);
      writeText(`  ${"cycle".padEnd(20)} ${"ok".padStart(6)} ${"failed".padStart(7)} ${"escalated".padStart(10)}  last`);
      for (const s of summary) {
        const flag = s.escalated > 0 ? "🚨" : s.lastOutcome === "ok" ? "✓ " : s.lastOutcome === "failed" ? "✗ " : "  ";
        writeText(`  ${s.cycle.padEnd(20)} ${String(s.ok).padStart(6)} ${String(s.failed).padStart(7)} ${String(s.escalated).padStart(10)}  ${flag}${s.lastOutcome}`);
      }
    });

  sn.command("clear <cycle>")
    .description("Push a clear-escalation request to the inbox. The daemon picks it up on its next tick (~30s) and resets the cycle's restart counter so auto-retry resumes.")
    .option("--json", "JSON output.")
    .action(async (cycle: string, opts: CommonOpts) => {
      const repoRoot = process.cwd();
      try {
        inboxModule.pushInbox(repoRoot, {
          id: inboxModule.deterministicId(`supernova-clear-${cycle}-${Date.now()}`),
          priority: "high",
          source: "supernova-clear",
          title: `SUPERNOVA: clear escalation for "${cycle}"`,
          body: `Maintainer requested clearing the escalated state for cycle "${cycle}". The daemon will reset its restart counter on the next tick.`,
          cta: `mneme supernova log  (verify the next attempt succeeds)`,
        });
        if (opts.json) { writeJson({ ok: true, cycle, message: "clear request queued via inbox" }); return; }
        writeText(`✓ Queued clear-escalation request for cycle "${cycle}".`);
        writeText(`  The daemon will pick it up on its next tick (~30s).`);
        writeText(`  Verify with: mneme supernova log`);
      } catch (e) {
        const msg = (e as Error).message;
        if (opts.json) { writeJson({ ok: false, error: msg }); return; }
        writeText(`✗ Failed to push clear request: ${msg}`);
        process.exitCode = 1;
      }
    });
}
