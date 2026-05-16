/**
 * v2.19.10 PROOF-CARRYING + REVERSE-WRAPPER — MCP tools.
 *
 *   PROOF-CARRYING (4 tools):
 *     mneme.proof.attach          — wrap output with HMAC-signed proof
 *     mneme.proof.verify          — verify single proof
 *     mneme.proof.verify_chain    — verify ordered chain of proofs
 *     mneme.proof.fingerprint     — derive caller key from (vendor + session + repo)
 *
 *   REVERSE-WRAPPER (4 tools):
 *     mneme.suggest.next          — apply rules to current output → SuggestedNext
 *     mneme.suggest.attach        — wrap output with __suggested_next
 *     mneme.suggest.record_call   — update session call history (for loop detection)
 *     mneme.suggest.stats         — follow-through telemetry
 */

import type { MnemeTool } from "./_types.js";

// Session singleton for reverse_wrapper across calls within the same MCP server process.
// In production, AI agent supplies its own sessionId; we keep one default session here.
let defaultRwSession: import("@mneme-ai/core").reverseWrapper.ReverseWrapperSession | null = null;
async function getRwSession(sessionId: string): Promise<import("@mneme-ai/core").reverseWrapper.ReverseWrapperSession> {
  const core = await import("@mneme-ai/core");
  if (!defaultRwSession || defaultRwSession.sessionId !== sessionId) {
    defaultRwSession = new core.reverseWrapper.ReverseWrapperSession({ sessionId });
  }
  return defaultRwSession;
}

// ─── PROOF-CARRYING ─────────────────────────────────────────────────────
export const proofAttachTool: MnemeTool = {
  name: "mneme.proof.attach",
  category: "lab",
  description:
    "🔐 PROOF — wrap an output with an HMAC-signed certificate (toolName + inputSha + outputSha + callerKey + chainParent + ts). Downstream tools with requiresParentProof refuse input lacking valid proof.",
  whenToUse: "After running any tool whose output will be piped into a downstream tool that requires zero-trust chain-of-custody.",
  triggers: ["proof attach", "sign output", "chain of custody"],
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" },
      input: { type: "object" },
      output: { type: "object" },
      callerKey: { type: "string" },
      parentProof: { type: "object", description: "Optional parent ProofMetadata for chaining." },
    },
    required: ["toolName", "input", "output", "callerKey"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Sign this tool output", args: { toolName: "mneme.confessional.audit", input: {}, output: {}, callerKey: "ck-abc" }, expectedOutput: "{ data, proof: { proofId, hmac, ... } }" }],
  pitfalls: ["Chain depth capped at 32; if you approach it, you have a loop. Use fingerprintCaller() to derive callerKey deterministically."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.proofCarrying.attachProof(args as unknown as Parameters<typeof core.proofCarrying.attachProof>[0]);
    return { data: r, wisdom: core.proofCarrying.formatProofLine(r.proof), confidence: { level: "high" } };
  },
};

