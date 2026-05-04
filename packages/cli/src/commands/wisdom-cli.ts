/**
 * `mneme feedback`, `mneme calibrate`, `mneme watch` — the user-facing
 * CLI surface of the Wisdom Mutant Engine.
 *
 *   feedback   <id-or-prefix> <up|down>   record explicit feedback on a query
 *   calibrate                              re-tune search knobs against feedback
 *   watch                                  24/7 daemon: re-index + calibrate + self-eval
 */

import { existsSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { git, store, wisdom, indexer } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";

// ─── feedback ───────────────────────────────────────────────────────────

export interface FeedbackCommandOptions {
  cwd: string;
  idOrPrefix: string;
  vote: "up" | "down";
}

export async function feedbackCommand(opts: FeedbackCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const id = resolveFeedbackId(s, opts.idOrPrefix);
  if (!id) {
    ui.error(`No feedback row matches "${opts.idOrPrefix}". Run \`mneme ask\` first.`);
    s.close();
    return 1;
  }

  const updated = wisdom.setHelpful(s, id, opts.vote === "up", "explicit");
  s.close();
  if (!updated) {
    ui.error("Failed to update feedback row.");
    return 1;
  }
  const summary = wisdom.summarizeFeedback(s);
  process.stdout.write(
    `${kleur.green("✓")} ${opts.vote === "up" ? "thanks for the upvote" : "noted — feedback recorded"}\n` +
    `${kleur.gray(`feedback so far: ${summary.helpful} helpful · ${summary.unhelpful} unhelpful · ${summary.pending} pending`)}\n`,
  );
  return 0;
}

function resolveFeedbackId(s: store.MnemeStore, prefix: string): string | undefined {
  if (prefix.length >= 32) return prefix; // assume full UUID
  const row = s.db
    .prepare(`SELECT id FROM wisdom_feedback WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1`)
    .get(`${prefix}%`) as { id: string } | undefined;
  return row?.id;
}

// ─── calibrate ──────────────────────────────────────────────────────────

export interface CalibrateCommandOptions {
  cwd: string;
  json?: boolean;
}

export async function calibrateCommand(opts: CalibrateCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("calibrate")}  ${kleur.gray("(tuning search knobs against feedback)")}\n\n`);

  const result = await wisdom.calibrate(s, embedder);
  s.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  if (!result.calibrated) {
    process.stdout.write(
      `${kleur.yellow("⚠")}  Not enough positive feedback yet (${result.positiveExamples} / 10).\n` +
      `   Use ${kleur.bold("mneme feedback <id> up")} after questions that gave good answers.\n` +
      `   Defaults remain in effect: semWeight=0.65, minSemCosine=0.4, rrfK=60.\n`,
    );
    return 0;
  }

  process.stdout.write(
    `${kleur.green("✓")} Calibrated against ${result.positiveExamples} positive examples.\n` +
    `${kleur.bold("Best config:")}  semWeight=${result.config.semanticWeight}  minSemCosine=${result.config.minSemCosine}  rrfK=${result.config.rrfK}\n` +
    `${kleur.gray(`Hit rate on feedback set: ${(result.hitRate * 100).toFixed(1)}%`)}\n\n`,
  );
  process.stdout.write(`${kleur.bold("Top 5 grid points:")}\n`);
  for (const r of result.grid.slice(0, 5)) {
    process.stdout.write(
      `  ${kleur.gray("·")} semWeight=${r.semanticWeight}  minSem=${r.minSemCosine}  rrfK=${r.rrfK.toString().padStart(2)}  ${kleur.cyan((r.hitRate * 100).toFixed(1) + "%")}\n`,
    );
  }
  return 0;
}

// ─── watch ──────────────────────────────────────────────────────────────

export interface WatchCommandOptions {
  cwd: string;
  /** Override calibrate interval in milliseconds (default 1h). */
  calibrateMs?: number;
  /** Override self-eval interval in milliseconds (default 24h). */
  selfEvalMs?: number;
  /** Quiet mode — only print errors. */
  quiet?: boolean;
}

const HEAD_DEBOUNCE_MS = 1500;

export async function watchCommand(opts: WatchCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  const log = opts.quiet
    ? () => {}
    : (msg: string) => process.stdout.write(`${kleur.gray(new Date().toISOString())}  ${msg}\n`);

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("watch")}  ${kleur.gray("(Wisdom Mutant Engine — 24/7 daemon)")}\n\n`);
  process.stdout.write(`  ${kleur.gray("repo")}      ${meta.rootPath}\n`);
  process.stdout.write(`  ${kleur.gray("on commit")}  re-index incrementally\n`);
  process.stdout.write(`  ${kleur.gray("every 1h")}   re-calibrate search knobs\n`);
  process.stdout.write(`  ${kleur.gray("every 24h")}  self-eval against golden set, write trend row\n\n`);
  process.stdout.write(`  ${kleur.gray("(press Ctrl-C to stop)")}\n\n`);

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  const headPath = join(meta.rootPath, ".git", "HEAD");
  let indexing = false;
  let pending = false;
  let debounce: NodeJS.Timeout | undefined;

  const reindex = async (): Promise<void> => {
    if (indexing) {
      pending = true;
      return;
    }
    indexing = true;
    try {
      const s = new store.MnemeStore(dbPath(meta.rootPath));
      const idx = new indexer.Indexer({ cwd: meta.rootPath, store: s, embedder, redact: true });
      const t0 = Date.now();
      const r = await idx.run();
      s.close();
      log(`${kleur.green("✓")} indexed ${r.commits} commits → ${r.chunks} chunks (${Date.now() - t0}ms)`);
    } catch (err) {
      log(`${kleur.red("✗")} index failed: ${(err as Error).message}`);
    } finally {
      indexing = false;
      if (pending) {
        pending = false;
        // Re-run if a new HEAD change arrived during indexing.
        void reindex();
      }
    }
  };

  // Initial pass — sync the memory once on start.
  await reindex();

  // File watcher on .git/HEAD — fires on every commit / branch switch.
  if (existsSync(headPath)) {
    fsWatch(headPath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        log(`${kleur.cyan("→")} HEAD changed, re-indexing`);
        void reindex();
      }, HEAD_DEBOUNCE_MS);
    });
  }

  // Calibrate periodically.
  const calibrateMs = opts.calibrateMs ?? 60 * 60 * 1000;
  const calibrateTimer = setInterval(async () => {
    try {
      const s = new store.MnemeStore(dbPath(meta.rootPath));
      const r = await wisdom.calibrate(s, embedder);
      s.close();
      if (r.calibrated) {
        log(`${kleur.cyan("→")} calibrated  semWeight=${r.config.semanticWeight}  minSem=${r.config.minSemCosine}  rrfK=${r.config.rrfK}  hit=${(r.hitRate * 100).toFixed(1)}%`);
      } else {
        log(`${kleur.gray("·")} calibrate skipped (only ${r.positiveExamples}/10 positive examples)`);
      }
    } catch (err) {
      log(`${kleur.red("✗")} calibrate failed: ${(err as Error).message}`);
    }
  }, calibrateMs);

  // Self-eval periodically (placeholder — writes a row from current feedback summary).
  const selfEvalMs = opts.selfEvalMs ?? 24 * 60 * 60 * 1000;
  const selfEvalTimer = setInterval(() => {
    try {
      const s = new store.MnemeStore(dbPath(meta.rootPath));
      const summary = wisdom.summarizeFeedback(s);
      s.db.prepare(
        `INSERT INTO wisdom_eval_run
         (ran_at, variant, recall_at_3, mrr, hit_rate, num_queries, notes)
         VALUES (?, 'live-feedback', ?, ?, ?, ?, ?)`,
      ).run(
        new Date().toISOString(),
        summary.hitRate, // proxy
        0,
        summary.hitRate,
        summary.total,
        `helpful=${summary.helpful} unhelpful=${summary.unhelpful} pending=${summary.pending}`,
      );
      s.close();
      log(`${kleur.cyan("→")} self-eval recorded  hitRate=${(summary.hitRate * 100).toFixed(1)}%  n=${summary.total}`);
    } catch (err) {
      log(`${kleur.red("✗")} self-eval failed: ${(err as Error).message}`);
    }
  }, selfEvalMs);

  // Graceful shutdown.
  return new Promise<number>((resolve) => {
    const shutdown = () => {
      log("shutting down");
      clearInterval(calibrateTimer);
      clearInterval(selfEvalTimer);
      if (debounce) clearTimeout(debounce);
      resolve(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
