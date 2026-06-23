/**
 * `mneme posture` (v3.147.0) — the signed Agent Security Posture report.
 * Composes MUTAGEN (input-guardrail breach test) + ESCALON (tool-graph escalation +
 * poisoning) into one A–F graded, Ed25519-signed certificate.
 *
 *   mneme posture scan --file agent.json
 *   mneme posture verify --file posture.json
 */

import type { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { posture } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerPostureCommands(program: Command): void {
  const c = program.command("posture")
    .description("🛡 AGENT SECURITY POSTURE — grade an AI agent's whole safety surface (input guardrail via MUTAGEN + tool-graph escalation/poisoning via ESCALON) into one A–F, Ed25519-signed report. ★HONEST: grades the DECLARED config against a known attack space — a posture assessment, not a live pentest.");

  c.command("scan").description("grade an agent profile (JSON: {name, guardrail:'mneme|naive|none', tools:[...]})")
    .option("--file <file>", "agent profile JSON")
    .option("--out <file>", "write the signed posture certificate JSON")
    .option("--json", "print the report JSON")
    .action((o: { file?: string; out?: string; json?: boolean }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); }
      catch { out("⛔ provide --file <agent.json> (or pipe it on stdin)"); process.exitCode = 2; return; }
      let profile: unknown;
      try { profile = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const { report, receipt } = posture.certifyPosture(process.cwd(), profile as Parameters<typeof posture.certifyPosture>[1]);
      if (o.out) writeFileSync(o.out, JSON.stringify(receipt, null, 2) + "\n");
      if (o.json) { out(JSON.stringify(report, null, 2)); return; }
      const mark = report.grade === "A" || report.grade === "B" ? "🟢" : report.grade === "C" || report.grade === "D" ? "🟠" : "🔴";
      out(`${mark} AGENT POSTURE — ${report.agent}: grade ${report.grade} (${report.score}/100)`);
      out(`   input '${report.input.guardrail}': ${Math.round(report.input.breachRate * 100)}% of ${report.input.tested} variants breach · tools: ${report.toolGraph.verdict} (${report.toolGraph.critical} critical, ${report.toolGraph.poisoned} poisoned)`);
      for (const f of report.findings) out(`   ${f}`);
      out(`   signed ${receipt.issuerFingerprint} · verify offline: mneme posture verify`);
    });

  c.command("verify").description("verify a posture certificate OFFLINE (Ed25519 + grade re-derives from score)")
    .option("--file <file>", "posture certificate JSON")
    .action((o: { file?: string }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); }
      catch { out("⛔ provide --file <posture.json>"); process.exitCode = 2; return; }
      let receipt: unknown;
      try { receipt = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const v = posture.verifyPosture(receipt);
      out(v.valid ? `🟢 VALID — grade ${v.grade} (${v.score}/100)` : `🔴 INVALID — ${v.reason}`);
      if (!v.valid) process.exitCode = 1;
    });
}
