/**
 * v2.115.0 — TOKEN TREASURY MCP surface. An agent (or its host) can read the
 * MEASURED, SIGNED total of input-context tokens Mneme has saved — the
 * "Pay-per-Token-Saved" substrate, falsifiable not marketing. Auto-fed by
 * mneme.distill.brief (each reduction appends a saving event). Self-attesting.
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

export const TREASURY_LEDGER = ".mneme/treasury/ledger.jsonl";

/** Shared appender (also used by the distill MCP tool). Total. */
export function appendSaving(cwd: string, source: string, tokensBefore: number, tokensAfter: number): void {
  try {
    if (!Number.isFinite(tokensBefore) || !Number.isFinite(tokensAfter) || tokensBefore <= 0) return;
    const p = join(cwd, TREASURY_LEDGER);
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ source, tokensBefore: Math.round(tokensBefore), tokensAfter: Math.round(tokensAfter), at: Date.now() }) + "\n");
  } catch { /* accounting never blocks */ }
}

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `treasury:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "treasury.report" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const TREASURY_TOOLS: MnemeTool[] = [
  {
    name: "mneme.treasury.report",
    category: "memory",
    description: "💰 TOKEN TREASURY — read the MEASURED, signed total of input-context tokens Mneme has saved (distill / loopguard / nkl), optionally as USD at YOUR vendor's price. The 'Pay-per-Token-Saved' substrate: falsifiable, not marketing (append-only ledger + self-attesting). Token figures are a labeled ≈chars/4 estimate; USD uses the price-per-1k you pass.",
    whenToUse: "When the user (or a dashboard) asks how much Mneme has saved them, or to surface the running token/cost savings. Auto-fed by mneme.distill.brief.",
    triggers: ["how much saved", "token savings", "treasury", "cost saved", "savings report"],
    inputSchema: { type: "object", properties: { pricePer1kUSD: { type: "number", description: "your vendor's INPUT price per 1k tokens (e.g. 0.003) for a USD figure" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const p = join(cwd, TREASURY_LEDGER);
        const events = existsSync(p) ? core.treasury.parseLedger(readFileSync(p, "utf8")) : [];
        const price = typeof args["pricePer1kUSD"] === "number" ? (args["pricePer1kUSD"] as number) : undefined;
        const agg = core.treasury.aggregate(events as never, price !== undefined ? { pricePer1kUSD: price } : undefined);
        const data = await attest(cwd, { tokensSaved: agg.tokensSaved, savedPct: agg.savedPct, events: agg.events, bySource: agg.bySource, usdSaved: agg.usdSaved, totalBefore: agg.totalBefore, totalAfter: agg.totalAfter, note: agg.note });
        return { data, wisdom: `💰 ${agg.tokensSaved.toLocaleString()} input tokens saved across ${agg.events} events (−${agg.savedPct}%)${agg.usdSaved !== undefined ? ` ≈ $${agg.usdSaved}` : ""}.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
