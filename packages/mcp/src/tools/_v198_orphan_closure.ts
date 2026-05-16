/**
 * v2.19.8 ORPHAN CLOSURE — MCP wrappers for the 5 remaining v2.18+ core
 * exports that the AUTO-GENESIS scanner flagged as missing wrappers.
 * Closing these brings v2.18+ orphan count to ZERO; ritual gate
 * phase3.no-orphan-core-exports flips green permanently.
 *
 *   mneme.agreement.extract_decisions
 *   mneme.embedder.decide_promote
 *   mneme.jackpot.publish
 *   mneme.jackpot.leaderboard
 *   mneme.jackpot.render_card
 */

import type { MnemeTool } from "./_types.js";

export const agreementExtractDecisionsTool: MnemeTool = {
  name: "mneme.agreement.extract_decisions",
  category: "lab",
  description:
    "📜 AGREEMENT — extract just the decisions from a transcript without compiling a full agreement. Returns Decision[] with pattern + confidence. Use for preview / debugging.",
  whenToUse: "When you want to see what decisions Mneme would extract before committing to a full compile.",
  triggers: ["agreement extract", "preview decisions"],
  inputSchema: { type: "object", properties: { transcript: { type: "string" } }, required: ["transcript"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What decisions would you extract from this chat?", args: { transcript: "..." }, expectedOutput: "{ decisions: [{ text, pattern, confidence, ... }] }" }],
  pitfalls: ["This is decision extraction only — no compile, no signature, no checker. Use mneme.agreement.compile for the full pipeline."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const decisions = core.conversationCompiler.extractDecisions({ transcript: String(args["transcript"]) });
    return { data: { decisions }, wisdom: `📜 extracted ${decisions.length} decision(s)`, confidence: { level: "high" } };
  },
};

export const embedderDecidePromoteTool: MnemeTool = {
  name: "mneme.embedder.decide_promote",
  category: "lab",
  description:
    "🎚 EMBEDDER — pure-decision variant of mneme.embedder.auto_promote. Takes the current provider + a fresh doctor verdict → returns the signed decision without invoking any side effects.",
  whenToUse: "When the daemon wants to score the upgrade idea before persisting config.",
  triggers: ["embedder decide", "should I promote embedder"],
  inputSchema: {
    type: "object",
    properties: {
      current: { type: "string", enum: ["auto", "ollama", "openai", "bundled", "hash"] },
      doctor: { type: "object" },
    },
    required: ["current", "doctor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should we upgrade hash → ollama?", args: { current: "hash", doctor: { pick: "ollama", reason: "reachable", qualityStars: 4, reachable: true } }, expectedOutput: "{ shouldPromote, from, to, qualityGain, sig }" }],
  pitfalls: ["This is a pure decision — caller must actually write the new config to disk if shouldPromote=true."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.embedderAutoPromote.decidePromote({
      current: args["current"] as Parameters<typeof core.embedderAutoPromote.decidePromote>[0]["current"],
      doctor: args["doctor"] as Parameters<typeof core.embedderAutoPromote.decidePromote>[0]["doctor"],
    });
    return { data: d, wisdom: core.embedderAutoPromote.formatPromoteLine(d), confidence: { level: d.shouldPromote ? "high" : "medium" } };
  },
};

export const jackpotPublishTool: MnemeTool = {
  name: "mneme.jackpot.publish",
  category: "lab",
  description:
    "🎰 JACKPOT — opt-in publish today's jackpot headline to the community leaderboard at cosmic.mneme-ai.space. Privacy-safe (whitelist payload — only day/headline/kind/confidence/valueClass/sig; never body/action).",
  whenToUse: "After mneme.jackpot.draw, when user wants to share their daily insight + see the community board.",
  triggers: ["jackpot publish", "share jackpot", "publish my insight"],
  inputSchema: {
    type: "object",
    properties: {
      jackpot: { type: "object", description: "Full Jackpot object from mneme.jackpot.draw." },
      endpoint: { type: "string", description: "Optional override; defaults to cosmic.mneme-ai.space." },
    },
    required: ["jackpot"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Publish today's jackpot to the community board", args: { jackpot: {} }, expectedOutput: "{ ok, day, position? }" }],
  pitfalls: ["Rate-limited 5/min/fingerprint on the cosmic server; honour the 429 if you hit it."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.jackpot.publishJackpot(args as unknown as Parameters<typeof core.jackpot.publishJackpot>[0]);
    return { data: r, wisdom: r.ok ? "🎰 JACKPOT published" : `🎰 JACKPOT publish failed: ${r.error ?? "(unknown)"}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const jackpotLeaderboardTool: MnemeTool = {
  name: "mneme.jackpot.leaderboard",
  category: "lab",
  description:
    "🎰 JACKPOT — fetch today's top community jackpots from cosmic.mneme-ai.space (top 50 by confidence). Opt-in only — only headlines published by users appear.",
  whenToUse: "Morning ritual; see what other Mneme users got as their jackpot today.",
  triggers: ["jackpot leaderboard", "community jackpots", "today's top insights"],
  inputSchema: {
    type: "object",
    properties: {
      endpoint: { type: "string", description: "Optional override; defaults to cosmic.mneme-ai.space." },
      day: { type: "string", description: "YYYY-MM-DD; defaults to today UTC." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me today's top jackpots from other users", args: {}, expectedOutput: "{ day, count, top: [...] }" }],
  pitfalls: ["Cosmic endpoint may be down; tool returns { ok: false, reason } on network failure."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.jackpot.readJackpotLeaderboard(args as unknown as Parameters<typeof core.jackpot.readJackpotLeaderboard>[0]);
    return { data: r, wisdom: r.ok ? `🎰 ${r.count} community jackpot(s) today` : `🎰 leaderboard fetch failed: ${r.error ?? "(unknown)"}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const jackpotRenderCardTool: MnemeTool = {
  name: "mneme.jackpot.render_jackpot_card",
  category: "lab",
  description:
    "🎰 JACKPOT — render the daily insight as a shareable text card (multi-line, emoji-decorated). Use for chat output, Slack post, README badge, etc.",
  whenToUse: "After mneme.jackpot.draw; when you want a pre-formatted display string.",
  triggers: ["jackpot card", "render insight"],
  inputSchema: {
    type: "object",
    properties: { jackpot: { type: "object" } },
    required: ["jackpot"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Render today's jackpot as a card", args: { jackpot: {} }, expectedOutput: "{ card: '...' }" }],
  pitfalls: ["Card is plain text optimised for terminal/markdown; render via formatJackpotLine if you only want the one-line summary."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = core.jackpot.renderJackpotCard(args["jackpot"] as Parameters<typeof core.jackpot.renderJackpotCard>[0]);
    return { data: { card }, wisdom: "🎰 JACKPOT card rendered", confidence: { level: "high" } };
  },
};

export const V198_ORPHAN_CLOSURE_TOOLS: MnemeTool[] = [
  agreementExtractDecisionsTool,
  embedderDecidePromoteTool,
  jackpotPublishTool,
  jackpotLeaderboardTool,
  jackpotRenderCardTool,
];
