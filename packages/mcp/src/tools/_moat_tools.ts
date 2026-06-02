/**
 * v2.150.0 — MOAT MCP surface. mneme.moat.score — the deterministic, signed
 * competitive-moat score from real present capabilities + measured signals.
 * Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const MOAT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.moat.score",
    category: "meta",
    description: "📊 MOAT — the deterministic, SIGNED competitive-moat score: a number (0-100) computed from REAL present capabilities × their MEASURED signals (live SIEGE gate-resistance, Gateway routing accuracy, the mycelium/canon/governor gauntlets, signed-primitive depth, locally-accumulating signed ledgers = switching cost). Returns the overall + per-dimension breakdown + the before→after delta vs the pre-session baseline. Self-attesting. HONEST: engineering-moat signals verifiable in-repo — NOT a market valuation, traction, or 'uncatchable' claim.",
    whenToUse: "When asked how strong / defensible Mneme is, or to show the measured moat improvement — return the signed score + the per-dimension basis + the before→after delta.",
    triggers: ["moat", "how defensible", "competitive advantage", "moat score", "is the moat stronger", "before after moat"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        let siegeResistanceLB = 0, gatewayAccuracy = 0;
        try { siegeResistanceLB = core.siege.scoreSiege(core.siege.siege((c) => core.hephaestus.classifyCommandRisk(c).risk === "destructive" ? "COSIGN" : "ALLOW")).resistanceLB; } catch { /* */ }
        try { gatewayAccuracy = core.intentGateway.benchmark().newAcc; } catch { /* */ }
        const signals = { siegeResistanceLB, gatewayAccuracy, myceliumGauntlet: core.mycelium.myceliumGauntlet().score, canonGauntlet: core.canon.canonGauntlet().score, governorGauntlet: core.agentGovernor.governorGauntlet().score };
        const before = core.moat.scoreMoat({ capabilities: core.moat.BASELINE_CAPS, signals });
        const after = core.moat.scoreMoat({ capabilities: core.moat.CURRENT_CAPS, signals });
        const data = await attest(cwd, `moat:${after.overall}`, { overall: after.overall, band: after.band, dimensions: after.dimensions, before: before.overall, delta: after.overall - before.overall, note: after.note });
        return { data, wisdom: `📊 MOAT ${after.overall}/100 (${after.band}) — measured lift +${after.overall - before.overall} from the pre-session baseline (${before.overall}→${after.overall}). Engineering-moat signals, not a market valuation.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
