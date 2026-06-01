/**
 * v2.137.0 — STELE MCP surface (the signed, delta-syncable capability inscription).
 * mneme.stele.sync — an agent passes the merkle root it holds; gets back either
 * "up to date" (0 tokens) or ONLY the added/changed/removed capabilities + the
 * new signed root. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function entries(core: typeof import("@mneme-ai/core")): import("@mneme-ai/core").stele.SteleEntry[] {
  try { return (core.agentManifest.MNEME_COMMAND_CATALOG as Array<{ command: string; since?: string; what?: string }>).map((c) => ({ name: c.command, version: c.since, summary: c.what })); } catch { return []; }
}

export const STELE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.stele.sync",
    category: "meta",
    description: "🗿 STELE — the signed, merkle-rooted, delta-syncable inscription of Mneme's WHOLE capability surface. Pass the merkle `root` you currently hold (and optionally the `leaves` name→hash map you cached); you get back either upToDate=true (0 tokens — your roots match, you provably hold the complete latest set) or ONLY the added/changed/removed capabilities + the new signed root. So 'I didn't know that tool existed' becomes structurally impossible AND cheap: O(delta) tokens, not O(900 tools), with a tamper-evident proof you hold the current surface. Self-attesting. HONEST: the win is the delta-sync + merkle freshness/completeness proof (novel for an agent-capability manifest); 'can't NOT know' holds only because you CALL this on boot — it pairs with the activation membrane.",
    whenToUse: "On session start / boot — pass the merkle root you cached last time (or omit for the full root). If upToDate, you're done (0 tokens). If not, fold ONLY the returned added/changed entries into your context and cache the new root. Re-sync whenever you suspect Mneme upgraded. The cheap, provable way to always know Mneme's full current surface.",
    triggers: ["stele", "capability sync", "what tools does mneme have now", "did mneme update", "capability genome", "manifest delta", "am i current"],
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "the merkle root your agent currently holds (omit to just get the current root)." },
        leaves: { type: "object", description: "optional name→leafHash map you cached, for precise delta + tamper-detection." },
      },
    },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const cat = entries(core);
        const root = typeof args["root"] === "string" ? args["root"] as string : "";
        const leaves = args["leaves"] && typeof args["leaves"] === "object" ? args["leaves"] as Record<string, string> : undefined;
        if (!root && !leaves) {
          const s = core.stele.buildStele(cat);
          const data = await attest(cwd, "stele.root", { root: s.root, count: s.count });
          return { data, wisdom: `🗿 STELE root for ${s.count} capabilities — cache this root; next boot pass it back to get only the delta.`, followUp: [], confidence: { level: "high" as const } };
        }
        const d = core.stele.steleDelta(cat, root, leaves);
        const data = await attest(cwd, "stele.delta", {
          currentRoot: d.currentRoot, upToDate: d.upToDate,
          added: d.added.map((e) => ({ name: e.name, summary: e.summary })),
          changed: d.changed.map((e) => ({ name: e.name, summary: e.summary })),
          removed: d.removed, deltaTokenEstimate: d.deltaTokenEstimate, fullTokenEstimate: d.fullTokenEstimate, note: d.note,
        });
        return {
          data,
          wisdom: d.upToDate
            ? `✓ up to date — you hold the latest complete surface (merkle roots match), 0 tokens.`
            : `🔄 ${d.added.length} new + ${d.changed.length} changed + ${d.removed.length} removed (~${d.deltaTokenEstimate} tok vs ~${d.fullTokenEstimate} full). Fold ONLY these in + cache the new root: ${d.currentRoot.slice(0, 12)}…`,
          followUp: [], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
