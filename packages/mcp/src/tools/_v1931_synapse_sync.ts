/**
 * v2.19.31 CROSS-DEVICE SYNAPSE SYNC — MCP tools (Phase D of SYNAPSE GENESIS)
 *
 *   🧬 mneme.synapse.sync_export
 *   🧬 mneme.synapse.sync_verify
 *   🧬 mneme.synapse.sync_merge
 *   🧬 mneme.synapse.sync_pack
 *   🧬 mneme.synapse.sync_unpack
 *   🧬 mneme.synapse.sync_stats
 *
 *   Composes onto v2.19.29 SYNAPSE GENESIS + v1.72 DIASPORA for mobile + laptop
 *   + desktop unified brain. Caller supplies transport (git branch / HTTP / QR).
 */

import type { MnemeTool } from "./_types.js";

export const synapseSyncExportTool: MnemeTool = {
  name: "mneme.synapse.sync_export",
  category: "lab",
  description: "🧬 SYNC — package the local synapse store into an HMAC-signed envelope for cross-device transport (mobile + laptop + desktop).",
  whenToUse: "Daemon-driven, or before user travel between devices. Pair with mneme.synapse.sync_pack for DIASPORA git-branch transport.",
  triggers: ["sync export", "synapse export", "cross-device brain"],
  inputSchema: {
    type: "object",
    properties: {
      deviceId: { type: "string" },
      store: { type: "object" },
      nowMs: { type: "number" },
    },
    required: ["deviceId", "store"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Export brain from this laptop for sync", args: { deviceId: "macbook-pro-2026", store: {} }, expectedOutput: "{ v, deviceId, exportedAtMs, store, sig }" }],
  pitfalls: ["deviceId must be stable across exports for de-dup; use machine fingerprint hash for privacy."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = core.synapseSync.exportForSync({
      deviceId: String(args["deviceId"]),
      store: args["store"] as Parameters<typeof core.synapseSync.exportForSync>[0]["store"],
      nowMs: args["nowMs"] as number | undefined,
    });
    return { data: env, wisdom: `🧬 exported ${env.store.weights.length} synapses for device=${env.deviceId}`, confidence: { level: "high" } };
  },
};

export const synapseSyncVerifyTool: MnemeTool = {
  name: "mneme.synapse.sync_verify",
  category: "audit",
  description: "🧬 SYNC — verify an envelope's HMAC signature. Forged or tampered envelopes return false; receiver should drop them before merge.",
  whenToUse: "Before merging an envelope from another device — never trust without verifying.",
  triggers: ["sync verify", "synapse envelope verify"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this synapse envelope authentic?", args: { envelope: {} }, expectedOutput: "{ valid: true | false }" }],
  pitfalls: ["Wrong secret = always false; secret is shared via the MNEME_SYNAPSE_SYNC_SECRET env var across devices."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const valid = core.synapseSync.verifySyncExport(args["envelope"] as Parameters<typeof core.synapseSync.verifySyncExport>[0]);
    return { data: { valid }, wisdom: `🧬 envelope ${valid ? "verified" : "REJECTED"}`, confidence: { level: valid ? "high" : "low" } };
  },
};

export const synapseSyncMergeTool: MnemeTool = {
  name: "mneme.synapse.sync_merge",
  category: "lab",
  description: "🧬 SYNC — CRDT merge N device exports into one canonical synapse store. Last-strongest-wins per key; permanent=true sticky; observations cumulative; commutative + associative + idempotent. Bad signatures auto-dropped.",
  whenToUse: "After fetching envelopes from peer devices (git pull / HTTP / QR). Result is the unified brain.",
  triggers: ["sync merge", "synapse merge", "unify brain", "cross-device merge"],
  inputSchema: {
    type: "object",
    properties: {
      exports: { type: "array" },
    },
    required: ["exports"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Merge mobile + laptop + desktop synapse stores", args: { exports: [] }, expectedOutput: "{ store, provenance, participatingDevices, rejectedDevices }" }],
  pitfalls: ["Duplicate deviceId: last-export-wins by exportedAtMs. Forged envelopes excluded but listed in rejectedDevices for audit."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.synapseSync.mergeSynapseStores({
      exports: args["exports"] as Parameters<typeof core.synapseSync.mergeSynapseStores>[0]["exports"],
    });
    const stats = core.synapseSync.computeSyncStats(r);
    return { data: r, wisdom: core.synapseSync.formatSyncStatsLine(stats), confidence: { level: r.rejectedDevices.length === 0 ? "high" : "medium" } };
  },
};

export const synapseSyncPackTool: MnemeTool = {
  name: "mneme.synapse.sync_pack",
  category: "lab",
  description: "🧬 SYNC — DIASPORA transport adapter. Returns canonical path + bytes + branch hint the caller's transport (git, HTTP, QR, USB) can carry across devices.",
  whenToUse: "After sync_export; before pushing via DIASPORA git branch or HTTP bridge.",
  triggers: ["sync pack", "diaspora pack", "synapse transport pack"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Pack envelope for diaspora git branch", args: { envelope: {} }, expectedOutput: "{ path, bytes, branchHint }" }],
  pitfalls: ["deviceId is sanitised to [a-zA-Z0-9_-] for path safety — path traversal stripped automatically."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.synapseSync.packForDiaspora(args["envelope"] as Parameters<typeof core.synapseSync.packForDiaspora>[0]);
    return { data: p, wisdom: `🧬 packed -> ${p.path} (branch ${p.branchHint})`, confidence: { level: "high" } };
  },
};

export const synapseSyncUnpackTool: MnemeTool = {
  name: "mneme.synapse.sync_unpack",
  category: "lab",
  description: "🧬 SYNC — parse JSON bytes arrived via any transport back into a typed envelope. Returns null for malformed bytes; never throws.",
  whenToUse: "After fetching via transport (git pull / HTTP GET / QR scan); feed result to sync_verify then sync_merge.",
  triggers: ["sync unpack", "diaspora unpack", "synapse envelope decode"],
  inputSchema: { type: "object", properties: { bytes: { type: "string" } }, required: ["bytes"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Unpack the bytes fetched from diaspora", args: { bytes: '{"v":1,...}' }, expectedOutput: "{ envelope: DeviceSynapseExport | null }" }],
  pitfalls: ["Returns null instead of throwing — caller MUST null-check before sync_merge."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = core.synapseSync.unpackFromDiaspora(String(args["bytes"] ?? ""));
    return { data: { envelope: env }, wisdom: env ? `🧬 unpacked from device=${env.deviceId}` : "🧬 unpack failed (malformed bytes)", confidence: { level: env ? "high" : "low" } };
  },
};

export const synapseSyncStatsTool: MnemeTool = {
  name: "mneme.synapse.sync_stats",
  category: "audit",
  description: "🧬 SYNC — summarise a merge result (participating devices / total synapses / multi-device count / permanent count / cumulative observations).",
  whenToUse: "Pulse line + brain-unification dashboard. Run after sync_merge.",
  triggers: ["sync stats", "synapse merge stats"],
  inputSchema: { type: "object", properties: { result: { type: "object" } }, required: ["result"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show cross-device brain stats", args: { result: {} }, expectedOutput: "{ participatingDevices, totalSynapses, ..., line }" }],
  pitfalls: ["Pass the FULL merge result (not just the store) so contributor counts come through."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.synapseSync.computeSyncStats(args["result"] as Parameters<typeof core.synapseSync.computeSyncStats>[0]);
    return { data: { stats: s, line: core.synapseSync.formatSyncStatsLine(s) }, wisdom: core.synapseSync.formatSyncStatsLine(s), confidence: { level: "high" } };
  },
};

export const V1931_SYNAPSE_SYNC_TOOLS: MnemeTool[] = [
  synapseSyncExportTool,
  synapseSyncVerifyTool,
  synapseSyncMergeTool,
  synapseSyncPackTool,
  synapseSyncUnpackTool,
  synapseSyncStatsTool,
];
