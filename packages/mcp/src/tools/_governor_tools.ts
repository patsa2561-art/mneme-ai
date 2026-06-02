/**
 * v2.145.0 — THE AGENT GOVERNOR MCP surface. Orchestrator-agnostic: any platform
 * (Astra / Claude Code / Tycoon / AutoGen) hands an action (or a queue) + a
 * charter and gets a signed governance verdict / auto-batch report.
 * mneme.govern.decide — one action → verdict. mneme.govern.batch — run the queue
 * as a continuous auto-operation batch. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
const CHARTER_SCHEMA = { type: "object", properties: { mission: { type: "string" }, scopeGlobs: { type: "array", items: { type: "string" } }, riskEnvelope: { type: "string", enum: ["read", "write", "destructive"] }, budget: { type: "object" }, forbidden: { type: "array", items: { type: "string" } } } };

export const GOVERNOR_TOOLS: MnemeTool[] = [
  {
    name: "mneme.govern.decide",
    category: "forensics",
    description: "🏛 AGENT GOVERNOR — govern ONE agent action against a signed Charter → ALLOW_AUTONOMOUS / ALLOW_WITH_AUDIT / ESCALATE_HUMAN / BLOCK. Folds the gate signals (CERBERUS command-risk · CRUCIBLE shadow verdict · TELOS drift · REGRET band · ELLEIPSIS completeness · irreversibility) into one verdict. THE SAFETY INVARIANT: an irreversible / destructive / out-of-scope / over-budget / forbidden / drift-divergent action can NEVER be ALLOW_AUTONOMOUS. Self-attesting. HONEST: the Governor DECIDES — the orchestrator executes per the verdict (Mneme is the kernel, not the executor).",
    whenToUse: "BEFORE an agent (yours or a sub-agent's) takes a non-trivial action, gate it: pass the charter + the action (with whatever gate signals you have). Run it autonomously only on ALLOW_AUTONOMOUS; route ESCALATE_HUMAN to a person; never override a BLOCK.",
    triggers: ["govern", "agent governor", "is this action allowed", "should the agent do this", "charter", "autonomy gate"],
    inputSchema: { type: "object", required: ["charter", "action"], properties: { charter: CHARTER_SCHEMA, action: { type: "object", description: "{id,kind,summary,files?,reversible?,inverse?,tokensEst?,signals?}" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const charter = args["charter"] as import("@mneme-ai/core").agentGovernor.Charter;
        const action = args["action"] as import("@mneme-ai/core").agentGovernor.AgentAction;
        if (!charter || !action) return low("charter and action are required");
        const d = core.agentGovernor.governAction(charter, action);
        const data = await attest(cwd, `govern:${d.verdict}`, { id: d.id, verdict: d.verdict, autonomous: d.autonomous, reasons: d.reasons });
        return { data, wisdom: `${d.verdict === "ALLOW_AUTONOMOUS" ? "🟢" : d.verdict === "ALLOW_WITH_AUDIT" ? "🟡" : d.verdict === "ESCALATE_HUMAN" ? "✋" : "🛑"} ${d.verdict} — ${d.reasons[0] ?? ""}. ${d.autonomous ? "Run it." : "Do NOT run autonomously."}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.govern.batch",
    category: "forensics",
    description: "🏛 AGENT GOVERNOR — run a fleet's action QUEUE as a continuous AUTO-OPERATION BATCH against a signed Charter. Autonomous + audited actions flow without per-step human input; only irreversible / out-of-envelope / forbidden actions escalate; a circuit-breaker pauses the whole fleet on mission drift (TELOS DIVERGENT) / regret spike / escalation thrash. Returns the signed run report (autonomous / audited / escalated / blocked + breaker + budget). Self-attesting. This is the '1 founder + 1000 agents, safe + accountable, automatically' kernel.",
    whenToUse: "Hand the Governor a batch of queued agent actions + the charter; it returns which ran autonomously, which were audited, and which need a human — so the fleet operates continuously and you only review the escalations. Re-run as the queue grows.",
    triggers: ["govern batch", "auto operation", "run the agent fleet", "autonomous batch", "1000 agents", "fleet governance"],
    inputSchema: { type: "object", required: ["charter", "actions"], properties: { charter: CHARTER_SCHEMA, actions: { type: "array", items: { type: "object" } }, regretRate: { type: "number", description: "current fleet regret rate 0..1 (feeds the circuit-breaker)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const charter = args["charter"] as import("@mneme-ai/core").agentGovernor.Charter;
        const actions = Array.isArray(args["actions"]) ? args["actions"] as import("@mneme-ai/core").agentGovernor.AgentAction[] : [];
        if (!charter || !actions.length) return low("charter and a non-empty actions array are required");
        const regretRate = typeof args["regretRate"] === "number" ? args["regretRate"] as number : undefined;
        const rep = core.agentGovernor.governBatch(charter, actions, regretRate !== undefined ? { regretRate } : undefined);
        const data = await attest(cwd, `govern.batch:${rep.executed.length}/${rep.total}`, { total: rep.total, autonomous: rep.autonomous, audited: rep.audited, escalated: rep.escalated, blocked: rep.blocked, breakerTripped: rep.breakerTripped, breakerReason: rep.breakerReason, stoppedAt: rep.stoppedAt, budgetUsed: rep.budgetUsed, note: rep.note });
        return { data, wisdom: `🏛 GOVERNOR batch — 🟢${rep.autonomous} autonomous · 🟡${rep.audited} audited · ✋${rep.escalated.length} escalated · 🛑${rep.blocked.length} blocked${rep.breakerTripped ? ` · ⚡BREAKER TRIPPED (${rep.breakerReason})` : ""}.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
