/**
 * `mneme matrix` (v2.166.0) — THE MATRIX RAIL pipe core. The transport-agnostic,
 * gRPC-ready pipe that flows ANY payload (0 B → tens of MB, binary, unicode)
 * byte-identical through ordered, compressed, hash-manifested frames — or says
 * exactly why. Run the self-test (pipe integrity + corruption + size A/B) or
 * measure a file's wire cost.
 *
 *   mneme matrix                 # self-test: pipe + corruption + size A/B (gauntlet)
 *   mneme matrix bench <file>    # measure raw-JSON vs rail-wire bytes for a file
 *   mneme matrix --json
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { matrix } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerMatrixCommands(program: Command): void {
  const m = program
    .command("matrix")
    .description("🛰 THE MATRIX RAIL — the local-first, gRPC-ready pipe core. Flows ANY payload (0 bytes → tens of MB, raw binary, unicode) byte-identical through ordered, compressed, hash-manifested frames; catches every dropped/reordered/duplicated/tampered chunk; compresses the wire. Run with no args for the self-test (pipe integrity + corruption + size A/B). The transport substance under the gRPC server.")
    .option("--json", "JSON output.")
    .action((opts: { json?: boolean }) => {
      const g = matrix.matrixGauntlet();
      if (opts.json) { out(JSON.stringify(g, null, 2)); if (g.score !== 100) process.exitCode = 2; return; }
      out(`🛰 MATRIX RAIL — pipe self-test  (gauntlet ${g.score}/100)`);
      out("");
      out(`  PIPE INTEGRITY   ${g.pipe.passed}/${g.pipe.cases} pathological payloads round-trip byte-identical (0B · 1B · 5MB · binary · unicode · nested)`);
      out(`  CORRUPTION       ${g.corruption.caught}/${g.corruption.cases} tamper classes caught (dropped · reordered · duplicate · flipped byte · manifest tamper) — no silent pass`);
      out(`  SIZE A/B         raw JSON ${g.ab.rawBytes.toLocaleString()} B → wire ${g.ab.wireBytes.toLocaleString()} B  (−${g.ab.savedPct}% on the wire, ${g.ab.frames} frame(s))`);
      out("");
      for (const c of g.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`);
      out("");
      out(`  The pipe is transport-agnostic (gRPC-ready). A large payload auto-splits into frames — gRPC's 4MB cap is not a wall. Every frame is hash-manifested; corruption is caught, never silently passed.`);
      if (g.score !== 100) process.exitCode = 2;
    });

  m.command("bench <file>")
    .description("Measure a file's wire cost: raw JSON utf8 bytes vs the rail's compressed frames.")
    .option("--json", "JSON output.")
    .action((file: string, opts: { json?: boolean }) => {
      if (!existsSync(file)) { out(`file not found: ${file}`); process.exitCode = 2; return; }
      let value: unknown;
      const text = readFileSync(file, "utf8");
      try { value = JSON.parse(text); } catch { value = text; } // works for JSON or any text
      const ws = matrix.wireSize(value);
      if (opts.json) { out(JSON.stringify(ws, null, 2)); return; }
      out(`🛰 wire cost of ${file}:`);
      out(`   raw JSON : ${ws.rawBytes.toLocaleString()} B`);
      out(`   rail wire: ${ws.wireBytes.toLocaleString()} B  (−${ws.savedPct}% · ${ws.frames} frame(s))`);
    });
}
