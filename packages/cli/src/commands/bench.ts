/**
 * `mneme bench` — AI-Memory-Bench CLI.
 *
 * Two modes:
 *   1. `--probes-out <file>`  → emit JSON of probes for the AI to answer
 *   2. `--score <answers.json>` → score AI's answers, render leaderboard
 *
 * Workflow:
 *   $ mneme bench --probes-out probes.json
 *   $ <feed probes.json questions to your AI; collect answers as JSON map>
 *   $ mneme bench --score answers.json --label "claude-code-with-mneme"
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git, bench } from "@mneme-ai/core";

export interface BenchOptions {
  cwd: string;
  probesOut?: string;
  score?: string;
  label?: string;
  category?: bench.ProbeCategory;
  json?: boolean;
}

export async function benchCommand(opts: BenchOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  const probes = opts.category
    ? bench.STANDARD_PROBES.filter((p: bench.Probe) => p.category === opts.category)
    : bench.STANDARD_PROBES;

  // ── Mode 1: emit probes for AI to answer ──────────────────────────
  if (opts.probesOut) {
    const out = probes.map((p: bench.Probe) => ({
      id: p.id,
      category: p.category,
      question: p.question,
      tags: p.tags,
    }));
    writeFileSync(opts.probesOut, JSON.stringify(out, null, 2), "utf8");
    if (opts.json) {
      process.stdout.write(JSON.stringify({ probesEmitted: out.length, path: opts.probesOut }, null, 2) + "\n");
    } else {
      ui.banner();
      process.stdout.write(
        kleur.bold(`\n  📐 AI-Memory-Bench — ${out.length} probe(s) written to ${opts.probesOut}\n\n`) +
          "  Next:\n" +
          "    1. Feed each `question` to your AI client (with or without Mneme attached)\n" +
          "    2. Collect responses into a JSON map: { \"<probe-id>\": \"<answer>\", ... }\n" +
          "    3. Run: " + kleur.cyan("mneme bench --score answers.json --label '<your-config>'") + "\n\n",
      );
    }
    return 0;
  }

  // ── Mode 2: score AI answers ──────────────────────────────────────
  if (opts.score) {
    if (!existsSync(opts.score)) {
      ui.error(`No such answers file: ${opts.score}`);
      return 1;
    }
    let answers: Record<string, string>;
    try {
      answers = JSON.parse(readFileSync(opts.score, "utf8")) as Record<string, string>;
    } catch (err) {
      ui.error(`Could not parse answers JSON: ${(err as Error).message}`);
      return 1;
    }
    const result = await bench.runBench(probes, answers, meta.rootPath);
    const label = opts.label ?? "unnamed-run";

    if (opts.json) {
      process.stdout.write(JSON.stringify({ label, ...result }, null, 2) + "\n");
      return 0;
    }
    ui.banner();
    process.stdout.write("\n" + bench.renderLeaderboard(result, label) + "\n\n");
    process.stdout.write(
      kleur.gray(
        "  Tip: pipe " + kleur.cyan("--json") + " into your CI to fail builds when " +
          "Wilson lower bound drops below your threshold.\n\n",
      ),
    );
    return result.hallucinationRate > 0.1 ? 1 : 0;
  }

  // ── No mode → print help ──────────────────────────────────────────
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  📐 AI-Memory-Bench — the first reproducible benchmark for AI memory layers\n\n") +
      `  Probes available: ${kleur.green(`${probes.length}`)} (across ${kleur.cyan(`${new Set(probes.map((p) => p.category)).size}`)} categories)\n\n` +
      "  Usage:\n" +
      `    ${kleur.cyan("mneme bench --probes-out probes.json")}     emit probes for the AI to answer\n` +
      `    ${kleur.cyan("mneme bench --score answers.json --label X")}   score the AI's answers\n\n` +
      "  Why measure: if you can't quantify hallucination, you can't reduce it.\n" +
      "  Run with + without Mneme attached, compare the two leaderboards.\n\n",
  );
  return 0;
}
