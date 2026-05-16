/**
 * v2.19.0 VENDOR-SYNCRETIC PENTAD — MCP tools (vendor-agnostic).
 *
 *   CONFESSIONAL     — mneme.confessional.*
 *   VENDOR GHOST     — mneme.ghost.*
 *   TRINITY VOTE     — mneme.trinity.*
 *   INSURANCE MARKET — mneme.insurance.*
 *   VENDOR BOOMERANG — mneme.boomerang.*
 */

import type { MnemeTool } from "./_types.js";

// ─── CONFESSIONAL ──────────────────────────────────────────────────────
export const confessionalAuditTool: MnemeTool = {
  name: "mneme.confessional.audit",
  category: "lab",
  description:
    "CONFESSIONAL 🛐 — vendor-agnostic pre-merge audit. Grade a PRIMARY vendor's response against a peer panel (Claude / GPT / Gemini / Grok / Cursor / any). Verdict approve / flag / block + signed receipt + per-fact peer-confirmed misses.",
  whenToUse: "BEFORE applying any AI-generated diff. Especially valuable for newer / higher-variance vendors.",
  triggers: ["confessional audit", "audit diff", "peer audit"],
  inputSchema: {
    type: "object",
    properties: {
      primary: { type: "object" },
      peers: { type: "array" },
      taskClass: { type: "string" },
      expectedFacts: { type: "array" },
      divergenceThreshold: { type: "number" },
      hardBlockBelow: { type: "number" },
    },
    required: ["primary", "peers", "taskClass", "expectedFacts"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Audit this Grok diff before I merge",
    args: { primary: { vendor: "grok", text: "..." }, peers: [], taskClass: "code_generation", expectedFacts: [] },
    expectedOutput: "{ verdict, primaryComposite, consensusComposite, divergence, reasons, headline, sig }",
  }],
  pitfalls: ["peers[] cannot be empty — pass at least one cached competitor response."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.confessional.auditDiff(args as unknown as Parameters<typeof core.confessional.auditDiff>[0]);
    return { data: r, wisdom: core.confessional.formatConfessionalLine(r), confidence: { level: r.verdict === "approve" ? "high" : r.verdict === "flag" ? "medium" : "low" } };
  },
};

