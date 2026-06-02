/**
 * v2.146.0 — INTENT GATEWAY MCP surface. mneme.gateway.route — map a user's free
 * natural-language request (any language) to the right Mneme command + a compiled
 * invocation, or ask to clarify. THE tool an AI agent calls when a user speaks
 * freely and the agent isn't sure which Mneme capability fits. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const GATEWAY_TOOLS: MnemeTool[] = [
  {
    name: "mneme.gateway.route",
    category: "meta",
    description: "🧭 INTENT GATEWAY — map a user's FREE natural-language request (any language, EN/Thai) to the right Mneme command + a compiled runnable invocation, with confidence. Returns ROUTED (a command), CLARIFY (ask which of the top candidates), or UNKNOWN. Curated bilingual concept-map + IDF catalog fallback + abstention (never a confident misfire) + entity extraction (budget / forbidden / scope). Measured: top-1 accuracy on a labeled corpus far exceeds the old keyword router. Self-attesting. HONEST: the LLM agent (you) is itself the best router — use this as the deterministic fallback when you're unsure which Mneme capability fits, or for chat-only/offline.",
    whenToUse: "When a user speaks in plain language and you're not certain which Mneme command serves them best, call this FIRST to get the right command (+ a compiled invocation). On ROUTED, run that command; on CLARIFY, ask the user which candidate; on UNKNOWN, proceed on your own judgment. The user never has to know command names.",
    triggers: ["gateway", "what command", "which mneme command", "route this request", "interpret this", "the user said", "natural language to command"],
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string", description: "the user's request in their own words (any language)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const text = typeof args["text"] === "string" ? args["text"] as string : "";
        if (!text.trim()) return low("no text provided");
        const r = core.intentGateway.route(text);
        const data = await attest(cwd, `gateway:${r.verdict}`, { verdict: r.verdict, command: r.command, confidence: r.confidence, candidates: r.candidates, entities: r.entities, invocation: r.invocation });
        return { data, wisdom: r.verdict === "ROUTED" ? `🟢 → ${r.command} (${(r.confidence * 100).toFixed(0)}%)${r.invocation && r.invocation !== r.command ? ` · run: ${r.invocation}` : ""}` : r.verdict === "CLARIFY" ? `❔ ambiguous — ask the user: ${r.candidates.map((c) => c.command).join(" / ")}` : "❔ no confident match — use your own judgment", followUp: [], confidence: { level: r.verdict === "ROUTED" ? "high" as const : "low" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
