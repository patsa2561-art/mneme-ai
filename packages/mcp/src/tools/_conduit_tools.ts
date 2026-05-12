/**
 * v1.80.0 -- MCP wrappers for CONDUIT PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const conduitDetectTool: MnemeTool = {
  name: "mneme.conduit.detect_relay",
  category: "meta",
  description:
    "CONDUIT detect -- check whether a user prompt requires action only the source AI can run (upgrade / uninstall / shell / filesystem / MCP-call). Web AIs read this to avoid fake-executing.",
  whenToUse: "Run on every user prompt when the AI is paste-only (web surface). If detected, emit a CONDUIT RETURN instead of freelancing.",
  triggers: ["detect relay", "is this for source AI"],
  inputSchema: {
    type: "object",
    properties: { userPrompt: { type: "string" } },
    required: ["userPrompt"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Does 'upgrade mneme' need to be relayed?", args: { userPrompt: "upgrade mneme" }, expectedOutput: "{ detected: true, kind: 'system.upgrade' }" },
  ],
  pitfalls: ["Detection is intentionally conservative; some prompts may slip through and need user disambiguation."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.conduit.detectRelayAction(String(args["userPrompt"] ?? ""));
    return {
      data: d,
      wisdom: d.detected ? `relay needed: ${d.kind}` : "no relay needed",
      confidence: { level: "high" },
    };
  },
};

export const conduitIngestReturnTool: MnemeTool = {
  name: "mneme.conduit.ingest_return",
  category: "meta",
  description:
    "CONDUIT ingest -- parse a pasted `# CONDUIT RETURN` block from a web AI and surface the requested action so the source AI can execute it.",
  whenToUse: "After the user pastes a return block from ChatGPT/Gemini back into their editor AI.",
  triggers: ["ingest conduit", "conduit return"],
  inputSchema: {
    type: "object",
    properties: { pastedText: { type: "string" } },
    required: ["pastedText"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Ingest this return from ChatGPT", args: { pastedText: "# CONDUIT RETURN\n..." }, expectedOutput: "{ requestedAction: 'system.upgrade', ... }" },
  ],
  pitfalls: ["Returns null if block is malformed; ask user to re-copy."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const parsed = core.conduit.parseConduitReturn(String(args["pastedText"] ?? ""));
    return {
      data: parsed,
      wisdom: parsed ? `ingest ok: ${parsed.requestedAction} from ${parsed.returningFrom}` : "no CONDUIT RETURN block found",
      confidence: { level: parsed ? "high" : "medium" },
    };
  },
};

export const conduitUninstallPlanTool: MnemeTool = {
  name: "mneme.conduit.uninstall_plan",
  category: "meta",
  description:
    "CONDUIT -- generate a per-surface uninstall plan (editor-ai / web-ai / browser-userscript / browser-bookmarklet / all). Plain-English steps + commands + post-check.",
  whenToUse: "User asks 'how do I remove Mneme from <X>'.",
  triggers: ["uninstall plan", "how to remove mneme", "ถอน mneme ออกยังไง"],
  inputSchema: {
    type: "object",
    properties: {
      surface: { type: "string", enum: ["editor-ai", "web-ai", "browser-userscript", "browser-bookmarklet", "all"] },
    },
    required: ["surface"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Uninstall Mneme from Cursor", args: { surface: "editor-ai" }, expectedOutput: "Plan steps + estimated time." },
  ],
  pitfalls: ["Web-AI plan estimate is 0 minutes because nothing was installed; the soul prompt is just text."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const surface = args["surface"] as "editor-ai" | "web-ai" | "browser-userscript" | "browser-bookmarklet" | "all";
    const plan = core.conduit.uninstallPlan(surface);
    const md = core.conduit.renderUninstallPlan(plan);
    return {
      data: plan,
      wisdom: `${plan.steps.length}-step plan, ~${plan.estimateMinutes}min`,
      confidence: { level: "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const conduitSyncStatusTool: MnemeTool = {
  name: "mneme.conduit.sync_status",
  category: "meta",
  description:
    "CONDUIT -- compare a pasted soul's Mneme version against local Mneme. Returns sync state: in-sync / source-newer / destination-newer / unknown + a recommendation.",
  whenToUse: "Before trusting a pasted soul prompt: surface mismatches so the user knows whether to upgrade local or regenerate the soul.",
  triggers: ["sync status", "are we in sync", "version mismatch"],
  inputSchema: {
    type: "object",
    properties: {
      soulVersion: { type: "string" },
      localVersion: { type: "string" },
      npmLatest: { type: "string" },
    },
    required: ["soulVersion", "localVersion"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Soul is 1.78, local is 1.80 -- in sync?", args: { soulVersion: "1.78.0", localVersion: "1.80.0" }, expectedOutput: "{ status: 'destination-newer' }" },
  ],
  pitfalls: ["Missing version info → status='unknown'; act conservatively."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.conduit.computeSyncStatus({
      soulVersion: String(args["soulVersion"] ?? ""),
      localVersion: String(args["localVersion"] ?? ""),
      npmLatest: args["npmLatest"] as string | undefined,
    });
    return {
      data: r,
      wisdom: r.summary + " · " + r.recommendation,
      confidence: { level: r.status === "unknown" ? "low" : "high" },
    };
  },
};

export const conduitPhantomTool: MnemeTool = {
  name: "mneme.conduit.phantom_directive",
  category: "meta",
  description:
    "CONDUIT phantom -- render the PHANTOM EXECUTION directive for embedding in custom prompts. Web AIs use this to PREVIEW a Mneme tool's likely output without actually executing.",
  whenToUse: "Building a custom paste-only AI workflow where conceptual previews are useful before the real-exec round-trip.",
  triggers: ["phantom directive", "preview tool output"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me the phantom directive", args: {}, expectedOutput: "Markdown directive block." }],
  pitfalls: ["Phantom previews are NOT real execution. Always include the disclaimer."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const md = core.conduit.renderPhantomDirective();
    return {
      data: { directive: md },
      wisdom: `Phantom directive (${md.length} chars).`,
      confidence: { level: "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const CONDUIT_TOOLS: MnemeTool[] = [
  conduitDetectTool,
  conduitIngestReturnTool,
  conduitUninstallPlanTool,
  conduitSyncStatusTool,
  conduitPhantomTool,
];
