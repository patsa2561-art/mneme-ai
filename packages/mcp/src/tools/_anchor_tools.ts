/**
 * v1.88.0 -- MCP wrappers for ANCHOR PROTOCOL.
 */

import { resolve } from "node:path";

import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const anchorPoleTool: MnemeTool = {
  name: "mneme.anchor.pole",
  category: "meta",
  description:
    "ANCHOR -- read or create the parent-pole identity for this repo. Pole = stable HMAC identity that signs rope tokens issued to children (Cursor / mobile / iPad / etc).",
  whenToUse: "First-run setup; whenever a child needs a fresh rope token; whenever you want to display the pole ID to the user.",
  triggers: ["who is the pole", "show pole id", "parent identity"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show my parent pole id", args: {}, expectedOutput: "{ point: { poleId, publicKey, createdAt } }" }],
  pitfalls: ["The secret part of the pole is NEVER returned via MCP -- only the public point. Secret stays in .mneme/anchor/pole-secret.json."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.anchor.ensurePole(repoRootOf(rt));
    return {
      data: { point: r.point },
      wisdom: `pole ${r.point.poleId} created ${r.point.createdAt}`,
      confidence: { level: "high" },
    };
  },
};

export const anchorIssueRopeTool: MnemeTool = {
  name: "mneme.anchor.issue_rope",
  category: "meta",
  description:
    "ANCHOR -- mint a signed rope token for a child device. The rope proves the child is rooted to this pole; lets it sync with sibling children + receive upgrade notifications.",
  whenToUse: "Each time a new device joins the user's brain (phone / iPad / second laptop). One rope per child.",
  triggers: ["issue rope", "new child", "give rope to mobile"],
  inputSchema: {
    type: "object",
    properties: {
      childId: { type: "string" },
      ttlMs: { type: "integer" },
      scope: { type: "array", items: { type: "string" } },
    },
    required: ["childId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint a rope for my phone", args: { childId: "phone-android-1" }, expectedOutput: "{ rope: { poleId, childId, expiresAt, sig } }" }],
  pitfalls: ["Default TTL 30d. Long-lived ropes are convenient but lower the cost of compromise -- pick the shortest TTL that fits the use case."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const { secret } = core.anchor.ensurePole(repoRootOf(rt));
    const rope = core.anchor.issueRope(secret, String(args["childId"] ?? "anonymous-child"), {
      ttlMs: args["ttlMs"] as number | undefined,
      scope: args["scope"] as ("sync" | "resume" | "upgrade-notify")[] | undefined,
    });
    return {
      data: rope,
      wisdom: `rope for ${rope.childId} (expires ${rope.expiresAt})`,
      confidence: { level: "high" },
    };
  },
};

export const anchorClipboardTool: MnemeTool = {
  name: "mneme.anchor.clipboard_write",
  category: "meta",
  description:
    "ANCHOR -- write the handoff prompt to the local clipboard. Phone Link / Universal Clipboard / KDE Connect (if configured) automatically mirrors it to the user's phone. Phone flow: long-press → paste → send.",
  whenToUse: "Cross-device handover when the user wants the lowest-friction path. Combine with QR for users without clipboard sync.",
  triggers: ["copy to clipboard", "send to my phone clipboard", "clipboard handoff"],
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Put this on my phone clipboard", args: { text: "Fetch ..." }, expectedOutput: "{ ok: true, tool, bytes, crossDeviceProvider }" }],
  pitfalls: ["Cross-device sync requires OS-level setup once (Phone Link / Universal Clipboard / KDE Connect). Mneme does NOT install or configure these tools."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const cap = core.anchor.detectClipboard();
    const result = core.anchor.writeClipboard(String(args["text"] ?? ""));
    const hint = core.anchor.renderClipboardSetupHint(cap);
    return {
      data: { result, capability: cap },
      wisdom: result.ok
        ? `clipboard written via ${result.tool} (${result.bytes} bytes); cross-device: ${cap.crossDeviceProvider}`
        : `clipboard write failed: ${result.reason}`,
      confidence: { level: result.ok ? "high" : "low" },
      secondBrain: { presentation: hint },
    };
  },
};

export const ANCHOR_TOOLS: MnemeTool[] = [anchorPoleTool, anchorIssueRopeTool, anchorClipboardTool];
