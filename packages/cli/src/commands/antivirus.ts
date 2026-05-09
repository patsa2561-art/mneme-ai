/**
 * `mneme antivirus` -- CLI for the Antivirus / Vaccine Lab.
 *
 *   mneme antivirus scan <text-or-file>      one-shot scan
 *   mneme antivirus lab                      list strains + vaccines + efficacy
 *   mneme antivirus benchmark [<vaccine_id>] run benchmark, certify
 *   mneme antivirus immunize                 print active vaccines + auto-action hint
 *   mneme antivirus stats                    realtime counters
 *   mneme antivirus cure <text-or-file>      apply cures + print cleaned text
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { antivirus } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

function readDraft(arg: string): string {
  // Allow `mneme antivirus scan path/to/file` OR `mneme antivirus scan "text"`.
  if (arg && existsSync(arg)) {
    try { return readFileSync(arg, "utf8"); } catch { /* fall through */ }
  }
  return arg;
}

export function registerAntivirusCommands(program: Command): void {
  const av = program
    .command("antivirus")
    .alias("av")
    .description("Antivirus -- scan AI drafts for hallucination strains + run the vaccine lab.");

  av.command("scan <textOrFile>")
    .description("Scan a draft (literal text OR a file path) for all known hallucination strains.")
    .option("--json", "JSON output.")
    .option("--strain <id>", "Limit to a single strain id (e.g., citatio_viridis).")
    .action(async (textOrFile: string, opts: { strain?: string } & CommonOpts) => {
      const draft = readDraft(textOrFile);
      const vaccines = opts.strain
        ? antivirus.SEED_VACCINES.filter((v) => v.strain === opts.strain)
        : undefined;
      const r = await antivirus.scan(process.cwd(), draft, { vaccines });
      if (opts.json) { writeJson(r); return; }
      writeText(`Scan ${r.scanId.slice(0, 8)} -- ${r.assays.length} claim${r.assays.length === 1 ? "" : "s"} examined in ${r.totalMs}ms`);
      writeText(`Risk score: ${(r.riskScore * 100).toFixed(0)}%   Infections: ${r.infections.length}`);
      if (r.infections.length === 0) {
        writeText(`OK  No hallucinations detected.`);
        return;
      }
      writeText(``);
      for (const inf of r.infections) {
        writeText(`  [!] ${inf.claim.strain} -- "${inf.claim.match}" (offset ${inf.claim.offset})`);
        writeText(`      Evidence: ${inf.evidence}`);
        if (inf.cure) writeText(`      Cure:     ${inf.cure}`);
      }
    });

  av.command("lab")
    .description("Inspect the vaccine lab: strain taxonomy + active pharmacopoeia + efficacies.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const strains = antivirus.listStrains();
      const p = antivirus.readPharmacopoeia(process.cwd());
      if (opts.json) { writeJson({ strains, pharmacopoeia: p }); return; }
      writeText(`Strain taxonomy (${strains.length})`);
      for (const s of strains) {
        writeText(`  sev=${s.severity}  ${s.id.padEnd(24)} ${s.commonName}`);
      }
      writeText(``);
      writeText(`Pharmacopoeia (${p.vaccines.length} vaccines)`);
      for (const v of p.vaccines) {
        const f1 = v.efficacy?.f1 == null ? "uncertified" : `F1 ${v.efficacy.f1.toFixed(2)}`;
        writeText(`  ${v.id.padEnd(36)} v${v.version}  ${f1}  src=${v.source}`);
      }
    });

  av.command("benchmark")
    .description("Run benchmark suite (precision/recall/F1, HMAC-signed). Updates pharmacopoeia.")
    .option("--vaccine <id>", "Benchmark just this vaccine.")
    .option("--json", "JSON output.")
    .action(async (opts: { vaccine?: string } & CommonOpts) => {
      const wantId = opts.vaccine;
      const vaccines = wantId
        ? antivirus.SEED_VACCINES.filter((v) => v.id === wantId)
        : antivirus.SEED_VACCINES;
      writeText(`Running benchmarks for ${vaccines.length} vaccine${vaccines.length === 1 ? "" : "s"}...`);
      const results = await antivirus.runAllBenchmarks(process.cwd(), vaccines);
      antivirus.refreshEfficacies(process.cwd());
      if (opts.json) { writeJson(results); return; }
      writeText(``);
      for (const [id, eff] of Object.entries(results)) {
        const p = eff.precision == null ? "n/a" : eff.precision.toFixed(2);
        const r = eff.recall == null ? "n/a" : eff.recall.toFixed(2);
        const f = eff.f1 == null ? "n/a" : eff.f1.toFixed(2);
        writeText(`  ${id.padEnd(36)} P=${p} R=${r} F1=${f}  (TP=${eff.tp} FP=${eff.fp} TN=${eff.tn} FN=${eff.fn})`);
        writeText(`    sig=${eff.signature.slice(0, 16)}...`);
      }
    });

  av.command("immunize")
    .description("Activate antivirus for the current session (prints active vaccine summary).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const p = antivirus.readPharmacopoeia(process.cwd());
      const efficacies = p.vaccines.map((v) => v.efficacy?.f1).filter((f): f is number => typeof f === "number");
      const avgF1 = efficacies.length === 0 ? null : efficacies.reduce((s, x) => s + x, 0) / efficacies.length;
      const distinctStrains = new Set(p.vaccines.map((v) => v.strain)).size;
      const data = { activeVaccines: p.vaccines.length, distinctStrains, avgF1 };
      if (opts.json) { writeJson(data); return; }
      writeText(`OK  Antivirus active.`);
      writeText(`    ${p.vaccines.length} vaccines covering ${distinctStrains} strains${avgF1 != null ? ` (avg F1: ${avgF1.toFixed(2)})` : " (uncertified -- run \`mneme antivirus benchmark\`)"}.`);
    });

  av.command("stats")
    .description("Realtime stats snapshot.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const s = antivirus.readStats(process.cwd());
      const m = antivirus.deriveMetrics(s);
      if (opts.json) { writeJson({ ...s, derived: m }); return; }
      writeText(`Lifetime stats`);
      writeText(`  Scans:                ${s.totalScans}`);
      writeText(`  Claims examined:      ${s.totalClaimsExamined}`);
      writeText(`  Infections caught:    ${s.totalInfectionsCaught}`);
      writeText(`  Catch rate:           ${(m.catchRate * 100).toFixed(1)}%`);
      writeText(`  Avg scan time:        ${Math.round(m.avgScanMs)}ms`);
      writeText(`  Top strain:           ${m.topStrain ?? "(none yet)"}`);
      writeText(`  Vaccines invoked:     ${m.uniqueVaccinesActive}`);
    });

  av.command("cure <textOrFile>")
    .description("Apply cures from a fresh scan; prints the cleaned text.")
    .option("--strategy <s>", "redact | annotate", "redact")
    .option("--json", "JSON output.")
    .action(async (textOrFile: string, opts: { strategy?: string } & CommonOpts) => {
      const draft = readDraft(textOrFile);
      const r = await antivirus.scan(process.cwd(), draft, { recordStats: false });
      const strategy = (opts.strategy === "annotate" ? "annotate" : "redact") as "redact" | "annotate";
      let cleaned = draft;
      let replaced = 0;
      const sorted = [...r.infections].sort((a, b) => b.claim.match.length - a.claim.match.length);
      for (const inf of sorted) {
        const replacement = strategy === "annotate"
          ? `[SUSPECT: ${inf.claim.strain}] ${inf.claim.match} [/SUSPECT]`
          : "[redacted]";
        const before = cleaned;
        cleaned = cleaned.split(inf.claim.match).join(replacement);
        if (cleaned !== before) replaced++;
      }
      if (opts.json) { writeJson({ cleaned, replaced, strategy }); return; }
      writeText(`-- Cleaned (${replaced} replacements via ${strategy}) --`);
      writeText(cleaned);
    });
}
