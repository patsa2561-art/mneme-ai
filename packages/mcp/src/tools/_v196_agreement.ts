/**
 * v2.19.6 CONVERSATION COMPILER — MCP tools.
 *
 *   mneme.agreement.compile           — transcript → signed agreement
 *   mneme.agreement.run               — run agreement against target diff
 *   mneme.agreement.verify_pair       — HMAC pair-lock check
 *   mneme.agreement.list              — list persisted agreements
 *   mneme.agreement.pre_commit_hook   — generate pre-commit hook script
 */

import type { MnemeTool } from "./_types.js";

export const agreementCompileTool: MnemeTool = {
  name: "mneme.agreement.compile",
  category: "lab",
  description:
    "📜 AGREEMENT — compile a chat transcript into a deterministic + signed + callable Agreement artifact. Decisions auto-extracted (EN+TH); pattern checkers attached; HMAC pair-locks (transcript + generated source).",
  whenToUse: "End of any decision-making conversation. The decisions become executable code; future sessions import the artifact instead of re-discussing.",
  triggers: ["agreement compile", "compile agreement", "lock decisions", "บันทึก agreement"],
  inputSchema: {
    type: "object",
    properties: {
      transcript: { type: "string" },
      name: { type: "string" },
      proposedBy: { type: "string" },
      compiledAt: { type: "string", description: "ISO ts; defaults to now. Pass a fixed ts for deterministic re-compile." },
    },
    required: ["transcript", "name"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compile this chat as an agreement called 'team-rules'", args: { transcript: "Every commit must have a test.", name: "team-rules" }, expectedOutput: "{ agreementId, decisions, generatedSource, sig }" }],
  pitfalls: ["A transcript with NO recognised patterns produces an agreement with 0 auto-checkers + only 'manual' stubs. Add patterns to the registry over time."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.conversationCompiler.compileAgreement(args as unknown as Parameters<typeof core.conversationCompiler.compileAgreement>[0]);
    return { data: a, wisdom: core.conversationCompiler.formatAgreementLine(a), confidence: { level: a.decisions.length > 0 ? "high" : "low" } };
  },
};

export const agreementRunTool: MnemeTool = {
  name: "mneme.agreement.run",
  category: "lab",
  description:
    "📜 AGREEMENT — run an agreement's checkers against a target {filesChanged, diffText, branch, commitMessage}. Returns per-decision CheckResult with severity (info/warn/block).",
  whenToUse: "Pre-commit, CI, pre-merge gate. Any time before action that should respect the agreement.",
  triggers: ["agreement run", "check agreement", "run agreement against diff"],
  inputSchema: {
    type: "object",
    properties: {
      agreement: { type: "object" },
      target: { type: "object" },
    },
    required: ["agreement", "target"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run my agreement against the staged diff", args: { agreement: {}, target: { filesChanged: ["src/foo.ts"], diffText: "...", branch: "feature" } }, expectedOutput: "{ results: [{ decisionText, pattern, ok, reason, severity }] }" }],
  pitfalls: ["Always pass branch + diffText if available; some checkers (no_direct_push_main, no_console_log) need them."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const results = core.conversationCompiler.runAgreement(args as unknown as Parameters<typeof core.conversationCompiler.runAgreement>[0]);
    return { data: { results }, wisdom: core.conversationCompiler.formatCheckSummary(results), confidence: { level: results.every((r) => r.ok) ? "high" : "low" } };
  },
};

export const agreementVerifyPairTool: MnemeTool = {
  name: "mneme.agreement.verify_pair",
  category: "lab",
  description:
    "📜 AGREEMENT — verify the HMAC pair-lock over (transcript + agreement). Catches tampering of EITHER side.",
  whenToUse: "Before trusting an agreement loaded from disk or shared from another machine.",
  triggers: ["agreement verify", "verify pair-lock"],
  inputSchema: {
    type: "object",
    properties: {
      agreement: { type: "object" },
      transcript: { type: "string" },
    },
    required: ["agreement", "transcript"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this agreement still valid?", args: { agreement: {}, transcript: "..." }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["A 'transcript sha256 mismatch' often means you supplied the wrong transcript file, not actual tampering."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.conversationCompiler.verifyAgreementPair(args as unknown as Parameters<typeof core.conversationCompiler.verifyAgreementPair>[0]);
    return { data: r, wisdom: r.ok ? "📜 AGREEMENT pair-lock OK" : `📜 AGREEMENT pair-lock FAILED: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const agreementListTool: MnemeTool = {
  name: "mneme.agreement.list",
  category: "lab",
  description:
    "📜 AGREEMENT — list all persisted agreement JSON files in the default or specified directory.",
  whenToUse: "User asks 'what have we agreed on?'.",
  triggers: ["agreement list", "list agreements"],
  inputSchema: { type: "object", properties: { baseDir: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What agreements does this repo have?", args: {}, expectedOutput: "{ paths: ['.mneme/agreements/ag-xxx.json', ...] }" }],
  pitfalls: ["Returns paths; load each to see decisions count + names."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const paths = core.conversationCompiler.listAgreements(args["baseDir"] ? String(args["baseDir"]) : undefined);
    return { data: { paths }, wisdom: `📜 AGREEMENT · ${paths.length} agreement(s) persisted`, confidence: { level: "high" } };
  },
};

export const agreementPreCommitHookTool: MnemeTool = {
  name: "mneme.agreement.pre_commit_hook",
  category: "lab",
  description:
    "📜 AGREEMENT — generate a pre-commit-hook script that loads the agreement, runs checkers against the staged diff, and exits 1 on any BLOCKED check.",
  whenToUse: "After compiling an agreement; install once with `chmod +x` + `git config core.hooksPath`.",
  triggers: ["agreement hook", "pre-commit hook", "generate hook"],
  inputSchema: {
    type: "object",
    properties: {
      agreementJsonPath: { type: "string" },
      transcriptPath: { type: "string" },
    },
    required: ["agreementJsonPath", "transcriptPath"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Generate a pre-commit hook for this agreement", args: { agreementJsonPath: "/p/ag.json", transcriptPath: "/p/ag.transcript.txt" }, expectedOutput: "{ hook: '#!/usr/bin/env node ...' }" }],
  pitfalls: ["The generated script imports @mneme-ai/core/conversation_compiler — ensure that's installed in the repo running the hook."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const hook = core.conversationCompiler.generatePreCommitHook(args as unknown as Parameters<typeof core.conversationCompiler.generatePreCommitHook>[0]);
    return { data: { hook }, wisdom: "📜 AGREEMENT pre-commit hook generated", confidence: { level: "high" } };
  },
};

export const V196_AGREEMENT_TOOLS: MnemeTool[] = [
  agreementCompileTool,
  agreementRunTool,
  agreementVerifyPairTool,
  agreementListTool,
  agreementPreCommitHookTool,
];
