/**
 * v2.16.0 REVOLUTIONARY PENTAD — MCP tools.
 *
 *   PERSONA          — mneme.persona.*
 *   ANTI-COLLUSION   — mneme.anti_collusion.*
 *   ALPHA            — mneme.alpha.*  (HONEST financial AI layer)
 *   PUBLIC AUDIT     — mneme.audit.*
 *   LIVING MODEL     — mneme.living.*
 *   OBELISK          — mneme.obelisk.*
 */

import type { MnemeTool } from "./_types.js";

// === PERSONA ===
export const personaExportTool: MnemeTool = {
  name: "mneme.persona.export",
  category: "meta",
  description: "PERSONA — package your decision history + soul rules into a portable HMAC-signed .mneme-persona bundle. Teammates import it to subscribe to your judgment.",
  whenToUse: "After accumulating ≥20 REPLICA decisions; opt-in share with teammates.",
  triggers: ["export persona", "share my judgment"],
  inputSchema: { type: "object", properties: { owner: { type: "string" }, displayName: { type: "string" }, decisions: { type: "array" }, soulRules: { type: "array" } }, required: ["owner", "decisions"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Export my persona for the team", args: { owner: "me@x.com", decisions: [] }, expectedOutput: "{ ..., sig }" }],
  pitfalls: ["Only export decisions flagged shareable; never source code."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.persona.exportPersona({
      owner: String(args["owner"]),
      ...(args["displayName"] ? { displayName: String(args["displayName"]) } : {}),
      decisions: args["decisions"] as Parameters<typeof core.persona.exportPersona>[0]["decisions"],
      ...(args["soulRules"] ? { soulRules: args["soulRules"] as Parameters<typeof core.persona.exportPersona>[0]["soulRules"] } : {}),
    });
    return { data: b, wisdom: core.persona.formatPersonaLine(b), confidence: { level: "high" } };
  },
};

export const personaQueryTool: MnemeTool = {
  name: "mneme.persona.query",
  category: "meta",
  description: "PERSONA — query a teammate's persona for what THEY would do in a given situation. Returns recommendation + confidence + attribution.",
  whenToUse: "Stuck on a decision; ask 'what would Shinnapat do?' via their persona bundle.",
  triggers: ["query persona", "what would X do"],
  inputSchema: { type: "object", properties: { bundle: { type: "object" }, question: { type: "string" }, features: { type: "object" } }, required: ["bundle", "question"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What would Shin do for this Friday deploy?", args: { bundle: {}, question: "Friday deploy?" }, expectedOutput: "{ recommendation, confidence, attributedTo, sig }" }],
  pitfalls: ["Verify bundle.sig before trusting; tampered personas return same shape."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.persona.queryPersona({
      bundle: args["bundle"] as Parameters<typeof core.persona.queryPersona>[0]["bundle"],
      question: String(args["question"]),
      ...(args["features"] ? { features: args["features"] as Record<string, string> } : {}),
    });
    return { data: r, wisdom: `PERSONA · ${r.attributedTo} would: ${r.recommendation ?? "(no match)"} · conf=${(r.confidence * 100).toFixed(0)}%`, confidence: { level: r.confidence > 0.6 ? "high" : r.confidence > 0.3 ? "medium" : "low" } };
  },
};

// === ANTI-COLLUSION ===
export const antiCollusionDetectTool: MnemeTool = {
  name: "mneme.anti_collusion.detect",
  category: "meta",
  description: "ANTI-COLLUSION (AI Internal Affairs) — analyse a multi-agent conversation log for 5 collusion patterns (skipped verification, echoing, mutual praise loop, verification dropout, convenient agreement). Returns HMAC-signed verdict per agent pair; triggers APOPTOSIS context-wipe if risk ≥ 0.8.",
  whenToUse: "Any multi-agent flow (Dev Agent + QA Agent + Ops Agent). Run periodically on conversation logs.",
  triggers: ["detect collusion", "audit agents"],
  inputSchema: { type: "object", properties: { conversationId: { type: "string" }, turns: { type: "array" }, expectedVerifyRate: { type: "number" } }, required: ["conversationId", "turns"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Did my agents collude?", args: { conversationId: "c1", turns: [] }, expectedOutput: "[{ agentPair, collusionRisk, verdict, findings, sig }]" }],
  pitfalls: ["Risk ≥ 0.8 = apoptosis_now (immediate context wipe + leaderboard log)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.antiCollusion.detectCollusion({
      conversationId: String(args["conversationId"]),
      turns: args["turns"] as Parameters<typeof core.antiCollusion.detectCollusion>[0]["turns"],
      ...(args["expectedVerifyRate"] ? { expectedVerifyRate: Number(args["expectedVerifyRate"]) } : {}),
    });
    return { data: r, wisdom: core.antiCollusion.formatAntiCollusionLine(r), confidence: { level: r.some((v) => v.verdict === "apoptosis_now") ? "high" : "medium" } };
  },
};

// === ALPHA (honest) ===
export const alphaExtractTool: MnemeTool = {
  name: "mneme.alpha.extract",
  category: "meta",
  description: "ALPHA — pull a structured financial claim (ticker / direction / horizon / target price / overconfidence flag) out of AI free-text. Honest layer: does NOT promise prediction accuracy; makes AI claims TRACEABLE.",
  whenToUse: "Whenever AI states ANY financial opinion. Pair with mneme.alpha.price_check + mneme.alpha.fuse for accountability.",
  triggers: ["extract claim", "parse stock claim"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, text: { type: "string" } }, required: ["vendor", "text"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What did the AI claim?", args: { vendor: "claude", text: "$NOK going up 90% confident" }, expectedOutput: "{ ticker, direction, overconfident, sig }" }],
  pitfalls: ["overconfident=true is a RED FLAG — re-verify the claim independently."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.alpha.extractClaim({ vendor: String(args["vendor"]), text: String(args["text"]) });
    return { data: c, wisdom: core.alpha.formatAlphaLine(c), confidence: { level: c.overconfident ? "low" : "medium", notes: c.overconfident ? "OVERCONFIDENT claim — markets are noisy; no honest engineer claims >85% accuracy on direction predictions." : undefined } };
  },
};

export const alphaFuseTool: MnemeTool = {
  name: "mneme.alpha.fuse",
  category: "meta",
  description: "ALPHA — fuse N vendors' claims on the same ticker into consensus + dispersion + advisory string. ADVISORY ONLY — never a trade signal.",
  whenToUse: "When polling multiple AI vendors for opinions on a stock; want to see disagreement + overconfidence rates.",
  triggers: ["fuse stock claims", "consensus opinion"],
  inputSchema: { type: "object", properties: { claims: { type: "array" } }, required: ["claims"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Consensus on NVDA?", args: { claims: [] }, expectedOutput: "{ consensusDirection, dispersion, advisory }" }],
  pitfalls: ["consensusStrength=1.0 with overconfidentCount=N is a herding signal — be skeptical."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.alpha.fuseClaims(args["claims"] as Parameters<typeof core.alpha.fuseClaims>[0]);
    return { data: r, wisdom: `ALPHA FUSE · ${r.ticker} · ${r.consensusDirection} (${(r.consensusStrength * 100).toFixed(0)}% agree, ${r.overconfidentCount}/${r.vendorsConsulted} overconfident)`, confidence: { level: "low", notes: r.advisory } };
  },
};

// === PUBLIC AUDIT ===
export const publicAuditTool: MnemeTool = {
  name: "mneme.audit.public",
  category: "meta",
  description: "AURELIAN PUBLIC AUDIT — grade any open-source package (npm/PyPI/Cargo/...). Returns 0-100 composite score across popularity / freshness / openness / types / docs + verdict (platinum/gold/silver/bronze/needs_work) + recommendations.",
  whenToUse: "Before adopting a new dependency; periodic audit of existing deps.",
  triggers: ["audit package", "is this package good"],
  inputSchema: { type: "object", properties: { registry: { type: "string" }, packageName: { type: "string" }, metadata: { type: "object" } }, required: ["registry", "packageName"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should we use lodash?", args: { registry: "npm", packageName: "lodash" }, expectedOutput: "{ composite, verdict, recommendations, sig }" }],
  pitfalls: ["Pre-fill `metadata` from your registry API; the audit doesn't fetch by default."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.publicAudit.audit({
      registry: String(args["registry"]) as Parameters<typeof core.publicAudit.audit>[0]["registry"],
      packageName: String(args["packageName"]),
      ...(args["metadata"] ? { metadata: args["metadata"] as Parameters<typeof core.publicAudit.audit>[0]["metadata"] } : {}),
    });
    return { data: r, wisdom: core.publicAudit.formatPublicAuditLine(r), confidence: { level: r.verdict === "platinum" || r.verdict === "gold" ? "high" : "medium" } };
  },
};

// === LIVING MODEL ===
export const livingMerkleTool: MnemeTool = {
  name: "mneme.living.merkle_summary",
  category: "meta",
  description: "LIVING MODEL — build a Merkle-tree summary of local observations for anti-entropy sync with peer hosts.",
  whenToUse: "Periodic gossip exchange between Mneme-managed hosts.",
  triggers: ["merkle summary", "anti-entropy"],
  inputSchema: { type: "object", properties: { host: { type: "string" }, observations: { type: "array" } }, required: ["host", "observations"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build summary for sync", args: { host: "host-a", observations: [] }, expectedOutput: "{ root, total, leafIds }" }],
  pitfalls: ["leafIds are exchanged in plain — they're identifiers, not content."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.livingModel.buildMerkleSummary(String(args["host"]), args["observations"] as Parameters<typeof core.livingModel.buildMerkleSummary>[1]);
    return { data: s, wisdom: core.livingModel.formatLivingModelLine(s), confidence: { level: "high" } };
  },
};

export const livingCausalTool: MnemeTool = {
  name: "mneme.living.infer_causal",
  category: "meta",
  description: "LIVING MODEL — naive causal inference: given (cause, effect) pairs, compute mean lead time + directionality vote + correlation. Pure inference, no LLM.",
  whenToUse: "Suspect 'deploys at host A correlate with errors at host B' — quantify it.",
  triggers: ["causal inference", "correlate events"],
  inputSchema: { type: "object", properties: { pairs: { type: "array" } }, required: ["pairs"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Do my Tuesday deploys cause Wednesday outages?", args: { pairs: [] }, expectedOutput: "{ meanLeadSeconds, directionalityVote, correlation }" }],
  pitfalls: ["Correlation ≠ causation. Treat the output as a HYPOTHESIS to test, not a verdict."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.livingModel.inferCausal(args["pairs"] as Parameters<typeof core.livingModel.inferCausal>[0]);
    return { data: r, wisdom: `CAUSAL · ${r.cause}→${r.effect} · lead=${r.meanLeadSeconds?.toFixed(0)}s · dir=${(r.directionalityVote * 100).toFixed(0)}%`, confidence: { level: r.samples >= 10 ? "medium" : "low" } };
  },
};

// === OBELISK ===
export const obeliskBuildCardTool: MnemeTool = {
  name: "mneme.obelisk.build_card",
  category: "meta",
  description: "OBELISK — wrap your BOUNTY vendor scorecard as a publishable OBELISK card with signature. Submit to the federated trust graph.",
  whenToUse: "When you want to share your measured vendor falseRate with the community.",
  triggers: ["build obelisk card", "publish vendor score"],
  inputSchema: { type: "object", properties: { publisher: { type: "string" }, publisherUrl: { type: "string" }, vendorScore: { type: "object" } }, required: ["publisher", "vendorScore"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Publish my Claude scorecard", args: { publisher: "alice@x.com", vendorScore: {} }, expectedOutput: "{ ..., sig }" }],
  pitfalls: ["Publisher identity is whatever you write; trust comes from sig + community track record."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.obelisk.buildCard({
      publisher: String(args["publisher"]),
      ...(args["publisherUrl"] ? { publisherUrl: String(args["publisherUrl"]) } : {}),
      vendorScore: args["vendorScore"] as Parameters<typeof core.obelisk.buildCard>[0]["vendorScore"],
    });
    return { data: c, wisdom: `OBELISK · ${c.publisher} → ${c.vendorScore.vendor} (${c.vendorScore.totalVerdicts} verdicts)`, confidence: { level: "high" } };
  },
};

export const obeliskAggregateTool: MnemeTool = {
  name: "mneme.obelisk.aggregate",
  category: "meta",
  description: "OBELISK — aggregate N signed cards into the federated AI Trust Graph. Wilson-LB-weighted consensus per vendor across publishers.",
  whenToUse: "Periodic publishing of the trust graph; researchers studying AI vendor accuracy.",
  triggers: ["aggregate obelisk", "trust graph"],
  inputSchema: { type: "object", properties: { cards: { type: "array" } }, required: ["cards"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Aggregate community scorecards", args: { cards: [] }, expectedOutput: "{ rows, unverified }" }],
  pitfalls: ["Unverified cards (failed sig) are isolated. Investigate before re-including."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.obelisk.aggregateGraph(args["cards"] as Parameters<typeof core.obelisk.aggregateGraph>[0]);
    return { data: r, wisdom: core.obelisk.formatObeliskLine(r.rows), confidence: { level: "high" } };
  },
};

export const V216_REVOLUTIONARY_TOOLS: MnemeTool[] = [
  personaExportTool, personaQueryTool,
  antiCollusionDetectTool,
  alphaExtractTool, alphaFuseTool,
  publicAuditTool,
  livingMerkleTool, livingCausalTool,
  obeliskBuildCardTool, obeliskAggregateTool,
];
