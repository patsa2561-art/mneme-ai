/**
 * `mneme precog` -- PRECOGNITION cache CLI (v1.26.3).
 *
 *   mneme precog peek                  show cached predictions + freshness
 *   mneme precog predict <fromTool>    top-K next tools given current state
 *   mneme precog stats                 hit rate / pheromone density / etc.
 *   mneme precog dream                 run one dream cycle manually
 *   mneme precog observe <tool> [--args k1,k2]
 *                                      record an observation (debugging)
 *   mneme precog reset                 wipe all oracle state
 *   mneme precog hint                  print the [PRECOG] line for the pulse
 *
 * Precog is a Markov + ACO pheromone + dream-loop predictor over the
 * AI's tool-call sequence -- world-first for MCP. See
 * packages/core/src/oracle/types.ts for the full algorithm.
 *
 * (The internal module is still `oracle/` because we wrote it before
 * realising `mneme oracle` was already taken by an unrelated co-edit
 * predictor. The user-facing surface is `precog`. Welcome to brand
 * archaeology.)
 */

import type { Command } from "commander";
import { oracle } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerOracleCommands(program: Command): void {
  const orc = program
    .command("precog")
    .alias("precognition")
    .description("MNEME PRECOG -- Markov + ACO pheromone + dream-loop precognition cache for AI tool sequences (world-first for MCP).");

  orc.command("peek")
    .description("Show every cached prediction (fresh + expired).")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const preds = oracle.peekCache(process.cwd());
      if (opts.json) { writeJson(preds); return; }
      if (preds.length === 0) { writeText("(no predictions cached -- run `mneme oracle dream` to populate)"); return; }
      const now = Date.now();
      writeText(`Oracle cache -- ${preds.length} prediction(s)`);
      for (const p of preds) {
        const fresh = Date.parse(p.expiresAt) > now;
        const tag = p.hit ? "HIT" : fresh ? "FRESH" : "EXPIRED";
        writeText(`  [${tag.padEnd(7)}] ${p.fromTool}  ->  ${p.toTool}  (conf ${(p.confidence * 100).toFixed(1)}%, exp ${p.expiresAt})`);
      }
    });

  orc.command("predict <fromTool>")
    .description("Predict top-K likely next tools after fromTool.")
    .option("-k <n>", "how many predictions (default 3)", (v) => Number(v))
    .option("--json", "JSON output.")
    .action((fromTool: string, opts: { k?: number } & CommonOpts) => {
      const k = opts.k ?? 3;
      const preds = oracle.predictNext(process.cwd(), fromTool, k);
      if (opts.json) { writeJson(preds); return; }
      if (preds.length === 0) {
        writeText(`(oracle has no signal for ${fromTool} yet -- record more observations)`);
        return;
      }
      writeText(`After ${fromTool}, oracle predicts:`);
      for (const p of preds) {
        writeText(`  -> ${p.tool}  conf=${(p.confidence * 100).toFixed(1)}%  markov=${(p.pMarkov * 100).toFixed(1)}%  phero=${p.tau.toFixed(2)}`);
      }
    });

  orc.command("stats")
    .description("Aggregate Oracle stats: hit rate, observations, pheromone density.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const s = oracle.oracleStats(process.cwd());
      if (opts.json) { writeJson(s); return; }
      writeText(`Oracle stats`);
      writeText(`  Observations:    ${s.totalObservations} (${s.uniqueTools} unique tools)`);
      writeText(`  Bigram edges:    ${s.bigramCount}`);
      writeText(`  Pheromone:       ${s.pheromoneEdges} edges`);
      writeText(`  Predictions:     ${s.predictions} cached, ${s.hits} hits`);
      writeText(`  Hit rate:        ${(s.hitRate * 100).toFixed(1)}%`);
      writeText(`  Dream cycles:    ${s.dreamCycles}`);
      writeText(`  Current state:   ${s.currentState ?? "(none)"}`);
      writeText(`  Last dream:      ${s.lastDreamAt ?? "(never)"}`);
    });

  orc.command("dream")
    .description("Run one dream cycle: evaporate pheromones, regenerate predictions, drop expired.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const r = oracle.dreamCycle(process.cwd());
      if (opts.json) { writeJson(r); return; }
      writeText(`Dream cycle complete.`);
      writeText(`  Evaporated edges:  ${r.evaporatedEdges}`);
      writeText(`  New predictions:   ${r.predictions.length}`);
      for (const p of r.predictions) {
        writeText(`    -> ${p.toTool}  conf=${(p.confidence * 100).toFixed(1)}%  exp ${p.expiresAt}`);
      }
    });

  orc.command("observe <tool>")
    .description("Manually record a tool-call observation (for debugging / seeding).")
    .option("--args <keys>", "comma-separated list of arg keys (default empty)", (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .option("--json", "JSON output.")
    .action((tool: string, opts: { args?: string[] } & CommonOpts) => {
      const o = oracle.recordObservation(process.cwd(), tool, opts.args ?? []);
      if (opts.json) { writeJson(o); return; }
      writeText(`Recorded ${tool} at ${o.at}`);
    });

  orc.command("hint")
    .description("Print the [ORACLE] hint line that would be injected into the pulse.")
    .action(() => {
      const text = oracle.renderOracleHint(process.cwd());
      if (text) writeText(text);
      else writeText("(no hint -- top prediction below confidence threshold)");
    });

  orc.command("reset")
    .description("DELETE all oracle state (observations, pheromones, predictions, stats).")
    .action(() => {
      oracle.resetOracle(process.cwd());
      writeText(`Oracle state reset.`);
    });

  // v1.26.6 -- chicken-and-egg breaker. Plant a synthetic Mneme-shaped
  // sequence so peek/predict/hint all show populated state without
  // needing a live MCP connection.
  orc.command("seed")
    .description("Plant a synthetic observation trail (5x 8 sessions over the past hour) + run 2 dream cycles. Demoable instantly.")
    .option("--demo", "Required confirmation flag (this overwrites existing oracle state).")
    .option("--json", "JSON output.")
    .action((opts: { demo?: boolean } & CommonOpts) => {
      if (!opts.demo) {
        writeText(`This wipes existing PRECOG state. Re-run with --demo to confirm.`);
        process.exit(1);
        return;
      }
      const r = oracle.seedDemoOracle(process.cwd());
      const stats = oracle.oracleStats(process.cwd());
      const top = stats.currentState ? oracle.predictNext(process.cwd(), stats.currentState, 3) : [];
      if (opts.json) { writeJson({ ...r, stats, topPredictions: top }); return; }
      writeText(`Seeded PRECOG with ${r.observations} observations + ${r.dreamCycles} dream cycles.`);
      writeText(``);
      writeText(`Stats now:`);
      writeText(`  Observations:    ${stats.totalObservations} (${stats.uniqueTools} unique tools)`);
      writeText(`  Bigram edges:    ${stats.bigramCount}`);
      writeText(`  Pheromone:       ${stats.pheromoneEdges} edges`);
      writeText(`  Predictions:     ${stats.predictions} cached`);
      writeText(`  Current state:   ${stats.currentState ?? "(none)"}`);
      if (top.length > 0) {
        writeText(``);
        writeText(`Top 3 predictions from current state:`);
        for (const p of top) {
          writeText(`  -> ${p.tool}  conf=${(p.confidence * 100).toFixed(1)}%`);
        }
      }
      writeText(``);
      writeText(`Try: mneme precog hint  |  mneme precog peek  |  mneme nucleus pulse --no-quiet`);
    });
}
