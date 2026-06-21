/**
 * `mneme statguard` (v3.116.0) — catch statistical misinterpretations (p-value /
 * CI / power) in a claim, grounded in Greenland et al. 2016. The anti-trap guard
 * so an AI agent (or a researcher) never relays a documented statistics fallacy.
 *
 *   mneme statguard "p > 0.05 so there is no effect"
 *   mneme statguard bench
 */

import type { Command } from "commander";
import { statguard, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerStatguardCommands(program: Command): void {
  const g = program
    .command("statguard")
    .alias("stat-check")
    .argument("[claim...]", "a statistical claim to check")
    .description("📐 STATGUARD — flag documented statistical misinterpretations (p-value / confidence interval / power) in a claim, with the correct interpretation + the Greenland et al. 2016 citation. The anti-trap guard so an AI never relays a stats fallacy to a researcher/doctor/analyst. Deterministic; CLEAN = no KNOWN fallacy (not 'the stats are correct').")
    .option("--json", "JSON output (signed)")
    .action((claim: string[] | undefined, opts: { json?: boolean }) => {
      const q = Array.isArray(claim) ? claim.join(" ") : String(claim ?? "");
      if (!q.trim()) { out("usage: mneme statguard \"<a statistical claim>\""); process.exitCode = 2; return; }
      const r = statguard.checkStat(q);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `statguard:${r.verdict}`, payload: { verdict: r.verdict, hits: r.hits.map((h) => h.id) }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); process.exitCode = r.verdict === "CLEAN" ? 0 : 2; return; }
      if (r.verdict === "CLEAN") { out(`✓ CLEAN — no known statistical misinterpretation detected.`); process.exitCode = 0; return; }
      out(`🛑 MISINTERPRETATION — ${r.hits.length} fallacy(ies):`);
      for (const h of r.hits) { out(`   • ${h.name}  [${h.ref}]`); out(`     why: ${h.why}`); out(`     fix: ${h.correct}`); }
      process.exitCode = 2;
    });

  g.command("bench")
    .description("the signed A/B: detection recall on documented fallacies + precision (no false flag on correct statements).")
    .option("--json", "JSON output")
    .action((opts: { json?: boolean }) => {
      const b = statguard.statGuardBench();
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "reasoning-trace", subject: `statguard.bench:r${b.recall}p${b.precision}`, payload: { recall: b.recall, precision: b.precision }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...b, signed: receipt }, null, 2)); return; }
      out(`📐 STATGUARD — ${b.total} labeled claims (${b.flaggable} fallacious + ${b.total - b.flaggable} correct):`);
      out(`   fallacies caught: ${b.caught}/${b.flaggable}  · recall ${(b.recall * 100).toFixed(0)}%`);
      out(`   correct kept clean: ${b.cleanCorrect}/${b.total - b.flaggable}  · precision ${(b.precision * 100).toFixed(0)}% (${b.falseFlags} false flag)`);
      out(`   ${receipt ? "✓ signed · " : ""}grounded in Greenland et al. 2016; deterministic pattern detector — CLEAN = no KNOWN fallacy, not a full stats proof.`);
    });
}
