/**
 * v2.143.0 — DRIFT MCP surface (Mission-Drift Detection / Context Forensics).
 * mneme.drift.analyze — run the EWMA control chart over an agent's action stream
 * vs its declared mission → STABLE / DRIFTING / DIVERGENT / UNKNOWN. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const DRIFT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.drift.analyze",
    category: "forensics",
    description: "🧭 MISSION DRIFT — catch an agent (yourself or another) slowly straying from its declared mission across turns. Pass the `mission` (+ optional `scopeGlobs` / `keywords`) and the `actions` stream ([{turn,summary,files,riskClass}]); it runs an EWMA statistical-process-control chart over a deterministic off-mission signal (off-scope files · off-topic vs the mission vocabulary · risk-class), with a control limit from the agent's OWN early baseline → band STABLE / DRIFTING / DIVERGENT / UNKNOWN + the first breach turn + the off-mission actions. Self-attesting. HONEST: it measures how far recent behaviour moved from the baseline — NOT mind-reading, NOT a future prediction; it abstains to UNKNOWN on thin data and never flags DIVERGENT below the minimum action count. (Distinct from mneme.overshoot's one-shot plan compare — this is the trend.)",
    whenToUse: "Periodically during a long multi-turn task (yours or a sub-agent's): feed the recent action stream + the declared mission to check you haven't drifted. A DRIFTING/DIVERGENT verdict is a signal to re-anchor to the mission before the next turn does damage.",
    triggers: ["drift", "mission drift", "am i still on task", "is the agent straying", "context forensics", "scope creep over time", "behaviour trend"],
    inputSchema: { type: "object", required: ["mission", "actions"], properties: { mission: { type: "object", properties: { goal: { type: "string" }, scopeGlobs: { type: "array", items: { type: "string" } }, keywords: { type: "array", items: { type: "string" } } } }, actions: { type: "array", items: { type: "object" }, description: "[{turn,summary,files?,riskClass?}]" }, lambda: { type: "number", description: "EWMA smoothing 0..1 (default 0.3)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const mission = (args["mission"] && typeof args["mission"] === "object") ? args["mission"] as import("@mneme-ai/core").drift.Mission : { goal: String(args["mission"] ?? "") };
        const actions = Array.isArray(args["actions"]) ? args["actions"] as import("@mneme-ai/core").drift.AgentAction[] : [];
        if (!actions.length) return low("no actions provided");
        const lambda = typeof args["lambda"] === "number" ? args["lambda"] as number : undefined;
        const r = core.drift.analyzeDrift(mission, actions, lambda !== undefined ? { lambda } : undefined);
        const data = await attest(cwd, `drift:${r.band}`, { band: r.band, driftScore: r.driftScore, ucl: r.ucl, baseline: r.baseline, firstBreachTurn: r.firstBreachTurn, breachCount: r.breachCount, reasons: r.reasons, note: r.note });
        return { data, wisdom: `${r.band === "DIVERGENT" ? "🛑" : r.band === "DRIFTING" ? "🟡" : r.band === "STABLE" ? "🟢" : "❔"} MISSION DRIFT ${r.band}${r.band !== "UNKNOWN" ? ` — EWMA ${r.driftScore} vs UCL ${r.ucl}${r.firstBreachTurn !== null ? `, first breach @ turn ${r.firstBreachTurn}` : ""}` : " — not enough data"}.`, followUp: [], confidence: { level: r.band === "UNKNOWN" ? "low" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
