/**
 * v1.75.0 -- MCP wrappers for VERSION TELEPATHY.
 */

import type { MnemeTool } from "./_types.js";

export const telepathyHeartbeatTool: MnemeTool = {
  name: "mneme.telepathy.heartbeat",
  category: "meta",
  description:
    "VERSION TELEPATHY -- generate the current Mneme heartbeat (local version + npm-latest + sync status + daemon + vaccines + inbox). Returns JSON + a ready-to-paste markdown block. Used implicitly by soul-prompt; call directly when you want a fresh version-sync snapshot to inject into any chat.",
  whenToUse:
    "User asks 'what version is Mneme?' / 'is Mneme up to date?' / 'are you on the latest?'. Also use BEFORE handoff to another AI when you want the receiver to know whether the manifest is current.",
  triggers: ["version", "เวอร์ชั่น", "up to date", "latest", "heartbeat"],
  inputSchema: {
    type: "object",
    properties: {
      localVersion: { type: "string", description: "Local Mneme version. Defaults to mneme package version." },
      repoFingerprint: { type: "string" },
      daemonRunning: { type: "boolean" },
      vaccineCount: { type: "integer" },
      inboxUnsent: { type: "integer" },
      offline: { type: "boolean", description: "Skip network; use only cached npm-latest." },
    },
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Is Mneme on the latest version?",
      args: {},
      expectedOutput: "Heartbeat JSON + 'in-sync ✓ at v1.75.0' summary.",
    },
  ],
  pitfalls: [
    "npm-latest is cached 1h; pass offline:true to skip the network entirely.",
    "When offline + cache stale → sync_status='unknown' (heartbeat still produced).",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const localVersion = (args["localVersion"] as string | undefined) ?? "1.75.0";
    const fingerprint = (args["repoFingerprint"] as string | undefined) ?? "(unknown)";
    const h = await core.telepathy.generateHeartbeat({
      localVersion,
      repoFingerprint: fingerprint,
      daemonRunning: args["daemonRunning"] as boolean | undefined,
      vaccineCount: args["vaccineCount"] as number | undefined,
      inboxUnsent: args["inboxUnsent"] as number | undefined,
      offline: Boolean(args["offline"]),
    });
    const md = core.telepathy.renderHeartbeatMarkdown(h);
    const summary =
      h.syncStatus === "in-sync"
        ? `in-sync ✓ at v${h.localVersion}`
        : h.syncStatus === "behind"
          ? `BEHIND ⚠ -- local v${h.localVersion}, npm latest v${h.npmLatest}`
          : h.syncStatus === "ahead"
            ? `ahead of npm (dev build) -- local v${h.localVersion}, npm v${h.npmLatest}`
            : `version sync unknown (offline or npm unreachable) -- local v${h.localVersion}`;
    return {
      data: h,
      wisdom: summary,
      confidence: { level: h.syncStatus === "unknown" ? "medium" : "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const telepathyCompareTool: MnemeTool = {
  name: "mneme.telepathy.compare",
  category: "meta",
  description:
    "VERSION TELEPATHY -- parse a heartbeat block from any pasted text (e.g. a soul prompt) and compare it to the current local heartbeat. Tells you whether the user's two machines are in-sync.",
  whenToUse:
    "User pastes a soul prompt and asks 'is the OTHER side on the same version?'. Also useful when AI receives a soul prompt and wants to surface a version-mismatch warning.",
  triggers: ["compare version", "same version", "in sync"],
  inputSchema: {
    type: "object",
    properties: {
      pastedText: { type: "string", description: "Text that contains an embedded Mneme Heartbeat section." },
      localVersion: { type: "string" },
      repoFingerprint: { type: "string" },
    },
    required: ["pastedText"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Is the brain I pasted on the same version as my local Mneme?",
      args: { pastedText: "...soul prompt..." },
      expectedOutput: "Either 'both on v1.75.0' or 'pasted=v1.70.0 / local=v1.75.0 -- pasted side is behind'.",
    },
  ],
  pitfalls: ["If the pasted text has no heartbeat section, returns parsed=null."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const pasted = String(args["pastedText"] ?? "");
    const parsed = core.telepathy.parseHeartbeat(pasted);
    const localVersion = (args["localVersion"] as string | undefined) ?? "1.75.0";
    const local = await core.telepathy.generateHeartbeat({
      localVersion,
      repoFingerprint: (args["repoFingerprint"] as string | undefined) ?? "(unknown)",
      offline: true,
    });
    if (!parsed) {
      return {
        data: { parsed: null, local },
        wisdom: "No heartbeat in the pasted text -- nothing to compare.",
        confidence: { level: "high" },
      };
    }
    const same = parsed.localVersion === local.localVersion;
    const summary = same
      ? `both sides on v${local.localVersion} ✓`
      : `pasted side = v${parsed.localVersion} / local = v${local.localVersion} -- mismatch`;
    return {
      data: { parsed, local, same },
      wisdom: summary,
      confidence: { level: "high" },
    };
  },
};

export const TELEPATHY_TOOLS: MnemeTool[] = [telepathyHeartbeatTool, telepathyCompareTool];
