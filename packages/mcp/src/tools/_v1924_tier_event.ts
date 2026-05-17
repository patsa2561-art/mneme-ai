/**
 * v2.19.24 — TOOL TIER (extends PROPRIOCEPTION) + EVENT PATTERN MATCH (extends SPINAL)
 *
 *   🪞 TIER (3 tools):
 *     mneme.tier.classify       — single tool name -> tier (starter/explorer/deep/experimental)
 *     mneme.tier.list_by_tier   — filter the catalog by tier
 *     mneme.tier.budget         — HMAC-signed budget across all tools
 *
 *   ⚡ EVENT (3 tools):
 *     mneme.event.match         — semantic event -> ranked tool predictions
 *     mneme.event.list_patterns — list 18+ BUILTIN_PATTERNS
 *     mneme.event.report        — HMAC-signed match report
 */

import type { MnemeTool } from "./_types.js";

// ─── TIER ───────────────────────────────────────────────────────────

export const tierClassifyTool: MnemeTool = {
  name: "mneme.tier.classify",
  category: "audit",
  description:
    "🪞 TIER (extends v2.19.23 PROPRIOCEPTION) — classify a single tool name into 4 tiers (starter/explorer/deep/experimental). Deterministic; STARTER beats EXPERIMENTAL beats EXPLORER beats DEEP fallback.",
  whenToUse: "Surface design: decide how to badge / filter a tool for end users.",
  triggers: ["tier classify", "tool tier"],
  inputSchema: { type: "object", properties: { toolName: { type: "string" } }, required: ["toolName"] },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What tier is mneme.arena.judge?",
    args: { toolName: "mneme.arena.judge" },
    expectedOutput: "{ tier: 'explorer', reason: \"family 'arena' in explorer set\" }",
  }],
  pitfalls: ["Tier is a HINT to humans, NOT a security boundary. AI agents can call any tier via MCP."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.toolTier.classifyTier(String(args["toolName"]));
    return { data: c, wisdom: `🪞 ${core.toolTier.TIER_BADGE[c.tier]} ${c.tier} · ${c.reason}`, confidence: { level: "high" } };
  },
};

export const tierListByTierTool: MnemeTool = {
  name: "mneme.tier.list_by_tier",
  category: "audit",
  description: "🪞 TIER — filter a tool-name list down to a single tier. Preserves input order.",
  whenToUse: "Build a curated catalog view (e.g., the `mneme tools --tier explorer` CLI surface).",
  triggers: ["tier filter", "list by tier"],
  inputSchema: {
    type: "object",
    properties: {
      toolNames: { type: "array", items: { type: "string" } },
      tier: { type: "string", enum: ["starter", "explorer", "deep", "experimental"] },
    },
    required: ["toolNames", "tier"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Filter to starter tools",
    args: { toolNames: ["mneme.status", "mneme.arena.judge"], tier: "starter" },
    expectedOutput: "{ tools: ['mneme.status'], count: 1 }",
  }],
  pitfalls: ["Unknown tier names produce empty result; not an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const tools = core.toolTier.listByTier({
      toolNames: args["toolNames"] as string[],
      tier: args["tier"] as Parameters<typeof core.toolTier.listByTier>[0]["tier"],
    });
    return { data: { tools, count: tools.length }, wisdom: `🪞 ${tools.length} tools in tier=${args["tier"]}`, confidence: { level: "high" } };
  },
};

export const tierBudgetTool: MnemeTool = {
  name: "mneme.tier.budget",
  category: "audit",
  description: "🪞 TIER — HMAC-signed budget across all tool names (counts per tier). Use to audit catalog shape over time.",
  whenToUse: "Post-upgrade audit: did the tier distribution shift unexpectedly?",
  triggers: ["tier budget", "tier stats"],
  inputSchema: { type: "object", properties: { toolNames: { type: "array", items: { type: "string" } } }, required: ["toolNames"] },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Show tier budget across the full catalog",
    args: { toolNames: ["mneme.status", "mneme.arena.judge", "mneme.alien.x"] },
    expectedOutput: "{ totalTools, starter, explorer, deep, experimental, sig }",
  }],
  pitfalls: ["Sum of tiers == totalTools always (each tool lands in exactly one tier)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.toolTier.computeTierBudget({ toolNames: args["toolNames"] as string[] });
    return { data: b, wisdom: core.toolTier.formatBudgetLine(b), confidence: { level: "high" } };
  },
};

