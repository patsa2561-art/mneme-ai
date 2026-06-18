/**
 * v3.103.0 — MORPH MCP surface (the polymorphic plug).
 *
 * `mneme.morph` is the ONE tool an AI agent learns instead of memorizing 600+
 * static tools. The agent states its intent in free natural language (any
 * language, EN/Thai); MORPH resolves the right Mneme capability and returns the
 * typed next call — the concrete MCP tool to invoke, a runnable CLI, and the args
 * projected from the sentence — or asks to clarify when unsure. Self-attesting
 * (every result carries an offline-verifiable Ed25519 `_proof`). Flows through the
 * Matrix gRPC rail automatically (it is a registry tool). Composes the Intent
 * Gateway + the manifest — deterministic, not model magic.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const MORPH_TOOLS: MnemeTool[] = [
  {
    name: "mneme.morph",
    category: "meta",
    description: "🧬 MORPH — the polymorphic plug. Instead of memorizing Mneme's 600+ tools, state your intent in free natural language (any language, EN/Thai) and MORPH resolves the RIGHT capability and returns the typed NEXT CALL: the concrete MCP tool to invoke, a runnable CLI, and args projected from your sentence (budget/forbidden/scope). It abstains (CLARIFY) rather than misfire, and never invents a capability the router didn't resolve. Self-attesting (offline-verifiable proof). Examples: 'is this claim true', 'who wrote this and why', 'ดูแลเรื่องงบ 5 หมื่น ห้ามโพสต์'.",
    whenToUse: "FIRST call when you (an AI agent) want a Mneme capability but aren't sure which tool — describe the intent and MORPH hands back the exact tool + args to call next. The single front door for agents.",
    triggers: ["morph", "what mneme tool do i need", "which capability", "i want to but don't know the tool", "polymorphic", "shape the call for me", "ใช้ tool ไหนดี", "อยากทำ...แต่ไม่รู้ใช้อะไร"],
    inputSchema: { type: "object", required: ["intent"], properties: { intent: { type: "string", description: "what you want, in your own words (any language)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const intent = String(args["intent"] ?? "");
        if (!intent.trim()) return low("morph needs an 'intent' — describe what you want in plain words.");
        const m = core.morph.morph(intent);
        const data = await attest(cwd, `morph:${m.verdict}`, { ...(m as unknown as Record<string, unknown>) });
        const wisdom = m.verdict === "MORPHED" && m.capability
          ? `🧬 morphed → ${m.capability.command}${m.capability.mcpTool ? ` (call ${m.capability.mcpTool})` : ""} · confidence ${(m.confidence * 100).toFixed(0)}%. Next call is shaped in \`shape\` (mcpTool + cli + args).`
          : m.verdict === "CLARIFY"
            ? `❔ Not sure which capability — candidates: ${m.candidates.map((c) => c.mcpTool ?? c.command).join(", ")}. Ask the user or pick one.`
            : `❔ Couldn't map that to a Mneme capability — rephrase, or call mneme.boot to see what's possible.`;
        return { data, wisdom, followUp: m.capability?.mcpTool ? [m.capability.mcpTool] : [], confidence: { level: m.verdict === "MORPHED" ? "high" as const : "low" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
