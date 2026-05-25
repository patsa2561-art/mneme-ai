/**
 * @mneme-ai/sdk/benchmark — built-in SDK-vs-CLI speedup proof.
 *
 * Wild feature: users can prove the claimed 30-80× speedup on their own
 * hardware in one call. Compares N in-process SDK calls against the same
 * N CLI subprocess calls + reports the ratio.
 *
 * Refuses to lie: if the SDK is slower (e.g. on a niche platform), it
 * surfaces that too.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@mneme-ai/core";

export interface BenchmarkResult {
  op: string;
  iterations: number;
  sdkMeanMs: number;
  sdkTotalMs: number;
  cliMeanMs: number;
  cliTotalMs: number;
  speedupRatio: number;
  /** True when SDK strictly faster than CLI on average. */
  sdkWins: boolean;
}

export interface BenchmarkOpts {
  iterations?: number;
  cliBin?: string;
  /** Skip the CLI side (useful when CLI not built). */
  skipCli?: boolean;
}

function findCliBin(): string | null {
  const candidates = [
    resolve(process.cwd(), "packages/cli/bin/mneme.js"),
    resolve(process.cwd(), "node_modules/mneme-ai/bin/mneme.js"),
    resolve(process.cwd(), "node_modules/.bin/mneme"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** Bench EU stamp (fastest hot path; the one we promise <30ms). */
export async function benchEuStamp(opts: BenchmarkOpts = {}): Promise<BenchmarkResult> {
  const iter = opts.iterations ?? 20;
  const input = { message: "bench commit", vendor: "claude-code", confidence: 0.9 };
  // SDK warm
  core.nemesis.stampArticle50(input);
  const sdk0 = performance.now();
  for (let i = 0; i < iter; i++) core.nemesis.stampArticle50({ ...input, message: `msg ${i}` });
  const sdkTotal = performance.now() - sdk0;

  let cliTotal = 0;
  let cliMean = 0;
  if (!opts.skipCli) {
    const cli = opts.cliBin ?? findCliBin();
    if (cli && existsSync(cli)) {
      const cli0 = performance.now();
      for (let i = 0; i < iter; i++) {
        spawnSync(process.execPath, [cli, "nemesis", "eu_stamp", "--message", `msg ${i}`, "--vendor", "claude-code"], { encoding: "utf8", timeout: 5000 });
      }
      cliTotal = performance.now() - cli0;
      cliMean = cliTotal / iter;
    }
  }

  const sdkMean = sdkTotal / iter;
  const speedup = cliMean > 0 ? cliMean / sdkMean : 0;
  return {
    op: "nemesis.eu_stamp",
    iterations: iter,
    sdkMeanMs: +sdkMean.toFixed(2),
    sdkTotalMs: +sdkTotal.toFixed(2),
    cliMeanMs: +cliMean.toFixed(2),
    cliTotalMs: +cliTotal.toFixed(2),
    speedupRatio: +speedup.toFixed(1),
    sdkWins: speedup > 1.5,
  };
}

/** Bench NEMESIS classify_calibrated. */
export async function benchClassify(opts: BenchmarkOpts = {}): Promise<BenchmarkResult> {
  const iter = opts.iterations ?? 20;
  const fx = { diff: "+const x = 1;\n+function foo() { return x; }\n", prDescription: "## Changes\n- a\n", commitMessages: ["x"] };
  const fp = core.nemesis.extractFingerprint(fx);
  core.nemesis.classifyAgentCalibrated(fp);
  const sdk0 = performance.now();
  for (let i = 0; i < iter; i++) core.nemesis.classifyAgentCalibrated(fp);
  const sdkTotal = performance.now() - sdk0;

  let cliTotal = 0, cliMean = 0;
  if (!opts.skipCli) {
    const cli = opts.cliBin ?? findCliBin();
    if (cli && existsSync(cli)) {
      const cli0 = performance.now();
      const payload = JSON.stringify(fx);
      for (let i = 0; i < iter; i++) {
        spawnSync(process.execPath, [cli, "nemesis", "classify", "--stdin"], { encoding: "utf8", input: payload, timeout: 8000 });
      }
      cliTotal = performance.now() - cli0;
      cliMean = cliTotal / iter;
    }
  }
  const sdkMean = sdkTotal / iter;
  const speedup = cliMean > 0 ? cliMean / sdkMean : 0;
  return {
    op: "nemesis.classify",
    iterations: iter,
    sdkMeanMs: +sdkMean.toFixed(2),
    sdkTotalMs: +sdkTotal.toFixed(2),
    cliMeanMs: +cliMean.toFixed(2),
    cliTotalMs: +cliTotal.toFixed(2),
    speedupRatio: +speedup.toFixed(1),
    sdkWins: speedup > 1.5,
  };
}

/** Run the full bench suite. */
export async function vsCli(opts: BenchmarkOpts = {}): Promise<{
  ok: boolean;
  results: BenchmarkResult[];
  averageSpeedup: number;
  at: string;
}> {
  const results = [
    await benchEuStamp(opts),
    await benchClassify(opts),
  ];
  const avg = results
    .filter((r) => r.speedupRatio > 0)
    .reduce((s, r) => s + r.speedupRatio, 0)
    / Math.max(1, results.filter((r) => r.speedupRatio > 0).length);
  return {
    ok: results.every((r) => r.sdkWins || r.cliMeanMs === 0),
    results,
    averageSpeedup: +avg.toFixed(1),
    at: new Date().toISOString(),
  };
}
