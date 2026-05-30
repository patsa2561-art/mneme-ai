/**
 * `mneme map` (v2.116.0) — render the Visual Knowledge Map: a gorgeous,
 * dependency-free constellation of Mneme's live signed state (savings / loop /
 * cortex / treasury) that auto-adapts to the terminal (truecolor gradients →
 * 256-color → plain ASCII on a pipe/CI). Zero config — it just renders the
 * richest form the surface supports.
 *
 *   mneme map            # the live knowledge-map frame
 *   mneme map --json     # the underlying state (for embedding)
 *
 * Gathering is best-effort + total: missing ledgers → idle nodes, never an error.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function writeText(l: string): void { process.stdout.write(l + "\n"); }
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }

interface CoreV {
  visual: {
    detectCaps: (env: Record<string, string | undefined>, isTTY: boolean, cols?: number) => unknown;
    renderKnowledgeMap: (state: unknown, caps: unknown) => string;
  };
  treasury?: { parseLedger: (t: string) => unknown[]; aggregate: (e: unknown[]) => { tokensSaved: number; savedPct: number; events: number } };
  loopguard?: { LOOPGUARD_LEDGER: string; parseLedger: (t: string) => unknown[]; detectStuck: (e: unknown[]) => { stuck: boolean } };
}
async function core(): Promise<CoreV | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreV; if (c.visual) return c; } catch { /* */ }
  return null;
}

function readVersion(): string { try { return String(require("../../package.json").version); } catch { return ""; } }

/** Gather the live state into a MapState (best-effort, total). */
function gatherState(m: CoreV, cwd: string): { state: Record<string, unknown> } {
  const nodes: Array<{ label: string; status: string }> = [];
  let headline = "";
  let savingsSpark: number[] = [];

  // TREASURY — token savings
  try {
    const p = join(cwd, ".mneme", "treasury", "ledger.jsonl");
    if (existsSync(p) && m.treasury) {
      const evs = m.treasury.parseLedger(readFileSync(p, "utf8")) as Array<{ tokensBefore: number; tokensAfter: number }>;
      const agg = m.treasury.aggregate(evs);
      if (agg.events > 0) {
        nodes.push({ label: "SAVINGS", status: "ok" });
        headline = `${agg.tokensSaved.toLocaleString()} input tokens saved (−${agg.savedPct}%)`;
        savingsSpark = evs.slice(-24).map((e) => Math.max(0, (e.tokensBefore || 0) - (e.tokensAfter || 0)));
      } else { nodes.push({ label: "SAVINGS", status: "idle" }); }
    } else { nodes.push({ label: "SAVINGS", status: "idle" }); }
  } catch { nodes.push({ label: "SAVINGS", status: "idle" }); }

  // LOOPGUARD — thrash state
  try {
    const p = join(cwd, m.loopguard?.LOOPGUARD_LEDGER ?? ".mneme/loopguard/events.jsonl");
    if (existsSync(p) && m.loopguard) {
      const v = m.loopguard.detectStuck(m.loopguard.parseLedger(readFileSync(p, "utf8")));
      nodes.unshift({ label: "LOOP", status: v.stuck ? "bad" : "ok" });
    } else { nodes.unshift({ label: "LOOP", status: "idle" }); }
  } catch { nodes.unshift({ label: "LOOP", status: "idle" }); }

  // CORTEX — shared facts
  try {
    const p = join(cwd, ".mneme", "cortex", "store.json");
    if (existsSync(p)) {
      const store = JSON.parse(readFileSync(p, "utf8")) as { entries?: unknown[] };
      const n = Array.isArray(store.entries) ? store.entries.length : 0;
      nodes.push({ label: "CORTEX", status: n > 0 ? "ok" : "idle" });
    } else { nodes.push({ label: "CORTEX", status: "idle" }); }
  } catch { nodes.push({ label: "CORTEX", status: "idle" }); }

  // TRUTH — always present (the savant identity)
  nodes.unshift({ label: "TRUTH", status: "ok" });

  return { state: { version: readVersion(), nodes, savingsSpark, headline: headline || undefined, signed: true } };
}

export function registerMapCommands(program: Command): void {
  program
    .command("map")
    .alias("visual")
    .description("🗺️ VISUAL KNOWLEDGE MAP — render Mneme's live signed state as a gorgeous terminal constellation (savings / loop / cortex / truth). Auto-adapts: truecolor gradients → 256-color → plain ASCII on a pipe/CI. Zero config.")
    .option("--json", "emit the underlying state instead of the rendered frame.")
    .option("--ascii", "force pure-ASCII output (no color, no Unicode).")
    .action(async (opts: { json?: boolean; ascii?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const { state } = gatherState(m, cwd);
      if (opts.json) { writeJson(state); return; }
      const env = opts.ascii ? { ...process.env, MNEME_NO_COLOR: "1", MNEME_ASCII: "1" } : process.env;
      const caps = m.visual.detectCaps(env as Record<string, string | undefined>, Boolean(process.stdout.isTTY), process.stdout.columns);
      writeText(m.visual.renderKnowledgeMap(state, caps));
    });
}
