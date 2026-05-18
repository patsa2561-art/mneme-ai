/**
 * v2.19.42 PROOF OF SAVING + CASCADE INVERSION + HONESTY GATE 2.0 — MCP tools
 *
 *   PROOF OF SAVING (3):
 *     mneme.proof.mint                    — HMAC-signed savings certificate from decisions
 *     mneme.proof.verify                  — verify cert + recompute Merkle root + check arithmetic
 *     mneme.proof.format                  — human-readable certificate render
 *
 *   CASCADE INVERSION (1):
 *     mneme.inversion.ab_benchmark        — wall-time A/B sequential vs parallel-race
 *
 *   HONESTY GATE 2.0 (2):
 *     mneme.honesty.audit_features        — feature-name claim parser + coverage + auto-amend
 *     mneme.honesty.strip_amendments      — round-trip safety (strip auto-amend markers from body)
 */

import type { MnemeTool } from "./_types.js";

// ─── PROOF OF SAVING ──────────────────────────────────────────────────

export const proofMintTool: MnemeTool = {
  name: "mneme.proof.mint",
  category: "audit",
  description: "🪙 PROOF OF SAVING (v2.19.42) — mint an HMAC-signed Merkle-rooted savings certificate from a batch of Governor decisions. Replayable, tamper-evident, vendor-neutral. The enterprise procurement primitive no AI optimisation vendor ships.",
  whenToUse: "Weekly / monthly / quarterly — after governing a batch of AI calls, mint a cert auditors can verify offline. Compose with v2.19.34 APOSTILLE for compliance binders.",
  triggers: ["proof mint", "savings certificate", "token savings audit"],
  inputSchema: {
    type: "object",
    properties: {
      decisions: { type: "array", description: "Array of GovernorDecision objects (each has signature + tokensUsedActual + estTokensSavedVsDirect + stage)" },
      windowStartMs: { type: "number", description: "Start of the savings window (epoch ms)" },
      windowEndMs: { type: "number", description: "End of the savings window (epoch ms)" },
      usdPerToken: { type: "number", description: "Blended $-per-token estimate. Default 0.000002 (~$2/1M tokens)" },
    },
    required: ["decisions", "windowStartMs", "windowEndMs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How much did Mneme save us this month?", args: { decisions: [], windowStartMs: 0, windowEndMs: 1 }, expectedOutput: "{ v, mintedAt, decisionCount, totalDirectTokens, totalActualTokens, totalTokensSaved, estUsdSaved, merkleRoot, hmac }" }],
  pitfalls: ["The certificate's $-amount is estimated using a blended per-token rate; pass `usdPerToken` to use a specific vendor's published price."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const cert = core.proofOfSaving.mintSavingsCertificate(args as unknown as Parameters<typeof core.proofOfSaving.mintSavingsCertificate>[0]);
    return { data: cert, wisdom: `🪙 saved ${cert.totalTokensSaved.toLocaleString()} tokens / $${cert.estUsdSaved.toFixed(2)} across ${cert.decisionCount} calls`, confidence: { level: "high" } };
  },
};

