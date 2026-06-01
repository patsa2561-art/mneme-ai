/**
 * v2.127.0 — CONTEXT BLINDING MCP surface. Before an agent relays code to a
 * hosted model, it calls mneme.blind.context to strip secret literals + replace
 * sensitive identifier names with reversible local placeholders; it keeps the
 * returned map LOCALLY, sends only `blinded`, then calls mneme.blind.restore on
 * the model's reply. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "blind", payload: { dataHash: h, tool: "blind.context" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const BLIND_TOOLS: MnemeTool[] = [
  {
    name: "mneme.blind.context",
    category: "forensics",
    description: "🕶 CONTEXT BLINDING — BEFORE relaying code to a hosted model, blind it: secret literals are REMOVED and sensitive identifier names (SecretFinancialEngine, userPasswordHash, …) become reversible local placeholders (MZ1, MZ2). Returns { blinded, map, stats }. Send ONLY `blinded` to the model; keep `map` in your own state; call mneme.blind.restore on the reply. The model reasons over the STRUCTURE (which is preserved) but never sees your real names or secrets. Pseudonymization (fast, ms), NOT ZKP/FHE; no kernel hook. Composes with mneme.egress.guard.",
    whenToUse: "When you must send proprietary/sensitive code to a hosted model and the org cares that real names + secrets never reach the provider: blind first, send `blinded`, keep `map`, restore the reply. mode:'aggressive' blinds ALL user identifiers; 'sensitive' (default) blinds secret/financial/internal-looking names + a protect[] list.",
    triggers: ["blind", "redact names", "code never leaks", "pseudonymize", "hide identifiers from the model", "salt mapping", "context blinding"],
    inputSchema: { type: "object", required: ["payload"], properties: { payload: { type: "string", description: "the code/context about to be sent to a hosted model" }, mode: { type: "string", enum: ["sensitive", "aggressive"], description: "default sensitive" }, protect: { type: "array", items: { type: "string" }, description: "identifier names to ALWAYS blind" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const r = core.blind.blindContext(String(args["payload"] ?? ""), { mode: args["mode"] === "aggressive" ? "aggressive" : "sensitive", protect: Array.isArray(args["protect"]) ? (args["protect"] as string[]) : undefined });
        const data = await attest(cwd, { blinded: r.blinded, map: r.map, identifiersBlinded: r.identifiersBlinded, secretsRedacted: r.secretsRedacted, note: r.note });
        return { data, wisdom: `🕶 Send the 'blinded' payload only — ${r.identifiersBlinded} name(s) blinded, ${r.secretsRedacted} secret(s) removed. Keep 'map' in YOUR state (never send it); call mneme.blind.restore on the model's reply.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.blind.restore",
    category: "forensics",
    description: "🕶 Restore real names in a model's reply, using the `map` returned by mneme.blind.context (placeholders → your real identifiers). Deterministic.",
    whenToUse: "Immediately after a hosted model replies to a blinded payload — restore the real names before applying its output.",
    triggers: ["unblind", "restore names", "reverse blinding"],
    inputSchema: { type: "object", required: ["text", "map"], properties: { text: { type: "string", description: "the model's reply (contains placeholders)" }, map: { type: "object", description: "the reverse map from mneme.blind.context" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const restored = core.blind.unblindOutput(String(args["text"] ?? ""), (args["map"] as Record<string, string>) ?? {});
        return { data: { restored }, wisdom: `🕶 restored real names.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
