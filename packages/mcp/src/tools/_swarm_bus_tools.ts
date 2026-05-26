/**
 * v2.65.0 — SWARM BUS MCP tool surface.
 *
 *   mneme.swarm_bus.subscribe  — agent subscribes to a channel
 *   mneme.swarm_bus.broadcast  — send a message to all subscribers
 *   mneme.swarm_bus.drain      — pop pending messages for one agent
 *   mneme.swarm_bus.peek       — peek inbox without consuming
 *   mneme.swarm_bus.handoff    — render Claude→Cursor→Continue narrative
 *   mneme.swarm_bus.channels   — list all channels
 *   mneme.swarm_bus.audit      — verify HMAC-chained bus ledger
 *
 * Wraps core/src/swarm_bus/. Cross-agent message broker for multi-
 * agent workflows. Vendor-agnostic; any MCP-speaking agent can join.
 */

import type { MnemeTool } from "./_types.js";

export const swarmSubscribeTool: MnemeTool = {
  name: "mneme.swarm_bus.subscribe",
  category: "meta",
  description:
    "🐝 SWARM BUS — subscribe an agent to a channel. Auto-creates the channel as 'public' on first subscribe. For private channels, pass a capability passport with scope swarm:<channel>.",
  whenToUse: "Agent joins a cross-agent workflow. Subscribe first; drain to receive messages.",
  triggers: ["subscribe to channel", "swarm subscribe"],
  inputSchema: {
    type: "object",
    required: ["channel", "agent"],
    properties: {
      channel: { type: "string" },
      agent: { type: "string" },
      passport: { type: "string", description: "Capability passport token (required for private channels)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.swarmBus.subscribe({
        channel: String(args["channel"] ?? ""),
        agent: String(args["agent"] ?? ""),
        passportToken: typeof args["passport"] === "string" ? args["passport"] : undefined,
        cwd,
      });
      return { data: r, wisdom: r.hint, followUp: r.ok ? ["mneme.swarm_bus.drain"] : [], confidence: { level: r.ok ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "subscribe failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmBroadcastTool: MnemeTool = {
  name: "mneme.swarm_bus.broadcast",
  category: "meta",
  description:
    "🐝 SWARM BUS — broadcast a message to all subscribers of a channel. Optional artifactHmac for tamper-evident handoffs (receiving agent re-hashes the artifact before acting). Lamport-clock causal order preserved across distributed agents.",
  whenToUse:
    "Agent finishes a unit of work and wants to notify others on the same channel. Use artifactHmac when the message references a file the other agent should read.",
  triggers: ["broadcast message", "swarm broadcast"],
  inputSchema: {
    type: "object",
    required: ["channel", "from", "text"],
    properties: {
      channel: { type: "string" },
      from: { type: "string", description: "Sender agent id." },
      text: { type: "string" },
      artifactPath: { type: "string", description: "Optional relative path to artifact." },
      artifactHmac: { type: "string", description: "Optional SHA/HMAC of artifact." },
      passport: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.swarmBus.broadcast({
        channel: String(args["channel"] ?? ""),
        from: String(args["from"] ?? ""),
        text: String(args["text"] ?? ""),
        artifactPath: typeof args["artifactPath"] === "string" ? args["artifactPath"] : undefined,
        artifactHmac: typeof args["artifactHmac"] === "string" ? args["artifactHmac"] : undefined,
        passportToken: typeof args["passport"] === "string" ? args["passport"] : undefined,
        cwd,
      });
      return { data: r, wisdom: r.hint, followUp: ["mneme.swarm_bus.handoff"], confidence: { level: r.ok ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "broadcast failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmDrainTool: MnemeTool = {
  name: "mneme.swarm_bus.drain",
  category: "meta",
  description:
    "🐝 SWARM BUS — pop pending messages for one agent. Returns the inbox content + clears it (delivered marker). Messages arrive in Lamport-causal order.",
  whenToUse: "Agent wakes up / starts session / reaches a checkpoint and wants to read what other agents posted.",
  triggers: ["drain inbox", "swarm drain", "what messages do I have"],
  inputSchema: {
    type: "object",
    required: ["agent"],
    properties: {
      agent: { type: "string" },
      channel: { type: "string", description: "Optional channel filter." },
      limit: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.swarmBus.drain({
        agent: String(args["agent"] ?? ""),
        channel: typeof args["channel"] === "string" ? args["channel"] : undefined,
        limit: typeof args["limit"] === "number" ? args["limit"] as number : undefined,
        cwd,
      });
      return { data: r, wisdom: core.swarmBus.renderInbox(r.messages), followUp: r.messages.length > 0 ? ["mneme.swarm_bus.broadcast"] : [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "drain failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmPeekTool: MnemeTool = {
  name: "mneme.swarm_bus.peek",
  category: "meta",
  description:
    "🐝 SWARM BUS — peek at an agent's inbox without consuming. Returns messages but does NOT mark them as delivered.",
  whenToUse: "Check what's pending before deciding whether to act.",
  triggers: ["peek inbox", "swarm peek"],
  inputSchema: { type: "object", required: ["agent"], properties: { agent: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const messages = core.swarmBus.peekInbox(cwd, String(args["agent"] ?? ""));
      return { data: { ok: true, count: messages.length, messages }, wisdom: core.swarmBus.renderInbox(messages), followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "peek failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmHandoffTool: MnemeTool = {
  name: "mneme.swarm_bus.handoff",
  category: "meta",
  description:
    "🐝 SWARM BUS — render the agent → agent → agent handoff narrative for a channel with HMAC proof per step. Inspector for 'what did the swarm actually do?'.",
  whenToUse: "Investigate cross-agent workflow; compliance / audit / debugging multi-agent runs.",
  triggers: ["swarm handoff", "show handoff narrative"],
  inputSchema: { type: "object", required: ["channel"], properties: { channel: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.swarmBus.auditHandoff(cwd, String(args["channel"] ?? ""));
      return { data: r, wisdom: r.rendered, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "handoff failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmChannelsTool: MnemeTool = {
  name: "mneme.swarm_bus.channels",
  category: "meta",
  description:
    "🐝 SWARM BUS — list all channels with kind (public/private), subscriber count, Lamport clock, owner.",
  whenToUse: "Onboarding new agent (show available channels); admin / monitoring view.",
  triggers: ["list channels", "swarm channels"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const channels = core.swarmBus.listChannels(cwd);
      return { data: { ok: true, count: channels.length, channels }, wisdom: `${channels.length} channel(s)`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "channels list failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const swarmAuditTool: MnemeTool = {
  name: "mneme.swarm_bus.audit",
  category: "meta",
  description: "🐝 SWARM BUS — verify HMAC-chained bus ledger + last N entries.",
  whenToUse: "Compliance audit; investigate cross-agent workflow history; chain integrity check.",
  triggers: ["swarm audit", "swarm bus audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.swarmBus.verifyLedgerChain(cwd);
      const rows = core.swarmBus.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return { data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) }, wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`, followUp: [], confidence: { level: led.ok ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const SWARM_BUS_TOOLS: MnemeTool[] = [
  swarmSubscribeTool,
  swarmBroadcastTool,
  swarmDrainTool,
  swarmPeekTool,
  swarmHandoffTool,
  swarmChannelsTool,
  swarmAuditTool,
];
