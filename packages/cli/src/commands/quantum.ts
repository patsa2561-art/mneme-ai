/**
 * `mneme quantum` -- educational easter egg about why we don't need
 * quantum computing for the AI-agent-trigger problem.
 */

import type { Command } from "commander";
import { quantum } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerQuantumCommands(program: Command): void {
  const q = program
    .command("quantum")
    .description("Why Mneme doesn't need quantum (yet) -- educational easter egg.");

  q.command("why")
    .description("Plain-English explanation of why quantum doesn't solve the AI-trigger gap.")
    .action(() => {
      writeText(quantum.whyNotQuantum());
    });

  q.command("compare")
    .description("Side-by-side classical vs quantum complexity table for Mneme-relevant problems.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      if (opts.json) { writeJson(quantum.COMPLEXITY_TABLE); return; }
      writeText(`Classical vs Quantum -- where Mneme can/can't benefit`);
      writeText(``);
      for (const row of quantum.COMPLEXITY_TABLE) {
        writeText(`  Classical: ${row.classical.name.padEnd(28)} ${row.classical.bigO}`);
        writeText(`  Quantum:   ${row.quantum.name.padEnd(28)} ${row.quantum.bigO}`);
        writeText(`  Speedup:   ${row.speedup}`);
        writeText(`  Mneme?:    ${row.applicableToMneme ? "YES" : "no"}  -- ${row.reason}`);
        writeText(``);
      }
    });

  q.command("grover <N>")
    .description("Grover's algorithm: how many iterations to find one item among N?")
    .action((n: string) => {
      const N = parseInt(n, 10);
      if (!Number.isFinite(N) || N <= 0) { writeText("N must be a positive integer"); return; }
      const iters = quantum.groverIterations(N);
      const speedup = quantum.quantumSpeedupAt(N);
      writeText(`Grover over N=${N}: ~${iters} iterations (vs N classical = ${speedup.toFixed(1)}x speedup).`);
    });
}
