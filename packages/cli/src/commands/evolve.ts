/**
 * `mneme evolve` -- self-modifying NUCLEUS proposal CLI (v1.26.4).
 *
 *   mneme evolve scan         show signals collected from local telemetry
 *   mneme evolve propose      generate markdown PR proposals
 *   mneme evolve list         list every persisted proposal
 *   mneme evolve view <id>    print one proposal's markdown
 *   mneme evolve stats        aggregate stats
 *
 * Mneme reads its own bug reports (selfcheck FAILs + antivirus
 * recurrences + PRECOG misses) and writes markdown PR proposals into
 * `.mneme/proposals/<id>.md`. NEVER auto-merges. The user (or a CI
 * agent) opens the actual GitHub PR.
 */

import type { Command } from "commander";
import { evolve } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerEvolveCommands(program: Command): void {
  const ev = program
    .command("evolve")
    .description("MNEME EVOLVE -- self-modifying NUCLEUS. Reads local telemetry, proposes markdown PR patches to Mneme itself. Never auto-merges.");

  ev.command("scan")
    .description("Show every signal Mneme can extract from local telemetry (selfcheck FAILs + antivirus + PRECOG misses).")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const sigs = evolve.scanSignals(process.cwd());
      if (opts.json) { writeJson(sigs); return; }
      if (sigs.length === 0) { writeText("(no signals -- run `mneme selfcheck run` first to populate)"); return; }
      writeText(`Mneme evolve -- ${sigs.length} signal(s)`);
      for (const s of sigs) {
        writeText(`  [${s.kind.padEnd(22)}] ${s.pattern}  x${s.occurrences}`);
        if (s.evidence) writeText(`         ${s.evidence}`);
      }
    });

  ev.command("propose")
    .description("Generate markdown PR proposals from current signals. Persists to .mneme/proposals/.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const ps = evolve.generateProposals(process.cwd());
      if (opts.json) { writeJson(ps); return; }
      if (ps.length === 0) { writeText("(no proposals generated -- no qualifying signals)"); return; }
      writeText(`Generated ${ps.length} proposal(s):`);
      for (const p of ps) {
        writeText(`  [${p.id}] (${(p.confidence * 100).toFixed(0)}%) ${p.title}`);
      }
      writeText(``);
      writeText(`View any with: mneme evolve view <id>`);
    });

  ev.command("list")
    .description("List every persisted proposal (sorted by confidence desc).")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const ps = evolve.listProposals(process.cwd());
      if (opts.json) { writeJson(ps); return; }
      if (ps.length === 0) { writeText("(no proposals -- run `mneme evolve propose`)"); return; }
      writeText(`Mneme proposals -- ${ps.length}`);
      for (const p of ps) {
        writeText(`  [${p.id}] (${(p.confidence * 100).toFixed(0)}%) ${p.title}`);
      }
    });

  ev.command("view <id>")
    .description("Print one proposal's full markdown.")
    .action((id: string) => {
      const md = evolve.viewProposal(process.cwd(), id);
      if (!md) { writeText(`(no proposal at id ${id})`); process.exit(1); return; }
      writeText(md);
    });

  ev.command("stats")
    .description("Aggregate stats: signal counts by kind, top recurring pattern.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const s = evolve.evolveStats(process.cwd());
      if (opts.json) { writeJson(s); return; }
      writeText(`Mneme evolve stats`);
      writeText(`  Total signals:    ${s.totalSignals}`);
      writeText(`  Total proposals:  ${s.totalProposals}`);
      writeText(`  By kind:`);
      for (const [k, n] of Object.entries(s.byKind)) writeText(`    ${k.padEnd(22)} ${n}`);
      writeText(`  Top pattern:      ${s.topPattern ?? "(none)"}`);
    });
}