// ─── EVENT PATTERN MATCH ─────────────────────────────────────────────

export const eventMatchTool: MnemeTool = {
  name: "mneme.event.match",
  category: "audit",
  description:
    "⚡ EVENT (extends v2.19.23 SPINAL REFLEX) — match a semantic event (commit msg / file path / clipboard text / shell cmd / user chat) against 18+ BUILTIN_PATTERNS. Returns ranked tool predictions with confidence + matched pattern ids.",
  whenToUse: "Daemon hook fires when an event source detects activity; pre-execute these tools.",
  triggers: ["event match", "semantic prediction"],
  inputSchema: {
    type: "object",
    properties: {
      event: { type: "object", description: "{ kind, text, context?, ts }" },
      topN: { type: "number", description: "Default 5" },
    },
    required: ["event"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What tools should fire on 'fix: token leak in auth.ts' commit?",
    args: { event: { v: 1, kind: "git_commit", text: "fix: token leak in auth.ts", ts: 1 } },
    expectedOutput: "{ predictions: [{ toolName: 'mneme.forensics.vulns', confidence: 0.85, matchedPatterns: [...] }, ...] }",
  }],
  pitfalls: ["Regex-based, not NLP. Caller can ignore predictions with confidence < 0.5."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const predictions = core.eventPatternMatch.matchEventPatterns({
      event: args["event"] as Parameters<typeof core.eventPatternMatch.matchEventPatterns>[0]["event"],
      topN: args["topN"] as number | undefined,
    });
    return { data: { predictions, count: predictions.length }, wisdom: `⚡ ${predictions.length} pattern hits`, confidence: { level: "high" } };
  },
};

export const eventListPatternsTool: MnemeTool = {
  name: "mneme.event.list_patterns",
  category: "audit",
  description: "⚡ EVENT — list 18+ BUILTIN_PATTERNS that ship as semantic rules.",
  whenToUse: "Audit / debug: see exactly what regexes drive the pre-execution layer.",
  triggers: ["event list patterns", "semantic patterns"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show built-in event patterns", expectedOutput: "{ patterns: SemanticPattern[], count: 18+ }" }],
  pitfalls: ["Patterns are PRIORS only; observation history (v2.19.22 REFLEX) overrides when posterior is rich."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const patterns = core.eventPatternMatch.listBuiltinPatterns();
    return {
      data: { patterns: patterns.map((p) => ({ id: p.id, eventKinds: p.eventKinds, regex: String(p.regex), tools: p.tools, reason: p.reason })), count: patterns.length },
      wisdom: `⚡ ${patterns.length} builtin patterns`,
      confidence: { level: "high" },
    };
  },
};

export const eventReportTool: MnemeTool = {
  name: "mneme.event.report",
  category: "audit",
  description: "⚡ EVENT — HMAC-signed report combining predictions + matched patterns + total considered. Use for daemon-side audit + replay.",
  whenToUse: "When the daemon needs a tamper-evident record of WHAT predictions fired for an event.",
  triggers: ["event report"],
  inputSchema: {
    type: "object",
    properties: {
      event: { type: "object" },
      topN: { type: "number" },
    },
    required: ["event"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Get a signed report for this commit event",
    args: { event: { v: 1, kind: "git_commit", text: "fix: bug", ts: 1 } },
    expectedOutput: "{ predictions, patternsConsidered, patternsMatched, sig }",
  }],
  pitfalls: ["Signature covers the event body too — tampering with event after signing breaks verify."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.eventPatternMatch.reportMatch({
      event: args["event"] as Parameters<typeof core.eventPatternMatch.reportMatch>[0]["event"],
      topN: args["topN"] as number | undefined,
    });
    return { data: r, wisdom: `⚡ ${r.predictions.length} preds · ${r.patternsMatched}/${r.patternsConsidered} patterns matched`, confidence: { level: "high" } };
  },
};

export const V1924_TIER_EVENT_TOOLS: MnemeTool[] = [
  tierClassifyTool, tierListByTierTool, tierBudgetTool,
  eventMatchTool, eventListPatternsTool, eventReportTool,
];
