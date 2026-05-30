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
import { getVersion } from "../version.js";

function writeText(l: string): void { process.stdout.write(l + "\n"); }
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }

interface CoreV {
  visual: {
    detectCaps: (env: Record<string, string | undefined>, isTTY: boolean, cols?: number) => unknown;
    renderKnowledgeMap: (state: unknown, caps: unknown) => string;
  };
  treasury?: { parseLedger: (t: string) => unknown[]; aggregate: (e: unknown[]) => { tokensSaved: number; savedPct: number; events: number } };
  loopguard?: { LOOPGUARD_LEDGER: string; parseLedger: (t: string) => unknown[]; detectStuck: (e: unknown[]) => { stuck: boolean } };
  gephyra?: { bridgeStatus: (repoRoot: string) => { crossings: number; quarantined: number; hallucinationsCaught: number; chainValid: boolean } };
}
async function core(): Promise<CoreV | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreV; if (c.visual) return c; } catch { /* */ }
  return null;
}

function readVersion(): string { try { return getVersion(); } catch { return ""; } }

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

  // HYDRA — signed context codebook
  try {
    const p = join(cwd, ".mneme", "hydra", "codebook.json");
    if (existsSync(p)) {
      const cb = JSON.parse(readFileSync(p, "utf8")) as { codebook?: Record<string, unknown> };
      const entries = cb.codebook && typeof cb.codebook === "object" ? Object.keys(cb.codebook).length : 0;
      nodes.push({ label: "HYDRA", status: entries > 0 ? "ok" : "idle" });
    } else { nodes.push({ label: "HYDRA", status: "idle" }); }
  } catch { nodes.push({ label: "HYDRA", status: "idle" }); }

  // GEPHYRA — truth-customs bridge (real status reader)
  try {
    if (m.gephyra) {
      const g = m.gephyra.bridgeStatus(cwd);
      const status = g.quarantined > 0 ? "warn" : g.crossings > 0 && g.chainValid ? "ok" : "idle";
      nodes.push({ label: "GEPHYRA", status });
    } else { nodes.push({ label: "GEPHYRA", status: "idle" }); }
  } catch { nodes.push({ label: "GEPHYRA", status: "idle" }); }

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
    .option("--watch", "live-refresh the map until Ctrl-C (TTY only; on a pipe it renders once).")
    .option("--interval <ms>", "watch refresh interval in ms (default 1500)", (v) => parseInt(v, 10))
    .action(async (opts: { json?: boolean; ascii?: boolean; watch?: boolean; interval?: number }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const env = opts.ascii ? { ...process.env, MNEME_NO_COLOR: "1", MNEME_ASCII: "1" } : process.env;
      const caps = () => m.visual.detectCaps(env as Record<string, string | undefined>, Boolean(process.stdout.isTTY), process.stdout.columns);
      const renderNow = (): string => m.visual.renderKnowledgeMap(gatherState(m, cwd).state, caps());

      if (opts.json) { writeJson(gatherState(m, cwd).state); return; }

      // ── one-shot (default, and the SAFE path on a pipe / CI / non-TTY) ──
      if (!opts.watch || !process.stdout.isTTY) {
        writeText(renderNow());
        return;
      }

      // ── live refresh (TTY only). Alt-screen + hidden cursor; flicker-free
      //    redraw (home + clear-below, not a full clear). Ctrl-C restores. ──
      const interval = Math.max(500, Math.min(10_000, Number.isFinite(opts.interval as number) ? (opts.interval as number) : 1500));
      const ALT_ON = "\x1b[?1049h", ALT_OFF = "\x1b[?1049l", CUR_HIDE = "\x1b[?25l", CUR_SHOW = "\x1b[?25h", HOME = "\x1b[H", CLEAR_BELOW = "\x1b[0J";
      let stopped = false;
      const restore = () => { if (stopped) return; stopped = true; try { process.stdout.write(CUR_SHOW + ALT_OFF); } catch { /* */ } };
      const footer = "\n\n  ctrl-c to exit · live\n";
      const tick = () => { if (stopped) return; try { process.stdout.write(HOME + renderNow() + footer + CLEAR_BELOW); } catch { /* */ } };
      try { process.stdout.write(ALT_ON + CUR_HIDE); } catch { /* */ }
      tick(); // first frame immediately
      const timer = setInterval(tick, interval);
      const onExit = () => { clearInterval(timer); restore(); process.exit(0); };
      process.on("SIGINT", onExit);
      process.on("SIGTERM", onExit);
      // keep the process alive on the timer; never throw
    });
}
