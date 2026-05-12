/**
 * v1.77.0 -- MCP wrappers for SEAMLESS (MUFFLER voice directive).
 */

import type { MnemeTool } from "./_types.js";

export const seamlessLintTool: MnemeTool = {
  name: "mneme.seamless.lint",
  category: "meta",
  description:
    "SEAMLESS lint -- scan an AI's draft reply for voice violations (Mneme codenames, mode narration, version chatter, tool-name menus). Use as a self-check before sending replies to the user.",
  whenToUse:
    "Receiving AI calls this on its own draft when crossing a vendor boundary. Also useful for debugging 'why does my AI sound robotic'.",
  triggers: ["lint reply", "voice check", "speak human"],
  inputSchema: {
    type: "object",
    properties: {
      reply: { type: "string" },
    },
    required: ["reply"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Check this draft reply for jargon leaks",
      args: { reply: "I'll run HYPERSCAN to verify." },
      expectedOutput: "{ clean: false, issues: [...], summary: '...' }",
    },
  ],
  pitfalls: ["Short codenames (<5 chars) are skipped to reduce false positives."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reply = String(args["reply"] ?? "");
    const report = core.seamless.lintReply(reply);
    return {
      data: report,
      wisdom: report.summary,
      confidence: { level: "high" },
    };
  },
};

export const seamlessSilenceTool: MnemeTool = {
  name: "mneme.seamless.silence",
  category: "meta",
  description:
    "SEAMLESS silence -- auto-rewrite a draft reply to strip Mneme codenames + mode-narration + version chatter. Returns a cleaned version safe to send to the user.",
  whenToUse:
    "When `mneme.seamless.lint` finds violations and you want a quick auto-fix. Conservative -- replaces codenames with 'the tool', drops standby boilerplate.",
  triggers: ["silence reply", "clean draft", "strip jargon"],
  inputSchema: {
    type: "object",
    properties: { reply: { type: "string" } },
    required: ["reply"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Strip the codenames from this reply",
      args: { reply: "Standing by in Ghost Sniper mode" },
      expectedOutput: "{ cleaned: 'ready' }",
    },
  ],
  pitfalls: ["Auto-rewrite may flatten nuance. Prefer rewriting by hand once you've seen the lint report."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reply = String(args["reply"] ?? "");
    const cleaned = core.seamless.silenceJargon(reply);
    return {
      data: { original: reply, cleaned, changed: cleaned !== reply },
      wisdom: cleaned !== reply ? "jargon stripped" : "already clean",
      confidence: { level: "high" },
    };
  },
};

export const seamlessDirectiveTool: MnemeTool = {
  name: "mneme.seamless.directive",
  category: "meta",
  description:
    "SEAMLESS -- render the MUFFLER voice directive (6 rules + codename list) for manual embedding in a custom prompt. Soul prompts + parasite bridge embed it automatically.",
  whenToUse: "User builds a custom prompt template and wants the same voice rules Mneme enforces everywhere.",
  triggers: ["voice rules", "directive", "muffler"],
  inputSchema: {
    type: "object",
    properties: {
      includeCodenameList: { type: "boolean" },
      extraRules: { type: "array", items: { type: "string" } },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me the voice rules", args: {}, expectedOutput: "Markdown directive block." }],
  pitfalls: ["Directive is intentionally long enough to anchor model attention -- don't truncate."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const md = core.seamless.renderVoiceDirective({
      includeCodenameList: args["includeCodenameList"] !== false,
      extraRules: args["extraRules"] as string[] | undefined,
    });
    return {
      data: { directive: md },
      wisdom: `Voice directive (${md.length} chars).`,
      confidence: { level: "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const SEAMLESS_TOOLS: MnemeTool[] = [seamlessLintTool, seamlessSilenceTool, seamlessDirectiveTool];
