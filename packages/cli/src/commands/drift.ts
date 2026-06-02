/**
 * `mneme drift` (v2.143.0) — Mission-Drift Detection (Context Forensics). Run an
 * EWMA statistical-process-control chart over an agent's action stream to catch
 * it slowly straying from its declared mission.
 *
 *   mneme telos --mission "refactor auth" --scope "src/auth/**" --actions log.jsonl
 *   cat actions.jsonl | mneme telos --mission "..." --actions -
 *
 * actions.jsonl: one JSON per line — {"turn":N,"summary":"...","files":["..."],"riskClass":"write"}
 * Exit 2 on DIVERGENT. HONEST: measures movement from the agent's own baseline,
 * not a prediction; abstains UNKNOWN on thin data.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { drift, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function splitList(v?: string): string[] { return typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []; }

function readActions(file?: string): drift.AgentAction[] {
  try {
    const raw = file === "-" ? readFileSync(0, "utf8") : (file && existsSync(file) ? readFileSync(file, "utf8") : "");
    const acts: drift.AgentAction[] = [];
    raw.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      try { const j = JSON.parse(line); acts.push({ turn: Number(j.turn) || i + 1, summary: String(j.summary ?? ""), files: Array.isArray(j.files) ? j.files.map(String) : undefined, riskClass: j.riskClass }); } catch { /* skip */ }
    });
    return acts;
  } catch { return []; }
}

function sparkline(series: number[], ucl: number): string {
  const blocks = "▁▂▃▄▅▆▇█";
  const max = Math.max(ucl, ...series, 0.001);
  return series.map((v) => { const idx = Math.min(blocks.length - 1, Math.floor((v / max) * (blocks.length - 1))); return v > ucl ? "❗" : blocks[idx]; }).join("");
}

export function registerDriftCommands(program: Command): void {
  program
    .command("telos")
    .alias("mission-drift")
    .description("🧭 TELOS (Mission Drift) — catch an agent slowly straying from its declared mission/telos across turns. Runs an EWMA statistical-process-control chart over a deterministic off-mission signal (off-scope files · off-topic vs the mission keywords · risk-class), with a control limit from the agent's OWN early baseline → band STABLE / DRIFTING / DIVERGENT / UNKNOWN. Reads an actions JSONL. Exit 2 on DIVERGENT. HONEST: measures movement from baseline, NOT a prediction; abstains UNKNOWN on thin data. (The trend layer — distinct from `mneme overshoot`'s one-shot plan compare.)")
    .requiredOption("--mission <goal>", "the declared mission/goal")
    .option("--scope <globs>", "comma-separated allowed path globs (e.g. \"src/auth/**\")")
    .option("--keywords <list>", "comma-separated mission vocabulary (else derived from the goal)")
    .requiredOption("--actions <file>", "JSONL of agent actions ({turn,summary,files,riskClass}); '-' = stdin")
    .option("--lambda <n>", "EWMA smoothing 0..1 (default 0.3)", (v) => parseFloat(v))
    .option("--json", "JSON output (signed)")
    .action((opts: { mission: string; scope?: string; keywords?: string; actions: string; lambda?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const mission: drift.Mission = { goal: opts.mission, scopeGlobs: splitList(opts.scope), keywords: splitList(opts.keywords) };
      const actions = readActions(opts.actions);
      const r = drift.analyzeDrift(mission, actions, opts.lambda !== undefined ? { lambda: opts.lambda } : undefined);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `drift:${r.band}`, payload: { band: r.band, driftScore: r.driftScore, ucl: r.ucl, firstBreachTurn: r.firstBreachTurn }, includePayload: true }); } catch { /* */ }

      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); process.exitCode = r.band === "DIVERGENT" ? 2 : 0; return; }
      const icon = r.band === "DIVERGENT" ? "🛑" : r.band === "DRIFTING" ? "🟡" : r.band === "STABLE" ? "🟢" : "❔";
      out(`${icon} MISSION DRIFT — ${r.band}`);
      if (r.band === "UNKNOWN") { out(`   ${r.reasons[0] ?? "not enough data"}`); out(`   ${r.note}`); process.exitCode = 0; return; }
      out(`   EWMA ${r.driftScore} vs baseline ${r.baseline.mean} · UCL ${r.ucl} · breaches ${r.breachCount}${r.firstBreachTurn !== null ? ` (first @ turn ${r.firstBreachTurn})` : ""}`);
      out(`   chart: ${sparkline(r.series, r.ucl)}`);
      for (const reason of r.reasons) out(`   • ${reason}`);
      if (r.offMissionRecent.length) { out("   off-mission actions:"); for (const a of r.offMissionRecent) out(`     t${a.turn} (${a.score}) ${a.summary}`); }
      out(`   ${receipt ? "✓ signed · " : ""}${r.note}`);
      process.exitCode = r.band === "DIVERGENT" ? 2 : 0;
    });
}
