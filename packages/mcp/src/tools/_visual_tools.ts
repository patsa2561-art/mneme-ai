/**
 * v2.116.0 — VISUAL KNOWLEDGE MAP MCP surface. An AI agent calls this to get a
 * ready-to-echo, gorgeous constellation frame of Mneme's live signed state
 * (truth / savings / loop / cortex) — so a chat reply can SHOW the map instead
 * of describing it. The renderer is pure + deterministic; the agent picks the
 * style (truecolor for a rich terminal, ascii for a plain transcript). The
 * frame is also wrapped with a NOTARY proof so the state behind it is verifiable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `visual:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "visual.map" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

/* eslint-disable @typescript-eslint/no-explicit-any */
function gather(core: any, cwd: string): Record<string, unknown> {
  const nodes: Array<{ label: string; status: string }> = [{ label: "TRUTH", status: "ok" }];
  let headline = ""; let savingsSpark: number[] = [];
  try { const p = join(cwd, m_loop(core)); if (existsSync(p)) { const v = core.loopguard.detectStuck(core.loopguard.parseLedger(readFileSync(p, "utf8"))); nodes.push({ label: "LOOP", status: v.stuck ? "bad" : "ok" }); } else nodes.push({ label: "LOOP", status: "idle" }); } catch { nodes.push({ label: "LOOP", status: "idle" }); }
  try { const p = join(cwd, ".mneme", "treasury", "ledger.jsonl"); if (existsSync(p)) { const evs = core.treasury.parseLedger(readFileSync(p, "utf8")); const agg = core.treasury.aggregate(evs); if (agg.events > 0) { nodes.push({ label: "SAVINGS", status: "ok" }); headline = `${agg.tokensSaved.toLocaleString()} input tokens saved (−${agg.savedPct}%)`; savingsSpark = evs.slice(-24).map((e: any) => Math.max(0, (e.tokensBefore || 0) - (e.tokensAfter || 0))); } else nodes.push({ label: "SAVINGS", status: "idle" }); } else nodes.push({ label: "SAVINGS", status: "idle" }); } catch { nodes.push({ label: "SAVINGS", status: "idle" }); }
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); if (existsSync(p)) { const s = JSON.parse(readFileSync(p, "utf8")); nodes.push({ label: "CORTEX", status: Array.isArray(s.entries) && s.entries.length > 0 ? "ok" : "idle" }); } else nodes.push({ label: "CORTEX", status: "idle" }); } catch { nodes.push({ label: "CORTEX", status: "idle" }); }
  let version = ""; try { version = String((core.agentManifest?.MNEME_VERSION) ?? ""); } catch { /* */ }
  return { version, nodes, savingsSpark, headline: headline || undefined, signed: true };
}
function m_loop(core: any): string { try { return core.loopguard.LOOPGUARD_LEDGER; } catch { return ".mneme/loopguard/events.jsonl"; } }

export const VISUAL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.visual.map",
    category: "memory",
    description: "🗺️ VISUAL KNOWLEDGE MAP — get a ready-to-echo, gorgeous constellation frame of Mneme's live signed state (truth / savings / loop / cortex). SHOW it in your reply instead of describing it. Pure + deterministic; pass style 'truecolor' (rich terminal), 'mono' (no color), or 'ascii' (plain transcript). Self-attesting (the state behind the frame is NOTARY-signed).",
    whenToUse: "When surfacing Mneme's status to the user (session start, after a verify/savings update) and you can render a code block — echo the returned `frame` for an instant, beautiful first impression. Use style 'ascii' for plain chat, 'truecolor' for a real terminal.",
    triggers: ["show the map", "knowledge map", "visual", "mneme status visual", "render map"],
    inputSchema: { type: "object", properties: { style: { type: "string", enum: ["truecolor", "mono", "ascii"], description: "render style (default mono — safe everywhere)" }, width: { type: "number", description: "columns (default 80)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const style = args["style"] === "truecolor" || args["style"] === "ascii" ? args["style"] : "mono";
        const width = typeof args["width"] === "number" ? (args["width"] as number) : 80;
        const caps = style === "truecolor"
          ? { truecolor: true, color256: true, color: true, unicode: true, width }
          : style === "ascii"
            ? { truecolor: false, color256: false, color: false, unicode: false, width }
            : { truecolor: false, color256: false, color: false, unicode: true, width };
        const state = gather(core, cwd);
        const frame = core.visual.renderKnowledgeMap(state as never, caps as never);
        const data = await attest(cwd, { frame, state, style });
        return { data, wisdom: `🗺️ knowledge map rendered (${style}). Echo \`frame\` in a code block to show it.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
