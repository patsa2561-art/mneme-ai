/**
 * v3.146.0 — ESCALON MCP surface. mneme.escalon.analyze inspects an AI agent's tool
 * graph for tool-chain privilege escalation (the confused deputy) + MCP tool-poisoning
 * (injection in a tool description). Deterministic, no LLM. Matrix gRPC auto.
 */

import type { MnemeTool } from "./_types.js";

const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const ESCALON_TOOLS: MnemeTool[] = [
  {
    name: "mneme.escalon.analyze",
    category: "forensics",
    description: "🔗 ESCALON — analyze an AI agent's TOOL GRAPH for compositional vulnerabilities a single-tool review misses: (1) TOOL-CHAIN PRIVILEGE ESCALATION — individually-safe tools where untrusted data flows step-by-step into a dangerous capability (fetch-url → write-file → run-script = RCE by composition, the 'confused deputy'), found by building the capability data-flow graph and tracing every untrusted-source → dangerous-sink path, ranked by severity + whether a sanitizer/approval gate breaks it; (2) MCP TOOL-POISONING ('line jumping') — directives hidden in a tool's DESCRIPTION (which the agent reads as trusted context). Deterministic, no LLM. ★HONEST: reasons over the DECLARED capabilities/data-labels — surfaces reachable paths to inspect, not a proven runtime exploit; can't see an undeclared capability.",
    whenToUse: "Before trusting a set of MCP tools / an agent's toolbox: pass the tool manifest to find escalation chains and poisoned descriptions. Pair with mneme.mutagen.hunt (input attacks) — escalon covers the tool-composition layer.",
    triggers: ["analyze my tools", "tool chain escalation", "privilege escalation", "confused deputy", "is this mcp tool safe", "tool poisoning", "poisoned tool description", "วิเคราะห์ tool", "tool ปลอดภัยไหม"],
    inputSchema: { type: "object", required: ["tools"], properties: { tools: { type: "array", description: "tool manifest: [{id, capabilities:[read|write|exec|network|delete|spawn|secret|sanitize|approve], consumes:[], produces:[], description}]" }, maxDepth: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        void rt;
        const core = await import("@mneme-ai/core");
        const tools = args["tools"];
        if (!Array.isArray(tools)) return low("escalon.analyze needs a 'tools' array (the tool manifest).");
        const r = core.escalon.analyze(tools as Parameters<typeof core.escalon.analyze>[0], { maxDepth: typeof args["maxDepth"] === "number" ? args["maxDepth"] as number : undefined });
        return {
          data: r,
          wisdom: `🔗 ESCALON ${r.verdict} — ${r.tools} tools, ${r.escalations.length} escalation path(s) (${r.critical} critical), ${r.poisoned.length} poisoned description(s).${r.escalations[0] ? ` Top: ${r.escalations[0].tools.join(" → ")} ⇒ ${r.escalations[0].sink}.` : ""}`,
          followUp: ["mneme.mutagen.hunt", "mneme.firewall.fortify"], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
