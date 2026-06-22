/**
 * v3.135.0 — PR ENGINE MCP surface. mneme.launch.kit — generate a launch kit where
 * every claim is VERICERT-screened first (overclaims/superlatives rejected, never
 * ship). Launch copy that can't lie. Matrix gRPC auto.
 */

import type { MnemeTool } from "./_types.js";
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const PR_ENGINE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.launch.kit",
    category: "insights",
    description: "📣 PR ENGINE — generate a launch/PR kit (Hacker News post · X thread · Reddit post · changelog) from candidate claims, where EVERY claim is VERICERT-screened first: an overclaiming / fabricated / unfalsifiable-superlative claim (e.g. 'world's best', '100% accurate', 'never wrong') is REJECTED and never makes it into the copy. The output re-certifies itself (zero-overclaim guarantee). Launch copy that can't lie — the same anti-hallucination bar applied to the marketing. HONEST: it screens KNOWN overclaim patterns + drops unfalsifiable superlatives, it does not make a true claim true.",
    whenToUse: "When writing a launch post, release announcement, changelog, or any public claim about a product — pass the candidate claims and get back defensible copy + the list of claims that were too strong (with reasons), so you never ship an overclaim.",
    triggers: ["write a launch post", "draft the announcement", "show hn post", "press release", "changelog from claims", "launch copy", "เขียนโพสต์เปิดตัว", "ร่างประกาศ"],
    inputSchema: { type: "object", required: ["product", "claims"], properties: { product: { type: "string" }, version: { type: "string" }, url: { type: "string" }, install: { type: "string" }, claims: { type: "array", items: { type: "string" }, description: "candidate claims — each is VERICERT-screened" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); void rt;
        const product = String(args["product"] || "");
        const claims = Array.isArray(args["claims"]) ? (args["claims"] as string[]).filter(Boolean) : [];
        if (!product || !claims.length) return low("launch.kit needs { product, claims[] }.");
        const kit = core.prEngine.buildLaunchKit({ product, version: args["version"] as string, url: args["url"] as string, install: args["install"] as string, claims });
        return { data: kit, wisdom: `📣 ${kit.approved.length} claims approved · ${kit.rejected.length} rejected${kit.rejected.length ? " (" + kit.rejected.map((r) => r.reason).join("; ") + ")" : ""} · ${kit.clean ? "zero-overclaim ✓" : "⚠ review"}. Defensible copy ready (HN/X/Reddit/changelog).`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
