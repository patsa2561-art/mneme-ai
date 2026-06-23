/**
 * `mneme escalon` (v3.146.0) — the agent TOOL-GRAPH vulnerability analyzer.
 *
 *   analyze — given a tool manifest (JSON: [{id, capabilities, consumes, produces, description}]),
 *             find tool-chain privilege-escalation paths + poisoned tool descriptions.
 *
 *   mneme escalon analyze --file tools.json
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { escalon } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerEscalonCommands(program: Command): void {
  const c = program.command("escalon")
    .description("🔗 ESCALON — analyze an AI agent's TOOL GRAPH for (1) tool-chain privilege escalation (safe tools that compose into a dangerous capability — the confused deputy) and (2) MCP tool-poisoning (injection hidden in a tool's description). Deterministic, no LLM. ★HONEST: reasons over the DECLARED capabilities — surfaces reachable paths to inspect, not a proven runtime exploit.");

  c.command("analyze").description("find privilege-escalation chains + poisoned descriptions in a tool manifest")
    .option("--file <file>", "tool manifest JSON: [{id, capabilities:[], consumes:[], produces:[], description}]")
    .option("--json", "JSON")
    .action((o: { file?: string; json?: boolean }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); }
      catch { out("⛔ provide --file <tools.json> (or pipe the manifest on stdin)"); process.exitCode = 2; return; }
      let tools: unknown;
      try { tools = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const r = escalon.analyze(tools as Parameters<typeof escalon.analyze>[0]);
      if (o.json) { out(JSON.stringify(r, null, 2)); return; }
      const mark = r.verdict === "DANGER" ? "🔴" : r.verdict === "REVIEW" ? "🟠" : "🟢";
      out(`${mark} ESCALON — ${r.verdict} · ${r.tools} tools · ${r.escalations.length} escalation path(s) · ${r.poisoned.length} poisoned · ${r.critical} critical`);
      for (const e of r.escalations.slice(0, 8)) out(`   ${e.severity >= 80 && !e.gated ? "🔴" : "🟠"} [sev ${e.severity}] ${e.tools.join(" → ")} ⇒ ${e.sink}${e.gated ? " (gated)" : ""}`);
      for (const p of r.poisoned) out(`   ☣ poisoned: ${p.tool} — "${p.excerpt}"`);
      if (r.verdict === "CLEAN") out(`   ✅ no escalation path or poisoned description found.`);
    });
}
