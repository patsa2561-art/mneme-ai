import { git, retrieve, store, wisdom } from "@mneme-ai/core";
import { resolveEmbedder, resolveEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import { Spinner } from "../spinner.js";
import { renderAnswer } from "../render-answer.js";
import { isNoLlm } from "../no-llm.js";
import kleur from "kleur";

export interface AskCommandOptions {
  cwd: string;
  question: string;
  topK?: number;
  json?: boolean;
  /** Skip LLM synthesis (use extractive answer only). */
  noLlm?: boolean;
  /** Show classification reason + raw scores; useful for debugging. */
  debug?: boolean;
}

export async function askCommand(opts: AskCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  // ── Step 1. Classify intent BEFORE retrieval. ────────────────────────
  const intent = retrieve.classifyIntent(opts.question);

  if (opts.debug) {
    ui.dim(`intent=${intent.intent}  reason="${intent.reason}"`);
  }

  // Vague queries — short-circuit and redirect.
  if (intent.intent === "vague") {
    ui.banner();
    process.stdout.write("\n");
    process.stdout.write(`  ${kleur.bold().cyan("Q")}  ${kleur.bold(opts.question)}\n\n`);
    process.stdout.write(`  ${kleur.yellow("⚠")}  ${kleur.bold("Mneme can't answer this directly.")}\n`);
    process.stdout.write(`  ${kleur.gray(intent.reason)}\n\n`);
    if (intent.redirect) {
      for (const line of intent.redirect.split("\n")) {
        process.stdout.write(`  ${line}\n`);
      }
    }
    process.stdout.write("\n");
    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          { question: opts.question, intent: intent.intent, reason: intent.reason },
          null,
          2,
        ) + "\n",
      );
    }
    return 0;
  }

  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  // ── Step 2. Retrieval (with spinner). ────────────────────────────────
  const spinner = new Spinner();
  if (!opts.json) spinner.start("Searching commit history...");

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  const calib = wisdom.readCalibration(s);
  const results = await retrieve.search(opts.question, {
    store: s,
    embedder,
    repo: meta,
    topK: opts.topK ?? 8,
    semanticWeight: calib.semanticWeight,
  });
  const confidence = retrieve.classifyConfidence(results);

  if (!opts.json) spinner.update(`Found ${results.length} candidates · confidence: ${confidence}`);

  // ── Step 3. LLM synthesis (when available + not --no-llm). ───────────
  const useLlm = !isNoLlm(opts.noLlm, cfg);
  let enricher: retrieve.SynthesisEnricher | undefined;
  if (useLlm && confidence !== "none") {
    if (!opts.json) spinner.update("Synthesizing answer...");
    try {
      enricher = await resolveEnricher({
        provider: cfg.embeddings.provider === "openai" ? "openai" : "ollama",
        model: cfg.embeddings.model,
      });
    } catch {
      // No LLM available — extractive fallback in synthesize().
      enricher = undefined;
    }
  }

  const synthesized = await retrieve.synthesize(
    opts.question,
    results,
    confidence,
    enricher,
  );

  spinner.stop();

  // ── Step 4. Wisdom Mutant — record query for the feedback loop. ──────
  let feedbackId: string | undefined;
  try {
    feedbackId = wisdom.recordQuery(s, {
      query: opts.question,
      resultHashes: results.map((r) => r.commit.hash),
      topScore: results[0]?.score,
      semanticWeight: calib.semanticWeight,
      minSemCosine: calib.minSemCosine,
      rrfK: calib.rrfK,
    });
  } catch {
    // Don't break ask if wisdom recording fails.
  }

  s.close();

  // ── Step 5. Output. ──────────────────────────────────────────────────
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          question: opts.question,
          intent: intent.intent,
          confidence,
          synthesized,
          searchResults: results,
          feedbackId,
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  ui.banner();
  process.stdout.write(
    renderAnswer({
      question: opts.question,
      synthesized,
      results,
      repo: meta,
      feedbackId,
    }),
  );
  return 0;
}
