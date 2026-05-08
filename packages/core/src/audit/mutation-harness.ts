/**
 * Mutation harness — the v1.1 piece v0.48 deferred.
 *
 * v0.48 shipped the operator library (`MUTATORS`, `planMutants`) + the
 * score function (`scoreMutationVerdict`). What was missing: the driver
 * that actually applies each mutant to disk + invokes the user's test
 * command + collects kill/survive results.
 *
 * v1.1 ships that driver. Caller passes:
 *   - sourceFile path  — the file to mutate
 *   - testCommand      — what to run after each mutant ("npm test", "pytest", etc.)
 *   - cwd              — working directory for the test command
 *
 * The harness:
 *   1. Reads the source file once and computes mutants via `planMutants`.
 *   2. For each mutant: writes the mutated file → runs the test command
 *      → restores original → records kill/survive based on test exit code.
 *   3. Returns aggregate kill count + per-mutant detail trace.
 *
 * Performance
 *   16-way parallel via `concurrency.pmap` — N mutants run concurrently
 *   IF the user's test runner supports concurrency. We default to 1
 *   because most test suites assume single-process file system access;
 *   `--concurrency` opts in.
 *
 * Safety
 *   - Original file is restored even on test crash (try/finally).
 *   - Cap on total mutants prevents runaway test budgets.
 *   - SIGINT handler restores file on Ctrl-C.
 *   - Test command is `spawn`-with-array (no shell, no injection).
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { planMutants, type MutantPlan } from "./mutation-counterfactual.js";
import { pMap } from "../util/concurrency.js";

export interface RunMutationOptions {
  /** File to mutate (absolute path or relative to cwd). */
  sourceFile: string;
  /** Command to run after each mutant. argv array; no shell. */
  testCommand: string[];
  /** Working directory for the test command. */
  cwd: string;
  /** Concurrency level. Default 1 (most test suites assume serial fs). */
  concurrency?: number;
  /** Cap on total mutants generated. Default 16. */
  cap?: number;
  /** Per-mutant test timeout in ms. Default 60_000 (60s). */
  timeoutMs?: number;
  /** Optional progress callback per mutant completed. */
  onProgress?: (info: { index: number; total: number; killed: boolean; durationMs: number }) => void;
}

export interface MutantResult {
  plan: MutantPlan;
  /** True when the test exited non-zero (mutant killed). */
  killed: boolean;
  /** Test command's exit code. */
  exitCode: number | null;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Tail of stdout/stderr (last 500 chars) for debugging. */
  outputTail?: string;
  /** Error if the harness itself failed. */
  error?: string;
}

export interface MutationHarnessResult {
  sourceFile: string;
  totalMutants: number;
  killedMutants: number;
  /** killedMutants / totalMutants — 0 when no mutants. */
  mutationScore: number;
  /** Per-mutant detail. */
  results: MutantResult[];
  /** Sum of all per-mutant durations (wall-clock if serial; CPU-equivalent if parallel). */
  totalDurationMs: number;
}

/**
 * Run the full mutation campaign and return aggregated results.
 *
 * The function is robust to test-runner crashes: a mutant whose test
 * spawn itself errored is recorded but doesn't crash the campaign. The
 * source file is always restored at the end (success or failure).
 */
export async function runMutationCampaign(
  opts: RunMutationOptions,
): Promise<MutationHarnessResult> {
  const { sourceFile, testCommand, cwd } = opts;
  const concurrency = opts.concurrency ?? 1;
  const cap = opts.cap ?? 16;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  // 1. Read original + plan mutants
  const original = await readFile(sourceFile, "utf8");
  const lines = original.split("\n");
  const mutants = planMutants(lines, cap);

  if (mutants.length === 0) {
    return {
      sourceFile,
      totalMutants: 0,
      killedMutants: 0,
      mutationScore: 0,
      results: [],
      totalDurationMs: 0,
    };
  }

  // Restore-on-exit guard for SIGINT / unhandled errors
  let restored = false;
  const restore = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    try {
      await writeFile(sourceFile, original, "utf8");
    } catch {
      /* best-effort */
    }
  };
  const sigintHandler = (): void => {
    void restore().then(() => process.exit(130));
  };
  process.once("SIGINT", sigintHandler);

  try {
    // 2. Run mutants. With concurrency=1 (default), this is sequential.
    // With concurrency>1, mutants run concurrently — caller's responsibility
    // that their test runner supports it.
    let completed = 0;
    const results = await pMap(mutants, concurrency, async (plan) => {
      const t0 = Date.now();
      // Write mutant: replace the line at lineIndex
      const mutated = [...lines];
      mutated[plan.lineIndex] = plan.mutated;
      try {
        await writeFile(sourceFile, mutated.join("\n"), "utf8");
        const result = await runTestCommand(testCommand, cwd, timeoutMs);
        const durationMs = Date.now() - t0;
        const killed = result.exitCode !== 0;
        const r: MutantResult = {
          plan,
          killed,
          exitCode: result.exitCode,
          durationMs,
          outputTail: result.outputTail,
        };
        completed += 1;
        opts.onProgress?.({ index: completed, total: mutants.length, killed, durationMs });
        return r;
      } catch (err) {
        const durationMs = Date.now() - t0;
        completed += 1;
        return {
          plan,
          killed: false,
          exitCode: null,
          durationMs,
          error: (err as Error).message ?? String(err),
        };
      } finally {
        // Always restore THIS file before the next iteration (matters when
        // concurrency=1 — the next mutant reads from disk, not from `original`)
        await writeFile(sourceFile, original, "utf8");
      }
    });

    const killedMutants = results.filter((r) => r.killed).length;
    const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0);

    return {
      sourceFile,
      totalMutants: mutants.length,
      killedMutants,
      mutationScore: mutants.length === 0 ? 0 : killedMutants / mutants.length,
      results,
      totalDurationMs,
    };
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    await restore();
  }
}

/* ──────────────────────  Internals  ─────────────────────────────────── */

interface TestCommandResult {
  exitCode: number | null;
  outputTail: string;
}

async function runTestCommand(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<TestCommandResult> {
  return new Promise((resolve, reject) => {
    if (argv.length === 0) {
      reject(new Error("testCommand is empty"));
      return;
    }
    const [cmd, ...args] = argv;
    const proc = spawn(cmd!, args, {
      cwd,
      windowsHide: true,
      // Important: shell:false to avoid argument injection
      shell: false,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let buf = "";
    const onChunk = (chunk: Buffer | string): void => {
      buf += chunk.toString();
      // Keep only the last 500 chars to bound memory under a chatty test runner
      if (buf.length > 500) buf = buf.slice(buf.length - 500);
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", onChunk);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
      }, 1_000);
    }, timeoutMs);
    proc.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : code,
        outputTail: timedOut ? `[harness] timed out after ${timeoutMs}ms\n${buf}` : buf,
      });
    });
  });
}

/**
 * Convenience: run the campaign + return the score in the form the QSAC
 * scorer (`scoreMutationVerdict`) expects. Glue code so callers can do
 * one-shot integration without manual plumbing.
 */
export async function runMutationAndScore(opts: RunMutationOptions): Promise<{
  harness: MutationHarnessResult;
  score: ReturnType<typeof import("./mutation-counterfactual.js").scoreMutationVerdict>;
}> {
  const { scoreMutationVerdict } = await import("./mutation-counterfactual.js");
  const harness = await runMutationCampaign(opts);
  const score = scoreMutationVerdict({
    totalMutants: harness.totalMutants,
    killedMutants: harness.killedMutants,
    haveBaseline: harness.totalMutants > 0,
  });
  return { harness, score };
}
