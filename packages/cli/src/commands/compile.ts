/**
 * `mneme compile` (v3.0.0) — MNEME-BC, the Behavioral Compiler. Parse ANY vendor's action
 * (a bash string, or a JSON tool-call on stdin) into the vendor-neutral Behavioral IR + a
 * deterministic verdict. The "common language" every AI vendor speaks once Mneme parses it.
 */
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { compiler } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerCompileCommands(program: Command): void {
  program.command("compile [command...]")
    .description("🏗 MNEME-BC — compile an AI action into the Behavioral IR (typed effect nodes) + a deterministic risk verdict. Reads the command from args, or a Claude Code hook JSON / raw command on stdin.")
    .option("--json", "emit the full IR + verdict as JSON")
    .action((commandParts: string[], o: { json?: boolean }) => {
      let input: unknown = (commandParts ?? []).join(" ");
      if (!String(input).trim()) { try { if (!process.stdin.isTTY) input = readFileSync(0, "utf8"); } catch { /* */ } }
      const ir = compiler.compileToIR(input);
      const v = compiler.analyzeIR(ir);
      if (o.json) { out(JSON.stringify({ ir, verdict: v }, null, 2)); if (v.verdict === "BLOCK") process.exitCode = 2; return; }
      const icon = v.verdict === "BLOCK" ? "🔴" : v.verdict === "REVIEW" ? "🟡" : "🟢";
      out(`🏗 MNEME-BC — ${icon} ${v.verdict} · maxRisk ${ir.maxRisk} · from ${ir.vendorShape}`);
      if (!ir.nodes.length) { out("   (no actionable nodes)"); return; }
      for (const n of ir.nodes) out(`   ${n.joinedBy || "·"} [${n.effect} ${n.risk}] ${n.verb}${n.flags.length ? "  {" + n.flags.join(",") + "}" : ""}`);
      if (v.reasons.length) out("   ⚠ " + v.reasons.join("; "));
      if (v.verdict === "BLOCK") process.exitCode = 2;
    });
}