export const proofVerifyTool: MnemeTool = {
  name: "mneme.proof.verify",
  category: "lab",
  description:
    "🔐 PROOF — verify a single ProofedOutput: outputSha matches data + HMAC verifies. Fails on tampered data or forged sig.",
  whenToUse: "Before trusting ANY output that arrives with a proof attached. Especially before chaining further.",
  triggers: ["proof verify", "validate proof"],
  inputSchema: { type: "object", properties: { proofed: { type: "object" } }, required: ["proofed"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this proof valid?", args: { proofed: { data: {}, proof: {} } }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["ok=false with 'outputSha256 mismatch' = tampered data; with 'HMAC mismatch' = forged or wrong secret."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.proofCarrying.verifyProof(args["proofed"] as Parameters<typeof core.proofCarrying.verifyProof>[0]);
    return { data: r, wisdom: r.ok ? "🔐 PROOF · clean" : `🔐 PROOF rejected: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const proofVerifyChainTool: MnemeTool = {
  name: "mneme.proof.verify_chain",
  category: "lab",
  description:
    "🔐 PROOF — verify a CHAIN of ProofedOutputs (root → leaf order). Checks each individually + chain links + no loops + monotonically-increasing chainDepth.",
  whenToUse: "Auditing a multi-step tool call sequence; before relaying chained results to user.",
  triggers: ["proof verify chain", "chain audit"],
  inputSchema: { type: "object", properties: { proofedList: { type: "array" } }, required: ["proofedList"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this 5-step tool chain", args: { proofedList: [] }, expectedOutput: "{ ok, brokenAt?, reason?, dagDepth }" }],
  pitfalls: ["ok=false with 'chain break' = parent mismatch; with 'loop detected' = proofId reused; with 'depth not strictly increasing' = chain order wrong."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.proofCarrying.verifyChain(args["proofedList"] as Parameters<typeof core.proofCarrying.verifyChain>[0]);
    return { data: r, wisdom: r.ok ? `🔐 CHAIN · depth ${r.dagDepth} clean` : `🔐 CHAIN broken at step ${r.brokenAt}: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const proofFingerprintTool: MnemeTool = {
  name: "mneme.proof.fingerprint",
  category: "lab",
  description:
    "🔐 PROOF — derive a stable callerKey fingerprint from (vendor + sessionId + repoPath). Use as the callerKey for attach.",
  whenToUse: "Once per AI-agent session; reuse the result for every subsequent proof.attach call.",
  triggers: ["proof fingerprint", "caller key"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      sessionId: { type: "string" },
      repoPath: { type: "string" },
    },
    required: ["vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get my callerKey", args: { vendor: "claude", sessionId: "abc" }, expectedOutput: "{ callerKey: 'ck-...' }" }],
  pitfalls: ["Same (vendor + sessionId + repoPath) → same key, by design (deterministic)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const k = core.proofCarrying.fingerprintCaller(args as unknown as Parameters<typeof core.proofCarrying.fingerprintCaller>[0]);
    return { data: { callerKey: k }, wisdom: `🔐 callerKey=${k}`, confidence: { level: "high" } };
  },
};

// ─── REVERSE-WRAPPER ────────────────────────────────────────────────────
export const suggestNextTool: MnemeTool = {
  name: "mneme.suggest.next",
  category: "lab",
  description:
    "🪂 SUGGEST — apply rules to (currentTool, output) → SuggestedNext { tool, why, confidence, costEstimateUsd?, suggestedArgs?, suppressedReason? }. Loop-detected against the session's recent call history.",
  whenToUse: "After running any tool, if you want a hint about what to call next. The AI planner makes the final decision.",
  triggers: ["suggest next", "what next", "reverse wrapper"],
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      currentTool: { type: "string" },
      output: { type: "object" },
      rules: { type: "array", description: "Optional custom rules; defaults to BUILTIN_RULES." },
    },
    required: ["sessionId", "currentTool", "output"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What should I call next?", args: { sessionId: "abc", currentTool: "mneme.inverse.audit", output: { data: { verdict: "rejected" } } }, expectedOutput: "{ tool, why, confidence, sig }" }],
  pitfalls: ["Returns null when no rule fires. suppressedReason set when loop-detected (suggestion still returned for transparency, marked as suppressed)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = await getRwSession(String(args["sessionId"]));
    const rules = (args["rules"] as Array<unknown> | undefined) as Parameters<typeof session.suggestNext>[0]["rules"] | undefined ?? core.reverseWrapper.BUILTIN_RULES;
    const sn = session.suggestNext({
      currentTool: String(args["currentTool"]),
      output: args["output"],
      rules,
    });
    return { data: sn, wisdom: sn ? core.reverseWrapper.formatSuggestionLine(sn) : "🪂 SUGGEST · no rule matched", confidence: { level: sn ? (sn.suppressedReason ? "low" : "high") : "medium" } };
  },
};

export const suggestAttachTool: MnemeTool = {
  name: "mneme.suggest.attach",
  category: "lab",
  description:
    "🪂 SUGGEST — wrap an output with __suggested_next (or pass through unchanged if no rule fires). Convenience wrapper around suggest.next.",
  whenToUse: "End of every tool handler that wants to attach a hint for the AI's next call.",
  triggers: ["suggest attach", "wrap with suggestion"],
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      currentTool: { type: "string" },
      output: { type: "object" },
      rules: { type: "array" },
    },
    required: ["sessionId", "currentTool", "output"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Attach suggestion to this output", args: { sessionId: "abc", currentTool: "X", output: { v: 1 } }, expectedOutput: "{ data: {...}, __suggested_next?: {...} }" }],
  pitfalls: ["If your output's TS type is strict, the wrap returns a wider shape — narrow on the caller."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = await getRwSession(String(args["sessionId"]));
    const rules = (args["rules"] as Array<unknown> | undefined) as Parameters<typeof session.attachSuggestion>[0]["rules"] | undefined ?? core.reverseWrapper.BUILTIN_RULES;
    const wrapped = session.attachSuggestion({
      currentTool: String(args["currentTool"]),
      output: args["output"],
      rules,
    });
    return { data: wrapped, wisdom: wrapped.__suggested_next ? core.reverseWrapper.formatSuggestionLine(wrapped.__suggested_next) : "🪂 SUGGEST · no rule matched", confidence: { level: "high" } };
  },
};

export const suggestRecordCallTool: MnemeTool = {
  name: "mneme.suggest.record_call",
  category: "lab",
  description:
    "🪂 SUGGEST — record that a tool was just called in this session. Updates loop-detection state + checks pending suggestions for follow-through.",
  whenToUse: "Every time the AI agent invokes a tool; daemon can do this automatically.",
  triggers: ["suggest record", "log tool call"],
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      toolName: { type: "string" },
    },
    required: ["sessionId", "toolName"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Log that I called arena.judge", args: { sessionId: "abc", toolName: "mneme.arena.judge" }, expectedOutput: "{ ok: true, historyLength }" }],
  pitfalls: ["Idempotent — repeated calls just append. History is in-process; cleared on MCP restart."],
  handler: async (_rt, args) => {
    const session = await getRwSession(String(args["sessionId"]));
    session.recordCall(String(args["toolName"]));
    const h = session.recentHistory(8);
    return { data: { ok: true, historyLength: h.length, recent: h.map((c) => c.tool) }, wisdom: `🪂 recorded ${args["toolName"]}`, confidence: { level: "high" } };
  },
};

export const suggestStatsTool: MnemeTool = {
  name: "mneme.suggest.stats",
  category: "lab",
  description:
    "🪂 SUGGEST — follow-through telemetry: total/followed/expired/followRate/perToolBreakdown.",
  whenToUse: "Periodic check on suggestion quality + AI calibration.",
  triggers: ["suggest stats", "follow through rate"],
  inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's my follow-through rate?", args: { sessionId: "abc" }, expectedOutput: "{ followRate, perToolBreakdown }" }],
  pitfalls: ["Low follow-through could mean either: bad suggestions, or under-calibrated AI. Compare per-tool to diagnose."],
  handler: async (_rt, args) => {
    const session = await getRwSession(String(args["sessionId"]));
    const s = session.followThroughStats();
    return { data: s, wisdom: `🪂 SUGGEST STATS · followRate=${s.followRate} (${s.followed}/${s.followed + s.expired})`, confidence: { level: "high" } };
  },
};

export const V1910_PROOF_REVERSE_TOOLS: MnemeTool[] = [
  proofAttachTool, proofVerifyTool, proofVerifyChainTool, proofFingerprintTool,
  suggestNextTool, suggestAttachTool, suggestRecordCallTool, suggestStatsTool,
];
