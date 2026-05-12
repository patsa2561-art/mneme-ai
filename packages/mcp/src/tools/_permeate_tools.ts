/**
 * v1.74.0 -- MCP wrappers for PERMEATE PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const permeateUserscriptTool: MnemeTool = {
  name: "mneme.permeate.userscript",
  category: "meta",
  description: "PERMEATE -- generate a Tampermonkey/Greasemonkey/Violentmonkey userscript that adds a 💉 'Inject Mneme Soul' button to ChatGPT / Gemini / Claude.ai / Copilot / DeepSeek / Qwen. NO store approval needed; user installs the userscript manager once.",
  whenToUse: "User wants to inject soul prompts via a button instead of paste; works in browser-only AIs.",
  triggers: ["userscript", "tampermonkey", "inject button"],
  inputSchema: {
    type: "object",
    properties: {
      mnemeVersion: { type: "string" },
      bridgeUrl: { type: "string" },
      bridgeToken: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Make me a Tampermonkey script", args: {}, expectedOutput: "Userscript content + filename + install note." }],
  pitfalls: ["User must install Tampermonkey/Violentmonkey first."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.permeate.generateUserscript({
      mnemeVersion: (args["mnemeVersion"] as string | undefined) ?? "1.74.0",
      bridgeUrl: args["bridgeUrl"] as string | undefined,
      bridgeToken: args["bridgeToken"] as string | undefined,
    });
    return {
      data: a,
      wisdom: `Userscript ready (${a.filename}). ${a.installNote}`,
      confidence: { level: "high" },
      secondBrain: { presentation: a.content },
    };
  },
};

export const permeateBookmarkletTool: MnemeTool = {
  name: "mneme.permeate.bookmarklet",
  category: "meta",
  description: "PERMEATE -- generate a single-line javascript: bookmarklet. Drag to bookmark bar; click on any AI chat page; prompts to paste soul prompt; injects + alerts to press Send.",
  whenToUse: "Simplest alternative to userscript -- no Tampermonkey install needed.",
  triggers: ["bookmarklet", "single bookmark", "drag to bar"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me a bookmarklet", args: {}, expectedOutput: "javascript: URI + install steps." }],
  pitfalls: ["Some sites block javascript: URIs via CSP; userscript (P1) is more reliable."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const a = core.permeate.generateBookmarklet();
    return {
      data: a,
      wisdom: `Bookmarklet ready (${a.uri.length} chars).${a.warning ? ` WARN: ${a.warning}` : ""}`,
      confidence: { level: a.warning ? "medium" : "high" },
      secondBrain: { presentation: a.instructions.join("\n") },
    };
  },
};

export const permeateIntegrationsTool: MnemeTool = {
  name: "mneme.permeate.integrations",
  category: "meta",
  description: "PERMEATE -- summarize how Mneme connects to every supported AI tool (15+ tracked). Editor-based tools (Cursor / Continue / Cline / Aider / Zed / Claude Code) work via MCP automatically; browser-only chats need paste OR the userscript.",
  whenToUse: "User asks 'does Mneme work with X editor / chat?'",
  triggers: ["does mneme work with", "editor integration", "supported tools"],
  inputSchema: { type: "object", properties: { status: { type: "string" }, surface: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Does Mneme work with Cursor?", args: { surface: "editor-extension" }, expectedOutput: "Matrix filtered to editor tools." }],
  pitfalls: ["Status snapshot; emergent tools added periodically."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const report = core.permeate.reportIntegrations();
    const filtered = core.permeate.filterIntegrations({
      status: args["status"] as "working" | "partial" | "manual-setup" | "needs-paste" | undefined,
      surface: args["surface"] as "editor-extension" | "cli" | "web" | "desktop-app" | undefined,
    });
    return {
      data: { report, integrations: filtered },
      wisdom: report.headline,
      confidence: { level: "high" },
    };
  },
};

export const permeateTransportTool: MnemeTool = {
  name: "mneme.permeate.transport",
  category: "meta",
  description: "PERMEATE -- recommend the best cross-machine transport for moving a soul prompt (clipboard / Gist / Wanderer .mwt / QR code). Returns ranked options + step-by-step instructions.",
  whenToUse: "User wants to move context between 2 computers.",
  triggers: ["transport menu", "cross-machine transfer", "how do I move brain"],
  inputSchema: {
    type: "object",
    properties: {
      hasGithubAccount: { type: "boolean" },
      preferOffline: { type: "boolean" },
      laptopToPhone: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How do I move brain to my Mac?", args: { hasGithubAccount: true }, expectedOutput: "Gist recommended + 4 options ranked." }],
  pitfalls: ["Friction scores are relative to typical UX; YMMV."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.permeate.recommendTransport({
      hasGithubAccount: Boolean(args["hasGithubAccount"]),
      preferOffline: Boolean(args["preferOffline"]),
      laptopToPhone: Boolean(args["laptopToPhone"]),
    });
    return {
      data: r,
      wisdom: `Recommended: ${r.recommended} — ${r.rationale}`,
      confidence: { level: "high" },
    };
  },
};

export const PERMEATE_TOOLS: MnemeTool[] = [
  permeateUserscriptTool,
  permeateBookmarkletTool,
  permeateIntegrationsTool,
  permeateTransportTool,
];
