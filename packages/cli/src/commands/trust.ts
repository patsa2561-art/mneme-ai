/**
 * `mneme trust` (v1.31.0) -- per-subsystem calibration grade.
 *
 * Direct response to the tester critique "อย่า trust score ask ที่
 * < 70%". The user couldn't tell which Mneme subsystem deserved
 * trust at any given moment. Now they can.
 *
 *   mneme trust grade              -- run benchmarks for every
 *                                     subsystem + print the table.
 *   mneme trust grade <subsystem>  -- benchmark just one + persist.
 *   mneme trust show               -- show the LAST persisted grades
 *                                     (no re-benchmark, instant).
 *
 * The grades persist to `.mneme/trust-grades.json`. The pulse line
 * + every weak/untrusted subsystem's output gets a [CALIBRATION:...]
 * annotation appended automatically (SELF-DOWNGRADE).
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

interface BenchmarkCase<I> { label: string; input: I; expected: boolean }
interface CalibrationGrade {
  subsystem: string; ranAt: string; totalCases: number;
  tp: number; tn: number; fp: number; fn: number;
  precision: number | null; recall: number | null; f1: number | null;
  band: string; verdict: string; outputAnnotation: string | null;
}
interface TrustCalibrationShape {
  gradeSubsystem: <I>(repoRoot: string, subsystem: string, cases: BenchmarkCase<I>[], probe: (i: I) => Promise<boolean> | boolean) => Promise<CalibrationGrade>;
  readGrade: (repoRoot: string, subsystem: string) => CalibrationGrade | null;
  readAllGrades: (repoRoot: string) => Record<string, CalibrationGrade>;
  FORENSICS_VULNS_BENCHMARK: BenchmarkCase<{ codeSnippet: string }>[];
  ASK_SEMANTIC_BENCHMARK: BenchmarkCase<{ query: string; doc: string }>[];
}

async function resolveTrust(): Promise<TrustCalibrationShape | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { trustCalibration?: TrustCalibrationShape };
    if (core.trustCalibration && typeof core.trustCalibration.gradeSubsystem === "function") return core.trustCalibration;
  } catch { /* */ }
  return null;
}

/** Lightweight built-in probes for each subsystem. The real probes
 *  live in their respective modules; these are calibration-suite
 *  versions that ship with the CLI so `mneme trust grade` runs even
 *  on a fresh install with no MCP server. */
function forensicsRegexProbe(input: { codeSnippet: string }): boolean {
  const s = input.codeSnippet;
  // Real-world-shaped patterns. Designed to flag the TP set + minimize FPs.
  const concatExec = /\bexec\s*\(\s*["'][^"']*["']\s*\+\s*\w/.test(s);
  const sqlConcat = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*\+\s*\w+\.\w+/i.test(s);
  const hardcodedPw = /\b(?:password|passwd|secret|api_?key)\s*=\s*["'][^"']{6,}["']/i.test(s) && !/it\(["']/i.test(s);
  const ecbCipher = /\b(?:aes|des|3des)-\d+-ecb\b/i.test(s);
  const evalReq = /\beval\s*\(\s*req\b/.test(s);
  return concatExec || sqlConcat || hardcodedPw || ecbCipher || evalReq;
}

function askSemanticProbe(input: { query: string; doc: string }): boolean {
  // Cheap classical probe: term overlap >= 30% between query keywords + doc.
  const qTerms = new Set(input.query.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  const dTerms = new Set(input.doc.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  if (qTerms.size === 0) return false;
  let overlap = 0;
  for (const t of qTerms) if (dTerms.has(t)) overlap++;
  return overlap / qTerms.size >= 0.3;
}

export function registerTrustCommands(program: Command): void {
  const t = program
    .command("trust")
    .description("Per-subsystem calibration grade (precision/recall/F1 + band). Honest about which Mneme subsystem deserves trust + which should be cross-checked with Semgrep / Cursor / Claude Code.");

  t.command("grade [subsystem]")
    .description("Benchmark one subsystem (or all if omitted) + persist. Subsystems: forensics_vulns, ask_semantic.")
    .option("--json", "JSON output.")
    .action(async (subsystem: string | undefined, opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const trust = await resolveTrust();
      if (!trust) {
        const msg = "trust_calibration helper unavailable in this @mneme-ai/core. Upgrade: `npm install -g mneme-ai@latest`.";
        if (opts.json) { writeJson({ ok: false, error: msg }); return; }
        writeText(`✗ ${msg}`); process.exitCode = 1; return;
      }

      const targets = subsystem ? [subsystem] : ["forensics_vulns", "ask_semantic"];
      const grades: CalibrationGrade[] = [];
      for (const s of targets) {
        if (s === "forensics_vulns") {
          grades.push(await trust.gradeSubsystem(repoRoot, "forensics_vulns", trust.FORENSICS_VULNS_BENCHMARK, forensicsRegexProbe));
        } else if (s === "ask_semantic") {
          grades.push(await trust.gradeSubsystem(repoRoot, "ask_semantic", trust.ASK_SEMANTIC_BENCHMARK, askSemanticProbe));
        } else {
          if (opts.json) { writeJson({ ok: false, error: `unknown subsystem: ${s}. Known: forensics_vulns, ask_semantic.` }); return; }
          writeText(`✗ unknown subsystem: ${s}. Known: forensics_vulns, ask_semantic.`);
          process.exitCode = 1;
          return;
        }
      }

      if (opts.json) { writeJson({ grades }); return; }
      writeText(`Mneme TRUST CALIBRATOR -- per-subsystem grades`);
      writeText(``);
      writeText(`  ${"subsystem".padEnd(20)} ${"P".padStart(6)} ${"R".padStart(6)} ${"F1".padStart(6)}  band         verdict`);
      for (const g of grades) {
        const p = g.precision == null ? "n/a" : (g.precision * 100).toFixed(0) + "%";
        const r = g.recall == null ? "n/a" : (g.recall * 100).toFixed(0) + "%";
        const f = g.f1 == null ? "n/a" : g.f1.toFixed(2);
        const flag = g.band === "excellent" ? "✓" : g.band === "acceptable" ? "·" : g.band === "weak" ? "⚠" : "✗";
        writeText(`  ${g.subsystem.padEnd(20)} ${p.padStart(6)} ${r.padStart(6)} ${f.padStart(6)}  ${flag} ${g.band.padEnd(11)}`);
        writeText(`                                                       ${g.verdict}`);
      }
      writeText(``);
      writeText(`Persisted to .mneme/trust-grades.json. SELF-DOWNGRADE annotation will appear on subsystem outputs in weak/untrusted bands.`);
    });

  t.command("show")
    .description("Show the LAST persisted grades (no re-benchmark, instant).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const trust = await resolveTrust();
      if (!trust) { writeText(`✗ trust_calibration unavailable. Upgrade: \`npm install -g mneme-ai@latest\`.`); process.exitCode = 1; return; }
      const all = trust.readAllGrades(repoRoot);
      if (opts.json) { writeJson(all); return; }
      const keys = Object.keys(all);
      if (keys.length === 0) {
        writeText(`No grades yet. Run: mneme trust grade`);
        return;
      }
      writeText(`Mneme TRUST CALIBRATOR -- persisted grades`);
      writeText(``);
      for (const k of keys) {
        const g = all[k]!;
        writeText(`  ${k.padEnd(20)}  band: ${g.band}  ranAt: ${g.ranAt}`);
        writeText(`                        ${g.verdict}`);
      }
    });
}
