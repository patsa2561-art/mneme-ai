/**
 * v2.120.0 — EXEC value layer MCP surface. Exposes the honest ROI projection so
 * an agent can answer "what would Mneme save my team?" with a transparent
 * (measured rate × your volume × your price) figure — never a fabricated metric.
 * Self-attesting (NOTARY _proof).
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "exec:roi", payload: { dataHash: h, tool: "exec.roi" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const EXEC_TOOLS: MnemeTool[] = [
  {
    name: "mneme.exec.roi",
    category: "insights",
    description: "📈 EXEC ROI PROJECTION — answer 'what would Mneme save my team?' with HONEST math: it reads the MEASURED tokens-saved-per-reduction rate from the local treasury ledger and projects it to your team × usage × months at YOUR vendor price. Transparent product (measured rate × your volume × your price), self-attesting, never a fabricated metric. $ uses the price YOU supply.",
    whenToUse: "When a user / buyer asks how much Mneme saves or could save their team. Pass teamSize, reductionsPerDevPerMonth, pricePer1kUSD (and optional months). Surface the projectedUsdSaved + the basis label; it is a projection, not a forecast.",
    triggers: ["roi", "how much would mneme save", "savings projection", "value to my team", "pay per token saved"],
    inputSchema: { type: "object", required: ["teamSize", "reductionsPerDevPerMonth", "pricePer1kUSD"], properties: { teamSize: { type: "number", description: "team size" }, reductionsPerDevPerMonth: { type: "number", description: "reduction-eligible events per dev per month" }, pricePer1kUSD: { type: "number", description: "your vendor's price per 1k input tokens (USD)" }, months: { type: "number", description: "projection horizon in months (default 12)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const fs = await import("node:fs"); const path = await import("node:path");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const p = path.join(cwd, ".mneme", "treasury", "ledger.jsonl");
        const events = fs.existsSync(p) ? core.treasury.parseLedger(fs.readFileSync(p, "utf8")) : [];
        const agg = core.treasury.aggregate(events);
        const proj = core.exec.projectRoi({
          measuredTokensSaved: agg.tokensSaved, measuredReductions: agg.events,
          teamSize: Number(args["teamSize"] ?? 0), reductionsPerDevPerMonth: Number(args["reductionsPerDevPerMonth"] ?? 0),
          pricePer1kUSD: Number(args["pricePer1kUSD"] ?? 0), months: args["months"] !== undefined ? Number(args["months"]) : 12,
        });
        const data = await attest(cwd, { ...proj, measuredReductionsRealized: agg.events });
        return {
          data,
          wisdom: agg.events === 0
            ? `📈 ROI projection is $0 until Mneme has realized reductions on this machine — run distill/loopguard/nkl to seed the measured rate. The math is honest, not a forecast.`
            : `📈 Projected ≈$${proj.projectedUsdSaved} saved over ${proj.months} months (measured rate ${proj.avgTokensPerReduction} tokens/reduction × your team/usage/price). A projection, not a guarantee.`,
          followUp: [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
