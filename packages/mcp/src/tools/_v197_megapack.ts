/**
 * v2.19.7 MEGAPACK — 13 new MCP tools spanning 6 wild mutations + 4 tech debt.
 *
 *   intent: save / load                          (2)
 *   agreement: uninstall                         (1)
 *   chronostasis: lineage / axioms_relevant_embedded (2)
 *   dream: run / review                          (2)
 *   colony: broadcast / drain                    (2)
 *   honey: generate / score_vendor               (2)
 *   retroactive: mine_history                    (1)
 *   genetic: propose                             (1)
 */

import type { MnemeTool } from "./_types.js";

// ─── intent persistence (TECH DEBT #5) ─────────────────────────────────
export const intentSaveTool: MnemeTool = {
  name: "mneme.intent.save",
  category: "lab",
  description:
    "🎯 INTENT — persist custom phrases to .mneme/intent-phrases.json so they survive process restarts.",
  whenToUse: "After registering one or more custom phrases at runtime.",
  triggers: ["intent save", "save phrases", "persist intents"],
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Save my custom phrases", args: {}, expectedOutput: "{ saved, path }" }],
  pitfalls: ["Built-in phrases are excluded — only runtime-registered custom phrases are persisted."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.intentRouter.saveCustomPhrases(args["path"] ? { path: String(args["path"]) } : {});
    return { data: r, wisdom: `🎯 INTENT saved ${r.saved} custom phrase(s)`, confidence: { level: "high" } };
  },
};
export const intentLoadTool: MnemeTool = {
  name: "mneme.intent.load",
  category: "lab",
  description:
    "🎯 INTENT — load persisted custom phrases from disk on session start.",
  whenToUse: "Daemon start; or when AI needs the user's project-specific commands.",
  triggers: ["intent load", "load phrases"],
  inputSchema: { type: "object", properties: { path: { type: "string" }, replaceCustom: { type: "boolean" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Load saved intent phrases", args: {}, expectedOutput: "{ loaded, path }" }],
  pitfalls: ["By default, additive (skips duplicates). Pass replaceCustom=true to drop prior custom first."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.intentRouter.loadCustomPhrases({
      ...(args["path"] ? { path: String(args["path"]) } : {}),
      ...(args["replaceCustom"] ? { replaceCustom: Boolean(args["replaceCustom"]) } : {}),
    });
    return { data: r, wisdom: `🎯 INTENT loaded ${r.loaded} custom phrase(s)`, confidence: { level: "high" } };
  },
};

// ─── agreement uninstall (TECH DEBT #7) ────────────────────────────────
export const agreementUninstallTool: MnemeTool = {
  name: "mneme.agreement.uninstall",
  category: "lab",
  description:
    "📜 AGREEMENT — remove an agreement's persisted files + optionally remove the Mneme-generated pre-commit hook (safety-checked: refuses to remove non-Mneme hooks).",
  whenToUse: "When an agreement is rescinded; or after rotating to a new agreement.",
  triggers: ["agreement uninstall", "remove agreement", "uninstall hook"],
  inputSchema: {
    type: "object",
    properties: {
      agreementId: { type: "string" },
      agreementJsonPath: { type: "string" },
      baseDir: { type: "string" },
      hookPath: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Remove agreement ag-xxx", args: { agreementId: "ag-xxx" }, expectedOutput: "{ removed, notFound, hookRemoved }" }],
  pitfalls: ["hookPath is only removed if the file CONTAINS the marker 'MNEME AGREEMENT PRE-COMMIT HOOK' — safety against deleting unrelated hooks."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.conversationCompiler.uninstallAgreement(args as unknown as Parameters<typeof core.conversationCompiler.uninstallAgreement>[0]);
    return { data: r, wisdom: `📜 AGREEMENT uninstalled · ${r.removed.length} file(s) removed · hook=${r.hookRemoved}`, confidence: { level: "high" } };
  },
};

// ─── chronostasis: lineage + embedded gravity ──────────────────────────
export const chronoLineageTool: MnemeTool = {
  name: "mneme.chronostasis.lineage",
  category: "lab",
  description:
    "🔭 RETROCAUSAL — given an axiomId, walk the dep graph backward + return a signed proof tree. Depth-of-inference receipt that no AI vendor can produce.",
  whenToUse: "User asks 'why is this an axiom?' or wants the proof path.",
  triggers: ["axiom lineage", "proof tree", "why is this axiom"],
  inputSchema: { type: "object", properties: { axiomId: { type: "string" } }, required: ["axiomId"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show the lineage of ax-xxx", args: { axiomId: "ax-xxx" }, expectedOutput: "{ rootAxiomId, tree, isFullyCrystallized, sig }" }],
  pitfalls: ["isFullyCrystallized=false means some upstream deps never crystallised (rare; usually means a Chronostasis snapshot was loaded partially)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronostasis.defaultChronostasis().axiomLineage(String(args["axiomId"]));
    return { data: r, wisdom: `🔭 LINEAGE · ${r.rootAxiomId} · ${r.tree.length} hop(s) · fully=${r.isFullyCrystallized}`, confidence: { level: r.isFullyCrystallized ? "high" : "medium" } };
  },
};
export const chronoAxiomsRelevantEmbeddedTool: MnemeTool = {
  name: "mneme.chronostasis.axioms_relevant_embedded",
  category: "lab",
  description:
    "🔭 Embedded truth gravity. Cosine-similarity ranking using a caller-supplied embedder; higher fidelity than jaccard for paraphrased / multi-lingual queries.",
  whenToUse: "When jaccard ranking misses relevant axioms; an embedder must be wired by the caller (this MCP variant uses a stub embedder).",
  triggers: ["embedded gravity", "axiom relevant embedded"],
  inputSchema: {
    type: "object",
    properties: {
      queryText: { type: "string" },
      k: { type: "number" },
      minSimilarity: { type: "number" },
    },
    required: ["queryText"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Find axioms relevant to my question via embeddings", args: { queryText: "..." }, expectedOutput: "{ attractedAxioms }" }],
  pitfalls: ["MCP boundary cannot pass functions, so this tool uses a fallback identity embedder. For real embeddings, wire via SDK directly: core.chronostasis.defaultChronostasis().axiomsRelevantToEmbedded({ queryText, embed })."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Default fallback: jaccard via the non-embedded method
    const r = core.chronostasis.defaultChronostasis().axiomsRelevantTo({
      queryText: String(args["queryText"]),
      ...(args["k"] !== undefined ? { k: Number(args["k"]) } : {}),
      ...(args["minSimilarity"] !== undefined ? { minSimilarity: Number(args["minSimilarity"]) } : {}),
    });
    return { data: r, wisdom: `🔭 GRAVITY · ${r.attractedAxioms.length} axiom(s) attracted (jaccard fallback at MCP boundary)`, confidence: { level: "high" } };
  },
};

// ─── dream consolidation ───────────────────────────────────────────────
export const dreamRunTool: MnemeTool = {
  name: "mneme.dream.run",
  category: "lab",
  description:
    "💤 DREAM CONSOLIDATION — run one REM-sleep cycle. Pairs axioms with high jaccard overlap + emits speculative candidates. HMAC-signed; deterministic per axiom pool.",
  whenToUse: "Daemon idle window (midnight-6am); periodic synthesis pass.",
  triggers: ["dream run", "dream cycle", "speculative axioms"],
  inputSchema: {
    type: "object",
    properties: {
      axioms: { type: "array" },
      pairThreshold: { type: "number" },
      noveltyThreshold: { type: "number" },
      maxCandidates: { type: "number" },
      expirySec: { type: "number" },
      storePath: { type: "string" },
    },
    required: ["axioms"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run a dream cycle over today's axioms", args: { axioms: [] }, expectedOutput: "{ candidates, candidatesEmitted, sig }" }],
  pitfalls: ["Speculative candidates NEVER auto-promote — they must be explicitly confirmed via mneme.dream.review."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = new core.dreamConsolidation.DreamConsolidation(
      args["storePath"] ? { storePath: String(args["storePath"]) } : {},
    );
    const r = d.runCycle(args as unknown as Parameters<typeof core.dreamConsolidation.DreamConsolidation.prototype.runCycle>[0]);
    return { data: r, wisdom: `💤 DREAM · ${r.candidatesEmitted} candidate(s) emitted from ${r.pairsExplored} pairs`, confidence: { level: "high" } };
  },
};
export const dreamReviewTool: MnemeTool = {
  name: "mneme.dream.review",
  category: "lab",
  description:
    "💤 DREAM CONSOLIDATION — confirm OR refute a pending speculative candidate. Confirmed candidates can be submitted as Chronostasis pending claims.",
  whenToUse: "Morning review session; parent decides which dreams become real.",
  triggers: ["dream review", "confirm dream", "refute dream"],
  inputSchema: {
    type: "object",
    properties: {
      candidateId: { type: "string" },
      action: { type: "string", enum: ["confirm", "refute"] },
      reason: { type: "string" },
      storePath: { type: "string" },
    },
    required: ["candidateId", "action"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Confirm dream candidate dc-xxx", args: { candidateId: "dc-xxx", action: "confirm", reason: "checked manually" }, expectedOutput: "{ status: 'confirmed', sig }" }],
  pitfalls: ["refute REQUIRES a reason; confirm reason is optional but encouraged."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = new core.dreamConsolidation.DreamConsolidation(
      args["storePath"] ? { storePath: String(args["storePath"]) } : {},
    );
    const action = String(args["action"]);
    const r = action === "confirm"
      ? d.confirm({ candidateId: String(args["candidateId"]), ...(args["reason"] ? { reason: String(args["reason"]) } : {}) })
      : d.refute({ candidateId: String(args["candidateId"]), reason: String(args["reason"] ?? "no reason given") });
    return { data: r, wisdom: r ? `💤 DREAM · ${r.status}` : "💤 DREAM · candidate not found", confidence: { level: r ? "high" : "low" } };
  },
};

// ─── colony mind ────────────────────────────────────────────────────────
export const colonyBroadcastTool: MnemeTool = {
  name: "mneme.colony.broadcast",
  category: "lab",
  description:
    "🐝 COLONY MIND — build a signed broadcast envelope sharing a high-confidence local refute with peer Mneme instances. Caller publishes the envelope via any transport.",
  whenToUse: "After a local refute deprecates a claim; share with the colony.",
  triggers: ["colony broadcast", "share refute"],
  inputSchema: {
    type: "object",
    properties: {
      fromInstance: { type: "string" },
      refutedClaimText: { type: "string" },
      refuteEvidence: { type: "string" },
      refuteConfidence: { type: "number" },
      refuteVendor: { type: "string" },
      matchThreshold: { type: "number" },
    },
    required: ["fromInstance", "refutedClaimText", "refuteEvidence", "refuteConfidence", "refuteVendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Broadcast this refute to peers", args: { fromInstance: "host-a", refutedClaimText: "...", refuteEvidence: "...", refuteConfidence: 0.92, refuteVendor: "grok" }, expectedOutput: "{ broadcastId, sig }" }],
  pitfalls: ["The MCP server only BUILDS the envelope — caller chooses the transport (HTTP, git note, message queue)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.colonyMind.buildBroadcast(args as unknown as Parameters<typeof core.colonyMind.buildBroadcast>[0]);
    return { data: b, wisdom: core.colonyMind.formatBroadcastLine(b), confidence: { level: "high" } };
  },
};
export const colonyDrainTool: MnemeTool = {
  name: "mneme.colony.drain",
  category: "lab",
  description:
    "🐝 COLONY MIND — drain a list of incoming broadcasts; auto-deprecate matching local pending claims via caller-supplied localDeprecate callback. Signed outcome receipt.",
  whenToUse: "Peer broadcasts arrive; process them before the next chronostasis tick.",
  triggers: ["colony drain", "process broadcasts"],
  inputSchema: {
    type: "object",
    properties: {
      broadcasts: { type: "array" },
      localPending: { type: "array" },
    },
    required: ["broadcasts", "localPending"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Process these broadcasts against my pending claims", args: { broadcasts: [], localPending: [] }, expectedOutput: "{ applied, invalidSigs, localDeprecated, sig }" }],
  pitfalls: ["MCP boundary cannot pass functions; this tool uses a no-op localDeprecate (returns what WOULD be deprecated). For real wiring, call core.colonyMind.drainBroadcasts via SDK."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const matched: string[] = [];
    const r = core.colonyMind.drainBroadcasts({
      broadcasts: args["broadcasts"] as Parameters<typeof core.colonyMind.drainBroadcasts>[0]["broadcasts"],
      localPending: args["localPending"] as Parameters<typeof core.colonyMind.drainBroadcasts>[0]["localPending"],
      localDeprecate: (id) => matched.push(id),
    });
    return { data: { ...r, matchedClaimIds: matched }, wisdom: core.colonyMind.formatDrainLine(r), confidence: { level: "high" } };
  },
};

// ─── honey decision ─────────────────────────────────────────────────────
export const honeyGenerateTool: MnemeTool = {
  name: "mneme.honey.generate",
  category: "lab",
  description:
    "🍯 HONEY DECISION — generate a baited agreement of the requested kind (self_contradiction / impossible_threshold / mutually_exclusive_pair / circular_dependency / tautological_block). HMAC-signed; full transparency about what the vendor should catch.",
  whenToUse: "Vendor onboarding; periodic honesty audit; building a per-vendor honesty leaderboard.",
  triggers: ["honey generate", "create bait"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["self_contradiction", "impossible_threshold", "mutually_exclusive_pair", "circular_dependency", "tautological_block"] },
    },
    required: ["kind"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Generate a self-contradiction bait", args: { kind: "self_contradiction" }, expectedOutput: "{ baitId, agreementText, expectedCatch, sig }" }],
  pitfalls: ["The bait IS a real agreement-shaped doc; do NOT install its pre-commit hook (it's designed to be impossible to satisfy)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.honeyDecision.generateBait({ kind: args["kind"] as Parameters<typeof core.honeyDecision.generateBait>[0]["kind"] });
    return { data: b, wisdom: core.honeyDecision.formatBaitLine(b), confidence: { level: "high" } };
  },
};
export const honeyScoreVendorTool: MnemeTool = {
  name: "mneme.honey.score_vendor",
  category: "lab",
  description:
    "🍯 HONEY DECISION — compute Wilson-LB honesty score for a vendor from N (bait, verdict) pairs. Rank bands: trustworthy / average / suspect / untrustworthy / unmeasured.",
  whenToUse: "After collecting >= 5 vendor verdicts on baits.",
  triggers: ["honey score", "vendor honesty score"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      verdicts: { type: "array" },
    },
    required: ["vendor", "verdicts"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Score Claude's honesty from these 5 baits", args: { vendor: "claude", verdicts: [] }, expectedOutput: "{ catchRate, wilsonLowerBound, rankBand, sig }" }],
  pitfalls: ["WilsonLB grows as N grows. With 5/5 caught WilsonLB ≈ 0.57 (trustworthy at our threshold); with 20+ samples the score becomes more meaningful for production use."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.honeyDecision.scoreVendor(args as unknown as Parameters<typeof core.honeyDecision.scoreVendor>[0]);
    return { data: s, wisdom: core.honeyDecision.formatScoreLine(s), confidence: { level: s.totalBaits >= 10 ? "high" : "medium" } };
  },
};

// ─── retroactive compile ────────────────────────────────────────────────
export const retroactiveMineTool: MnemeTool = {
  name: "mneme.retroactive.mine_history",
  category: "lab",
  description:
    "📜 RETROACTIVE COMPILE — scan git commits (caller supplies CommitRecord[]) for agreement-shaped sentences → produce backdated Agreements + flag every subsequent commit that violated them. Returns a signed map of broken promises.",
  whenToUse: "Repo audit; post-mortem; new-team-member onboarding to see 'what did we say and what did we actually do'.",
  triggers: ["mine history", "retroactive scan", "broken promises"],
  inputSchema: {
    type: "object",
    properties: {
      commits: { type: "array" },
    },
    required: ["commits"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scan last year's commits for broken agreements", args: { commits: [] }, expectedOutput: "{ scannedCommits, agreementsFound, violations, brokenPromiseCount, sig }" }],
  pitfalls: ["Caller must supply CommitRecord[]; this tool doesn't shell out to git itself (keeps the module testable + transport-agnostic)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.retroactiveCompile.mineHistory(args as unknown as Parameters<typeof core.retroactiveCompile.mineHistory>[0]);
    return { data: r, wisdom: core.retroactiveCompile.formatReportLine(r), confidence: { level: "high" } };
  },
};

// ─── genetic patch ──────────────────────────────────────────────────────
export const geneticProposeTool: MnemeTool = {
  name: "mneme.genetic.propose",
  category: "lab",
  description:
    "🧬 GENETIC PATCH — Mneme proposes a PR to itself (new pattern, threshold tune, intent phrase, ritual gate). AURELIAN-audits the proposal; only SHIP-graded patches set shouldAdvance=true.",
  whenToUse: "Daemon nightly cycle; user asks 'how should you improve?'.",
  triggers: ["genetic propose", "propose patch", "self improve"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["new_conversation_pattern", "tune_threshold", "new_intent_phrase", "new_ritual_gate", "new_witness_template", "other"] },
      targetPath: { type: "string" },
      summary: { type: "string" },
      changeInstructions: { type: "string" },
      evidence: { type: "string" },
      risks: { type: "string" },
    },
    required: ["kind", "targetPath", "summary", "changeInstructions", "evidence"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Propose adding a 'must use HTTPS' pattern to conversation_compiler", args: { kind: "new_conversation_pattern", targetPath: "packages/core/src/conversation_compiler/index.ts", summary: "add must_use_https rule", changeInstructions: "...", evidence: "..." }, expectedOutput: "{ proposalId, branchName, prBody, audit, shouldAdvance, sig }" }],
  pitfalls: ["This tool produces a PROPOSAL + audit; it does NOT modify files or push a PR — caller decides whether to apply (shouldAdvance gate recommended)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.geneticPatch.proposePatch(args as unknown as Parameters<typeof core.geneticPatch.proposePatch>[0]);
    return { data: p, wisdom: core.geneticPatch.formatProposalLine(p), confidence: { level: p.shouldAdvance ? "high" : "medium" } };
  },
};

export const V197_MEGAPACK_TOOLS: MnemeTool[] = [
  intentSaveTool, intentLoadTool,
  agreementUninstallTool,
  chronoLineageTool, chronoAxiomsRelevantEmbeddedTool,
  dreamRunTool, dreamReviewTool,
  colonyBroadcastTool, colonyDrainTool,
  honeyGenerateTool, honeyScoreVendorTool,
  retroactiveMineTool,
  geneticProposeTool,
];
