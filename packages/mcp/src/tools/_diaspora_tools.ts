/**
 * v1.72.0 -- MCP wrappers for DIASPORA PROTOCOL.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const diasporaGitignoreTool: MnemeTool = {
  name: "mneme.diaspora.gitignore",
  category: "meta",
  description: "GHOST SNIPER GITIGNORE -- ensure every AI-tooling artifact (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/, .windsurf, .aider, .codeium, .continue) is auto-listed in .gitignore. Idempotent. Closes the privacy-leak gap where AGENTS.md / GEMINI.md were getting committed.",
  whenToUse: "First-run setup; periodic verification; after a new AI vendor is detected.",
  triggers: ["fix gitignore", "ghost sniper", "auto-gitignore"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Auto-gitignore AI artifacts", args: {}, expectedOutput: "Created/updated .gitignore with managed entries." }],
  pitfalls: ["Idempotent; safe to call repeatedly."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.diaspora.ensureGitignoreEntries(repoRootOf(rt));
    return {
      data: r,
      wisdom: `gitignore ${r.action}: ${r.detail}`,
      confidence: { level: "high" },
    };
  },
};

export const diasporaSporeTool: MnemeTool = {
  name: "mneme.diaspora.spore",
  category: "meta",
  description: "SPORE DEFAULT-ON -- if the repo has a git remote, auto-enable cross-machine wisdom sync. The remote URL becomes the cross-machine identity, no config needed.",
  whenToUse: "First-run setup; after `git remote add origin ...`.",
  triggers: ["spore", "enable cross-machine sync"],
  inputSchema: { type: "object", properties: { force: { type: "boolean" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Enable spore", args: {}, expectedOutput: "enabled true|false + reason + remote info." }],
  pitfalls: ["Won't enable on repos without a git remote (correct UX)."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.diaspora.autoStartSpore(repoRootOf(rt), { force: Boolean(args["force"]) });
    return {
      data: r,
      wisdom: `Spore ${r.enabled ? "ENABLED" : "off"}: ${r.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const diasporaCapsuleSaveTool: MnemeTool = {
  name: "mneme.diaspora.capsule.save",
  category: "meta",
  description: "PORTABLE SESSION CAPSULE -- save current session context to an HMAC-signed .capsule file that any other vendor (Claude->Cursor, Cursor->Codex) can resume from.",
  whenToUse: "User wants to hand-off context to a different AI tool / different machine.",
  triggers: ["save session", "save capsule", "handover to other AI"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      contextSummary: { type: "string" },
      promptTrace: { type: "array" },
      decisions: { type: "array", items: { type: "string" } },
      reasoningTrace: { type: "array", items: { type: "string" } },
    },
    required: ["vendor", "contextSummary"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Save current session", args: { vendor: "claude", contextSummary: "Investigating bug X" }, expectedOutput: "Capsule id + path." }],
  pitfalls: ["Capsule HMAC binds to issuing repo; cross-repo resume invalidates."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const cap = core.diaspora.saveCapsule(repoRootOf(rt), {
      vendor: String(args["vendor"] ?? "unknown"),
      contextSummary: String(args["contextSummary"] ?? ""),
      promptTrace: (args["promptTrace"] ?? []) as Array<import("@mneme-ai/core").diaspora.sessionCapsule.CapsulePromptStep>,
      decisions: (args["decisions"] ?? undefined) as string[] | undefined,
      reasoningTrace: (args["reasoningTrace"] ?? undefined) as string[] | undefined,
    });
    return {
      data: cap,
      wisdom: `Capsule ${cap.id} saved; ${cap.promptTrace.length} steps; ${cap.decisions?.length ?? 0} decision(s).`,
      confidence: { level: "high" },
    };
  },
};

export const diasporaCapsuleResumeTool: MnemeTool = {
  name: "mneme.diaspora.capsule.resume",
  category: "meta",
  description: "Resume a session capsule in the current vendor. Verifies HMAC, records inheritance event to ai-souls, returns multi-line recap the agent can quote.",
  whenToUse: "On startup of a new session in a different vendor; user says 'resume from yesterday'.",
  triggers: ["resume session", "load capsule", "inherit context"],
  inputSchema: {
    type: "object",
    properties: { capsuleId: { type: "string" }, toVendor: { type: "string" } },
    required: ["capsuleId", "toVendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Resume capsule abc123", args: { capsuleId: "abc123", toVendor: "cursor" }, expectedOutput: "Verdict + recap." }],
  pitfalls: ["INVALID_HMAC = tampered; NOT_FOUND = wrong id; EXPIRED = capsule too old."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.diaspora.resumeCapsule(repoRootOf(rt), String(args["capsuleId"] ?? ""), {
      toVendor: String(args["toVendor"] ?? "unknown"),
    });
    return {
      data: r,
      wisdom: `Capsule ${args["capsuleId"]}: ${r.verdict}.${r.inheritance ? ` Inherited from ${r.inheritance.fromVendor}.` : ""}`,
      confidence: { level: r.verdict === "RESUMED" ? "high" : "low" },
      secondBrain: { presentation: r.recap },
    };
  },
};

export const diasporaBridgeTool: MnemeTool = {
  name: "mneme.diaspora.bridge.template",
  category: "meta",
  description: "Return the Custom GPT template JSON (and OpenAPI spec endpoint) for ChatGPT integration. User uploads the template into the Custom GPT 'Actions' configuration to wire ChatGPT to local Mneme firewalls.",
  whenToUse: "When user wants to wire ChatGPT (Custom GPT) to local Mneme.",
  triggers: ["custom gpt", "chatgpt bridge", "openapi template"],
  inputSchema: {
    type: "object",
    properties: { baseUrl: { type: "string" }, token: { type: "string" } },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get the Custom GPT template", args: { baseUrl: "https://my-tunnel.com" }, expectedOutput: "Template JSON to paste into Custom GPT." }],
  pitfalls: ["Token is per-repo; never share publicly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const baseUrl = String(args["baseUrl"] ?? "http://127.0.0.1:11434");
    const token = String(args["token"] ?? "<your-token>");
    const tpl = core.diaspora.customGptTemplate(baseUrl, token);
    const spec = core.diaspora.openapiSpec(baseUrl);
    return {
      data: { template: JSON.parse(tpl), openapi: spec, baseUrl },
      wisdom: `Custom GPT template for ${baseUrl} -- paste data.template into your GPT's Actions config.`,
      confidence: { level: "high" },
    };
  },
};

export const DIASPORA_TOOLS: MnemeTool[] = [
  diasporaGitignoreTool,
  diasporaSporeTool,
  diasporaCapsuleSaveTool,
  diasporaCapsuleResumeTool,
  diasporaBridgeTool,
];
