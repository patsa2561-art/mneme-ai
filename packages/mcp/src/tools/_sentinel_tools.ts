/**
 * v1.71.0 -- MCP wrappers for SENTINEL + COUNCIL + MUTATION.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const sentinelInterceptTool: MnemeTool = {
  name: "mneme.sentinel.intercept",
  category: "meta",
  description: "SENTINEL PROTOCOL -- intercept shell commands at MCP boundary. Catches dangerous patterns (rm -rf, curl|sh, fork bomb, exfil), enforces repo-scope boundary, scores risk, learns trust over time. Verdict: ALLOW / AUDIT / WARN / BLOCK with HMAC-signed audit ledger.",
  whenToUse: "Wrap EVERY shell command the AI proposes before execution. The action-firewall layer.",
  triggers: ["intercept command", "sentinel", "is this command safe", "ป้องกัน command อันตราย"],
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      vendor: { type: "string" },
      auditAlways: { type: "boolean" },
    },
    required: ["command"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Check 'rm -rf /'", args: { command: "rm -rf /" }, expectedOutput: "Decision + risk score + reasons + audit entry." }],
  pitfalls: ["This module DECIDES; it does NOT execute. Caller acts on action verdict."],
  composeWith: ["mneme.precog.intercept", "mneme.aegis.killswitch"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.sentinel.intercept(repoRootOf(rt), String(args["command"] ?? ""), {
      vendor: args["vendor"] as string | undefined,
      auditAlways: Boolean(args["auditAlways"]),
    });
    return {
      data: d,
      wisdom: d.headline,
      confidence: { level: d.action === "ALLOW" ? "high" : d.action === "BLOCK" ? "high" : "medium" },
    };
  },
};

export const sentinelBenchTool: MnemeTool = {
  name: "mneme.sentinel.bench",
  category: "meta",
  description: "Run SENTINEL bench against 20 dangerous + 15 safe synthetic commands. Reports catch rate + false-positive rate.",
  whenToUse: "Verify Sentinel after any change to the catalog or scorer.",
  triggers: ["sentinel bench"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run sentinel bench", args: {}, expectedOutput: "Catch rate + FP rate + per-corpus breakdown." }],
  pitfalls: ["Bench mutates audit log; use tmp repo for pristine."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.sentinel.runSentinelBench(repoRootOf(rt));
    const txt = core.sentinel.renderSentinelBench(r);
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
      secondBrain: { presentation: txt },
    };
  },
};

export const sentinelAuditTool: MnemeTool = {
  name: "mneme.sentinel.audit",
  category: "meta",
  description: "Summarize the Sentinel HMAC-audit ledger: total entries, action breakdown, top classes, tampered count.",
  whenToUse: "Periodic review of AI action history; investigating after an incident.",
  triggers: ["sentinel audit", "action history"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show sentinel audit", args: {}, expectedOutput: "Summary + last entry." }],
  pitfalls: ["Tampered HMAC entries flag at READ time; investigate immediately."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.sentinel.summarizeAudit(repoRootOf(rt));
    return {
      data: s,
      wisdom: s.headline,
      confidence: { level: "high" },
    };
  },
};

export const precogCouncilTool: MnemeTool = {
  name: "mneme.precog.council",
  category: "meta",
  description: "MULTI-VOICE COUNCIL -- run claim through 5 distinct verifier voices (package-pedant / temporal-paranoid / humility-zealot / citation-niggle / novelty-suspicion). Majority vote pushes PRECOG catch rate from 92.9% toward 98%+.",
  whenToUse: "When a single PRECOG pass CERTIFIED but you want a stricter cross-check.",
  triggers: ["council", "5 voices", "stricter verify"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, majority: { type: "number" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Council on 'we use typescript'", args: { claim: "we use typescript" }, expectedOutput: "5 votes + verdict." }],
  pitfalls: ["Council CAN be stricter than firewall by design; consider both verdicts."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.precog.runCouncil(repoRootOf(rt), String(args["claim"] ?? ""), {
      majority: args["majority"] as number | undefined,
    });
    return {
      data: c,
      wisdom: c.headline,
      confidence: { level: "high" },
    };
  },
};

export const precogMutationTool: MnemeTool = {
  name: "mneme.precog.mutation",
  category: "meta",
  description: "ADVERSARIAL MUTATION TEST -- if a claim got CERTIFIED, mutate one fact and re-test. If the mutant ALSO certifies, the original cert was fragile -> demote.",
  whenToUse: "After PRECOG returns CERTIFIED on a high-stakes claim; quality gate.",
  triggers: ["mutation test", "fragile cert"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mutation test on 'we use typescript'", args: { claim: "we use typescript" }, expectedOutput: "Probes + decision PASS/DEMOTE." }],
  pitfalls: ["Only meaningful on originally-CERTIFIED claims."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const claim = String(args["claim"] ?? "");
    const orig = core.precog.intercept(repoRootOf(rt), claim, { recordOnReject: false, issueCert: false });
    const m = core.precog.mutationTest(repoRootOf(rt), claim, orig);
    return {
      data: m,
      wisdom: m.headline,
      confidence: { level: "high" },
    };
  },
};

export const SENTINEL_TOOLS: MnemeTool[] = [
  sentinelInterceptTool,
  sentinelBenchTool,
  sentinelAuditTool,
  precogCouncilTool,
  precogMutationTool,
];