// ─── VENDOR GHOST ──────────────────────────────────────────────────────
export const ghostDistillTool: MnemeTool = {
  name: "mneme.ghost.distill",
  category: "lab",
  description:
    "GHOST 👻 — distill a vendor-specific stylometric profile from recorded samples (hedge density, absolute density, code-block rate, top tokens, length distribution). HMAC-signed snapshot.",
  whenToUse: "After ≥10 samples for a vendor; refresh weekly.",
  triggers: ["ghost distill", "vendor profile", "stylometry"],
  inputSchema: { type: "object", properties: { samples: { type: "array" } }, required: ["samples"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Distill Grok's style from my last 30 samples", args: { samples: [] }, expectedOutput: "{ vendor, sampleCount, hedgeDensityPer100w, ..., sig }" }],
  pitfalls: ["All samples in one call must be from the SAME vendor; mix produces an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.vendorGhost.distillProfile(args["samples"] as Parameters<typeof core.vendorGhost.distillProfile>[0]);
    return { data: p, wisdom: `👻 GHOST · distilled ${p.vendor} from ${p.sampleCount} sample(s)`, confidence: { level: p.sampleCount > 50 ? "high" : p.sampleCount > 10 ? "medium" : "low" } };
  },
};

export const ghostAskTool: MnemeTool = {
  name: "mneme.ghost.ask",
  category: "lab",
  description:
    "GHOST 👻 — 'what would vendor X say?' — nearest-neighbour over historical samples + style fingerprint. Returns the matched response or an honest no-match.",
  whenToUse: "User wants a specific vendor's flavour on a familiar question without paying for a live call.",
  triggers: ["what would X say", "ghost ask", "vendor flavor"],
  inputSchema: {
    type: "object",
    properties: { profile: { type: "object" }, samples: { type: "array" }, prompt: { type: "string" } },
    required: ["profile", "samples", "prompt"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What would Grok say about this race condition?", args: { profile: {}, samples: [], prompt: "..." }, expectedOutput: "{ found, response, similarity, confidence, reasons, profileSig }" }],
  pitfalls: ["Honest no-match is a feature, not a bug — ghost will NOT fabricate when there's no historical match."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const g = core.vendorGhost.askGhost({
      profile: args["profile"] as Parameters<typeof core.vendorGhost.askGhost>[0]["profile"],
      samples: args["samples"] as Parameters<typeof core.vendorGhost.askGhost>[0]["samples"],
      prompt: String(args["prompt"]),
    });
    return { data: g, wisdom: core.vendorGhost.formatGhostLine(g), confidence: { level: g.confidence === "none" ? "low" : g.confidence } };
  },
};

// ─── TRINITY VOTE ──────────────────────────────────────────────────────
export const trinityJudgeTool: MnemeTool = {
  name: "mneme.trinity.judge",
  category: "lab",
  description:
    "TRINITY 🎯 — consensus + tiebreaker ensemble. Judge the consensus pair first; ONLY call the expensive tiebreaker on disagreement. Saves ~85% of tiebreaker cost while extracting full value on the hard cases.",
  whenToUse: "Routing prompts when you have 2 cheap reliable vendors + 1 expensive outlier-quality vendor.",
  triggers: ["trinity judge", "ensemble vote", "tiebreak"],
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }, taskClass: { type: "string" }, expectedFacts: { type: "array" },
      consensusPair: { type: "array" }, tiebreakerVendor: { type: "string" },
      consensusToleranceComposite: { type: "number" }, consensusMinFactScore: { type: "number" },
    },
    required: ["prompt", "taskClass", "expectedFacts", "consensusPair", "tiebreakerVendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run trinity on this fact-check, Grok as tiebreaker", args: { prompt: "...", taskClass: "fact_check", expectedFacts: [], consensusPair: [], tiebreakerVendor: "grok" }, expectedOutput: "{ chosenVendor, tiebreakUsed, estimatedTiebreakerCostSavedUsd, sig }" }],
  pitfalls: ["Caller must supply a tiebreakerProvider function that materialises the response only when needed; this MCP variant uses a stub provider — orchestrate the real call in your client."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // MCP boundary cannot pass a function; surface an honest stub.
    const stubVendor = args["tiebreakerVendor"] as Parameters<typeof core.trinityVote.judgeWithTrinity>[0]["tiebreakerVendor"];
    const v = await core.trinityVote.judgeWithTrinity({
      prompt: String(args["prompt"]),
      taskClass: args["taskClass"] as Parameters<typeof core.trinityVote.judgeWithTrinity>[0]["taskClass"],
      expectedFacts: args["expectedFacts"] as Parameters<typeof core.trinityVote.judgeWithTrinity>[0]["expectedFacts"],
      consensusPair: args["consensusPair"] as Parameters<typeof core.trinityVote.judgeWithTrinity>[0]["consensusPair"],
      tiebreakerVendor: stubVendor,
      tiebreakerProvider: () => ({ vendor: stubVendor, text: "(tiebreaker not materialised at MCP boundary)" }),
      ...(args["consensusToleranceComposite"] !== undefined ? { consensusToleranceComposite: Number(args["consensusToleranceComposite"]) } : {}),
      ...(args["consensusMinFactScore"] !== undefined ? { consensusMinFactScore: Number(args["consensusMinFactScore"]) } : {}),
    });
    return { data: v, wisdom: core.trinityVote.formatTrinityLine(v), confidence: { level: "high" } };
  },
};

// ─── INSURANCE MARKET ──────────────────────────────────────────────────
export const insuranceBoardTool: MnemeTool = {
  name: "mneme.insurance.board",
  category: "lab",
  description:
    "INSURANCE 💰 — build signed market board: per-vendor premium multiplier from (falseRateLB, sample size). Clamped [0.5, 3.0]; under-measured vendors penalised.",
  whenToUse: "Periodic rebalance from BOUNTY data; before quoting any ORACLE premium.",
  triggers: ["insurance board", "vendor multiplier"],
  inputSchema: { type: "object", properties: { trusts: { type: "array" } }, required: ["trusts"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build market board from latest BOUNTY data", args: { trusts: [] }, expectedOutput: "{ multipliers: [{ vendor, multiplier, reasons }], sig }" }],
  pitfalls: ["Vendors with very few samples will be clamped near the high end (under-measured penalty)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.insuranceMarket.buildMarketBoard(args["trusts"] as Parameters<typeof core.insuranceMarket.buildMarketBoard>[0]);
    return { data: b, wisdom: `💰 INSURANCE board built · ${b.multipliers.length} vendor(s)`, confidence: { level: "high" } };
  },
};

export const insuranceQuoteTool: MnemeTool = {
  name: "mneme.insurance.quote",
  category: "lab",
  description:
    "INSURANCE 💰 — quote an ORACLE premium adjusted by the vendor's market multiplier. The vendor's measured track record literally moves the price.",
  whenToUse: "Subscriber asks for a premium; or comparing multi-vendor insurance cost.",
  triggers: ["insurance quote", "premium quote"],
  inputSchema: {
    type: "object",
    properties: { vendor: { type: "string" }, tier: { type: "string" }, board: { type: "object" } },
    required: ["vendor", "tier", "board"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the team-tier premium for Grok?", args: { vendor: "grok", tier: "team", board: {} }, expectedOutput: "{ baseAnnualPremiumUsd, multiplier, finalAnnualPremiumUsd, badge }" }],
  pitfalls: ["A vendor missing from the board defaults to x1.5 — be honest with the customer about why."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const q = core.insuranceMarket.quotePremium(args as unknown as Parameters<typeof core.insuranceMarket.quotePremium>[0]);
    return { data: q, wisdom: core.insuranceMarket.formatInsuranceLine(q), confidence: { level: "high" } };
  },
};

// ─── VENDOR BOOMERANG ──────────────────────────────────────────────────
export const boomerangRecordTool: MnemeTool = {
  name: "mneme.boomerang.record",
  category: "lab",
  description:
    "BOOMERANG 📡 — append HMAC-chain-signed activity record to the cross-vendor ledger (vendor / kind / file / symbol / location / note).",
  whenToUse: "Every AI-driven edit; daemon's git-post-commit hook is the natural place.",
  triggers: ["boomerang record", "log activity"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }, kind: { type: "string" }, filePath: { type: "string" },
      symbol: { type: "string" }, location: { type: "string" }, note: { type: "string" },
    },
    required: ["vendor", "kind", "filePath", "note"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Log that Claude added calculateTotal to src/foo.ts", args: { vendor: "claude", kind: "symbol_create", filePath: "src/foo.ts", symbol: "calculateTotal", location: "L42", note: "added helper" }, expectedOutput: "{ recordId, sig, prevSig }" }],
  pitfalls: ["The default instance is process-local; persist exportLedger() if you want the chain to survive restarts."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.vendorBoomerang.defaultBoomerang().record({
      vendor: args["vendor"] as Parameters<typeof core.vendorBoomerang.VendorBoomerang.prototype.record>[0]["vendor"],
      kind: args["kind"] as Parameters<typeof core.vendorBoomerang.VendorBoomerang.prototype.record>[0]["kind"],
      filePath: String(args["filePath"]),
      ...(args["symbol"] ? { symbol: String(args["symbol"]) } : {}),
      ...(args["location"] ? { location: String(args["location"]) } : {}),
      note: String(args["note"]),
    });
    return { data: r, wisdom: `📡 BOOMERANG recorded · ${r.vendor} · ${r.kind} · ${r.filePath}`, confidence: { level: "high" } };
  },
};

export const boomerangBuildContextTool: MnemeTool = {
  name: "mneme.boomerang.build_context",
  category: "lab",
  description:
    "BOOMERANG 📡 — build cross-vendor context block for the INCOMING vendor: 'these are the OTHER vendors who touched this file recently, what they did'. Prepend to next prompt.",
  whenToUse: "Top of every prompt cycle for a vendor about to edit a shared file.",
  triggers: ["boomerang context", "cross-vendor context"],
  inputSchema: {
    type: "object",
    properties: {
      incomingVendor: { type: "string" }, filePath: { type: "string" },
      lookbackSeconds: { type: "number" }, maxRecords: { type: "number" },
    },
    required: ["incomingVendor", "filePath"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What did other vendors do to src/foo.ts in last 24h?", args: { incomingVendor: "grok", filePath: "src/foo.ts" }, expectedOutput: "{ relevantRecords, injectedContextBlock, sig }" }],
  pitfalls: ["The injectedContextBlock is plain text; your MCP client must actually prepend it to the next prompt for the effect to materialise."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ctx = core.vendorBoomerang.defaultBoomerang().build({
      incomingVendor: args["incomingVendor"] as Parameters<typeof core.vendorBoomerang.VendorBoomerang.prototype.build>[0]["incomingVendor"],
      filePath: String(args["filePath"]),
      ...(args["lookbackSeconds"] !== undefined ? { lookbackSeconds: Number(args["lookbackSeconds"]) } : {}),
      ...(args["maxRecords"] !== undefined ? { maxRecords: Number(args["maxRecords"]) } : {}),
    });
    return { data: ctx, wisdom: core.vendorBoomerang.formatBoomerangLine(ctx), confidence: { level: ctx.relevantRecords.length > 0 ? "high" : "medium" } };
  },
};

export const boomerangVerifyChainTool: MnemeTool = {
  name: "mneme.boomerang.verify_chain",
  category: "lab",
  description:
    "BOOMERANG 📡 — verify the full activity ledger chain integrity. Detects any tampering across the whole history.",
  whenToUse: "Periodic audit; before trusting boomerang context in a high-stakes decision.",
  triggers: ["boomerang verify", "verify ledger"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the BOOMERANG ledger clean?", args: {}, expectedOutput: "{ ok, brokenAt?, reason? }" }],
  pitfalls: ["Chain integrity is necessary but not sufficient — verifies the records weren't mutated, not that they're TRUE."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.vendorBoomerang.defaultBoomerang().verifyChain();
    return { data: r, wisdom: r.ok ? "📡 BOOMERANG ledger chain CLEAN" : `📡 BOOMERANG ledger broken at #${r.brokenAt}: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const V219_SYNCRETIC_TOOLS: MnemeTool[] = [
  confessionalAuditTool,
  ghostDistillTool, ghostAskTool,
  trinityJudgeTool,
  insuranceBoardTool, insuranceQuoteTool,
  boomerangRecordTool, boomerangBuildContextTool, boomerangVerifyChainTool,
];
