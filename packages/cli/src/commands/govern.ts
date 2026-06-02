/**
 * `mneme govern` (v2.145.0) — THE AGENT GOVERNOR. The orchestrator-agnostic
 * governance kernel: ratify a Charter once, then run a fleet's action queue as a
 * continuous AUTO-OPERATION BATCH — autonomous + audited actions flow without
 * per-step human input; only irreversible / out-of-envelope / forbidden actions
 * escalate; a circuit-breaker pauses the fleet on mission drift. Signed.
 *
 *   mneme govern charter-init > charter.json
 *   mneme govern decide --charter charter.json --action '{"id":"a","kind":"edit",...}'
 *   mneme govern batch  --charter charter.json --actions queue.jsonl
 *   mneme govern amend  --charter charter.json --clean 20 --regretted 0
 *
 * batch/decide exit 2 if anything ESCALATEs/BLOCKs (CI-gate). HONEST: the Governor
 * DECIDES + SEQUENCES + ESCALATES + COMPENSATES; the orchestrator executes per
 * the verdicts (Mneme is the kernel, not the executor).
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { agentGovernor as gov, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function readCharter(file?: string): gov.Charter {
  try { if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")); } catch { /* */ }
  return { mission: "(none)", scopeGlobs: [], riskEnvelope: "read", budget: { maxActions: 100 }, forbidden: [] };
}

