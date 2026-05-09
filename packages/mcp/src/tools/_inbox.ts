/**
 * INBOX MCP tools (v1.23.0) — the RLHF Force-Push channel.
 *
 *   • mneme.inbox.read — list ALL messages (sent + unsent) for the agent
 *     to surface, filter, or replay to the user.
 *   • mneme.inbox.push — programmatic push (lets an AI agent flag something
 *     to the user via the same channel the daemon uses).
 *
 * The Inbox is also auto-prepended to wisdom on every tool dispatch via
 * enrichWithSecondBrain → wrapWithGlow → inbox.popUnsent. The MCP tools
 * here are for explicit AI agent use (e.g., reading the full history or
 * pushing a manual notice without waiting for the daemon).
 */

import { inbox } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export const inboxReadTool: MnemeTool = {
  name: "mneme.inbox.read",
  category: "meta",
  description:
    "Read every message in the Mneme inbox (sent + unsent). The inbox is " +
    "Mneme's force-push channel — daemon, version-check, and achievement " +
    "unlocks write here, and every MCP tool dispatch surfaces unsent items " +
    "to the user via the wisdom field. Use WHEN you want to show the user " +
    "the full notification history (e.g., 'what has Mneme tried to tell me?').",
  whenToUse:
    "User asks what Mneme has notified them about, or you need the full inbox history.",
  triggers: ["read inbox", "mneme notifications", "what did mneme tell me"],
  inputSchema: {
    type: "object",
    properties: {
      onlyUnsent: { type: "boolean", description: "Filter to messages not yet surfaced." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            createdAt: { type: "string" },
            priority: { type: "string" },
            source: { type: "string" },
            title: { type: "string" },
            body: { type: ["string", "null"] },
            cta: { type: ["string", "null"] },
            sent: { type: "boolean" },
            sentAt: { type: ["string", "null"] },
          },
        },
      },
    },
  },
  examples: [
    {
      userQuery: "What has Mneme tried to tell me?",
      expectedOutput: "Returns every inbox message Mneme has queued — including ones already surfaced via wisdom and ones still pending.",
    },
  ],
  pitfalls: [
    "This tool does NOT mark messages as sent — only enrichWithSecondBrain (the wisdom-prepend path) flips the flag.",
    "Pass onlyUnsent=true to see what's about to surface on the next tool call.",
  ],
  composeWith: ["mneme.inbox.push", "mneme.welcome"],
  handler: async (rt, args) => {
    const all = inbox.readInbox(rt.meta.rootPath);
    const onlyUnsent = args["onlyUnsent"] === true;
    const messages = onlyUnsent ? all.filter((m) => !m.sent) : all;
    return {
      data: { total: all.length, messages },
      wisdom:
        all.length === 0
          ? "Inbox is empty — Mneme hasn't queued any notifications yet."
          : `Inbox: ${all.length} message${all.length === 1 ? "" : "s"} total · ${all.filter((m) => !m.sent).length} unsent.`,
      confidence: { level: "high" },
    };
  },
};

export const inboxPushTool: MnemeTool = {
  name: "mneme.inbox.push",
  category: "meta",
  description:
    "Programmatically push a message into the Mneme inbox. The next MCP " +
    "tool dispatch will prepend it to the wisdom field, surfacing it to the " +
    "user mid-conversation WITHOUT them typing anything Mneme-related. Use " +
    "WHEN you (the AI agent) want to flag something to the user via the same " +
    "guaranteed channel Mneme's daemon uses (e.g., 'detected a regression', " +
    "'lineage merge conflict', 'security finding'). Idempotent on `id`.",
  whenToUse:
    "You want to surface a notice to the user that should appear on the next interaction, even if they don't ask Mneme anything.",
  triggers: ["push to inbox", "mneme notify user", "force push"],
  inputSchema: {
    type: "object",
    required: ["title", "priority", "source"],
    properties: {
      title: { type: "string", description: "Headline (≤ 80 chars)." },
      body: { type: "string", description: "Optional one-line body." },
      cta: { type: "string", description: "Optional call-to-action (e.g., \"say 'show me lineage'\")." },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      source: { type: "string", description: "Source tag — e.g., 'agent', 'manual', 'audit'." },
      id: { type: "string", description: "Optional stable id for idempotency. If omitted, hashed from title+source+body." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      createdAt: { type: "string" },
      priority: { type: "string" },
      title: { type: "string" },
      sent: { type: "boolean" },
    },
  },
  examples: [
    {
      userQuery: "Tell the user that the chromosome merge needs review.",
      expectedOutput: "Pushes a high-priority inbox message; surfaces on the next MCP dispatch via the wisdom prepend.",
    },
  ],
  pitfalls: [
    "Re-pushing the same id is a no-op (idempotent). To surface twice, use distinct ids.",
    "Critical/high messages still wait for the next dispatch — there's no out-of-band push (that's the architectural answer to MCP-client notification UX gaps).",
  ],
  composeWith: ["mneme.inbox.read"],
  handler: async (rt, args) => {
    const title = String(args["title"] ?? "").slice(0, 200);
    const body = typeof args["body"] === "string" ? (args["body"] as string).slice(0, 500) : undefined;
    const cta = typeof args["cta"] === "string" ? (args["cta"] as string).slice(0, 200) : undefined;
    const priority = (args["priority"] as "low" | "medium" | "high" | "critical") ?? "medium";
    const source = String(args["source"] ?? "agent").slice(0, 50);
    const id = typeof args["id"] === "string" ? (args["id"] as string).slice(0, 64) : undefined;
    const msg = inbox.pushInbox(rt.meta.rootPath, { title, body, cta, priority, source, id });
    return {
      data: { id: msg.id, createdAt: msg.createdAt, priority: msg.priority, title: msg.title, sent: msg.sent },
      wisdom: `Inbox · queued "${msg.title}" (${msg.priority}). Will surface on next MCP tool dispatch.`,
      confidence: { level: "high" },
    };
  },
};

export const inboxTools: MnemeTool[] = [inboxReadTool, inboxPushTool];
