/**
 * `mneme morph` (v3.103.0) — MORPH, the polymorphic surface. State an intent in
 * free natural language (any language, EN/Thai); MORPH resolves the RIGHT Mneme
 * capability and hands back the typed next call — the MCP tool to invoke, a
 * runnable CLI invocation, and the args projected from the sentence — signed.
 *
 *   mneme morph "is this claim actually true"
 *   mneme morph "ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม"
 *   mneme morph "ดูแลเรื่องงบ 5 หมื่น ห้ามโพสต์ด่าใคร"   --json
 */

import type { Command } from "commander";
import { morph as morphCore, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerMorphCommands(program: Command): void {
  program
    .command("morph")
    .alias("plug")
    .argument("[intent...]", "what you want, in your own words — any language")
    .description("🧬 MORPH — the polymorphic plug for AI agents: state an intent in free natural language; MORPH resolves the RIGHT Mneme capability and returns the typed next call (the MCP tool to invoke + a runnable CLI + args projected from your sentence), signed (offline-verifiable). One surface instead of memorizing 600+ tools; abstains (clarify) rather than misfire. Composes the Intent Gateway + the manifest. (MCP: mneme.morph)")
    .option("--json", "JSON output (signed)")
    .action((intent: string[] | undefined, opts: { json?: boolean }) => {
      const q = Array.isArray(intent) ? intent.join(" ") : String(intent ?? "");
      if (!q.trim()) { out("usage: mneme morph \"<what you want, in your own words>\""); process.exitCode = 2; return; }
      const plan = morphCore.morphPlan(q);
      const m = plan.steps[0]?.result ?? morphCore.morph(q);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `morph:${plan.multi ? "plan" : m.verdict}`, payload: { multi: plan.multi, steps: plan.plan.map((s) => s.command), verdict: m.verdict, command: m.capability?.command ?? null, confidence: m.confidence }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...(plan.multi ? { plan } : m), signed: receipt }, null, 2)); process.exitCode = (plan.multi ? plan.plan.length > 0 : m.verdict === "MORPHED") ? 0 : 2; return; }
      // compound intent → render the ordered pipeline
      if (plan.multi && plan.plan.length > 1) {
        out(`🧬 morph plan — ${plan.plan.length} steps (${plan.routedCount} routed · ${plan.abstainedCount} abstained):`);
        plan.plan.forEach((s, i) => {
          out(`   ${i + 1}. ${s.command}${s.mcpTool ? `  →  ${s.mcpTool}` : ""}`);
          if (s.cli && s.cli !== s.command) out(`      CLI: ${s.cli}`);
        });
        process.exitCode = 0; return;
      }
      if (m.verdict === "MORPHED" && m.capability) {
        out(`🧬 morphed → ${m.capability.command}   (confidence ${(m.confidence * 100).toFixed(0)}%)`);
        if (m.capability.mcpTool) out(`   MCP tool:  ${m.capability.mcpTool}`);
        if (m.shape?.cli && m.shape.cli !== m.capability.command) out(`   CLI:       ${m.shape.cli}`);
        const argKeys = Object.keys(m.shape?.args ?? {}).filter((k) => k !== "intent");
        if (argKeys.length) out(`   args:      ${argKeys.map((k) => `${k}=${JSON.stringify((m.shape!.args)[k])}`).join(" · ")}`);
        if (m.shape?.needs?.length) out(`   you supply: ${m.shape.needs.join(", ")}`);
        if (m.capability.what) out(`   what:      ${m.capability.what.slice(0, 160)}${m.capability.what.length > 160 ? "…" : ""}`);
      } else if (m.verdict === "CLARIFY") {
        out(`❔ Not sure which capability — did you mean one of these?`);
        for (const c of m.candidates) out(`   • ${c.command}${c.mcpTool ? `  (${c.mcpTool})` : ""}  [${c.score.toFixed(2)}]`);
      } else {
        out(`❔ I couldn't morph that to a Mneme capability — try rephrasing, or 'mneme boot' to see what's possible.`);
      }
      process.exitCode = m.verdict === "MORPHED" ? 0 : 2;
    });
}
