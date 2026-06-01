/**
 * `mneme outline <file>` (v2.124.0) — read a file's STRUCTURE for a fraction of
 * the tokens, then fetch the EXACT slice you need.
 *
 * The honest answer to "context-loading hyper-inflation": instead of an agent
 * Reading a whole 70-line (or 700-line) file into its context to orient itself,
 * it reads the structural skeleton (every symbol + line range, bodies elided),
 * then `--region <symbol|L1-L2>` fetches the byte-exact code only where it edits.
 *
 *   mneme outline src/foo.ts                 # the skeleton (cheap orientation)
 *   mneme outline src/foo.ts --region add    # byte-exact slice of `add`
 *   mneme outline src/foo.ts --region L40-L80 --json
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { outline } from "@mneme-ai/core";
import { appendSaving } from "./savings.js";

function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }

export function registerOutlineCommands(program: Command): void {
  program
    .command("outline <file>")
    .alias("glance")
    .description("🔭 Read a file's STRUCTURE (every symbol + line range, bodies elided) for a fraction of the tokens, instead of loading the whole file. `--region <symbol|L1-L2>` fetches the byte-EXACT slice to edit. Orient cheap → edit exact.")
    .option("--region <selector>", "fetch the byte-exact slice for a symbol name or an L<a>-L<b> range.")
    .option("--json", "structured JSON output.")
    .action((file: string, opts: { region?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const p = resolve(cwd, file);
      if (!existsSync(p)) { out(`✗ file not found: ${file}`); process.exitCode = 1; return; }
      let src = "";
      try { src = readFileSync(p, "utf8"); } catch (e) { out(`✗ read failed: ${(e as Error).message}`); process.exitCode = 1; return; }

      if (opts.region) {
        const r = outline.extractRegion(src, opts.region);
        if (!r.ok) { out(`✗ ${r.note}`); process.exitCode = 1; return; }
        if (opts.json) { outJson(r); return; }
        out(`# ${file} · L${r.startLine}-${r.endLine} (byte-exact)`);
        out(r.text);
        return;
      }

      const o = outline.extractOutline(src);
      const rendered = outline.renderOutline(o, { path: file });
      const m = outline.measureReduction(src.length, rendered.length);
      // record the measured saving into the signed treasury ledger (Pay-per-Token-Saved)
      try { appendSaving(cwd, { source: "outline", tokensBefore: m.estTokensBefore, tokensAfter: m.estTokensAfter }); } catch { /* best-effort */ }

      if (opts.json) { outJson({ outline: o, rendered, measure: m }); return; }
      process.stdout.write(rendered);
      out(`\n— ${o.symbolCount} symbols · ~${m.estTokensBefore} tok → ~${m.estTokensAfter} tok (${m.reductionPct}% less) · to edit: mneme outline ${file} --region <symbol|L1-L2>`);
      out(`  (${m.note})`);
    });
}
