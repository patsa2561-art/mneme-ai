/**
 * v2.64.0 — DIFFERENTIAL ARENA MCP tool surface.
 *
 *   mneme.diff_arena.ask    — parallel-call N vendors, return diff + consensus
 *   mneme.diff_arena.audit  — verify HMAC-chained rounds ledger
 *
 * Wraps core/src/diff_arena/. NOTE: MCP shape uses mock vendors by
 * default (matches CLI). For real http/cli adapters, callers wire the
 * SDK programmatically (vendor API keys live outside MCP for safety).
 */

import type { MnemeTool } from "./_types.js";

export const diffArenaAskTool: MnemeTool = {
  name: "mneme.diff_arena.ask",
  category: "meta",
  description:
    "🎭 DIFF-ARENA — parallel-call N vendors on the same prompt, return per-vendor responses + 4-axis consensus (Jaccard / numeric / sentiment / length) + outlier diagnosis + common facts + composed suggested answer. Default: 3 mock vendors (offline-safe). For real Claude/GPT/Gemini, wire http/cli adapters via the SDK with vendor API keys (mineral keys never leave the host).",
  whenToUse:
    "User asks a factual question where multi-vendor consensus matters: 'what is X' / 'how does Y work' / 'is Z true'. Calls Mneme arena → reads back consensus → composes informed answer surfacing common facts + flagging disputed/refuted claims.",
  triggers: ["ask multiple vendors", "diff arena", "consensus", "what do other AIs say"],
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
      vendors: {
        type: "array",
        items: { type: "string" },
        description: "Vendor specs like 'claude:mock', 'gpt:mock'. Default = ['claude:mock', 'gpt:mock', 'gemini:mock'].",
      },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const specs = (Array.isArray(args["vendors"]) ? args["vendors"] as string[] : ["claude:mock", "gpt:mock", "gemini:mock"]);
      const vendors = specs.map((spec) => {
        const [name, kind] = spec.split(":");
        if (kind === "mock") return core.diffArena.mockAdapter({ name: name ?? "unknown" });
        throw new Error(`MCP only supports mock vendors; got '${kind}'.`);
      });
      const r = await core.diffArena.diffArenaAsk({
        prompt: String(args["prompt"] ?? ""),
        vendors,
        cwd,
      });
      return {
        data: r,
        wisdom: r.suggestedAnswer,
        followUp: r.consensus.agreement === "low" ? ["mneme.verify"] : [],
        confidence: { level: r.consensus.agreement === "high" ? "high" as const : r.consensus.agreement === "medium" ? "medium" as const : "low" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "diff_arena.ask failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const diffArenaAuditTool: MnemeTool = {
  name: "mneme.diff_arena.audit",
  category: "meta",
  description:
    "🎭 DIFF-ARENA — verify HMAC-chained rounds ledger + last N entries.",
  whenToUse: "Compliance audit; investigate multi-vendor disagreement history.",
  triggers: ["diff_arena audit", "arena audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.diffArena.verifyLedgerChain(cwd);
      const rows = core.diffArena.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return {
        data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) },
        wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`,
        followUp: [],
        confidence: { level: led.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const DIFF_ARENA_TOOLS: MnemeTool[] = [
  diffArenaAskTool,
  diffArenaAuditTool,
];
