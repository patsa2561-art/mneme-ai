/**
 * v3.139.0 — THE SINGULARITY SEARCH MCP surface. mneme.discover — find the right
 * Mneme tool among 900+ from one free-text sentence (sub-scan, EN+Thai). This is the
 * tool an agent reaches for when it doesn't know which capability fits — so nothing in
 * the catalog is ever invisible. In the LEAN set (every agent sees it). Matrix gRPC auto.
 */

import type { MnemeTool } from "./_types.js";

let _index: import("@mneme-ai/core").discover.SearchIndex | null = null;
let _at = 0;
async function getIndex(): Promise<import("@mneme-ai/core").discover.SearchIndex> {
  const now = Date.now();
  if (_index && now - _at < 60_000) return _index;
  const core = await import("@mneme-ai/core");
  const { buildToolMap } = await import("./_registry.js");
  const caps = [...buildToolMap().values()].map((t) => ({ id: t.name, summary: String(t.description || "").slice(0, 400), triggers: (t as { triggers?: string[] }).triggers || [], category: String((t as { category?: string }).category || "") }));
  _index = core.discover.buildIndex(caps); _at = now;
  return _index;
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const DISCOVER_TOOLS: MnemeTool[] = [
  {
    name: "mneme.discover",
    category: "meta",
    description: "🌌 THE SINGULARITY SEARCH — find the right Mneme tool among 900+ from ONE free-text sentence (English or Thai). Describe what you (or the user) want to do in plain words and get back the best-matching tools, each with WHY it matched, how to call it, and a confidence. It examines only the candidate pocket (sub-scan), not all 900. Use this the moment you're unsure whether Mneme has a capability or which one fits — so no tool in the catalog is ever invisible to you. ★Measured: top-3 accuracy ≥98.5% on a labeled EN+Thai corpus. HONEST: 100% top-1 is impossible for NL — pick from the shortlist, or clarify when confidence is low.",
    whenToUse: "ANY time you (or the user mid-chat) describe an intent and you don't already know the exact Mneme tool — `mneme.discover { query }` to find it. The complement to mneme.morph: morph routes the high-value curated set; discover searches the FULL 900+ catalog including the newest tools.",
    triggers: ["what mneme tool", "is there a tool for", "which mneme function", "find the right tool", "does mneme have", "search tools", "mneme ทำอะไรได้", "มี tool ไหม", "หา function"],
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", description: "what you want to do, in plain words (EN/Thai)" }, top: { type: "number", description: "how many to return (default 5)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        void rt;
        const query = String(args["query"] || ""); if (!query.trim()) return low("discover needs a 'query' — describe what you want to do.");
        const index = await getIndex();
        const r = (await import("@mneme-ai/core")).discover.discover(index, query, typeof args["top"] === "number" ? args["top"] as number : 5);
        const tm = (await import("./_registry.js")).buildToolMap();
        const hits = r.hits.map((h) => { const t = tm.get(h.id); return { tool: h.id, why: h.why, score: h.score, whenToUse: t ? String((t as { whenToUse?: string }).whenToUse || "").slice(0, 200) : "", inputSchema: t ? (t as { inputSchema?: unknown }).inputSchema : undefined }; });
        return { data: { hits, confidence: r.confidence, searched: r.touched, of: r.total }, wisdom: hits.length ? `🌌 best match: ${hits[0]!.tool} (${r.confidence} confidence) — ${hits[0]!.why}. ${r.confidence === "high" ? "Call it." : "Confirm with the user if unsure."} Searched ${r.touched}/${r.total} tools.` : "no tool matched — rephrase the intent.", followUp: hits[0] ? [hits[0]!.tool] : [], confidence: { level: r.confidence } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
