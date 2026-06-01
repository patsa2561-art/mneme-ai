/**
 * v2.136.0 — ELLEIPSIS MCP surface (the completeness gate). Self-attesting.
 * Before an agent sends its reply / applies its diff, it checks: did I silently
 * drop part of what the user asked for?
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "elleipsis", payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const ELLEIPSIS_TOOLS: MnemeTool[] = [
  {
    name: "mneme.elleipsis.check",
    category: "quality",
    description: "🕳 ELLEIPSIS (the omission/completeness gate) — everyone checks whether what you SAID is true; this checks what you SILENTLY LEFT OUT. Pass the user's original `request` + your `output` (reply or diff); it deterministically extracts the checkable asks from the request and reports each as COVERED / UNADDRESSED / VIOLATED (a 'don't do X' you did) / UNKNOWN, plus a completeness score and the gaps to look at. Self-attesting. HONEST: a coverage HEURISTIC with prove-or-unknown — it surfaces a likely gap to LOOK at, abstains to UNKNOWN when unsure, and never claims to catch every omission. The diamond a model vendor won't build (it surfaces what their model failed to do).",
    whenToUse: "BEFORE you send a reply or apply a multi-part diff — especially when the user gave a list of asks or a 'don't touch X' constraint. Run it with the user's verbatim request + your draft output; if anything is UNADDRESSED or VIOLATED, fix it (or tell the user) before delivering. Catches the dropped-requirement failure that looks fine on screen.",
    triggers: ["did i miss anything", "completeness", "omission", "dropped requirement", "did i address everything", "elleipsis", "coverage of my answer"],
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "the user's original request (what they asked you to do)." },
        output: { type: "string", description: "your reply or diff to check for coverage of that request." },
      },
      required: ["request"],
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const request = typeof args["request"] === "string" ? args["request"] as string : "";
        const output = typeof args["output"] === "string" ? args["output"] as string : "";
        if (!request) return low("requires 'request' — the user's original ask");
        const r = core.elleipsis.elleipsisReport(request, output);
        const data = await attest(cwd, {
          completenessScore: r.completenessScore, covered: r.covered, unaddressed: r.unaddressed,
          violated: r.violated, unknown: r.unknown, atoms: r.atoms.length,
          gaps: r.gaps.map((g) => ({ ask: g.atom.text, coverage: g.coverage, reason: g.reason })),
          note: r.note,
        });
        return {
          data,
          wisdom: (r.unaddressed + r.violated) > 0
            ? `🕳 ${r.unaddressed} UNADDRESSED + ${r.violated} VIOLATED of ${r.atoms.length} ask(s) — fix or surface BEFORE you deliver: ${r.gaps.slice(0, 3).map((g) => `"${g.atom.text.slice(0, 40)}"`).join(" · ")}`
            : `✓ no clear omission across ${r.atoms.length} ask(s) (completeness ${Math.round(r.completenessScore * 100)}%); ${r.unknown} UNKNOWN worth a glance — heuristic, not proof.`,
          followUp: [], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
