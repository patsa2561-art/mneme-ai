/**
 * v2.174 — GOLDILOCKS MCP surface (config-fragility / habitable-zone).
 * mneme.goldilocks.zone — given DISCRETE probe samples [{v,pass}] + the current
 * value, infer the habitable band + margin to the nearest cliff + a verdict
 * (ROBUST/TIGHT/KNIFE-EDGE/UNSTABLE). The agent probes N config values itself
 * (it has the live system); Mneme turns the results into a signed verdict.
 */
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const GOLDILOCKS_TOOLS: MnemeTool[] = [
  {
    name: "mneme.goldilocks.zone",
    category: "quality",
    description: "🌗 GOLDILOCKS — config-fragility / habitable-zone. You probe a numeric config value at several points (does the system still PASS at v?), pass the results as samples [{v, pass}] + the current value; Mneme finds the contiguous passing band that contains current, the margin to the nearest cliff, and a verdict: ROBUST (comfortable) / TIGHT (small margin) / KNIFE-EDGE (on the boundary — fine-tuned/fragile) / UNSTABLE (current already fails). Self-attesting. The honest engineering core of 'fine-tuning' — sensitivity analysis, not cosmology.",
    whenToUse: "When you want to know how robust a config value is (max_tokens, timeout, concurrency, memory, retry, temperature): probe it at a spread of values, then ask whether the current setting is comfortably inside the working band or one step from a cliff.",
    triggers: ["config fragility", "how robust is this setting", "habitable zone", "margin to failure", "fine-tuning", "is this value safe", "sensitivity analysis"],
    inputSchema: { type: "object", required: ["samples", "current"], properties: { samples: { type: "array", description: "[{ v: number, pass: boolean }] — probe results across the range", items: { type: "object" } }, current: { type: "number", description: "the current/configured value" }, param: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const samples = (Array.isArray(args["samples"]) ? args["samples"] : []) as Array<{ v: number; pass: boolean }>;
        const current = typeof args["current"] === "number" ? args["current"] as number : 0;
        const z = core.goldilocks.zoneFromSamples(samples, current);
        const data = await attest(cwd, `goldilocks:${z.verdict}`, { param: String(args["param"] ?? "value"), ...(z as unknown as Record<string, unknown>) });
        return { data, wisdom: z.passesNow ? `🌗 ${z.verdict} — nearest cliff ${Number(z.margin).toPrecision(3)} away (${(z.marginPct * 100).toFixed(1)}% of range)` : `🛑 UNSTABLE — current value fails`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
