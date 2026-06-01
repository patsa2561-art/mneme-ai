/**
 * `mneme elleipsis` (v2.136.0) — the omission / completeness gate.
 * Did the AI silently drop part of what you asked for?
 *
 *   mneme elleipsis --request "add X and a test, don't touch auth" --output "<AI reply or diff>"
 *   mneme elleipsis --request-file ask.txt --output-file reply.txt --json
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { elleipsis, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function readMaybe(inline: string | undefined, file: string | undefined): string {
  if (typeof inline === "string") return inline;
  if (file && existsSync(file)) { try { return readFileSync(file, "utf8"); } catch { /* */ } }
  return "";
}

export function registerElleipsisCommands(program: Command): void {
  program
    .command("elleipsis")
    .alias("omission")
    .description("🕳 ELLEIPSIS — the completeness gate: extract the checkable asks from YOUR request and report which the AI's output COVERED / left UNADDRESSED / VIOLATED (a 'don't do X' it did). Catches the lie of omission — what the AI silently left out. Heuristic + prove-or-unknown (abstains to UNKNOWN; never fabricates a gap).")
    .option("--request <t>", "your original request (what you asked the AI to do).")
    .option("--request-file <p>", "read the request from a file.")
    .option("--output <t>", "the AI's reply or diff to check for coverage.")
    .option("--output-file <p>", "read the AI output from a file.")
    .option("--json", "JSON output (full signed report).")
    .action((opts: { request?: string; requestFile?: string; output?: string; outputFile?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const request = readMaybe(opts.request, opts.requestFile);
      const output = readMaybe(opts.output, opts.outputFile);
      if (!request) { process.stderr.write("✗ requires --request \"...\" (or --request-file). What did you ask the AI to do?\n"); process.exitCode = 2; return; }
      const r = elleipsis.elleipsisReport(request, output);
      const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "elleipsis", payload: { atoms: r.atoms.length, unaddressed: r.unaddressed, violated: r.violated, completeness: Number(r.completenessScore.toFixed(3)) }, includePayload: true });

      if (opts.json) { out(JSON.stringify({ ...r, receipt }, null, 2)); process.exitCode = (r.unaddressed + r.violated) > 0 ? 2 : 0; return; }

      const pct = Math.round(r.completenessScore * 100);
      const icon = r.violated > 0 ? "🛑" : r.unaddressed > 0 ? "⚠️" : "✓";
      out(`${icon} ELLEIPSIS — completeness ${pct}% · ${r.covered} covered · ${r.unaddressed} unaddressed · ${r.violated} violated · ${r.unknown} unknown  (of ${r.atoms.length} ask(s))`);
      for (const g of r.gaps.slice(0, 12)) {
        const tag = g.coverage === "VIOLATED" ? "🛑 VIOLATED" : "⚠️ UNADDRESSED";
        out(`   ${tag}: "${g.atom.text}"\n       ${g.reason}`);
      }
      if (r.unknown > 0) {
        const unk = r.verdicts.filter((v) => v.coverage === "UNKNOWN").slice(0, 6);
        if (unk.length) out(`   · ${r.unknown} UNKNOWN (worth a glance): ${unk.map((v) => `"${v.atom.text.slice(0, 32)}"`).join(" · ")}`);
      }
      out(`   # ${r.note}`);
      process.exitCode = (r.unaddressed + r.violated) > 0 ? 2 : 0;
    });
}
