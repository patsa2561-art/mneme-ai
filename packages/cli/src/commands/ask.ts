import { git, retrieve, store, wisdom } from "@mneme-ai/core";
import { resolveEmbedder, resolveAllEnrichers, ResilientEnricher } from "@mneme-ai/embeddings";
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
  /** v0.23: emit speculative-reasoning events (consider/accept/prune/verify) in real-time. */
  stream?: boolean;
  /** Skip LLM synthesis (use extractive answer only). */
  noLlm?: boolean;
  /** Show classification reason + raw scores; useful for debugging. */
  debug?: boolean;
  /**
   * Audit mode — refuse to answer below confidence floor and refuse if any
   * LLM-cited hash is not in the retrieved evidence. Use this when the
   * caller is a CI gate, an MCP tool result going to another agent, or any
   * surface that requires "no hallucination" semantics.
   */
  audit?: boolean;
  /** Confidence floor for audit mode. Defaults to "medium". */
  auditFloor?: "low" | "medium" | "high";
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

  // ── Step 2. Retrieval (with spinner + streaming events when --stream). ─
  const spinner = new Spinner();
  if (!opts.json && !opts.stream) spinner.start("Searching commit history...");

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  // v0.23: streaming events. When --stream, render each consider/accept/prune
  // event in real-time so the user sees Mneme reason. Otherwise NullSink (zero overhead).
  const eventSink = opts.stream && !opts.json
    ? new retrieve.CallbackSink((ev) => renderStreamEvent(ev))
    : new retrieve.NullSink();

  const calib = wisdom.readCalibration(s);
  const results = await retrieve.search(opts.question, {
    store: s,
    embedder,
    repo: meta,
    topK: opts.topK ?? 8,
    semanticWeight: calib.semanticWeight,
    events: eventSink,
  });
  const confidence = retrieve.classifyConfidence(results);

  if (!opts.json && !opts.stream) spinner.update(`Found ${results.length} candidates · confidence: ${confidence}`);

  // ── Step 3. LLM synthesis with self-healing fallback chain. ──────────
  //
  // Free-first ladder, tried in order on EVERY call (not just startup):
  //   1. local Ollama (with auto-picked chat model)
  //   2. GROQ_API_KEY → Groq cloud (free tier, fastest)
  //   3. TOGETHER_API_KEY → Together (free tier)
  //   4. OPENROUTER_API_KEY → OpenRouter free models
  //   5. OPENAI_API_KEY → OpenAI (paid, last resort)
  //
  // ResilientEnricher tracks per-provider health: a 429 from Groq puts it
  // in 5-min cooldown; a 5xx → 60s; auth/model-not-found → 1hr. Next call
  // skips the bad provider transparently. If EVERY provider fails, we
  // catch AllProvidersFailedError and degrade to extractive synthesis.
  // The user always gets an answer; never sees a hard error.
  const useLlm = !isNoLlm(opts.noLlm, cfg);
  let enricher: retrieve.SynthesisEnricher | undefined;
  let enricherError: string | undefined;
  if (useLlm && confidence !== "none") {
    if (!opts.json) spinner.update("Synthesizing answer...");
    try {
      const chain = await resolveAllEnrichers({ model: cfg.embeddings.model });
      if (chain.length > 0) {
        enricher = new ResilientEnricher(chain, (ev) => {
          if (!opts.json) {
            spinner.update(`${ev.from} ${ev.reason} — switching to ${ev.to}…`);
          }
        });
      }
    } catch (err) {
      enricher = undefined;
      enricherError = (err as Error).message ?? "no LLM available";
    }
  }

  const synthesized = await retrieve.synthesize(
    opts.question,
    results,
    confidence,
    enricher,
    {
      auditMode: opts.audit ?? false,
      auditFloor: opts.auditFloor ?? "medium",
    },
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

  // v0.23: record provider success/failure for mutant-adapt evolution.
  // Over time, the resilient enricher chain reorders by what's actually
  // working on the user's machine — without any explicit configuration.
  try {
    const providerAxis =
      synthesized.source === "llm" ? "provider:llm" : "provider:extractive-fallback";
    if (enricherError) {
      wisdom.recordFailure(meta.rootPath, providerAxis, enricherError.slice(0, 100));
    } else {
      wisdom.recordSuccess(meta.rootPath, providerAxis, synthesized.durationMs);
    }
  } catch {
    // mutant-adapt is best-effort
  }

  // v0.23: append turn to path-aware session (for next ask to use as context).
  try {
    const topFiles = Array.from(
      new Set(results.slice(0, 5).flatMap((r) => r.commit.files ?? [])),
    ).slice(0, 8);
    wisdom.appendTurn(meta.rootPath, {
      at: new Date().toISOString(),
      question: opts.question,
      topHashes: results.slice(0, 5).map((r) => r.commit.hash),
      topFiles,
      confidence,
    });
  } catch {
    // session is best-effort
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

  // If we fell back to retrieval-only because no LLM was available, tell
  // the user how to upgrade for free. Once-per-run friendly nudge — never
  // a hard error.
  if (enricherError && useLlm && confidence !== "none") {
    process.stdout.write(`\n  ${kleur.yellow("ℹ")}  ${kleur.gray("This was retrieval-only. For full Q&A synthesis, set up a free LLM:")}\n`);
    process.stdout.write(`     ${kleur.cyan().bold("mneme setup-free")}  ${kleur.gray("(30-second guided wizard — Ollama / Groq / OpenRouter — all free)")}\n\n`);
  }
  return 0;
}

/**
 * v0.23: render a speculative-reasoning event in real-time. The look and
 * feel echoes KAT-0B's Try/Accept/Contradiction trace. User sees Mneme
 * reason commit-by-commit instead of staring at a spinner.
 */
function renderStreamEvent(ev: retrieve.StreamEvent): void {
  switch (ev.kind) {
    case "consider":
      process.stdout.write(
        `  ${kleur.gray("⚙")} ${kleur.cyan("consider".padEnd(10))} ${kleur.bold(ev.commit.shortHash)}  ${kleur.gray(truncate(ev.commit.subject, 50))}  ${kleur.gray(`score ${ev.score.toFixed(2)}`)}\n`,
      );
      break;
    case "accept":
      process.stdout.write(
        `  ${kleur.green("✓")} ${kleur.green("accept".padEnd(10))}   ${kleur.bold(ev.commit.shortHash)}  ${kleur.gray(ev.reason)}\n`,
      );
      break;
    case "prune":
      process.stdout.write(
        `  ${kleur.red("✗")} ${kleur.red("prune".padEnd(10))}    ${kleur.bold(ev.commit.shortHash)}  ${kleur.gray(ev.reason)}\n`,
      );
      break;
    case "contradict":
      process.stdout.write(
        `  ${kleur.yellow("⚠")} ${kleur.yellow("contradict".padEnd(10))} ${kleur.bold(ev.commit.shortHash)}  ${kleur.gray("against " + ev.against)}\n`,
      );
      break;
    case "synthesize":
      process.stdout.write(
        `  ${kleur.cyan("✦")} ${kleur.cyan("synthesize".padEnd(10))} ${kleur.gray(`from ${ev.citationsCount} verified citation(s)…`)}\n`,
      );
      break;
    case "verify": {
      const tag = ev.ok ? kleur.green("✓ verified  ") : kleur.red("✗ unverified");
      process.stdout.write(`  ${tag} ${kleur.gray(truncate(ev.claim, 70))}${ev.reason ? kleur.gray(" — " + ev.reason) : ""}\n`);
      break;
    }
    case "done":
      process.stdout.write(`  ${kleur.green("✓")} ${kleur.green("done".padEnd(10))}      ${kleur.gray(`in ${ev.durationMs}ms`)}\n\n`);
      break;
    default:
      // Future event kinds — render minimally
      break;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
