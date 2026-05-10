/**
 * `mneme retrieval` -- Retrieval Lab CLI surface.
 *
 *   mneme retrieval lab          -- show leaderboard + active config
 *   mneme retrieval tune [--config X] [--rounds N] -- run trial(s)
 *   mneme retrieval configs      -- list candidate arms
 *   mneme retrieval rerank "<query>" "<text1>" "<text2>" ... -- cross-encoder
 *   mneme retrieval hyde "<query>" -- show the HyDE prompt payload
 */

import type { Command } from "commander";
import { retrievalLab } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

export function registerRetrievalCommands(program: Command): void {
  const r = program
    .command("retrieval")
    .alias("rl")
    .description("Retrieval Lab -- self-tuning retrieval config (UCB1 over candidate arms).");

  r.command("lab")
    .description("Show the leaderboard + active config + Pareto frontier.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const lb = retrievalLab.readLeaderboard(process.cwd());
      const pareto = new Set(retrievalLab.paretoFrontier(lb).map((e) => e.configId));
      if (opts.json) { writeJson({ ...lb, paretoIds: Array.from(pareto) }); return; }
      writeText(`Active config: ${lb.active}   Total trials: ${lb.totalTrials}`);
      writeText(``);
      const sorted = [...lb.entries].sort((a, b) => b.meanComposite - a.meanComposite);
      writeText(`  rank  config                              trials  composite  P     R     NDCG  lat_ms  pareto`);
      sorted.forEach((e, i) => {
        const p = (e.meanPrecisionAtK).toFixed(2);
        const rec = (e.meanRecallAtK).toFixed(2);
        const n = (e.meanNdcgAtK).toFixed(2);
        const c = (e.meanComposite).toFixed(3);
        const lat = Math.round(e.meanLatencyMs);
        const onPareto = pareto.has(e.configId) ? "  *" : "";
        writeText(`  ${String(i + 1).padStart(2)}    ${e.configId.padEnd(36)} ${String(e.trialCount).padStart(6)}  ${c.padStart(8)}  ${p}  ${rec}  ${n}    ${String(lat).padStart(5)}${onPareto}`);
      });
      writeText(``);
      writeText(`(* = Pareto frontier: best tradeoff between quality and latency)`);
    });

  r.command("tune")
    .description("Run retrieval trial(s). Default = UCB1 picks the next arm.")
    .option("--config <id>", "Trial this exact config id.")
    .option("--rounds <n>", "Number of trials to run (default 1).", (v) => Number(v))
    .option("--json", "JSON output.")
    .action(async (opts: { config?: string; rounds?: number } & CommonOpts) => {
      const root = process.cwd();
      const rounds = Math.max(1, Math.min(50, opts.rounds ?? 1));
      const trials = [];
      for (let i = 0; i < rounds; i++) {
        const config = opts.config
          ? retrievalLab.getConfig(opts.config)
          : retrievalLab.pickNextArm(retrievalLab.readLeaderboard(root)).config;
        const t = retrievalLab.runTrial(root, config);
        retrievalLab.recordTrial(root, t);
        trials.push(t);
      }
      const lb = retrievalLab.readLeaderboard(root);
      if (opts.json) { writeJson({ trials, active: lb.active }); return; }
      writeText(`Ran ${rounds} trial${rounds === 1 ? "" : "s"}`);
      for (const t of trials) {
        writeText(`  ${t.configId}  composite=${t.compositeScore.toFixed(3)}  P=${t.meanPrecisionAtK.toFixed(2)} R=${t.meanRecallAtK.toFixed(2)} NDCG=${t.meanNdcgAtK.toFixed(2)} lat=${t.meanLatencyMs}ms  sig=${t.signature.slice(0, 12)}...`);
      }
      writeText(``);
      writeText(`Active config now: ${lb.active}`);
    });

  r.command("configs")
    .description("List candidate arms (with availability).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const available = new Set(retrievalLab.availableEmbedders().map((e) => e.id));
      const data = retrievalLab.CANDIDATE_CONFIGS.map((c) => ({
        ...c,
        available: available.has(c.embedder),
      }));
      if (opts.json) { writeJson(data); return; }
      writeText(`Candidate arms (${data.length})`);
      for (const c of data) {
        const flag = c.available ? "OK" : "--";
        writeText(`  ${flag}  ${c.id.padEnd(36)} ${c.label}`);
        writeText(`         embedder=${c.embedder} rrfK=${c.rrfK} sw=${c.semanticWeight} reranker=${c.reranker} hyde=${c.useHyDE} candK=${c.candidateK}`);
      }
    });

  r.command("rerank <query> [candidates...]")
    .description("Cross-encoder rerank: query + N candidate strings.")
    .option("--top <k>", "Top-K (default = all candidates).", (v) => Number(v))
    .option("--json", "JSON output.")
    .action(async (query: string, candidates: string[], opts: { top?: number } & CommonOpts) => {
      const cands = (candidates ?? []).map((text, i) => ({ id: `c${i + 1}`, text }));
      const r = await retrievalLab.rerankCrossEncoder({ query, candidates: cands, topK: opts.top });
      if (opts.json) { writeJson(r); return; }
      writeText(`Rerank "${query}" -- ${r.modelLoaded ? "bge-reranker-base" : "term-density fallback"} (${r.totalMs}ms)`);
      r.ranked.forEach((c, i) => writeText(`  ${i + 1}. [${c.score.toFixed(3)}] ${c.text.slice(0, 100)}`));
    });

  r.command("hyde <query>")
    .description("Show the HyDE prompt payload for a query.")
    .option("--apply", "Apply deterministic fallback rewrite immediately.")
    .option("--json", "JSON output.")
    .action(async (query: string, opts: { apply?: boolean } & CommonOpts) => {
      if (opts.apply) {
        const r = retrievalLab.applyHyde(query, null);
        if (opts.json) { writeJson(r); return; }
        writeText(`HyDE (${r.source}):`);
        writeText(r.rewritten);
        return;
      }
      const p = retrievalLab.buildHyDePrompt(query);
      if (opts.json) { writeJson(p); return; }
      writeText(`-- HyDE system prompt (give this to your LLM with the query) --`);
      writeText(p.systemPrompt);
      writeText(``);
      writeText(`Query: ${p.query}`);
      writeText(`Max chars: ${p.maxChars}`);
    });
}
