/**
 * v2.124.0 — OUTLINE MCP surface: the agent-facing answer to context-loading
 * hyper-inflation. Instead of reading a whole file into context, an agent calls
 * mneme.outline.file to get the structural skeleton cheaply, then calls it again
 * with `region` for the byte-exact slice it must edit. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "outline", payload: { dataHash: h, tool: "outline.file" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const OUTLINE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.outline.file",
    category: "memory",
    description: "🔭 OUTLINE — read a code file's STRUCTURE for a fraction of the tokens instead of loading the whole file. Returns the skeleton (every import/function/class/interface/type/const/method with its signature + EXACT line range, bodies elided) + a measured token reduction. Pass `region` (a symbol name or 'L<a>-L<b>') to get the byte-EXACT slice to edit. Orient cheap (skeleton) → edit exact (region). Self-attesting. The honest fix for context-loading hyper-inflation — NOT a kernel hook, NOT 'understand code without seeing it'.",
    whenToUse: "BEFORE reading a code file in full to orient yourself: call mneme.outline.file { path } to learn its shape cheaply, then call again with { path, region: '<symbol>' } to load only the part you'll edit. Especially for large files where a raw read would burn thousands of tokens.",
    triggers: ["outline", "skeleton", "structure of file", "what's in this file", "read less of the file", "save tokens reading", "glance at file"],
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "path to the code file (relative to the repo root)" }, region: { type: "string", description: "optional: a symbol name or 'L<a>-L<b>' range to fetch the byte-exact slice instead of the skeleton" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const fs = await import("node:fs"); const path = await import("node:path");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const p = path.resolve(cwd, String(args["path"] ?? ""));
        if (!fs.existsSync(p)) return low(`file not found: ${String(args["path"])}`);
        const src = fs.readFileSync(p, "utf8");

        if (args["region"]) {
          const r = core.outline.extractRegion(src, String(args["region"]));
          const data = await attest(cwd, { ok: r.ok, mode: "region", path: args["path"], region: r.selector, startLine: r.startLine, endLine: r.endLine, text: r.text, note: r.note });
          return { data, wisdom: r.ok ? `🔭 byte-exact slice ${args["path"]} L${r.startLine}-${r.endLine}.` : `🔭 ${r.note}`, followUp: [], confidence: { level: r.ok ? "high" as const : "low" as const } };
        }

        const o = core.outline.extractOutline(src);
        const rendered = core.outline.renderOutline(o, { path: String(args["path"]) });
        const m = core.outline.measureReduction(src.length, rendered.length);
        const data = await attest(cwd, { mode: "skeleton", path: args["path"], symbolCount: o.symbolCount, totalLines: o.totalLines, outline: rendered, measure: m });
        return {
          data,
          wisdom: `🔭 ${o.symbolCount} symbols in ${o.totalLines} lines → skeleton ~${m.estTokensAfter} tok vs ~${m.estTokensBefore} tok for a full read (${m.reductionPct}% less). To edit, call again with region:'<symbol>'. (token figures are a labelled ≈chars/4 estimate)`,
          followUp: [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