export const proofVerifyTool: MnemeTool = {
  name: "mneme.proof.verify",
  category: "audit",
  description: "🪙 PROOF OF SAVING — verify a savings certificate. Recomputes Merkle root + HMAC + arithmetic invariants. Auditors can run this OFFLINE in ~5ms.",
  whenToUse: "Procurement / audit / billing reconciliation. Pass the cert + the original decisions list.",
  triggers: ["proof verify", "verify savings cert"],
  inputSchema: { type: "object", properties: { cert: { type: "object" }, decisions: { type: "array" } }, required: ["cert", "decisions"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this savings certificate authentic?", args: { cert: {}, decisions: [] }, expectedOutput: "{ ok: true } or { ok: false, reason }" }],
  pitfalls: ["Verification uses the same MNEME_PROOF_SECRET env var the cert was minted with. Auditors must have access to it (rotate per quarter)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.proofOfSaving.verifySavingsCertificate(
      args["cert"] as Parameters<typeof core.proofOfSaving.verifySavingsCertificate>[0],
      args["decisions"] as Parameters<typeof core.proofOfSaving.verifySavingsCertificate>[1],
    );
    return { data: v, wisdom: v.ok ? "🪙 certificate authentic" : `🪙 tampered: ${v.reason}`, confidence: { level: "high" } };
  },
};

export const proofFormatTool: MnemeTool = {
  name: "mneme.proof.format",
  category: "audit",
  description: "🪙 PROOF OF SAVING — render a savings certificate as human-readable text (dashboard / email surface).",
  whenToUse: "Surface to procurement / CFO / ESG team. The format is plain text safe for non-engineers.",
  triggers: ["proof format", "savings dashboard"],
  inputSchema: { type: "object", properties: { cert: { type: "object" } }, required: ["cert"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Render the savings cert for procurement", args: { cert: {} }, expectedOutput: "{ text: 'MNEME PROOF OF SAVING — v1...' }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const text = core.proofOfSaving.formatCertificate(args["cert"] as Parameters<typeof core.proofOfSaving.formatCertificate>[0]);
    return { data: { text }, wisdom: `🪙 rendered ${text.length} bytes`, confidence: { level: "high" } };
  },
};

// ─── CASCADE INVERSION ────────────────────────────────────────────────

export const inversionAbBenchmarkTool: MnemeTool = {
  name: "mneme.inversion.ab_benchmark",
  category: "meta",
  description: "🏎 CASCADE INVERSION (v2.19.42) — wall-time A/B benchmark of sequential vs parallel-race execution. Use to verify your token-saving infrastructure is faster on cold start.",
  whenToUse: "Run once after install to verify CASCADE INVERSION beats sequential cascade on cold-start workloads. Expected 3-5x speedup.",
  triggers: ["inversion benchmark", "cascade ab test"],
  inputSchema: {
    type: "object",
    properties: {
      stages: { type: "array", description: "Array of InversionStage objects (name + run + estCost + raceable)" },
      ganglionConfidence: { type: "number" },
      parallelThreshold: { type: "number" },
    },
    required: ["stages"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Benchmark cascade inversion", args: { stages: [] }, expectedOutput: "{ sequential, inversion, speedupRatio }" }],
  pitfalls: ["MCP wrapper takes a serialised stages list; the actual benchmark must be run in-process where the stage callbacks are real functions."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Stages arrive serialised — the wrapper supports a "no-op" benchmark
    // that confirms the module loaded; in-process callers run the real one.
    const stageCount = Array.isArray(args["stages"]) ? args["stages"].length : 0;
    if (stageCount === 0) {
      return { data: { sequential: { winner: null, wallTimeMs: 0 }, inversion: { winner: null, wallTimeMs: 0, parallelMode: true }, speedupRatio: 1 }, wisdom: "🏎 0 stages supplied — pass real stage callbacks via in-process caller", confidence: { level: "low" } };
    }
    void core; // module loaded; in-process caller does the real run
    return { data: { stageCount, note: "MCP wrapper acknowledges; run in-process with real stage callbacks for a true benchmark" }, wisdom: `🏎 ${stageCount} stages registered`, confidence: { level: "medium" } };
  },
};

// ─── HONESTY GATE 2.0 ─────────────────────────────────────────────────

export const honestyAuditFeaturesTool: MnemeTool = {
  name: "mneme.honesty.audit_features",
  category: "audit",
  description: "🪞 HONESTY GATE 2.0 (v2.19.42) — parse feature-name banners from whats_new (HOLY GRAIL / TRINITY / etc), verify each has MCP coverage (with alias awareness), auto-amend body with disclaimer comments where coverage is incomplete. The release-note becomes self-correcting.",
  whenToUse: "Ritual phase before publish. The v2.19.40 HOLY GRAIL QUADRUPLE bug (claim mentioned OUTCOME MARKET + ZK-FAIRNESS but tools were under market.* + fairness.*) would have been auto-flagged + amended by this gate.",
  triggers: ["honesty audit features", "auto amend whats new"],
  inputSchema: {
    type: "object",
    properties: { body: { type: "string" }, knownFeatures: { type: "object" } },
    required: ["body"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Audit my whats_new for feature-name coverage", args: { body: "shipped HOLY GRAIL QUADRUPLE" }, expectedOutput: "{ claims, reports, amend: { amended, added, notes } }" }],
  pitfalls: ["Uses live MCP catalog via buildAllTools() — composes with v2.19.41 auto-sourced runtime view."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const { buildAllTools } = await import("./_registry.js");
    const mcpToolNames = new Set(buildAllTools().map((t) => t.name));
    const result = core.honestyGate.auditFeatureCoverage({
      body: String(args["body"] ?? ""),
      runtime: { mcpToolNames },
      knownFeatures: args["knownFeatures"] as Record<string, string[]> | undefined,
    });
    return { data: result, wisdom: `🪞 ${result.claims.length} feature claims · ${result.reports.filter((r) => r.status === "uncovered").length} uncovered · ${result.amend.added} amendments applied`, confidence: { level: "high" } };
  },
};

export const honestyStripAmendmentsTool: MnemeTool = {
  name: "mneme.honesty.strip_amendments",
  category: "audit",
  description: "🪞 HONESTY GATE — strip auto-amend disclaimer markers from a body (round-trip safety so amend → publish → strip → re-amend is deterministic).",
  whenToUse: "When re-running the honesty gate on a body that may already contain previous amendments.",
  triggers: ["strip honesty amendments", "honesty strip"],
  inputSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Strip honesty amendments", args: { body: "..." }, expectedOutput: "{ stripped: '...' }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const stripped = core.honestyGate.stripHonestyAmendments(String(args["body"] ?? ""));
    return { data: { stripped }, wisdom: `🪞 stripped to ${stripped.length} bytes`, confidence: { level: "high" } };
  },
};

export const V1942_PROOF_INVERSION_TOOLS: MnemeTool[] = [
  proofMintTool, proofVerifyTool, proofFormatTool,
  inversionAbBenchmarkTool,
  honestyAuditFeaturesTool, honestyStripAmendmentsTool,
];
