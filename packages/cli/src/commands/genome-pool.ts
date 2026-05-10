/**
 * `mneme genome-pool` -- opt-in chromosome contributor (v1.26.4 MVP).
 *
 *   mneme genome-pool package [--out FILE]   bundle local chromosomes (PII-scrubbed) into a JSON file
 *   mneme genome-pool preview                show summary without writing
 *   mneme genome-pool dry-run                same as preview (alias)
 *
 * No upload yet -- this is the Phase 1 MVP. Output is a single JSON
 * file the user can review and decide whether to share. Future
 * versions ship a `submit` subcommand that POSTs to a public Mneme
 * Genome Pool API.
 */

import type { Command } from "commander";
import { genome } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerGenomePoolCommands(program: Command): void {
  const gp = program
    .command("genome-pool")
    .description("Mneme Genome Pool MVP -- opt-in PII-scrubbed chromosome contributor.");

  gp.command("preview")
    .alias("dry-run")
    .description("Build the contribution package in memory + show summary. No file written.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const pkg = genome.pool.buildPackage(process.cwd());
      if (!pkg) { writeText("(nothing to contribute -- no chromosomes in lineage store yet)"); return; }
      if (opts.json) { writeJson(pkg); return; }
      writeText(genome.pool.packageSummary(pkg));
    });

  gp.command("package")
    .description("Build the package and write it to disk for review.")
    .option("--out <path>", "Override output path (default .mneme/genome-pool/contribution-<ts>.json)")
    .option("--json", "JSON output.")
    .action((opts: { out?: string } & CommonOpts) => {
      const pkg = genome.pool.buildPackage(process.cwd());
      if (!pkg) { writeText("(nothing to contribute -- no chromosomes in lineage store yet)"); return; }
      const path = genome.pool.writePackage(process.cwd(), pkg, opts.out);
      if (opts.json) { writeJson({ path, count: pkg.count, repoFingerprint: pkg.repoFingerprint }); return; }
      writeText(genome.pool.packageSummary(pkg));
      writeText(``);
      writeText(`✓ Wrote ${pkg.count} entr${pkg.count === 1 ? "y" : "ies"} to:`);
      writeText(`  ${path}`);
      writeText(``);
      writeText(`Review the file before sharing. The Mneme Genome Pool upload`);
      writeText(`endpoint is not live yet -- this command produces the bundle, you keep it.`);
    });
}
