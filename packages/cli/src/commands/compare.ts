/**
 * `mneme compare` (v3.148.0) — honest head-to-head: Mneme vs a typical baseline
 * approach, measured live from the real engines. No competitor names — "baseline" is a
 * faithful model of the common approach (keyword filter, single-tool review, unverified
 * claims). Each number is reproducible.
 *
 *   mneme compare
 */

import type { Command } from "commander";
import { compare } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerCompareCommands(program: Command): void {
  program.command("compare")
    .description("📊 HEAD-TO-HEAD — measured comparison of Mneme's approach vs a typical baseline (keyword filter / single-tool review / unverified claims), computed live from the real engines. ★HONEST: 'baseline' models the common approach, not a named product (Mneme can't run a third party's private engine).")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      const r = compare.compareSecurity();
      if (o.json) { out(JSON.stringify(r, null, 2)); return; }
      out(`📊 Mneme vs a typical baseline — Mneme wins all: ${r.mnemeWinsAll ? "YES" : "no"} (avg +${r.avgDelta})`);
      for (const x of r.rows) {
        out(`   • ${x.axis}: Mneme ${x.mneme} vs baseline ${x.baseline}  (Δ +${x.delta})`);
        out(`     ${x.metric} — ${x.note}`);
      }
      out(`   honest: 'baseline' = a faithful model of the common approach, not a named competitor.`);
    });
}
