/**
 * `mneme sdc` (v3.114.0) — Syndrome-Decoded Consensus: error-correct a multi-agent
 * trust mesh. Detect + locate + recover poisoned/wrong attestations, or abstain.
 *
 *   echo '[{"fact":"x","attestations":[{"agent":"a","value":"T"},{"agent":"b","value":"T"},{"agent":"evil","value":"X"}]}]' | mneme sdc decode -
 *   mneme sdc bench       # the signed A/B: SDC vs plain majority-vote
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { sdc, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerSdcCommands(program: Command): void {
  const s = program
    .command("sdc")
    .description("🧬 SDC — Syndrome-Decoded Consensus: treat a multi-agent trust mesh like a QEC codeword. Detects + LOCATES poisoned/wrong attestations from the syndrome, recovers the consensus truth while errors stay under tolerance, or returns UNRECOVERABLE (abstains, never guesses). Beats plain majority-vote when liars are dense per-fact but a minority across the mesh (measured). The error-correction layer for a fleet of AI agents.");

  s.command("decode")
    .description("decode a mesh of facts+attestations (JSON array, '-' for stdin) → per-fact verdict + located bad agents + earned reliability.")
    .argument("[file]", "JSON file ('-' or omitted = stdin)")
    .option("--json", "JSON output")
    .action((file: string | undefined, opts: { json?: boolean }) => {
      let facts: sdc.FactInput[];
      try { const raw = !file || file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8"); facts = JSON.parse(raw); }
      catch { out("✗ could not read/parse JSON (expected: [{fact, attestations:[{agent,value}]}])"); process.exitCode = 2; return; }
      const m = sdc.decodeMesh(facts);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `sdc:decode:${m.decoded.length}`, payload: { corrupted: m.corruptedAgents, facts: m.decoded.length }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...m, signed: receipt }, null, 2)); return; }
      out(`🧬 SDC — ${m.decoded.length} fact(s), ${m.iterations} decode iteration(s)`);
      for (const d of m.decoded) out(`   ${d.verdict === "UNRECOVERABLE" ? "🛑" : d.verdict === "CORRECTED" ? "🔧" : "✓"} ${d.fact}: ${d.verdict}${d.value !== null ? ` → ${d.value}` : ""}${d.dissenters.length ? `  (dissent: ${d.dissenters.join(",")})` : ""}`);
      if (m.corruptedAgents.length) out(`   ⚠ located bad agents: ${m.corruptedAgents.join(", ")}`);
      out(`   reliability: ${Object.entries(m.reliability).map(([a, r]) => `${a}=${r}`).join(" · ")}`);
    });

  s.command("bench")
    .description("the signed A/B: Syndrome-Decoded Consensus vs plain majority-vote on a labeled mesh (sustained-liar regime).")
    .option("--json", "JSON output")
    .option("--seed <n>", "scenario seed", "7")
    .action((opts: { json?: boolean; seed?: string }) => {
      const b = sdc.sdcBench(parseInt(opts.seed ?? "7", 10) || 7);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "reasoning-trace", subject: `sdc.bench:${(b.sdcAcc * 100).toFixed(0)}vs${(b.majorityAcc * 100).toFixed(0)}`, payload: { sdcAcc: b.sdcAcc, majorityAcc: b.majorityAcc }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...b, signed: receipt }, null, 2)); return; }
      out(`🧬 SDC A/B — ${b.facts} labeled facts (sustained-liar regime):`);
      out(`   plain majority-vote: ${b.majorityCorrect}/${b.facts} = ${(b.majorityAcc * 100).toFixed(0)}%`);
      out(`   Syndrome-Decoded:    ${b.sdcCorrect}/${b.facts} = ${(b.sdcAcc * 100).toFixed(0)}%   (+${((b.sdcAcc - b.majorityAcc) * 100).toFixed(0)} pts)`);
      out(`   byzantine located:   precision ${b.byzantinePrecision} · recall ${b.byzantineRecall}`);
      out(`   ${receipt ? "✓ signed · " : ""}HONEST: corrects sustained liars who are a global minority; a colluding majority everywhere → UNRECOVERABLE (abstain, never guess).`);
    });
}
