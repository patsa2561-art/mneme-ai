/**
 * `mneme protect` (v3.117.0) — the Hallucination Protection Engine. Run an AI
 * claim/output through the nerve mesh → TRUSTED / REVIEW / BLOCK + the fired nerves.
 *
 *   mneme protect "p > 0.05 so the drug has no effect"
 *   mneme protect bench
 */

import type { Command } from "commander";
import { hpe, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerHpeCommands(program: Command): void {
  const g = program
    .command("protect")
    .alias("hpe")
    .argument("[claim...]", "an AI claim/output to screen")
    .description("🧠 HALLUCINATION PROTECTION ENGINE — screen an AI claim through a mesh of INDEPENDENT nerves (statistical fallacy · self-contradiction · overconfidence · fabrication-risk · + external truth-grounding/consensus/injection). REFLEX-blocks any hard fault, ABSTAINS (REVIEW) when unverifiable, passes only well-calibrated claims → TRUSTED/REVIEW/BLOCK. HONEST: drives confidently-wrong → ~0 (precision-when-TRUSTED 1.0 measured), NOT 0% hallucination (impossible). TRUSTED = no KNOWN fault, not a proof of truth.")
    .option("--json", "JSON output (signed)")
    .action((claim: string[] | undefined, opts: { json?: boolean }) => {
      const q = Array.isArray(claim) ? claim.join(" ") : String(claim ?? "");
      if (!q.trim()) { out("usage: mneme protect \"<an AI claim>\""); process.exitCode = 2; return; }
      const r = hpe.protect(q);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `hpe:${r.verdict}`, payload: { verdict: r.verdict, trust: r.trust, fired: r.fired.map((f) => f.nerve) }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); process.exitCode = r.verdict === "BLOCK" ? 2 : 0; return; }
      const icon = r.verdict === "TRUSTED" ? "✓" : r.verdict === "REVIEW" ? "❔" : "🛑";
      out(`${icon} ${r.verdict}  (trust ${(r.trust * 100).toFixed(0)}%)`);
      for (const f of r.fired) { out(`   • [${f.severity}] ${f.nerve}: ${f.why}`); out(`     fix: ${f.fix}`); }
      if (!r.fired.length) out(`   no nerve fired — no known fault (not a proof of truth).`);
      process.exitCode = r.verdict === "BLOCK" ? 2 : 0;
    });

  g.command("bench")
    .description("the signed A/B: precision-when-TRUSTED (no hallucination passes) + per-class containment, on a labeled corpus.")
    .option("--json", "JSON output")
    .action((opts: { json?: boolean }) => {
      const b = hpe.hpeBench();
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "reasoning-trace", subject: `hpe.bench:p${b.precisionWhenTrusted}`, payload: { precisionWhenTrusted: b.precisionWhenTrusted, leaks: b.leaks.length }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...b, signed: receipt }, null, 2)); return; }
      out(`🧠 HPE — ${b.total} labeled claims (${b.risky} hallucination-class + ${b.safe} well-calibrated):`);
      out(`   ★ precision-when-TRUSTED: ${(b.precisionWhenTrusted * 100).toFixed(0)}%  (${b.leaks.length} hallucination leaked as TRUSTED)`);
      out(`   hallucinations contained: ${b.hallucinationsBlockedOrReviewed}/${b.risky}  · safe passed: ${b.safeTrusted}/${b.safe} (coverage ${(b.safeCoverage * 100).toFixed(0)}%)`);
      out(`   ${receipt ? "✓ signed · " : ""}HONEST: confidently-wrong → ~0 via reflex+abstain; NOT 0% hallucination (a novel failure no nerve models can still pass).`);
    });
}
