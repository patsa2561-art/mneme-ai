/**
 * v2.140.0 — REGRET ORACLE MCP surface (💎3). mneme.regret.score — score an
 * edit's signals against the recorded calibration table (Wilson LB + UNKNOWN on
 * thin support). mneme.regret.record — record an outcome. Self-attesting.
 * HONEST: a backward-looking historical base rate, never a prediction.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MnemeTool } from "./_types.js";

const LEDGER = ".mneme/regret/outcomes.jsonl";
function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function loadModel(core: typeof import("@mneme-ai/core"), cwd: string): import("@mneme-ai/core").regret.RegretModel {
  const events: import("@mneme-ai/core").regret.RegretEvent[] = [];
  const p = join(cwd, LEDGER);
  if (existsSync(p)) for (const line of readFileSync(p, "utf8").split("\n")) { if (!line.trim()) continue; try { const j = JSON.parse(line); if (Array.isArray(j.features)) events.push({ features: j.features, regretted: j.regretted === true }); } catch { /* */ } }
  return core.regret.buildRegretModel(events);
}
function asList(v: unknown): string[] { return Array.isArray(v) ? (v as unknown[]).map(String) : typeof v === "string" ? (v as string).split(",").map((s) => s.trim()).filter(Boolean) : []; }

export const REGRET_TOOLS: MnemeTool[] = [
  {
    name: "mneme.regret.score",
    category: "forensics",
    description: "💎 REGRET ORACLE — score an edit's signals against the recorded calibration of how often similar edits were ACTUALLY regretted later (reverted / test failed). Pass `features` (e.g. [\"primitive:network\",\"area:auth\",\"vendor:grok\"]); get back band LOW/ELEVATED/HIGH/UNKNOWN + the Wilson 95% LOWER bound of the riskiest signal + its support. Self-attesting. HONEST: this is a BACKWARD-LOOKING historical base rate with a confidence interval — NOT a prediction of this specific edit and NOT a causal claim; it abstains to UNKNOWN when support is thin, and a thin signal scores LOW by construction (it can't be gamed into a scary number).",
    whenToUse: "BEFORE applying a risky edit, after PCE gives you its signals: ask the oracle how often edits with these signals were regretted here. HIGH = your own history says caution; UNKNOWN = not enough data, proceed on other judgment. Then `mneme.regret.record` the eventual outcome so the calibration improves.",
    triggers: ["regret", "regret oracle", "how often regretted", "is this edit risky historically", "revert rate for this", "calibration"],
    inputSchema: { type: "object", properties: { features: { type: "array", items: { type: "string" }, description: "the edit's signals (PCE primitives, area:*, vendor:*, breadth:*)" }, minSupport: { type: "number", description: "min samples before a signal counts (default 5)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const model = loadModel(core, cwd);
        const minSupport = typeof args["minSupport"] === "number" ? args["minSupport"] as number : undefined;
        const s = core.regret.scoreRegret(model, asList(args["features"]), minSupport !== undefined ? { minSupport } : undefined);
        const data = await attest(cwd, `regret.score:${s.band}`, { band: s.band, regretRateLowerBound: s.regretRateLowerBound, observedRate: s.observedRate, support: s.support, drivers: s.drivers, note: s.note });
        return { data, wisdom: `${s.band === "HIGH" ? "🛑" : s.band === "ELEVATED" ? "🟡" : s.band === "LOW" ? "🟢" : "❔"} REGRET ${s.band}${s.band !== "UNKNOWN" ? ` — ≥${(s.regretRateLowerBound * 100).toFixed(1)}% of similar edits were regretted (n=${s.support})` : " — not enough recorded outcomes"}. Historical base rate, not a prediction.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.regret.record",
    category: "forensics",
    description: "💎 REGRET ORACLE — record one real outcome into the signed calibration ledger: an edit's signals + whether it was `regretted` (reverted / test failed). The oracle gets more honest with every recorded outcome. Total: never throws.",
    whenToUse: "AFTER you learn an edit's fate — it got reverted, or its test failed (regretted:true), or it stuck (regretted:false). Tag it with the same signals you scored (PCE primitives, area:*, vendor:*) so the calibration sharpens.",
    triggers: ["regret record", "record an outcome", "this edit was reverted", "log regret"],
    inputSchema: { type: "object", required: ["features"], properties: { features: { type: "array", items: { type: "string" } }, regretted: { type: "boolean", description: "true if reverted / test failed" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const features = asList(args["features"]);
        if (!features.length) return low("no signals provided");
        const regretted = args["regretted"] === true;
        try { const p = join(cwd, LEDGER); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ features, regretted, at: Date.now() }) + "\n"); } catch { /* */ }
        const data = await attest(cwd, `regret.record:${regretted}`, { features, regretted });
        return { data, wisdom: `✓ recorded ${regretted ? "REGRETTED" : "stable"} outcome for: ${features.join(", ")}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
