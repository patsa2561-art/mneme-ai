/**
 * `mneme chimera` (v1.27.9) -- single-author insight synthesizer.
 *
 *   mneme chimera                 # full report
 *   mneme chimera --commits 3000  # bigger window
 *   mneme chimera --json          # machine-readable
 *
 * Useful when other Mneme commands degenerate (NETWORK / STIGMERGY /
 * AUDIT certify all return "insufficient data" on solo repos).
 * CHIMERA still produces meaningful insight from time-of-day patterns
 * + area diversity + velocity + topic momentum + phantom-collaborator
 * suggestions.
 */

import type { Command } from "commander";
import { chimera } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerChimeraCommands(program: Command): void {
  program
    .command("chimera")
    .description("MNEME CHIMERA -- single-author insight synthesizer for solo repos. Surfaces time-of-day fingerprint + area diversity + velocity + topic momentum + phantom-collaborator suggestions even when other commands degenerate.")
    .option("--commits <n>", "git log window size (default 1000)", (v) => Number(v))
    .option("--json", "JSON output.")
    .action((opts: { commits?: number } & CommonOpts) => {
      const r = chimera.chimera(process.cwd(), { windowCommits: opts.commits ?? 1000 });
      if (opts.json) { writeJson(r); return; }
      writeText(`MNEME CHIMERA -- ${r.commitsAnalysed} commits analysed`);
      writeText(``);
      writeText(`📝 NARRATIVE`);
      writeText(`   ${r.narrative}`);
      writeText(``);
      writeText(`⏰ TIME FINGERPRINT`);
      writeText(`   Peak day:   ${r.timeFingerprint.peakDay}s`);
      writeText(`   Peak hour:  ${String(r.timeFingerprint.peakHour).padStart(2, "0")}:00 UTC`);
      writeText(``);
      writeText(`📂 AREA DIVERSITY`);
      writeText(`   Distinct top-level dirs: ${r.areaDiversity.distinctTopDirs}`);
      writeText(`   Avg path depth:          ${r.areaDiversity.avgDepth.toFixed(1)}`);
      writeText(`   Spread index:            ${(r.areaDiversity.spreadIndex * 100).toFixed(0)}/100  (0 = always one area · 100 = uniform)`);
      writeText(`   Top areas:`);
      for (const d of r.areaDiversity.hotDirs) {
        writeText(`     ${d.dir.padEnd(20)} ${d.commits.toString().padStart(5)} touches  (${(d.pctOfTotal * 100).toFixed(0)}%)`);
      }
      writeText(``);
      writeText(`🚀 VELOCITY`);
      writeText(`   Last 30d:  ${r.velocityProfile.last30dCommits}  commits  (${r.velocityProfile.rolling30dPerDay.toFixed(1)}/day)`);
      writeText(`   vs prior 30d:  ${r.velocityProfile.vs60dRatio.toFixed(2)}x  (${r.velocityProfile.trend})`);
      writeText(``);
      if (r.topicMomentum.perDir.length > 0) {
        writeText(`📈 TOPIC MOMENTUM (recent 30d vs prior 30-90d)`);
        for (const t of r.topicMomentum.perDir.slice(0, 8)) {
          writeText(`   ${t.label.padEnd(12)} ${t.dir.padEnd(20)}  recent=${t.recent30d}  prior=${t.prior30to90d}  ratio=${t.momentumRatio.toFixed(2)}x`);
        }
        writeText(``);
      }
      if (r.phantomCollaborators.isSolo && r.phantomCollaborators.phantoms.length > 0) {
        writeText(`👥 PHANTOM COLLABORATORS  (if you scaled to ${r.phantomCollaborators.suggestedTeamSize}-person team)`);
        for (const p of r.phantomCollaborators.phantoms) {
          writeText(`   ${p.phantomId}`);
          writeText(`     area: ${p.area}/`);
          writeText(`     would own: ${p.topFiles.join(", ")}`);
          writeText(`     why: ${p.rationale}`);
        }
        writeText(``);
      }
      writeText(`Re-run with --commits 3000 for a wider window, or --json for machine-readable output.`);
    });
}
