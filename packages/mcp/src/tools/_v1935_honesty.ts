/**
 * v2.19.35 HONESTY + AUTO + DEAD-MAN + GITIGNORE — MCP tools (R1+R2+R3+R4 fixes)
 *
 *   R1 — mneme.truth.auto_check  (1-step zero-config truth verification)
 *   R3 — (no new tool; mneme.scheduler.decide now honours deadManMs internally)
 *   R4 — (no new tool; mneme.browse + mneme.suggest now register as 2-part CLI top-levels)
 *   HONESTY GATE (3 tools):
 *     mneme.honesty.parse_claims
 *     mneme.honesty.verify_claims
 *     mneme.honesty.audit_whats_new
 */

import type { MnemeTool } from "./_types.js";

export const truthAutoCheckTool: MnemeTool = {
  name: "mneme.truth.auto_check",
  category: "audit",
  description: "🛡 AUTO-CHECK (v2.19.35 R1 fix) — 1-step zero-config truth verification. Returns an EXECUTABLE PLAN (ordered MCP tool calls + final fusion) the AI agent runs end-to-end. No more 2-step caller-orchestrated dance — user just says 'verify this claim'.",
  whenToUse: "First-class verification entry point. Pair with proposeSensorPlan only when expert-mode sensor selection is needed.",
  triggers: ["truth auto check", "verify claim", "zero config truth"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, full: { type: "boolean" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this claim end-to-end", args: { claim: "mneme.handoff.snapshot exists" }, expectedOutput: "{ steps: [{step,kind,mcpTool,args,onFailure}], rationale, collectionRule }" }],
  pitfalls: ["Plan is metadata — AI agent must execute steps + collect outputs + invoke the final fuse step. collectionRule explains the exact protocol."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const plan = core.truthSensorPack.buildAutoCheckPlan({
      claim: String(args["claim"] ?? ""),
      full: Boolean(args["full"]),
    });
    return { data: plan, wisdom: plan.rationale, confidence: { level: "high" } };
  },
};

export const honestyParseClaimsTool: MnemeTool = {
  name: "mneme.honesty.parse_claims",
  category: "audit",
  description: "🪞 HONESTY (v2.19.35 R2+R4) — parse a whats_new body for verifiable claims (STARTER N→M, '+ mneme.X.Y', '+ mneme X', 'N new MCP tools', 'N compliance frameworks').",
  whenToUse: "Before publishing a release; auditor checks release notes match reality.",
  triggers: ["parse claims", "honesty parse"],
  inputSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What does this release-note claim?", args: { body: "STARTER 13→35 + mneme browse" }, expectedOutput: "[{kind, fragment, value}, ...]" }],
  pitfalls: ["Parser is conservative — only matches high-precision shapes; novel claim phrasings may be missed."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const claims = core.honestyGate.parseClaims(String(args["body"] ?? ""));
    return { data: { claims, count: claims.length }, wisdom: `🪞 parsed ${claims.length} claim(s)`, confidence: { level: "high" } };
  },
};

export const honestyVerifyClaimsTool: MnemeTool = {
  name: "mneme.honesty.verify_claims",
  category: "audit",
  description: "🪞 HONESTY — verify parsed claims against runtime view (mcpToolNames + cliCommands + starterCount + newToolsThisRelease + frameworkCount). FAIL on any violation.",
  whenToUse: "Ritual gate. Block publish on a 'lying release note'.",
  triggers: ["verify honesty", "honesty gate"],
  inputSchema: {
    type: "object",
    properties: { claims: { type: "array" }, runtime: { type: "object" } },
    required: ["claims", "runtime"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Do my release notes match reality?", args: { claims: [], runtime: {} }, expectedOutput: "{ verdict: PASS|FAIL, violations, totalClaims }" }],
  pitfalls: ["Runtime view must come from LIVE catalog (mneme tools --json), not a hardcoded list."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Convert runtime.mcpToolNames + cliCommands from arrays to Sets
    const runtimeArg = args["runtime"] as Record<string, unknown>;
    const runtime = {
      mcpToolNames: new Set(Array.isArray(runtimeArg.mcpToolNames) ? runtimeArg.mcpToolNames as string[] : []),
      cliCommands: new Set(Array.isArray(runtimeArg.cliCommands) ? runtimeArg.cliCommands as string[] : []),
      starterCount: typeof runtimeArg.starterCount === "number" ? runtimeArg.starterCount : 0,
      newToolsThisRelease: typeof runtimeArg.newToolsThisRelease === "number" ? runtimeArg.newToolsThisRelease : 0,
      frameworkCount: typeof runtimeArg.frameworkCount === "number" ? runtimeArg.frameworkCount : 0,
    };
    const verdict = core.honestyGate.verifyClaims({
      claims: args["claims"] as Parameters<typeof core.honestyGate.verifyClaims>[0]["claims"],
      runtime,
    });
    return { data: verdict, wisdom: `🪞 ${verdict.verdict} · ${verdict.violationCount} violations / ${verdict.totalClaims} claims`, confidence: { level: verdict.verdict === "PASS" ? "high" : "low" } };
  },
};

export const honestyAuditWhatsNewTool: MnemeTool = {
  name: "mneme.honesty.audit_whats_new",
  category: "audit",
  description: "🪞 HONESTY — one-call audit: parse whats_new body + verify against runtime. Returns combined verdict.",
  whenToUse: "Ritual phase before publish; CI gate.",
  triggers: ["audit whats new", "honesty audit"],
  inputSchema: {
    type: "object",
    properties: { body: { type: "string" }, runtime: { type: "object" } },
    required: ["body", "runtime"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Audit my whats_new claims", args: { body: "STARTER 13→35", runtime: { starterCount: 22 } }, expectedOutput: "{ verdict: FAIL, violations: [...] }" }],
  pitfalls: ["Combined parse+verify; for separate phases call parse_claims + verify_claims directly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const claims = core.honestyGate.parseClaims(String(args["body"] ?? ""));
    const runtimeArg = args["runtime"] as Record<string, unknown>;
    const runtime = {
      mcpToolNames: new Set(Array.isArray(runtimeArg.mcpToolNames) ? runtimeArg.mcpToolNames as string[] : []),
      cliCommands: new Set(Array.isArray(runtimeArg.cliCommands) ? runtimeArg.cliCommands as string[] : []),
      starterCount: typeof runtimeArg.starterCount === "number" ? runtimeArg.starterCount : 0,
      newToolsThisRelease: typeof runtimeArg.newToolsThisRelease === "number" ? runtimeArg.newToolsThisRelease : 0,
      frameworkCount: typeof runtimeArg.frameworkCount === "number" ? runtimeArg.frameworkCount : 0,
    };
    const verdict = core.honestyGate.verifyClaims({ claims, runtime });
    return { data: { claims, verdict }, wisdom: `🪞 ${verdict.verdict} · ${verdict.violationCount}/${verdict.totalClaims}`, confidence: { level: verdict.verdict === "PASS" ? "high" : "low" } };
  },
};

export const V1935_HONESTY_TOOLS: MnemeTool[] = [
  truthAutoCheckTool,
  honestyParseClaimsTool,
  honestyVerifyClaimsTool,
  honestyAuditWhatsNewTool,
];
