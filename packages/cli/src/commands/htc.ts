/**
 * `mneme htc-build` and `mneme htc-stats` — Hierarchical Token Cache CLI.
 *
 * Builds Layer 1 (per-commit abstracts), Layer 2 (cluster summaries),
 * Layer 3 (repo memoir) using the free LLM ladder (Ollama → Groq →
 * OpenRouter → OpenAI). Cost paid ONCE at index time, reused forever.
 *
 * The world-first feature: nobody else compresses-as-storage. Every other
 * AI-codebase tool retrieves raw at query time. This tool turns 50,000
 * commits into something that fits in a single Claude prompt.
 */
import kleur from "kleur";
import { git, store, util, htc, insights } from "@mneme-ai/core";
import { resolveAllEnrichers, ResilientEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import {
  ui,
  header,
  section,
  pill,
  meter,
  emptyState,
  nextSteps,
  kv,
} from "../ui.js";

// ─── mneme htc-stats ──────────────────────────────────────────────────

export interface HtcStatsOptions {
  cwd: string;
  json?: boolean;
}

export async function htcStatsCommand(opts: HtcStatsOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const stats = htc.getHtcStats(s);
  s.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header(
    "📦",
    "HTC — Hierarchical Token Cache",
    "compression-as-storage · Layer 1 abstracts + Layer 2 clusters + Layer 3 memoir",
    "How much of your repo is pre-compressed for AI consumption? Higher coverage = lower per-query token cost.",
  ) + "\n\n");

  // ─── Coverage ─────────────────────────────────────────────────────
  process.stdout.write(section("✦ Coverage") + "\n\n");
  const c = stats.abstractsCoverage;
  const coverageLevel = c >= 0.95 ? "ok" : c >= 0.5 ? "low" : "warn";
  process.stdout.write(
    kv("Layer 1 abstracts", `${meter(c, { width: 16 })}  ${kleur.bold(`${stats.abstractsGenerated}/${stats.totalCommits}`)} (${(c * 100).toFixed(0)}%)`) + "\n",
  );
  process.stdout.write(
    kv("Layer 2 clusters", `${stats.clustersGenerated} ${stats.clustersGenerated > 0 ? pill("READY", "ok") : pill("NOT BUILT", "warn")}`) + "\n",
  );
  if (stats.memoirGenerated && stats.memoirAgeDays !== undefined) {
    const memoirLabel =
      stats.memoirAgeDays < 1
        ? pill("FRESH", "ok")
        : stats.memoirAgeDays < 7
          ? pill(`${Math.round(stats.memoirAgeDays)}d old`, "low")
          : pill(`${Math.round(stats.memoirAgeDays)}d old — stale`, "warn");
    process.stdout.write(kv("Layer 3 memoir", memoirLabel) + "\n");
  } else {
    process.stdout.write(kv("Layer 3 memoir", pill("NOT BUILT", "warn")) + "\n");
  }
  process.stdout.write("\n");

  // ─── Token math ──────────────────────────────────────────────────
  process.stdout.write(section("✦ Token math (the killer metric)") + "\n\n");
  process.stdout.write(
    kv("raw commit text", kleur.gray(formatTokens(stats.estimatedRawTokens))) + "\n",
  );
  process.stdout.write(
    kv("compressed cache", kleur.bold().green(formatTokens(stats.totalCachedTokens))) + "\n",
  );
  if (stats.compressionRatio > 0) {
    process.stdout.write(
      kv("compression ratio", kleur.bold().cyan(`${stats.compressionRatio.toFixed(1)}× smaller`)) + "\n\n",
    );
    process.stdout.write(
      `  ${kleur.green("✓")}  ${kleur.gray(`Sending compressed cache to an LLM costs ~`)}${kleur.bold(`${stats.compressionRatio.toFixed(0)}× less`)}${kleur.gray(` than sending raw commits.`)}\n\n`,
    );
  } else {
    process.stdout.write("\n");
  }

  // ─── Smart next steps ─────────────────────────────────────────────
  if (c === 0) {
    process.stdout.write(emptyState("Cache not built yet.", [
      "Build with:  mneme htc-build",
      "Or build alongside indexing:  mneme index --compress",
      "Free providers (Ollama / Groq / OpenRouter) are auto-detected.",
    ]));
    return 0;
  }
  if (c < 0.95) {
    process.stdout.write(nextSteps([
      { cmd: "mneme htc-build", why: "Fill in missing abstracts (incremental — only un-cached commits)." },
    ]) + "\n\n");
  } else if (!stats.memoirGenerated || (stats.memoirAgeDays ?? 0) >= 7) {
    process.stdout.write(nextSteps([
      { cmd: "mneme htc-build --refresh-memoir", why: "Memoir is stale — refresh the repo-level narrative." },
    ]) + "\n\n");
  } else {
    process.stdout.write(`  ${kleur.green("✓")}  ${kleur.green("Cache is fresh and complete.")} ${kleur.gray("`mneme ask` will use HTC layers automatically.")}\n\n`);
  }
  return 0;
}

