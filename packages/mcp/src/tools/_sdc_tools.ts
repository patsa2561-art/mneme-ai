/**
 * v3.114.0 — SDC MCP surface (Syndrome-Decoded Consensus).
 * mneme.sdc.decode — error-correct a multi-agent trust mesh: detect + locate +
 * recover poisoned/wrong attestations, or abstain (UNRECOVERABLE). Self-attesting.
 * Flows through the Matrix gRPC rail automatically (registry tool).
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const SDC_TOOLS: MnemeTool[] = [
  {
    name: "mneme.sdc.decode",
    category: "forensics",
    description: "🧬 SDC — Syndrome-Decoded Consensus: error-correct a MULTI-AGENT trust mesh. Pass facts each with attestations [{agent,value}] from different agents; SDC treats them like a QEC codeword — detects + LOCATES the poisoned/wrong attestations from the syndrome, recovers the consensus truth while bad ones stay under tolerance, or returns UNRECOVERABLE (abstains, never guesses). Iteratively earns each agent's reliability from the whole mesh, so it BEATS plain majority-vote when liars are dense on a fact but a minority overall (measured). Use when N agents (any vendor) contributed conflicting facts and you must find the truth + the liar. Self-attesting.",
    whenToUse: "When multiple agents attested conflicting values for the same fact(s) — to recover the consensus truth AND locate which agent(s) poisoned/hallucinated, instead of trusting a single source or a raw majority.",
    triggers: ["which agent is lying", "poisoned memory", "consensus among agents", "agents disagree which is right", "byzantine agents", "error correct the mesh", "agent ไหนโกหก", "ความจำถูกวางยา"],
    inputSchema: { type: "object", required: ["facts"], properties: { facts: { type: "array", description: "[{fact, attestations:[{agent,value}]}]" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const facts = args["facts"] as import("@mneme-ai/core").sdc.FactInput[];
        if (!Array.isArray(facts) || facts.length === 0) return low("sdc.decode needs a non-empty 'facts' array: [{fact, attestations:[{agent,value}]}]");
        const m = core.sdc.decodeMesh(facts);
        const corrected = m.decoded.filter((d) => d.verdict === "CORRECTED").length;
        const unrec = m.decoded.filter((d) => d.verdict === "UNRECOVERABLE").length;
        const data = await attest(cwd, "sdc.decode", { ...(m as unknown as Record<string, unknown>) });
        return { data, wisdom: `🧬 SDC decoded ${m.decoded.length} fact(s): ${corrected} corrected, ${unrec} unrecoverable (abstained). ${m.corruptedAgents.length ? `Located bad agent(s): ${m.corruptedAgents.join(", ")}.` : "No bad agents located."}`, followUp: [], confidence: { level: unrec > 0 ? "medium" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
