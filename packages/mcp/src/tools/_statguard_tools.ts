/**
 * v3.116.0 — STATGUARD MCP surface. mneme.statguard.check — flag documented
 * statistical misinterpretations (p-value / CI / power), grounded in Greenland
 * et al. 2016, with the correction + citation. Self-attesting. Flows through the
 * Matrix gRPC rail automatically (registry tool).
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const STATGUARD_TOOLS: MnemeTool[] = [
  {
    name: "mneme.statguard.check",
    category: "forensics",
    description: "📐 STATGUARD — before you relay any interpretation of a statistical result (p-value, confidence interval, significance, power), check it for the 25 documented misinterpretations from Greenland et al. 2016. Catches the confident-but-wrong forms LLMs repeat: 'p>0.05 means no effect', '95% CI = 95% probability the truth is inside', 'significant = important', 'non-significant = groups equal', etc. Returns each hit with WHY it's wrong + the correct interpretation + the citation. Deterministic; CLEAN = no KNOWN fallacy. Self-attesting.",
    whenToUse: "Before delivering any statistics interpretation to a user (research, medical, analytics) — pass the sentence; if MISINTERPRETATION, fix it using the returned correction instead of relaying the fallacy.",
    triggers: ["p value", "p-value", "confidence interval", "statistically significant", "is this stats right", "power analysis", "interpret this result", "ตีความสถิติ", "p value แปลว่า", "นัยสำคัญทางสถิติ"],
    inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string", description: "the statistical statement to check" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const claim = String(args["claim"] ?? "");
        if (!claim.trim()) return low("statguard needs a 'claim' to check.");
        const r = core.statguard.checkStat(claim);
        const data = await attest(cwd, `statguard:${r.verdict}`, { ...(r as unknown as Record<string, unknown>) });
        const wisdom = r.verdict === "CLEAN"
          ? "✓ No known statistical misinterpretation detected (CLEAN ≠ proof the stats are correct)."
          : `🛑 ${r.hits.length} statistical fallacy(ies): ${r.hits.map((h) => h.name).join("; ")}. Fix before relaying — see each hit's 'correct'.`;
        return { data, wisdom, followUp: [], confidence: { level: r.verdict === "CLEAN" ? "high" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