// ─── mneme htc-build ──────────────────────────────────────────────────

export interface HtcBuildOptions {
  cwd: string;
  /** Only generate L1 abstracts (skip clusters + memoir). */
  abstractsOnly?: boolean;
  /** Re-run memoir even if recent. */
  refreshMemoir?: boolean;
  /** Concurrency for parallel LLM calls. Default 3. */
  concurrency?: number;
}

export async function htcBuildCommand(opts: HtcBuildOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  ui.banner();
  process.stdout.write(header(
    "📦",
    "HTC Build — compress your codebase for LLM consumption",
    "Layer 1 (per-commit abstracts) → Layer 2 (clusters) → Layer 3 (memoir)",
    "Pay token cost ONCE here. Reuse the cache forever in `mneme ask`. Free LLM ladder is auto-detected.",
  ) + "\n\n");

  // Resolve enricher
  const chain = await resolveAllEnrichers({});
  if (chain.length === 0) {
    ui.error("No LLM available. Run `mneme setup-free` first to set up the free path.");
    s.close();
    return 1;
  }
  const enricher = new ResilientEnricher(chain);
  process.stdout.write(`  ${pill("LLM", "ok")}  ${kleur.bold(enricher.name)}  ${kleur.gray("(free-LLM ladder, auto-fallback on failure)")}\n\n`);

  // ─── Layer 1 ──────────────────────────────────────────────────────
  process.stdout.write(section("✦ Layer 1 — per-commit abstracts") + "\n\n");
  const allCommits = util.loadAllCommits(s);
  const existingAbstracts = htc.getAllAbstracts(s);
  const todo = allCommits.filter((c) => !existingAbstracts.has(c.hash));

  if (todo.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.gray(`All ${allCommits.length} commits already have abstracts.`)}\n\n`);
  } else {
    process.stdout.write(`  ${kleur.gray(`generating ${todo.length} abstract(s) — ${existingAbstracts.size} already cached`)}\n`);
    let done = 0;
    let errors = 0;
    const t0 = Date.now();
    const results = await htc.generateAbstractsBatch(
      todo.map((c) => ({ hash: c.hash, subject: c.subject, body: c.body, files: c.files })),
      enricher,
      {
        concurrency: opts.concurrency ?? 3,
        onProgress: (d, total) => {
          done = d;
          const pct = Math.round((d / total) * 100);
          process.stdout.write(`\r  ${kleur.cyan("⚙")} ${pct}% (${d}/${total})    `);
        },
        onError: (_h, _err) => {
          errors += 1;
        },
      },
    );
    process.stdout.write("\r" + " ".repeat(40) + "\r");

    // Store results
    for (const r of results) htc.upsertAbstract(s, r);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.bold(`${results.length} abstracts`)} generated in ${elapsed}s${errors > 0 ? kleur.yellow(` · ${errors} errors`) : ""}\n\n`);
  }

  if (opts.abstractsOnly) {
    s.close();
    process.stdout.write(nextSteps([
      { cmd: "mneme htc-stats", why: "See coverage + compression ratio." },
      { cmd: "mneme htc-build", why: "Build Layer 2 (clusters) + Layer 3 (memoir) too." },
    ]) + "\n\n");
    return 0;
  }

  // ─── Layer 2 ──────────────────────────────────────────────────────
  process.stdout.write(section("✦ Layer 2 — topic clusters") + "\n\n");
  const abstractsMap = new Map<string, string>();
  for (const [hash, a] of htc.getAllAbstracts(s)) abstractsMap.set(hash, a.abstract);

  // Use existing buildClusters from insights. CommitCluster exposes .samples
  // (representative commits) — use those as the member set.
  const clusters = insights.buildClusters(allCommits, { similarityFloor: 0.15, minClusterSize: 3 });
  const clusterInputs = clusters.clusters.map((c) => ({
    id: `c${c.id}`,
    memberHashes: c.samples.map((m) => m.hash),
  }));
  process.stdout.write(`  ${kleur.gray(`identified ${clusterInputs.length} cluster(s) by embedding similarity`)}\n`);

  if (clusterInputs.length === 0) {
    process.stdout.write(`  ${kleur.yellow("!")}  ${kleur.gray("No clusters formed — repo too small or commits too diverse. Skipping Layer 2 + 3.")}\n\n`);
    s.close();
    return 0;
  }

  let cdone = 0;
  const t1 = Date.now();
  const summaries = await htc.generateClusterSummaries(abstractsMap, clusterInputs, enricher, {
    concurrency: opts.concurrency ?? 3,
    onProgress: (d, total) => {
      cdone = d;
      process.stdout.write(`\r  ${kleur.cyan("⚙")} ${Math.round((d / total) * 100)}% (${d}/${total})    `);
    },
  });
  process.stdout.write("\r" + " ".repeat(40) + "\r");
  for (const cs of summaries) htc.upsertClusterSummary(s, cs);
  const elapsed1 = ((Date.now() - t1) / 1000).toFixed(1);
  process.stdout.write(`  ${kleur.green("✓")} ${kleur.bold(`${summaries.length} cluster summaries`)} generated in ${elapsed1}s\n\n`);

  // ─── Layer 3 ──────────────────────────────────────────────────────
  const existingMemoir = htc.getMemoir(s);
  const memoirAgeDays = existingMemoir
    ? (Date.now() - new Date(existingMemoir.generatedAt ?? 0).getTime()) / 86_400_000
    : Infinity;

  if (existingMemoir && !opts.refreshMemoir && memoirAgeDays < 7) {
    process.stdout.write(`  ${kleur.gray(`Layer 3 memoir is fresh (${Math.round(memoirAgeDays)}d) — skipping. Use --refresh-memoir to force.`)}\n\n`);
  } else {
    process.stdout.write(section("✦ Layer 3 — repo memoir") + "\n\n");
    process.stdout.write(`  ${kleur.cyan("⚙")} ${kleur.gray("composing ~500-token narrative from cluster summaries...")}\n`);
    const t2 = Date.now();
    const memoir = await htc.generateMemoir(summaries, allCommits.length, enricher);
    htc.upsertMemoir(s, memoir);
    const elapsed2 = ((Date.now() - t2) / 1000).toFixed(1);
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.bold("memoir")} (${memoir.tokenCount} tokens) generated in ${elapsed2}s\n\n`);
  }

  // Final stats
  const stats = htc.getHtcStats(s);
  s.close();

  process.stdout.write(section("✦ Done — your repo is now LLM-ready") + "\n\n");
  process.stdout.write(
    kv("compression ratio", kleur.bold().green(`${stats.compressionRatio.toFixed(1)}× smaller`)) + "\n",
  );
  process.stdout.write(
    kv("raw → compressed", `${kleur.gray(formatTokens(stats.estimatedRawTokens))} → ${kleur.bold().green(formatTokens(stats.totalCachedTokens))}`) + "\n\n",
  );

  process.stdout.write(nextSteps([
    { cmd: 'mneme ask "what is this repo about?"', why: "Tries Layer 3 memoir first — answers in <1k tokens." },
    { cmd: "mneme htc-stats", why: "Inspect coverage anytime." },
  ]) + "\n\n");
  return 0;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}
