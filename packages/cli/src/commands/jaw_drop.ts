/**
 * v2.19.88 — CLI commands for the five jaw-drop features:
 *   mneme swarm    <input>            (#1 Truth Swarm)
 *   mneme gauntlet  ...                (#2 Adversarial Gauntlet)
 *   mneme jury      ...                (#3 AI Jury)
 *   mneme blame     <file>:<line>      (#4 Provenance Graph)
 *   mneme stream                       (#5 Live Lie Stream)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── #1 TRUTH SWARM ────────────────────────────────────────────────────

export async function swarmCommand(opts: { cwd: string; text?: string; filePath?: string; vendor?: string; json?: boolean }): Promise<void> {
  const core = await import("@mneme-ai/core");
  const text = opts.text ?? (opts.filePath ? readFileSync(opts.filePath, "utf8") : "");
  if (!text) { process.stderr.write("swarm requires --text or --file\n"); process.exit(1); return; }
  const report = await core.truthSwarm.runTruthSwarm({ text, vendor: opts.vendor, repoRoot: resolve(opts.cwd) });
  if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); }
  else {
    const verdictBadge = report.overallVerdict === "ship" ? "✅ SHIP" : report.overallVerdict === "caution" ? "⚠️ CAUTION" : "🚨 BLOCK";
    process.stdout.write(`🥇 MNEME TRUTH SWARM — ${report.organs.length} organs fired in parallel\n\n`);
    process.stdout.write(`  ${verdictBadge}   green=${report.greenCount} yellow=${report.yellowCount} red=${report.redCount} grey=${report.greyCount}\n`);
    process.stdout.write(`  report:  ${report.reportId}   sig: ${report.sig}\n\n`);
    for (const o of report.organs) {
      const dot = o.verdict === "green" ? "🟢" : o.verdict === "yellow" ? "🟡" : o.verdict === "red" ? "🔴" : "⚪";
      process.stdout.write(`  ${dot}  ${o.organ.padEnd(18)} ${String(o.latencyMs).padStart(5)}ms · ${o.oneLine}\n`);
    }
  }
  if (report.overallVerdict === "block") process.exit(2);
}

// ─── #2 ADVERSARIAL GAUNTLET ───────────────────────────────────────────

export async function gauntletCommand(opts: { cwd: string; mode: "probes" | "grade"; vendor?: string; answersFile?: string; json?: boolean }): Promise<void> {
  const core = await import("@mneme-ai/core");
  if (opts.mode === "probes") {
    // Print the canary bank so a human or script can collect vendor answers.
    if (opts.json) { process.stdout.write(JSON.stringify(core.gauntlet.CANARY_BANK, null, 2) + "\n"); return; }
    process.stdout.write(`🎬 MNEME GAUNTLET — ${core.gauntlet.CANARY_BANK.length} canary probes\n\n`);
    for (const p of core.gauntlet.CANARY_BANK) {
      process.stdout.write(`  [${p.id.padEnd(14)}] ${p.category}/${p.difficulty}\n     Q: ${p.question}\n\n`);
    }
    process.stdout.write(`Collect vendor answers as JSON [{"probeId":"...", "vendorAnswer":"..."}] then:\n  mneme gauntlet grade --vendor X --answers-file answers.json\n`);
    return;
  }
  // grade
  if (!opts.vendor || !opts.answersFile) { process.stderr.write("gauntlet grade requires --vendor and --answers-file\n"); process.exit(1); return; }
  if (!existsSync(opts.answersFile)) { process.stderr.write(`not found: ${opts.answersFile}\n`); process.exit(1); return; }
  const answers = JSON.parse(readFileSync(opts.answersFile, "utf8")) as Array<{ probeId: string; vendorAnswer: string }>;
  const report = core.gauntlet.runGauntlet(opts.vendor, answers);
  if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); }
  else {
    const tierBadge = report.tier === "platinum" ? "💎 PLATINUM" : report.tier === "gold" ? "🥇 GOLD" : report.tier === "silver" ? "🥈 SILVER" : report.tier === "bronze" ? "🥉 BRONZE" : "⚠ NEEDS-WORK";
    process.stdout.write(`🎬 MNEME GAUNTLET — ${opts.vendor}\n\n`);
    process.stdout.write(`  ${tierBadge}\n  pass:     ${report.passed} / ${report.total}  (${(report.passRate * 100).toFixed(1)}%)\n  WilsonLB: ${(report.wilsonLowerBound * 100).toFixed(1)}%\n\n`);
    process.stdout.write(`  by category:\n`);
    for (const [k, v] of Object.entries(report.perCategory)) {
      process.stdout.write(`    ${k.padEnd(10)} ${v.passed.toString().padStart(2)}/${v.total.toString().padStart(2)}  (${(v.rate * 100).toFixed(0)}%)\n`);
    }
    process.stdout.write(`\n  by difficulty:\n`);
    for (const [k, v] of Object.entries(report.byDifficulty)) {
      process.stdout.write(`    ${k.padEnd(10)} ${v.passed.toString().padStart(2)}/${v.total.toString().padStart(2)}  (${(v.rate * 100).toFixed(0)}%)\n`);
    }
  }
}

// ─── #3 AI JURY ────────────────────────────────────────────────────────

export async function juryCommand(opts: { cwd: string; question: string; jurors: Array<{ vendor: string; answer: string }>; json?: boolean }): Promise<void> {
  const core = await import("@mneme-ai/core");
  if (opts.jurors.length === 0) { process.stderr.write("jury requires at least one --juror <vendor>:<answer>\n"); process.exit(1); return; }
  const verdict = core.aiJury.rule(opts.question, opts.jurors);
  if (opts.json) { process.stdout.write(JSON.stringify(verdict, null, 2) + "\n"); return; }
  process.stdout.write(`🥈 MNEME AI JURY — ${opts.jurors.length} jurors\n\n`);
  process.stdout.write(`  question:  ${verdict.question}\n`);
  process.stdout.write(`  ⚖  majority verdict by:  ${verdict.majorityVendor}\n`);
  process.stdout.write(`  consensus: ${(verdict.consensus * 100).toFixed(0)}%\n\n`);
  process.stdout.write(`  ballots:\n`);
  for (const a of verdict.agreementWithMajority) {
    const tag = a.dissenter ? "🛡 dissent" : "✓ majority";
    process.stdout.write(`    [${a.vendor.padEnd(12)}]  ${tag}  agreement=${a.agreement.toFixed(3)}\n`);
  }
}

// ─── #4 PROVENANCE GRAPH ───────────────────────────────────────────────

export async function provCommand(opts: { cwd: string; mode: "record" | "blame" | "list"; file?: string; lineStart?: number; lineEnd?: number; line?: number; vendor?: string; prompt?: string; content?: string; verdict?: string; limit?: number; json?: boolean }): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);
  if (opts.mode === "record") {
    if (!opts.file || opts.lineStart == null || opts.lineEnd == null || !opts.vendor || !opts.prompt) {
      process.stderr.write("provenance record requires --file --line-start --line-end --vendor --prompt --content\n"); process.exit(1); return;
    }
    const rec = core.provenance.recordProvenance(repoRoot, {
      file: opts.file, lineStart: opts.lineStart, lineEnd: opts.lineEnd,
      vendor: opts.vendor, prompt: opts.prompt, content: opts.content ?? "",
      polygraphVerdict: opts.verdict as "green" | "yellow" | "red" | "grey" | undefined,
    });
    if (opts.json) { process.stdout.write(JSON.stringify(rec, null, 2) + "\n"); return; }
    process.stdout.write(`🥉 MNEME PROVENANCE — recorded ${rec.file}:${rec.lineStart}-${rec.lineEnd} by ${rec.vendor}\n  chain:  ${rec.chainHash}\n`);
    return;
  }
  if (opts.mode === "blame") {
    if (!opts.file || opts.line == null) { process.stderr.write("provenance blame requires --file --line\n"); process.exit(1); return; }
    const recs = core.provenance.blame(repoRoot, opts.file, opts.line);
    if (opts.json) { process.stdout.write(JSON.stringify(recs, null, 2) + "\n"); return; }
    process.stdout.write(`🥉 MNEME PROVENANCE — blame ${opts.file}:${opts.line}\n\n`);
    if (recs.length === 0) { process.stdout.write(`  no AI provenance record for that line.\n`); return; }
    for (const r of recs) {
      const verdictDot = r.polygraphVerdict === "green" ? "🟢" : r.polygraphVerdict === "red" ? "🔴" : r.polygraphVerdict === "yellow" ? "🟡" : "⚪";
      process.stdout.write(`  ${verdictDot}  ${r.ts.slice(0, 19)}  vendor=${r.vendor}  lines ${r.lineStart}-${r.lineEnd}\n     promptHash=${r.promptHash}  contentHash=${r.contentHash}\n`);
    }
    return;
  }
  // list
  const recs = core.provenance.listProvenance(repoRoot, { limit: opts.limit ?? 20 });
  if (opts.json) { process.stdout.write(JSON.stringify(recs, null, 2) + "\n"); return; }
  process.stdout.write(`🥉 MNEME PROVENANCE — last ${recs.length} entries\n\n`);
  for (const r of recs) {
    process.stdout.write(`  ${r.ts.slice(0, 19)}  ${r.vendor.padEnd(12)}  ${r.file}:${r.lineStart}-${r.lineEnd}\n`);
  }
}

// ─── #5 LIVE LIE STREAM ────────────────────────────────────────────────

export async function streamCommand(opts: { cwd: string; once?: boolean; limit?: number; json?: boolean }): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  function render() {
    const lies = core.lieStream.readRecentLies(repoRoot, { limit: opts.limit ?? 20 });
    if (opts.json) { process.stdout.write(JSON.stringify(lies, null, 2) + "\n"); return; }
    process.stdout.write(`\x1b[2J\x1b[H`); // clear screen
    process.stdout.write(`🌐 MNEME LIVE LIE STREAM — last ${lies.length} refuted verdicts\n`);
    process.stdout.write(`   (rolling 24h window; reads pulse.jsonl in real time)\n\n`);
    if (lies.length === 0) {
      process.stdout.write(`   (no refuted verdicts yet — start the browser polygraph + browse claude.ai)\n`);
    } else {
      for (const l of lies) process.stdout.write("   " + core.lieStream.formatLieTickerLine(l) + "\n");
    }
    process.stdout.write(`\n   (Ctrl-C to exit)\n`);
  }

  render();
  if (opts.once) return;
  const interval = setInterval(render, 3000);
  process.on("SIGINT", () => { clearInterval(interval); process.stdout.write("\n   stream stopped.\n"); process.exit(0); });
  // Keep process alive.
  await new Promise(() => { /* never resolve */ });
}
