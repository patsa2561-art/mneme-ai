/**
 * v2.126.0 — SCAFFOLD MCP surface (the honest "Blueprint Inflation"): an agent
 * emits a compact spec for a KNOWN template; Mneme expands it into deterministic
 * boilerplate locally, saving the agent the OUTPUT tokens of typing it out.
 * Unknown kinds are refused (never guessed). Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "scaffold", payload: { dataHash: h, tool: "scaffold.generate" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const SCAFFOLD_TOOLS: MnemeTool[] = [
  {
    name: "mneme.scaffold.generate",
    category: "lab",
    description: "🧱 SCAFFOLD — expand a compact SPEC into deterministic boilerplate locally, so you DON'T spend output tokens typing it (the honest core of 'Blueprint Inflation'). KNOWN templates only: ts-model (interface + in-memory CRUD repo), test-skeleton (describe/it stubs), config (json/env). Returns the generated files + the measured output-token saving + a NOTARY proof. Leaves TODO markers exactly where you must write the REAL business logic. Unknown `kind` is REFUSED (never guessed). NOT a generator of arbitrary novel logic — information theory forbids reconstructing 2,000 lines of new logic from a 35-token spec.",
    whenToUse: "When the user wants standard BOILERPLATE (a typed data model + CRUD, a test skeleton, a config file): emit the compact spec to this tool instead of typing the full code, then write/review only the real logic at the TODO markers. Do NOT use it for arbitrary business logic.",
    triggers: ["scaffold", "blueprint", "generate boilerplate", "crud stub", "new model", "test skeleton", "inflate spec"],
    inputSchema: { type: "object", required: ["spec"], properties: { spec: { type: "object", description: "the blueprint, e.g. {kind:'ts-model',model:'User',fields:{id:'string',email:'string'},crud:true} | {kind:'test-skeleton',target:'Repo',cases:['creates','deletes']} | {kind:'config',format:'json'|'env',entries:{...}}" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const r = core.scaffold.scaffold(args["spec"] as Parameters<typeof core.scaffold.scaffold>[0]);
        if (!r.ok) return { data: { ok: false, kind: r.kind, error: r.error, note: r.note }, wisdom: `🧱 ${r.error}`, followUp: [], confidence: { level: "low" as const } };
        const data = await attest(cwd, { ok: true, kind: r.kind, files: r.files, measure: r.measure, note: r.note });
        return {
          data,
          wisdom: `🧱 ${r.kind}: spec ~${r.measure.specTokens} tok → ~${r.measure.codeTokens} tok of boilerplate (${r.measure.outputReductionPct}% output-token saving). Write the REAL logic at the TODO markers; this is boilerplate only.`,
          followUp: [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
