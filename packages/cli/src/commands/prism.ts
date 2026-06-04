/**
 * `mneme prism` (v2.169.0) — PRISM: superposition reasoning with interference
 * collapse. Fan a question into N candidate branches (over the Matrix rail —
 * parallel by construction), keep them in superposition weighted by amplitude
 * (√confidence), let them INTERFERE (agreeing branches add coherently; refuting
 * branches subtract — destructive), then COLLAPSE via the Born rule to a measured
 * answer — or return SUPERPOSED (abstain) when there's no clear measurement.
 *
 *   mneme prism                                  # live self-test (gauntlet 100/100 + A/B)
 *   mneme prism collapse --branches branches.json   # collapse provided branches
 *
 * A branch is { "id", "answer", "confidence" (0..1), "stance"?: "support"|"refute" }.
 * Branches are produced by fanning the query out over the Matrix rail (or any
 * multi-agent / multi-attempt source); PRISM is the recombination brain.
 */
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { prism, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerPrismCommands(program: Command): void {
  const p = program
    .command("prism")
    .description("🔺 PRISM — SUPERPOSITION REASONING. Fan a question into N candidate branches, keep them in superposition (amplitude √confidence), let them INTERFERE (agreeing branches add coherently — (Σ√c)² superadditivity; refuting branches subtract — destructive), then COLLAPSE via the Born rule to a measured answer, or return SUPERPOSED (abstain) when there's no clear measurement. Beats confidence-argmax (and plurality) when many weak-but-coherent branches are right and a few strong-but-isolated are wrong. A deterministic operator INSPIRED by quantum amplitudes — NOT a quantum computer.")
    .action(() => {
      const g = prism.prismGauntlet();
      out(`🔺 PRISM — superposition reasoning self-test  (gauntlet ${g.score}/100)`);
      out(`  measured A/B on the target regime (${g.ab.cases} cases): prism ${(g.ab.prismAcc * 100).toFixed(0)}% · confidence-argmax ${(g.ab.argmaxAcc * 100).toFixed(0)}% · plurality ${(g.ab.pluralityAcc * 100).toFixed(0)}%`);
      for (const c of g.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(13)} ${c.detail}`);
      process.exitCode = g.score === 100 ? 0 : 2;
    });

  p.command("collapse")
    .description("collapse provided candidate branches into a measured answer (or SUPERPOSED). exit 2 if no clear collapse.")
    .requiredOption("--branches <file>", "JSON array of { id, answer, confidence, stance? } ('-' for stdin)")
    .option("--threshold <n>", "min top probability to collapse (default 0.5)", (v) => parseFloat(v))
    .option("--margin <n>", "min gap over the runner-up (default 0.15)", (v) => parseFloat(v))
    .option("--json", "JSON output")
    .action((opts: { branches: string; threshold?: number; margin?: number; json?: boolean }) => {
      let branches: prism.Branch[];
      try { branches = JSON.parse(opts.branches === "-" ? readFileSync(0, "utf8") : readFileSync(opts.branches, "utf8")); } catch { out("✗ could not read/parse branches JSON"); process.exitCode = 2; return; }
      if (!Array.isArray(branches)) { out("✗ branches must be a JSON array"); process.exitCode = 2; return; }
      const r = prism.collapse(branches, { ...(opts.threshold !== undefined ? { collapseThreshold: opts.threshold } : {}), ...(opts.margin !== undefined ? { margin: opts.margin } : {}) });
      let signed: unknown = r;
      try { signed = { ...r, _proof: notary.issueReceipt(process.cwd(), { kind: "reasoning-trace", subject: `prism:${r.collapsed ? "collapsed" : "superposed"}`, payload: { answer: r.answer, confidence: r.confidence }, includePayload: true }) }; } catch { /* unsigned */ }
      if (opts.json) { out(JSON.stringify(signed, null, 2)); process.exitCode = r.collapsed ? 0 : 2; return; }
      out(r.collapsed ? `🔺 COLLAPSED → "${r.answer}"  (P=${r.confidence.toFixed(3)}, coherence=${r.coherence.toFixed(2)})` : `🌫 SUPERPOSED — ${r.reason}`);
      out(`   spectrum: ${r.ranked.slice(0, 5).map((o) => `${o.answer}=${o.prob.toFixed(2)}`).join(" · ")}`);
      process.exitCode = r.collapsed ? 0 : 2;
    });
}
