/**
 * Mneme benchmark suite.
 *
 *   npm run bench
 *
 * Measures, on synthetic git repos of various sizes:
 *   - index throughput (commits/sec, chunks/sec)
 *   - query latency (p50, p95, p99)
 *   - DB size on disk
 *
 * Output is human-readable + a machine-readable JSON file consumed by
 * generate-status.ts so STATUS.md always reflects the latest numbers.
 */
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { indexer as indexerNs, store as storeNs, retrieve as retrieveNs } from "@mneme-ai/core";
import { HashEmbedder } from "@mneme-ai/embeddings";

interface Sizes {
  commits: number;
  filesPerCommit: number;
}

const SCENARIOS: Array<{ name: string; sizes: Sizes }> = [
  { name: "small", sizes: { commits: 100, filesPerCommit: 2 } },
  { name: "medium", sizes: { commits: 500, filesPerCommit: 3 } },
  { name: "large", sizes: { commits: 1000, filesPerCommit: 4 } },
];

const QUERIES = [
  "fix payment bug",
  "auth refactor compliance",
  "OrderQueue race condition",
  "Stripe webhook idempotency",
  "PII redaction logger",
  "BigInt overflow",
  "JWT short lived",
  "background processor",
];

function git(cwd: string, cmd: string, env: NodeJS.ProcessEnv = {}): void {
  execSync(`git ${cmd}`, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Bench",
      GIT_AUTHOR_EMAIL: "b@x.io",
      GIT_COMMITTER_NAME: "Bench",
      GIT_COMMITTER_EMAIL: "b@x.io",
      ...env,
    },
  });
}

function buildSyntheticRepo(opts: Sizes): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-bench-"));
  git(dir, "init -q -b main");
  git(dir, "config core.autocrlf false");

  const subjects = [
    "feat(api): add endpoint",
    "fix: handle null in parser",
    "refactor: simplify reducer",
    "chore: bump deps",
    "docs: update readme",
    "test: cover edge cases",
    "perf: cache hot path",
    "fix(auth): session expiration",
  ];
  const bodies = [
    "Stripe sometimes sends bigint amounts. Refs SENTRY-1287.",
    "OrderQueue race condition under burst load. SENTRY-1294.",
    "PII customer email leak. INC-2025-04.",
    "Compliance-driven session token storage rewrite. LEGAL-12.",
    "JWT 15-minute TTL. Webhook idempotency dedup.",
  ];

  const baseDate = new Date("2024-01-01T00:00:00Z").getTime();
  for (let i = 0; i < opts.commits; i++) {
    for (let f = 0; f < opts.filesPerCommit; f++) {
      const path = `src/m${(i * opts.filesPerCommit + f) % 50}.ts`;
      const filePath = join(dir, path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `export const v${i}_${f} = ${i};\n`, "utf8");
      git(dir, `add "${path}"`);
    }
    const subject = subjects[i % subjects.length]!;
    const body = bodies[i % bodies.length]!;
    const date = new Date(baseDate + i * 60_000).toISOString();
    git(dir, `commit -m "${subject} #${i}" -m "${body}"`, {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

interface BenchResult {
  scenario: string;
  commits: number;
  indexMs: number;
  indexedCommits: number;
  indexedChunks: number;
  commitsPerSecond: number;
  chunksPerSecond: number;
  queryP50Ms: number;
  queryP95Ms: number;
  queryP99Ms: number;
  dbBytes: number;
  embedder: string;
}

async function runScenario(name: string, sizes: Sizes): Promise<BenchResult> {
  process.stdout.write(`\n⏱  ${name} (${sizes.commits} commits) — building synthetic repo… `);
  const buildT0 = performance.now();
  const repo = buildSyntheticRepo(sizes);
  process.stdout.write(`${(performance.now() - buildT0).toFixed(0)}ms\n`);

  const dbDir = mkdtempSync(join(tmpdir(), "mneme-bench-db-"));
  const dbPath = join(dbDir, "mneme.db");
  const store = new storeNs.MnemeStore(dbPath);

  try {
    process.stdout.write(`   indexing… `);
    const embedder = new HashEmbedder(256);
    const idx = new indexerNs.Indexer({ cwd: repo, store, embedder });
    const t0 = performance.now();
    const result = await idx.run();
    const indexMs = performance.now() - t0;
    process.stdout.write(`${indexMs.toFixed(0)}ms — ${result.commits} commits, ${result.chunks} chunks\n`);

    process.stdout.write(`   query latency (${QUERIES.length} queries × 5 runs)… `);
    const samples: number[] = [];
    for (const q of QUERIES) {
      for (let trial = 0; trial < 5; trial++) {
        const qt0 = performance.now();
        await retrieveNs.search(q, { store, embedder, topK: 10 });
        samples.push(performance.now() - qt0);
      }
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);
    process.stdout.write(`p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms\n`);

    const dbBytes = statSync(dbPath).size;
    return {
      scenario: name,
      commits: sizes.commits,
      indexMs,
      indexedCommits: result.commits,
      indexedChunks: result.chunks,
      commitsPerSecond: result.commits / (indexMs / 1000),
      chunksPerSecond: result.chunks / (indexMs / 1000),
      queryP50Ms: p50,
      queryP95Ms: p95,
      queryP99Ms: p99,
      dbBytes,
      embedder: embedder.name,
    };
  } finally {
    store.close();
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const onlyArg = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1] : undefined;
  const scenarios = onlyArg ? SCENARIOS.filter((s) => s.name === onlyArg) : SCENARIOS;

  process.stdout.write("\n🏁  Mneme benchmark suite\n");
  const results: BenchResult[] = [];
  for (const s of scenarios) {
    results.push(await runScenario(s.name, s.sizes));
  }

  process.stdout.write("\n📊  Summary\n");
  process.stdout.write(`    ${"scenario".padEnd(10)} ${"index".padEnd(10)} ${"c/s".padEnd(8)} ${"p50".padEnd(8)} ${"p95".padEnd(8)} ${"p99".padEnd(8)} ${"db".padEnd(10)}\n`);
  process.stdout.write(`    ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(10)}\n`);
  for (const r of results) {
    process.stdout.write(
      `    ${r.scenario.padEnd(10)} ${(r.indexMs.toFixed(0) + "ms").padEnd(10)} ${r.commitsPerSecond.toFixed(0).padEnd(8)} ${(r.queryP50Ms.toFixed(1) + "ms").padEnd(8)} ${(r.queryP95Ms.toFixed(1) + "ms").padEnd(8)} ${(r.queryP99Ms.toFixed(1) + "ms").padEnd(8)} ${fmtBytes(r.dbBytes).padEnd(10)}\n`,
    );
  }

  if (outPath) {
    if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    process.stdout.write(`\n💾  Wrote ${outPath}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
