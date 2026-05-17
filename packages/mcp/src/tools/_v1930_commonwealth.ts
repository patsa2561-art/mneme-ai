/**
 * v2.19.30 MNEME COMMONWEALTH pillars 1+2 — 8 MCP tools
 *
 *   ⚱ SOUL EMBALMING (5):
 *     mneme.soul.empty_crypt
 *     mneme.soul.embalm
 *     mneme.soul.restore_latest
 *     mneme.soul.restore_at
 *     mneme.soul.crypt_stats
 *
 *   ⚖ HIVE COURT (3):
 *     mneme.court.adjudicate
 *     mneme.court.verify_writ
 *     mneme.court.should_defer
 */

import type { MnemeTool } from "./_types.js";

// ─── SOUL EMBALMING ─────────────────────────────────────────────────

export const soulEmptyCryptTool: MnemeTool = {
  name: "mneme.soul.empty_crypt",
  category: "audit",
  description: "⚱ COMMONWEALTH — emit fresh empty SoulCrypt for a given agentId + optional ringBufferSize (default ~30 days at 5min cadence).",
  whenToUse: "First-time agent registration; or after a vendor ban-recovery if caller wants a clean slate.",
  triggers: ["soul empty crypt", "new soul crypt"],
  inputSchema: { type: "object", properties: { agentId: { type: "string" }, ringBufferSize: { type: "number" } }, required: ["agentId"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Start a soul crypt for agent-claude-1", args: { agentId: "agent-claude-1" }, expectedOutput: "{ v, agentId, records: [], ringBufferSize }" }],
  pitfalls: ["Caller persists the crypt JSON; daemon writes per 5-min embalm cycle."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.soulEmbalming.emptyCrypt(String(args["agentId"]), args["ringBufferSize"] as number | undefined);
    return { data: c, wisdom: `⚱ crypt for ${c.agentId} ready (capacity ${c.ringBufferSize})`, confidence: { level: "high" } };
  },
};

export const soulEmbalmTool: MnemeTool = {
  name: "mneme.soul.embalm",
  category: "audit",
  description: "⚱ COMMONWEALTH — append a fresh agent soul to its crypt; HMAC-chained to predecessor; ring buffer evicts oldest. Defensive: mismatched/empty agentId silently rejected.",
  whenToUse: "Daemon 5-min interval: capture agent's evolving state (goal/decisions/mental model/biases/tool calls).",
  triggers: ["soul embalm"],
  inputSchema: {
    type: "object",
    properties: {
      crypt: { type: "object" },
      soul: { type: "object" },
    },
    required: ["crypt", "soul"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Snapshot agent's current state", args: { crypt: {}, soul: {} }, expectedOutput: "{ v, records: [...], ringBufferSize }" }],
  pitfalls: ["decisionHistory + lastToolCalls auto-capped to defaults to prevent unbounded growth."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.soulEmbalming.embalmSoul({
      crypt: args["crypt"] as Parameters<typeof core.soulEmbalming.embalmSoul>[0]["crypt"],
      soul: args["soul"] as Parameters<typeof core.soulEmbalming.embalmSoul>[0]["soul"],
    });
    return { data: c, wisdom: `⚱ embalmed (total ${c.records.length})`, confidence: { level: "high" } };
  },
};

export const soulRestoreLatestTool: MnemeTool = {
  name: "mneme.soul.restore_latest",
  category: "audit",
  description: "⚱ COMMONWEALTH — restore the most recent embalmed soul; null on empty crypt or tampered chain (fail-safe). The ban-recovery hot path.",
  whenToUse: "Daemon detects HTTP 403/401 from vendor → spawn replacement → inject restored soul.",
  triggers: ["soul restore latest"],
  inputSchema: { type: "object", properties: { crypt: { type: "object" } }, required: ["crypt"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Recover agent state after ban", args: { crypt: {} }, expectedOutput: "AgentSoul | null" }],
  pitfalls: ["Tampered crypt returns null — never inject untrusted soul."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.soulEmbalming.restoreLatestSoul({ crypt: args["crypt"] as Parameters<typeof core.soulEmbalming.restoreLatestSoul>[0]["crypt"] });
    return { data: { soul: s }, wisdom: s ? `⚱ restored soul (goal=${s.currentGoal.slice(0, 40)})` : "💀 no soul to restore", confidence: { level: "high" } };
  },
};

export const soulRestoreAtTool: MnemeTool = {
  name: "mneme.soul.restore_at",
  category: "audit",
  description: "⚱ COMMONWEALTH — restore a specific embalmed soul by index (negative = from newest; -1 = latest, 0 = oldest).",
  whenToUse: "Forensic replay of past agent state; debugging mid-loop divergence.",
  triggers: ["soul restore at"],
  inputSchema: { type: "object", properties: { crypt: { type: "object" }, index: { type: "number" } }, required: ["crypt", "index"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Restore soul from 3 snapshots ago", args: { crypt: {}, index: -3 }, expectedOutput: "AgentSoul | null" }],
  pitfalls: ["Out-of-range index → null (defensive)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.soulEmbalming.restoreSoulAt({
      crypt: args["crypt"] as Parameters<typeof core.soulEmbalming.restoreSoulAt>[0]["crypt"],
      index: Number(args["index"]),
    });
    return { data: { soul: s }, wisdom: s ? `⚱ restored @${args["index"]}` : "· out of range or tampered", confidence: { level: "high" } };
  },
};

export const soulCryptStatsTool: MnemeTool = {
  name: "mneme.soul.crypt_stats",
  category: "audit",
  description: "⚱ COMMONWEALTH — totals + capacity used + span across all embalmed records.",
  whenToUse: "Pulse digest; weekly soul-crypt audit.",
  triggers: ["soul crypt stats"],
  inputSchema: { type: "object", properties: { crypt: { type: "object" } }, required: ["crypt"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How much have I embalmed?", args: { crypt: {} }, expectedOutput: "{ totalRecords, capacityUsed, oldestEmbalmedAtMs, spanMs }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.soulEmbalming.computeCryptStats(args["crypt"] as Parameters<typeof core.soulEmbalming.computeCryptStats>[0]);
    return { data: s, wisdom: core.soulEmbalming.formatCryptLine(s), confidence: { level: "high" } };
  },
};

// ─── HIVE COURT ─────────────────────────────────────────────────────

export const courtAdjudicateTool: MnemeTool = {
  name: "mneme.court.adjudicate",
  category: "audit",
  description: "⚖ COMMONWEALTH — adjudicate a dispute among 0-N agents; composite scoring (ARENA 35% + CONFESSIONAL 25% + TRINITY 25% + TRUTH 15%); REJECTED truth zeros out finalScore. Emits HMAC-signed WRIT.",
  whenToUse: "2+ AI agents disagree mid-loop; user wants neutral verdict instead of arbitrary tiebreaker.",
  triggers: ["court adjudicate", "writ"],
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
      claims: { type: "array", items: { type: "object" } },
      closeCallMargin: { type: "number" },
      disputedMargin: { type: "number" },
    },
    required: ["topic", "claims"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Codex says refactor A, Claude says refactor B. Who wins?",
    args: { topic: "refactor auth.ts", claims: [{ agentId: "codex", vendor: "openai", claim: "A", factCoverageScore: 0.8, peerAuditScore: 0.7, trinityVoteShare: 0.6, truthForensicVerdict: "ACCEPTED" }] },
    expectedOutput: "{ tier, winnerAgentId, winningClaim, composites, margin, caveats, sig }",
  }],
  pitfalls: ["0 claims → INSUFFICIENT_PARTIES (defensive); 1 claim → winner by default."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const w = core.hiveCourt.adjudicate({
      topic: String(args["topic"]),
      claims: args["claims"] as Parameters<typeof core.hiveCourt.adjudicate>[0]["claims"],
      closeCallMargin: args["closeCallMargin"] as number | undefined,
      disputedMargin: args["disputedMargin"] as number | undefined,
    });
    return { data: w, wisdom: core.hiveCourt.formatWritLine(w), confidence: { level: "high" } };
  },
};

export const courtVerifyWritTool: MnemeTool = {
  name: "mneme.court.verify_writ",
  category: "audit",
  description: "⚖ COMMONWEALTH — verify a WRIT's HMAC signature before respecting it. Fail-safe: tampered writs rejected.",
  whenToUse: "Cross-instance WRIT consumption; before binding agents to a foreign verdict.",
  triggers: ["court verify writ"],
  inputSchema: { type: "object", properties: { writ: { type: "object" } }, required: ["writ"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this WRIT", args: { writ: {} }, expectedOutput: "{ ok: true | false }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ok = core.hiveCourt.verifyWrit(args["writ"] as Parameters<typeof core.hiveCourt.verifyWrit>[0]);
    return { data: { ok }, wisdom: ok ? "⚖ verified" : "💀 tampered", confidence: { level: "high" } };
  },
};

export const courtShouldDeferTool: MnemeTool = {
  name: "mneme.court.should_defer",
  category: "audit",
  description: "⚖ COMMONWEALTH — agent contract: should this agent defer to the WRIT now? Respects CLEAR / CLOSE_CALL / SINGLE_PARTY; PAUSES on DISPUTED + tampered.",
  whenToUse: "Every agent before executing a contested decision: 'do I defer to the WRIT or proceed?'",
  triggers: ["court should defer"],
  inputSchema: { type: "object", properties: { writ: { type: "object" } }, required: ["writ"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should I defer to this WRIT?", args: { writ: {} }, expectedOutput: "{ defer: true | false }" }],
  pitfalls: ["DISPUTED tier → defer=false → caller must surface to user."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const defer = core.hiveCourt.shouldDeferToWrit(args["writ"] as Parameters<typeof core.hiveCourt.shouldDeferToWrit>[0]);
    return { data: { defer }, wisdom: defer ? "⚖ defer to WRIT" : "⚠ user attention required", confidence: { level: "high" } };
  },
};

export const courtStatsTool: MnemeTool = {
  name: "mneme.court.stats",
  category: "audit",
  description: "⚖ COMMONWEALTH — extract one-line stats from a WRIT (tier + claims + margin + user-attention flag).",
  whenToUse: "Pulse digest: 'how was the last court session?'",
  triggers: ["court stats"],
  inputSchema: { type: "object", properties: { writ: { type: "object" } }, required: ["writ"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Summarise this WRIT", args: { writ: {} }, expectedOutput: "{ totalClaims, topComposite, margin, tier, userAttentionRequired }" }],
  pitfalls: ["Empty WRIT (INSUFFICIENT_PARTIES) returns zeros."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.hiveCourt.computeStats(args["writ"] as Parameters<typeof core.hiveCourt.computeStats>[0]);
    return { data: s, wisdom: `⚖ tier=${s.tier} · margin=${s.margin.toFixed(3)} · attention=${s.userAttentionRequired}`, confidence: { level: "high" } };
  },
};

export const V1930_COMMONWEALTH_TOOLS: MnemeTool[] = [
  soulEmptyCryptTool, soulEmbalmTool, soulRestoreLatestTool, soulRestoreAtTool, soulCryptStatsTool,
  courtAdjudicateTool, courtVerifyWritTool, courtShouldDeferTool, courtStatsTool,
];
