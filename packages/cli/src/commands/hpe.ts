/**
 * `mneme protect` (v3.117.0) — the Hallucination Protection Engine. Run an AI
 * claim/output through the nerve mesh → TRUSTED / REVIEW / BLOCK + the fired nerves.
 *
 *   mneme protect "p > 0.05 so the drug has no effect"
 *   mneme protect bench
 */

import type { Command } from "commander";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { hpe, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

const LEDGER = () => join(process.cwd(), ".mneme", "hpe-learned.jsonl");
/** Load confirmed learned faults from the local ledger (auto-applied on every scan). */
function loadLearned(): hpe.LearnedFault[] {
  try {
    const p = LEDGER(); if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) as hpe.LearnedFault; } catch { return null; } }).filter((x): x is hpe.LearnedFault => !!x && Array.isArray(x.signature));
  } catch { return []; }
}

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
      const learned = loadLearned();
      const r = hpe.protect(q, undefined, { learned });
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `hpe:${r.verdict}`, payload: { verdict: r.verdict, trust: r.trust, fired: r.fired.map((f) => f.nerve) }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); process.exitCode = r.verdict === "BLOCK" ? 2 : 0; return; }
      const icon = r.verdict === "TRUSTED" ? "✓" : r.verdict === "REVIEW" ? "❔" : "🛑";
      out(`${icon} ${r.verdict}  (trust ${(r.trust * 100).toFixed(0)}%)`);
      for (const f of r.fired) { out(`   • [${f.severity}] ${f.nerve}: ${f.why}`); out(`     fix: ${f.fix}`); }
      if (!r.fired.length) out(`   no nerve fired — no known fault (not a proof of truth).`);
      process.exitCode = r.verdict === "BLOCK" ? 2 : 0;
    });

  g.command("learn")
    .argument("<claim...>", "the CONFIRMED hallucination to learn")
    .description("teach HPE a confirmed real hallucination it missed → it auto-catches that kind on every future scan. Consent-gated (only learn a confirmed fault); precision-guarded (a too-broad pattern is rejected). Appends to .mneme/hpe-learned.jsonl.")
    .option("--why <s>", "why it's a fault", "a previously-confirmed hallucination case")
    .option("--fix <s>", "the correct handling", "verify against the source before relaying")
    .option("--hard", "block (default: soft = review)", false)
    .action((claim: string[], opts: { why: string; fix: string; hard?: boolean }) => {
      const q = claim.join(" ");
      // guard against false-flagging the engine's own known-safe corpus
      const safe = hpe.HPE_CORPUS.filter((c) => c.expectSafe).map((c) => c.text);
      const res = hpe.learnFault(q, { why: opts.why, fix: opts.fix, severity: opts.hard ? "hard" : "soft" }, safe);
      if (!res.ok || !res.learned) { out(`🛑 not learned — ${res.reason}`); process.exitCode = 2; return; }
      try { const p = LEDGER(); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(res.learned) + "\n", "utf8"); } catch (e) { out(`✗ could not write ledger: ${(e as Error).message}`); process.exitCode = 2; return; }
      out(`✓ learned [${res.learned.severity}] ${res.learned.id}`);
      out(`   signature: ${res.learned.signature.join(" · ")}`);
      out(`   HPE will now ${res.learned.severity === "hard" ? "BLOCK" : "REVIEW"} this kind on every future scan (auto-loaded from the ledger).`);
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
