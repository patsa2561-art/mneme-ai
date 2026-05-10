/**
 * `mneme audit` -- recurring self-recheck loop CLI.
 *
 *   mneme audit run            run all checks once
 *   mneme audit watch          re-run every N seconds until clean
 *   mneme audit last           show last persisted report
 */

import type { Command } from "commander";
import { selfcheck } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

function fmtVerdict(v: { name: string; status: string; evidence: string; ms: number; fixHint?: string }): string {
  const tag = v.status === "pass" ? "PASS"
    : v.status === "warn" ? "WARN"
    : v.status === "fail" ? "FAIL"
    : "skip";
  return `  [${tag}] ${v.name.padEnd(34)} ${v.evidence}${v.fixHint ? `\n        fix: ${v.fixHint}` : ""}`;
}

export function registerSelfcheckCommands(program: Command): void {
  const a = program
    .command("selfcheck")
    .alias("recheck")
    .description("Recurring self-recheck loop: 12 checks against Mneme's own state.");

  a.command("run")
    .description("Run all checks once. Persists to .mneme/selfcheck/last.json.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const r = await selfcheck.runAudit(process.cwd());
      if (opts.json) { writeJson(r); return; }
      writeText(`${r.banner}  (${r.totalMs}ms)`);
      writeText(``);
      for (const v of r.verdicts) writeText(fmtVerdict(v));
    });

  a.command("watch")
    .description("Run audit every N seconds until clean (no FAILs). Default 30s, max 5 iterations.")
    .option("--interval <s>", "seconds between runs", (v) => Number(v))
    .option("--max <n>", "max iterations", (v) => Number(v))
    .option("--json", "JSON output.")
    .action(async (opts: { interval?: number; max?: number } & CommonOpts) => {
      let iteration = 0;
      const r = await selfcheck.recurringSelfRecheck(process.cwd(), {
        intervalMs: (opts.interval ?? 30) * 1000,
        maxIterations: opts.max ?? 5,
        onIteration: (rep) => {
          iteration++;
          if (opts.json) { writeJson({ iteration, ...rep }); }
          else writeText(`Iteration ${iteration}: ${rep.banner}`);
        },
      });
      if (opts.json) { writeJson({ final: r }); return; }
      writeText(``);
      writeText(`Final: ${r.banner}  (${r.totalMs}ms)`);
      for (const v of r.verdicts) writeText(fmtVerdict(v));
    });

  a.command("last")
    .description("Print the last persisted audit report (no re-run).")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const r = selfcheck.readReport(process.cwd());
      if (!r) {
        if (opts.json) { writeJson(null); return; }
        writeText("(no audit report yet -- run `mneme audit run`)");
        return;
      }
      if (opts.json) { writeJson(r); return; }
      writeText(`${r.banner}  (ranAt ${r.ranAt})`);
      for (const v of r.verdicts) writeText(fmtVerdict(v));
    });
}
