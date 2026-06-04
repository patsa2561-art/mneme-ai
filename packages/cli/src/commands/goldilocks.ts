/**
 * `mneme goldilocks` (v2.174) — config-fragility / "habitable-zone" analyzer.
 * The honest core of the cosmic fine-tuning idea: find the band of values where
 * a config still works + how close your current value is to the nearest cliff.
 *
 *   mneme goldilocks                                  # self-test (gauntlet 100)
 *   mneme goldilocks scan --cmd "node bench.js {v}" --param max_tokens --lo 256 --hi 16000 --current 4000
 *     → runs the command with {v} substituted (exit 0 = pass), bisects the cliffs,
 *       and reports ROBUST / TIGHT / KNIFE-EDGE / UNSTABLE + the margin.
 */
import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { goldilocks, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerGoldilocksCommands(program: Command): void {
  const g = program
    .command("goldilocks")
    .description("🌗 GOLDILOCKS — config-fragility analyzer. Given a numeric config value, a range, and a pass/fail command, it finds the 'habitable zone' (the band where the system still works) by bisecting to each cliff, and tells you how close your value sits to breaking: ROBUST / TIGHT / KNIFE-EDGE / UNSTABLE. The honest engineering core of 'fine-tuning' — sensitivity analysis on an oracle you supply, not cosmology.")
    .action(() => {
      const r = goldilocks.goldilocksGauntlet();
      out(`🌗 GOLDILOCKS — habitable-zone analyzer self-test  (gauntlet ${r.score}/100)`);
      for (const c of r.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(18)} ${c.detail}`);
      process.exitCode = r.score === 100 ? 0 : 2;
    });

  g.command("scan")
    .description("find the habitable zone of a config value via a pass/fail command (exit 0 = pass). exit 2 if TIGHT/KNIFE-EDGE/UNSTABLE.")
    .requiredOption("--cmd <cmd>", "shell command with {v} substituted for the candidate value; exit 0 = pass")
    .requiredOption("--lo <n>", "low end of the search range", parseFloat)
    .requiredOption("--hi <n>", "high end of the search range", parseFloat)
    .requiredOption("--current <n>", "the current/configured value", parseFloat)
    .option("--param <name>", "a label for the parameter", "value")
    .option("--json", "JSON output")
    .action((opts: { cmd: string; lo: number; hi: number; current: number; param: string; json?: boolean }) => {
      const oracle = (v: number): boolean => {
        const cmd = opts.cmd.replace(/\{v\}/g, String(v));
        try { return spawnSync(cmd, { shell: true, stdio: "ignore", timeout: 120_000 }).status === 0; } catch { return false; }
      };
      const z = goldilocks.habitableZone(oracle, { lo: opts.lo, hi: opts.hi, current: opts.current });
      let signed: unknown = { param: opts.param, ...z };
      try { signed = { ...(signed as object), _proof: notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `goldilocks:${opts.param}`, payload: { verdict: z.verdict, margin: z.margin }, includePayload: true }) }; } catch { /* unsigned */ }
      if (opts.json) { out(JSON.stringify(signed, null, 2)); process.exitCode = z.verdict === "ROBUST" ? 0 : 2; return; }
      const icon = z.verdict === "ROBUST" ? "✓" : z.verdict === "UNSTABLE" ? "🛑" : "⚠";
      out(`${icon} ${opts.param} = ${opts.current} → ${z.verdict}`);
      if (z.passesNow) out(`   habitable zone: [${z.lowOpen ? "≤" : ""}${z.lowEdge.toPrecision(5)}, ${z.highEdge.toPrecision(5)}${z.highOpen ? "+" : ""}] · nearest cliff ${z.margin.toPrecision(4)} away (${(z.marginPct * 100).toFixed(1)}% of range)`);
      out(`   ${z.reason}`);
      process.exitCode = z.verdict === "ROBUST" ? 0 : 2;
    });
}
