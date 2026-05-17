/**
 * v2.19.33 POLISH + DISCOVERABILITY — MCP tools (B2/B3 user-audit fixes)
 *
 *   B2 — TRUTH SENSOR PACK (zero-config first-run):
 *     mneme.truth.init          — recommend default sensor stack for a claim
 *
 *   B3 — DISCOVERABILITY:
 *     mneme.browse              — paginated tier-aware catalog browse
 *     mneme.suggest             — repo-aware tool recommendations
 *
 *   B4 — SCHEDULER ADAPTS TO ACTIVE-DEV (extension to existing mneme.scheduler.*):
 *     decideTicks now honours hasBranchSwitch / hasCommitCycle /
 *     msSinceLastCommit / forceOrgans (no new MCP tool — extends behaviour).
 */

import type { MnemeTool } from "./_types.js";

// ─── B2 — TRUTH SENSOR PACK ────────────────────────────────────────────

export const truthInitTool: MnemeTool = {
  name: "mneme.truth.init",
  category: "audit",
  description: "🛡 TRUTH SENSOR PACK (v2.19.33 B2 fix) — returns the recommended zero-config default sensor stack for a claim. Use INSTEAD OF picking sensors yourself; pass results into mneme.truth.check_multi.",
  whenToUse: "First-run + any time you don't have a specific reason to pick sensors. The recipe shape-classifies the claim (file/symbol/version/tool/conceptual/narrative) and picks 3-5 high-signal sensors.",
  triggers: ["truth init", "default sensors", "what sensors to use", "zero config truth"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      full: { type: "boolean", description: "Force return the full default stack regardless of claim shape." },
    },
    required: ["claim"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What sensors should I run for 'mneme.handoff.snapshot exists'?",
    args: { claim: "mneme.handoff.snapshot exists" },
    expectedOutput: "{ plan: { shape: 'tool_capability', recommendedSensors: [...] }, instructions }",
  }],
  pitfalls: ["The recipe is METADATA, not executable — caller invokes each sensor's mcpTool with the claim and passes results to mneme.truth.check_multi."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const plan = core.truthSensorPack.proposeSensorPlan({
      claim: String(args["claim"] ?? ""),
      full: Boolean(args["full"]),
    });
    const instructions = core.truthSensorPack.explainDefaultStack(plan);
    return {
      data: { plan, instructions, recipe: plan.recommendedSensors },
      wisdom: plan.rationale,
      confidence: { level: plan.recommendedSensors.length > 0 ? "high" : "low" },
    };
  },
};

// ─── B3 — DISCOVERABILITY ─────────────────────────────────────────────

export const browseTool: MnemeTool = {
  name: "mneme.browse",
  category: "meta",
  description: "🔎 BROWSE (v2.19.33 B3 fix) — paginated catalog tour across 600+ Mneme tools. Filter by tier/family/query; sorted starter→explorer→deep→experimental. The 'where do I start' command for new users.",
  whenToUse: "First-run discoverability OR when looking for a tool whose exact name you don't remember. Pair with mneme.suggest for repo-aware recommendations.",
  triggers: ["browse tools", "list tools", "explore catalog", "what tools"],
  inputSchema: {
    type: "object",
    properties: {
      catalog: { type: "array", description: "Tool catalog snapshot (caller supplies; output of mneme tools --json)." },
      tier: { type: "string", enum: ["starter", "explorer", "deep", "experimental"] },
      family: { type: "string", description: "Family prefix (e.g., 'synapse')." },
      query: { type: "string", description: "Substring search across name/description/triggers." },
      limit: { type: "number", description: "Page size (default 30, max 200)." },
      offset: { type: "number", description: "Pagination offset (default 0)." },
    },
    required: ["catalog"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Show me starter tools",
    args: { catalog: [], tier: "starter" },
    expectedOutput: "{ totalMatches, entries: [...], pulseLine }",
  }],
  pitfalls: ["Caller MUST supply the live catalog — this tool is a pure ranker, not a reader. Pair with `mneme tools --json` upstream."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.toolBrowser.browseCatalog(args as unknown as Parameters<typeof core.toolBrowser.browseCatalog>[0]);
    return { data: r, wisdom: r.pulseLine, confidence: { level: "high" } };
  },
};

export const suggestTool: MnemeTool = {
  name: "mneme.suggest",
  category: "meta",
  description: "💡 SUGGEST (v2.19.33 B3 fix) — repo-aware tool recommendations. Scores tools by: intent match (substring + token overlap), starter-tier nudge, recency cooldown (recently-used tools demoted), and 5 repo signals (Node/Cargo/.git/CI/uncommitted-changes).",
  whenToUse: "After mneme.welcome (first-run), after a long-running session, or when the user says 'what should I try next?'. Deterministic — same inputs → same suggestions.",
  triggers: ["suggest tools", "what should I run", "recommend tools", "next action"],
  inputSchema: {
    type: "object",
    properties: {
      catalog: { type: "array" },
      recentActions: { type: "array", description: "Tail of .mneme/cli-activity.jsonl as [{action, ts}]." },
      repoSignals: { type: "object" },
      intent: { type: "string", description: "Optional natural-language intent ('audit my last commit')." },
      limit: { type: "number", description: "Top-N suggestions (default 5, max 20)." },
    },
    required: ["catalog"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What tools should I run?",
    args: { catalog: [], intent: "verify my last claim" },
    expectedOutput: "{ suggestions: [{ tool, score, reasons }], pulseLine }",
  }],
  pitfalls: ["Empty catalog returns empty suggestions — caller must wire `mneme tools --json` upstream."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.toolBrowser.suggestTools(args as unknown as Parameters<typeof core.toolBrowser.suggestTools>[0]);
    return { data: r, wisdom: r.pulseLine, confidence: { level: r.suggestions.length > 0 ? "high" : "low" } };
  },
};

export const V1933_POLISH_TOOLS: MnemeTool[] = [
  truthInitTool,
  browseTool,
  suggestTool,
];
