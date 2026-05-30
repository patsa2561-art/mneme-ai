/**
 * `mneme loopguard` + `mneme resume` (v2.110.0) — the honest core of Terminal
 * Cognitive Telemetry. Reads the LOOPGUARD event ledger (fed by `mneme absorb`)
 * and answers two deterministic questions:
 *   - loopguard: are we THRASHING on the same failure right now? (objective)
 *   - resume:    where did this session leave off? (deterministic reconstruction)
 *
 * No mind-reading, no LLM — a sequence of events → a verdict. The known fix is
 * recalled from the COGNITIVE CORTEX (learned shell recoveries).
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreLG {
  loopguard: {
    LOOPGUARD_LEDGER: string;
    parseLedger: (t: string) => unknown[];
    detectStuck: (e: unknown[], o?: unknown) => { stuck: boolean; signature: string; command: string; repeats: number; reason: string; threshold: number };
    summarizeSession: (e: unknown[], recall?: (s: string) => string | null, o?: unknown) => { lastCommand: string; lastError: string | null; resolved: boolean; repeatedFailures: Array<{ signature: string; count: number; base: string }>; stuck: { stuck: boolean; repeats: number; signature: string }; suggestion: string | null; headline: string };
  };
  cortex: { activeView: (s: unknown) => Map<string, { value: string }> };
  shellAutopilot: { recoveryKey: (sig: string) => string };
}
async function core(): Promise<CoreLG | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreLG; if (c.loopguard) return c; } catch { /* */ }
  return null;
}

function loadEvents(m: CoreLG, cwd: string): unknown[] {
  try { const p = join(cwd, m.loopguard.LOOPGUARD_LEDGER); if (!existsSync(p)) return []; return m.loopguard.parseLedger(readFileSync(p, "utf8")); } catch { return []; }
}
function loadStore(cwd: string): unknown {
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")); } catch { /* */ }
  return { v: 1, entries: [] };
}
/** recall a learned recovery for a failure signature from the cortex. */
function makeRecall(m: CoreLG, cwd: string): (sig: string) => string | null {
  const view = (() => { try { return m.cortex.activeView(loadStore(cwd)); } catch { return new Map<string, { value: string }>(); } })();
  return (sig: string) => { try { const e = view.get(m.shellAutopilot.recoveryKey(sig)); return e && typeof e.value === "string" && e.value.length > 0 ? e.value : null; } catch { return null; } };
}

export function registerLoopguardCommands(program: Command): void {
  program
    .command("loopguard")
    .description("🔁 LOOPGUARD — are you (or an agent) THRASHING? Detects when the SAME failure repeats ≥N times with no success in between (objective, not mind-reading) and surfaces what's already known. Reads the ledger fed by `mneme absorb`.")
    .option("--threshold <n>", "repeats before it's a thrash", (v) => parseInt(v, 10), 3)
    .option("--window <min>", "trailing window in minutes", (v) => parseInt(v, 10), 15)
    .option("--json", "JSON output.")
    .action(async (opts: { threshold?: number; window?: number; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const events = loadEvents(m, cwd);
      const v = m.loopguard.detectStuck(events, { threshold: opts.threshold, windowMs: (opts.window ?? 15) * 60_000 });
      if (opts.json) { writeJson(v); return; }
      if (!v.stuck) { writeText(`✓ no thrash detected (${events.length} events) — ${v.reason}`); return; }
      const recall = makeRecall(m, cwd);
      const fix = recall(v.signature);
      writeText(`🔁 THRASH: \`${v.command}\` failed ${v.repeats}× (signature ${v.signature})`);
      writeText(`   ${v.reason}`);
      if (fix) writeText(`   💡 known recovery (recalled): ${fix}`);
      else writeText(`   (no learned recovery yet — teach one: mneme absorb --cmd "${v.command}" --code 1 --fix "<the fix>")`);
    });

  program
    .command("resume")
    .description("⏸▶ RESUME — pull your focus back in 3 seconds. Deterministically reconstructs where this session left off from the `mneme absorb` ledger: last command, last UNRESOLVED error, repeated failures, and the known next move.")
    .option("--json", "JSON output.")
    .action(async (opts: { json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const events = loadEvents(m, cwd);
      const recall = makeRecall(m, cwd);
      const r = m.loopguard.summarizeSession(events, recall);
      if (opts.json) { writeJson(r); return; }
      writeText(`▶ ${r.headline}`);
      if (r.lastError && !r.resolved) {
        writeText(`   ✗ open error: ${r.lastError}`);
        if (r.suggestion) writeText(`   💡 known fix: ${r.suggestion}`);
      }
      if (r.stuck.stuck) writeText(`   🔁 you are thrashing on this (${r.stuck.repeats}×) — stop and try the known fix above`);
      if (r.repeatedFailures.length > 0) {
        writeText(`   repeated failures:`);
        for (const f of r.repeatedFailures.slice(0, 5)) writeText(`     ${f.count}×  ${f.base}  (${f.signature})`);
      }
    });
}