export function registerGovernCommands(program: Command): void {
  const g = program
    .command("govern")
    .description("🏛 THE AGENT GOVERNOR — the orchestrator-agnostic governance kernel that sits UNDER any agent platform (Astra / Claude Code / Tycoon / AutoGen) and makes a fleet of autonomous agents provably safe + accountable, automatically. Ratify a Charter once; then run the action queue as a continuous AUTO-OPERATION BATCH (autonomous + audited flow untouched; only irreversible / out-of-envelope / forbidden escalate; a circuit-breaker pauses the fleet on mission drift). Composes CERBERUS · CRUCIBLE · TELOS · REGRET · ELLEIPSIS into one signed verdict. HONEST: the Governor decides + sequences + escalates + compensates — the orchestrator executes per the verdicts.");

  g.command("charter-init")
    .description("print a Charter template (mission · scope · risk envelope · budget · forbidden).")
    .action(() => out(JSON.stringify({ mission: "describe the fleet's mission", scopeGlobs: ["src/**"], riskEnvelope: "write", budget: { maxActions: 100, maxTokens: 2000000 }, forbidden: ["delete production", "post publicly", "rotate credentials"] }, null, 2)));

  g.command("decide")
    .description("govern ONE action → ALLOW_AUTONOMOUS / ALLOW_WITH_AUDIT / ESCALATE_HUMAN / BLOCK (exit 2 if not autonomous).")
    .requiredOption("--charter <file>", "charter JSON")
    .requiredOption("--action <json>", "the action object (or '-' for stdin)")
    .option("--json", "JSON output (signed)")
    .action((opts: { charter: string; action: string; json?: boolean }) => {
      const charter = readCharter(opts.charter);
      let action: gov.AgentAction;
      try { action = JSON.parse(opts.action === "-" ? readFileSync(0, "utf8") : opts.action); } catch { out("✗ bad --action JSON"); process.exitCode = 2; return; }
      const d = gov.governAction(charter, action);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `govern:${d.verdict}`, payload: { id: d.id, verdict: d.verdict }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...d, signed: receipt }, null, 2)); process.exitCode = d.autonomous ? 0 : 2; return; }
      const icon = d.verdict === "ALLOW_AUTONOMOUS" ? "🟢" : d.verdict === "ALLOW_WITH_AUDIT" ? "🟡" : d.verdict === "ESCALATE_HUMAN" ? "✋" : "🛑";
      out(`${icon} ${d.verdict} — ${d.id}`);
      for (const r of d.reasons) out(`   • ${r}`);
      if (receipt) out("   ✓ signed");
      process.exitCode = d.autonomous ? 0 : 2;
    });

  g.command("batch")
    .description("run a fleet's action queue as a continuous AUTO-OPERATION BATCH; reports autonomous / audited / escalated / blocked + circuit-breaker. Exit 2 if anything escalated/blocked or the breaker tripped.")
    .requiredOption("--charter <file>", "charter JSON")
    .requiredOption("--actions <file>", "JSONL of actions ({id,kind,summary,files,reversible,inverse,signals,tokensEst}); '-' = stdin")
    .option("--regret-rate <n>", "current fleet regret rate 0..1 (feeds the circuit-breaker)", (v) => parseFloat(v))
    .option("--json", "JSON output (signed)")
    .action((opts: { charter: string; actions: string; regretRate?: number; json?: boolean }) => {
      const charter = readCharter(opts.charter);
      const raw = opts.actions === "-" ? readFileSync(0, "utf8") : (existsSync(opts.actions) ? readFileSync(opts.actions, "utf8") : "");
      const actions: gov.AgentAction[] = raw.split("\n").filter((l) => l.trim()).map((l, i) => { try { const j = JSON.parse(l); return { id: j.id ?? `a${i}`, kind: j.kind ?? "action", summary: j.summary ?? "", files: j.files, reversible: j.reversible, inverse: j.inverse, tokensEst: j.tokensEst, signals: j.signals ?? {} }; } catch { return null; } }).filter(Boolean) as gov.AgentAction[];
      const rep = gov.governBatch(charter, actions, opts.regretRate !== undefined ? { regretRate: opts.regretRate } : undefined);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `govern.batch:${rep.executed.length}/${rep.total}`, payload: { total: rep.total, autonomous: rep.autonomous, audited: rep.audited, escalated: rep.escalated.length, blocked: rep.blocked.length, breakerTripped: rep.breakerTripped }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...rep, signed: receipt }, null, 2)); process.exitCode = (rep.escalated.length || rep.blocked.length || rep.breakerTripped) ? 2 : 0; return; }
      out(`🏛 AGENT GOVERNOR — batch of ${rep.total}`);
      out(`   🟢 ${rep.autonomous} autonomous · 🟡 ${rep.audited} audited · ✋ ${rep.escalated.length} escalated · 🛑 ${rep.blocked.length} blocked`);
      out(`   budget used: ${rep.budgetUsed.actions} actions / ${rep.budgetUsed.tokens} tokens`);
      if (rep.breakerTripped) out(`   ⚡ CIRCUIT-BREAKER TRIPPED @ ${rep.stoppedAt}: ${rep.breakerReason}`);
      for (const e of rep.escalated.slice(0, 10)) out(`     ✋ ${e.id}: ${e.reasons.join("; ")}`);
      for (const b of rep.blocked.slice(0, 10)) out(`     🛑 ${b.id}: ${b.reasons.join("; ")}`);
      out(`   ${receipt ? "✓ signed · " : ""}${rep.note}`);
      process.exitCode = (rep.escalated.length || rep.blocked.length || rep.breakerTripped) ? 2 : 0;
    });

  g.command("amend")
    .description("Living Charter — propose widening/narrowing the autonomy envelope from evidence (clean approvals vs regrets).")
    .requiredOption("--charter <file>", "charter JSON")
    .option("--clean <n>", "count of clean human-approved actions", (v) => parseInt(v, 10), 0)
    .option("--regretted <n>", "count of regretted actions", (v) => parseInt(v, 10), 0)
    .option("--json", "JSON output")
    .action((opts: { charter: string; clean: number; regretted: number; json?: boolean }) => {
      const charter = readCharter(opts.charter);
      const a = gov.proposeAmendment(charter, { approvedClean: opts.clean, regretted: opts.regretted });
      if (opts.json) { out(JSON.stringify(a, null, 2)); return; }
      const icon = a.direction === "widen" ? "📈" : a.direction === "narrow" ? "📉" : "⏸";
      out(`${icon} envelope ${a.current} → ${a.proposed} (${a.direction})`);
      out(`   ${a.reason}`);
      out(`   (a proposal — the human ratifies; the envelope never auto-widens to destructive.)`);
    });
}
