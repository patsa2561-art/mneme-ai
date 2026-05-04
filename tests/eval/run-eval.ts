/**
 * Mneme eval harness — run questions against an indexed fixture repo and
 * report retrieval quality metrics.
 *
 *   npm run eval -- [--variant <name>] [--out <file>] [--quiet]
 *
 * Variants change the search configuration so you can compare strategies
 * (this is the "A/B" of retrieval systems — a controlled experiment with metrics).
 *
 * The eval harness IS the contract: any code change that lowers any
 * core metric should fail review. CI runs this and posts the diff.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { indexer as indexerNs, store as storeNs, retrieve as retrieveNs } from "@mneme-ai/core";
import { HashEmbedder } from "@mneme-ai/embeddings";
import type { EmbeddingProvider, Reranker } from "@mneme-ai/core";
import { createFixtureRepo } from "../fixtures/fixture-repo.js";
import { aggregate, evaluate, type PerQueryMetrics, type AggregateMetrics } from "./metrics.js";

interface GoldenRow {
  id: string;
  question: string;
  expectedTags: string[];
  category?: string;
}

interface Variant {
  name: string;
  embedder: () => EmbeddingProvider;
  semanticWeight: number;
  topK: number;
  rerank?: () => Reranker;
}

const VARIANTS: Record<string, Variant> = {
  baseline: {
    name: "baseline",
    embedder: () => new HashEmbedder(512),
    semanticWeight: 0.65,
    topK: 10,
  },
  "lex-only": {
    name: "lex-only",
    embedder: () => new HashEmbedder(512),
    semanticWeight: 0.0,
    topK: 10,
  },
  "sem-heavy": {
    name: "sem-heavy",
    embedder: () => new HashEmbedder(512),
    semanticWeight: 0.85,
    topK: 10,
  },
  "balanced": {
    name: "balanced",
    embedder: () => new HashEmbedder(512),
    semanticWeight: 0.5,
    topK: 10,
  },
  "reranked": {
    name: "reranked",
    embedder: () => new HashEmbedder(512),
    semanticWeight: 0.65,
    topK: 10,
    rerank: () => new retrieveNs.QueryDensityReranker(0.5),
  },
};

interface EvalReport {
  variant: string;
  embedder: string;
  semanticWeight: number;
  topK: number;
  goldenSetSize: number;
  fixtureCommits: number;
  durationMs: number;
  perQuery: PerQueryMetrics[];
  aggregate: AggregateMetrics;
  byCategory: Record<string, AggregateMetrics>;
  generatedAt: string;
}

async function runVariant(variant: Variant, golden: GoldenRow[]): Promise<EvalReport> {
  const t0 = Date.now();
  const fixture = createFixtureRepo();
  const dbDir = mkdtempSync(join(tmpdir(), "mneme-eval-"));
  const dbPath = join(dbDir, "mneme.db");
  const store = new storeNs.MnemeStore(dbPath);

  try {
    const embedder = variant.embedder();
    const idx = new indexerNs.Indexer({ cwd: fixture.path, store, embedder });
    await idx.run();

    // Map golden tags → real commit hashes via the fixture's hashByTag.
    const tagToHash = fixture.hashByTag;

    const reranker = variant.rerank?.();
    const perQuery: PerQueryMetrics[] = [];
    for (const row of golden) {
      let results = await retrieveNs.search(row.question, {
        store,
        embedder,
        topK: reranker ? variant.topK * 3 : variant.topK,
        semanticWeight: variant.semanticWeight,
      });
      if (reranker) {
        results = await reranker.rerank(row.question, results, variant.topK);
      }
      const retrievedHashes = results.map((r) => r.commit.hash);
      const relevantHashes = new Set(
        row.expectedTags
          .map((t) => tagToHash[t])
          .filter((h): h is string => Boolean(h)),
      );
      perQuery.push(evaluate(retrievedHashes, relevantHashes, row.id));
    }

    // Group by category
    const byCategory: Record<string, AggregateMetrics> = {};
    const categories = Array.from(new Set(golden.map((g) => g.category ?? "uncategorized")));
    for (const cat of categories) {
      const ids = new Set(
        golden.filter((g) => (g.category ?? "uncategorized") === cat).map((g) => g.id),
      );
      const subset = perQuery.filter((p) => ids.has(p.queryId));
      byCategory[cat] = aggregate(subset);
    }

    return {
      variant: variant.name,
      embedder: embedder.name,
      semanticWeight: variant.semanticWeight,
      topK: variant.topK,
      goldenSetSize: golden.length,
      fixtureCommits: store.countCommits(),
      durationMs: Date.now() - t0,
      perQuery,
      aggregate: aggregate(perQuery),
      byCategory,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    store.close();
    rmSync(dbDir, { recursive: true, force: true });
    fixture.cleanup();
  }
}

function loadGolden(): GoldenRow[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "golden.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldenRow);
}

function fmt(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function printReport(report: EvalReport): void {
  const a = report.aggregate;
  const lines: string[] = [];
  lines.push(`\n📊  Eval report — variant: ${bold(report.variant)}`);
  lines.push(`    embedder: ${report.embedder}  ·  semanticWeight: ${report.semanticWeight}  ·  k: ${report.topK}`);
  lines.push(`    golden set: ${report.goldenSetSize} questions  ·  fixture: ${report.fixtureCommits} commits  ·  ${report.durationMs}ms\n`);
  lines.push(`    ${"metric".padEnd(14)} ${"value".padEnd(10)}`);
  lines.push(`    ${"─".repeat(14)} ${"─".repeat(10)}`);
  lines.push(`    ${"recall@1".padEnd(14)} ${fmt(a.recallAt1).padEnd(10)}`);
  lines.push(`    ${"recall@3".padEnd(14)} ${fmt(a.recallAt3).padEnd(10)}`);
  lines.push(`    ${"recall@10".padEnd(14)} ${fmt(a.recallAt10).padEnd(10)}`);
  lines.push(`    ${"precision@3".padEnd(14)} ${fmt(a.precisionAt3).padEnd(10)}`);
  lines.push(`    ${"MRR".padEnd(14)} ${fmt(a.mrr).padEnd(10)}`);
  lines.push(`    ${"nDCG@10".padEnd(14)} ${fmt(a.ndcgAt10).padEnd(10)}`);
  lines.push(`    ${"hit rate".padEnd(14)} ${fmt(a.hitRate).padEnd(10)}`);
  lines.push("");
  lines.push("    by category:");
  for (const [cat, m] of Object.entries(report.byCategory)) {
    lines.push(`      ${cat.padEnd(14)}  recall@3=${fmt(m.recallAt3)}  MRR=${fmt(m.mrr)}  (${m.numQueries} q)`);
  }
  lines.push("");
  process.stdout.write(lines.join("\n") + "\n");
}

function bold(s: string): string {
  return process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const next = args[i + 1]!;
  if (next.startsWith("--")) return undefined;
  return next;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const variantArg = flag(args, "--variant");
  const outArg = flag(args, "--out");
  const quiet = args.includes("--quiet");

  const golden = loadGolden();
  const variantsToRun = variantArg ? [variantArg] : Object.keys(VARIANTS);

  const reports: EvalReport[] = [];
  for (const v of variantsToRun) {
    const variant = VARIANTS[v];
    if (!variant) {
      process.stderr.write(`Unknown variant: ${v}. Available: ${Object.keys(VARIANTS).join(", ")}\n`);
      process.exit(1);
    }
    const report = await runVariant(variant, golden);
    reports.push(report);
    if (!quiet) printReport(report);
  }

  if (outArg) {
    if (!existsSync(dirname(outArg))) mkdirSync(dirname(outArg), { recursive: true });
    writeFileSync(outArg, JSON.stringify(reports, null, 2));
    process.stdout.write(`\n💾  Wrote ${outArg}\n`);
  }

  // Print comparison table if multiple variants were run
  if (reports.length > 1) {
    process.stdout.write("\n📈  Comparison\n");
    process.stdout.write(`    ${"variant".padEnd(12)} ${"recall@1".padEnd(10)} ${"recall@3".padEnd(10)} ${"MRR".padEnd(10)} ${"nDCG@10".padEnd(10)}\n`);
    process.stdout.write(`    ${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)}\n`);
    for (const r of reports) {
      process.stdout.write(
        `    ${r.variant.padEnd(12)} ${fmt(r.aggregate.recallAt1).padEnd(10)} ${fmt(r.aggregate.recallAt3).padEnd(10)} ${fmt(r.aggregate.mrr).padEnd(10)} ${fmt(r.aggregate.ndcgAt10).padEnd(10)}\n`,
      );
    }
    process.stdout.write("\n");
  }
}

main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
