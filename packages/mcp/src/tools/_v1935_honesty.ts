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

/**
 * v2.19.41 — build the LIVE runtime view from the local MCP catalog so the
 * caller never has to supply one. Pre-v2.19.41 the tool required the caller
 * to compute mcpToolNames + cliCommands + starterCount themselves and crashed
 * if any field was missing. The whole point of the gate is one-call audit —
 * pull the runtime view from what's actually loaded right now.
 */
async function buildLiveRuntimeView(): Promise<{
  mcpToolNames: Set<string>;
  cliCommands: Set<string>;
  starterCount: number;
  newToolsThisRelease: number;
  frameworkCount: number;
}> {
  const { buildAllTools } = await import("./_registry.js");
  const tools = buildAllTools();
  const toolNames = new Set(tools.map((t) => t.name));
  // CLI commands are the 1-part stems users type after `mneme`.
  const cli = new Set<string>();
  for (const n of toolNames) {
    const parts = n.split(".");
    if (parts.length >= 2) cli.add(parts[1]!);
  }
  // STARTER count: tools with category starter-ish + handful manually surfaced.
  const starter = tools.filter((t) => (t as { tier?: string }).tier === "starter").length;
  // Frameworks fixed at 6 (SOC2 / ISO 27001 / EU AI Act / GDPR / HIPAA / Thai PDPA).
  return {
    mcpToolNames: toolNames,
    cliCommands: cli,
    starterCount: starter || tools.filter((t) => t.name.split(".")[1] === "welcome" || t.name.split(".")[1] === "verify" || t.name.split(".")[1] === "ask").length,
    newToolsThisRelease: 0,
    frameworkCount: 6,
  };
}

function coerceRuntimeArg(runtimeArg: unknown, live: Awaited<ReturnType<typeof buildLiveRuntimeView>>): Awaited<ReturnType<typeof buildLiveRuntimeView>> {
  // Caller-supplied runtime overrides live; missing fields fall through to live.
  if (!runtimeArg || typeof runtimeArg !== "object") return live;
  const r = runtimeArg as Record<string, unknown>;
  return {
    mcpToolNames: Array.isArray(r.mcpToolNames) ? new Set(r.mcpToolNames as string[]) : live.mcpToolNames,
    cliCommands: Array.isArray(r.cliCommands) ? new Set(r.cliCommands as string[]) : live.cliCommands,
    starterCount: typeof r.starterCount === "number" ? r.starterCount : live.starterCount,
    newToolsThisRelease: typeof r.newToolsThisRelease === "number" ? r.newToolsThisRelease : live.newToolsThisRelease,
    frameworkCount: typeof r.frameworkCount === "number" ? r.frameworkCount : live.frameworkCount,
  };
}

export const honestyVerifyClaimsTool: MnemeTool = {
  name: "mneme.honesty.verify_claims",
  category: "audit",
  description: "🪞 HONESTY — verify parsed claims against runtime view (mcpToolNames + cliCommands + starterCount + newToolsThisRelease + frameworkCount). v2.19.41 auto-sources the runtime from the LIVE MCP catalog so callers don't have to supply it.",
  whenToUse: "Ritual gate. Block publish on a 'lying release note'. Caller can pass runtime={} to use the live catalog.",
  triggers: ["verify honesty", "honesty gate"],
  inputSchema: {
    type: "object",
    properties: { claims: { type: "array" }, runtime: { type: "object" } },
    required: ["claims"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Do my release notes match reality?", args: { claims: [] }, expectedOutput: "{ verdict: PASS|FAIL, violations, totalClaims }" }],
  pitfalls: ["v2.19.41+ auto-sources runtime from the live MCP catalog. To override, pass runtime={mcpToolNames:[...], cliCommands:[...], ...}."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const live = await buildLiveRuntimeView();
    const runtime = coerceRuntimeArg(args["runtime"], live);
    const verdict = core.honestyGate.verifyClaims({
      claims: (args["claims"] ?? []) as Parameters<typeof core.honestyGate.verifyClaims>[0]["claims"],
      runtime,
    });
    return { data: verdict, wisdom: `🪞 ${verdict.verdict} · ${verdict.violationCount} violations / ${verdict.totalClaims} claims`, confidence: { level: verdict.verdict === "PASS" ? "high" : "low" } };
  },
};

export const honestyAuditWhatsNewTool: MnemeTool = {
  name: "mneme.honesty.audit_whats_new",
  category: "audit",
  description: "🪞 HONESTY — one-call audit: parse whats_new body + verify against runtime. v2.19.41 auto-sources the runtime from the LIVE MCP catalog so the caller can pass just `{ body: '...' }`. Returns combined verdict.",
  whenToUse: "Ritual phase before publish; CI gate. One-call audit by design.",
  triggers: ["audit whats new", "honesty audit"],
  inputSchema: {
    type: "object",
    properties: { body: { type: "string" }, runtime: { type: "object" } },
    required: ["body"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Audit my whats_new claims", args: { body: "STARTER 13→35" }, expectedOutput: "{ verdict, violations: [...] }" }],
  pitfalls: ["v2.19.41+ auto-sources runtime from the live catalog when not supplied; pre-v2.19.41 the missing-runtime case threw 'Cannot read properties of undefined (reading mcpToolNames)' — fixed at source."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const claims = core.honestyGate.parseClaims(String(args["body"] ?? ""));
    const live = await buildLiveRuntimeView();
    const runtime = coerceRuntimeArg(args["runtime"], live);
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
