/**
 * v2.33.0 — MCP wrappers for MNEMNET (federated AI-honesty network).
 *
 * 5 tools:
 *   mneme.mnemnet.status         — consent + node id + envelopes count
 *   mneme.mnemnet.join           — opt in / opt out
 *   mneme.mnemnet.build_envelope — DP-noise the local CITIZEN COURT ledger into an envelope
 *   mneme.mnemnet.public_hsc     — aggregate N envelopes into Public HSC
 *   mneme.mnemnet.verify         — offline HMAC verify of an envelope
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string { return resolve(rt.meta?.rootPath ?? process.cwd()); }

export const mnemnetStatusTool: MnemeTool = {
  name: "mneme.mnemnet.status",
  category: "meta",
  description: "MNEMNET — read consent + nodeId + local envelope count. Federation default OFF.",
  whenToUse: "Before opting in; consent audit.",
  triggers: ["mnemnet status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const consent = core.mnemnet.readConsent(repoRoot);
    const envelopes = core.mnemnet.listEnvelopes(repoRoot, 1).length === 0
      ? 0
      : core.mnemnet.listEnvelopes(repoRoot, 10000).length;
    return {
      data: { consent, envelopeCount: envelopes },
      wisdom: consent.optIn
        ? `MNEMNET OPT-IN · node=${consent.nodeId} · ${envelopes} envelope(s)`
        : `MNEMNET OFF (private-by-default). ${envelopes} envelope(s) local.`,
      followUp: consent.optIn ? [] : ["mneme.mnemnet.join"],
      confidence: { level: "high" as const },
    };
  },
};

export const mnemnetJoinTool: MnemeTool = {
  name: "mneme.mnemnet.join",
  category: "meta",
  description: "MNEMNET — opt in / out. Pass optIn=true + endpoint to enable.",
  whenToUse: "User explicitly opts in to contribute DP-noised honesty data.",
  triggers: ["mnemnet join", "mnemnet opt in"],
  inputSchema: {
    type: "object",
    properties: {
      optIn: { type: "boolean" },
      endpoint: { type: "string" },
      maxEpsilon: { type: "number", description: "Default 0.5." },
    },
    required: ["optIn"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const c = core.mnemnet.setConsent(repoRoot, args["optIn"] === true, {
      ...(typeof args["endpoint"] === "string" ? { endpoint: args["endpoint"] as string } : {}),
      ...(typeof args["maxEpsilon"] === "number" ? { maxEpsilon: args["maxEpsilon"] as number } : {}),
    });
    return {
      data: { consent: c },
      wisdom: args["optIn"] === true ? `MNEMNET OPT-IN saved · node=${c.nodeId}` : "MNEMNET OPT-OUT saved.",
      followUp: ["mneme.mnemnet.status"],
      confidence: { level: "high" as const },
    };
  },
};

export const mnemnetBuildEnvelopeTool: MnemeTool = {
  name: "mneme.mnemnet.build_envelope",
  category: "meta",
  description: "MNEMNET — build a DP-noised envelope from the local CITIZEN COURT ledger. Persists locally; federation push is a separate opt-in.",
  whenToUse: "Periodic batched contribution; before federate push.",
  triggers: ["mnemnet build envelope"],
  inputSchema: {
    type: "object",
    properties: {
      epsilon: { type: "number", description: "DP epsilon (clamped to consent.maxEpsilon)." },
      persist: { type: "boolean", description: "Append to envelopes.jsonl. Default true." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const verdicts = core.citizenCourt.listVerdicts(repoRoot, 10000);
    const env = core.mnemnet.buildEnvelope(repoRoot, verdicts, {
      ...(typeof args["epsilon"] === "number" ? { epsilon: args["epsilon"] as number } : {}),
    });
    if (args["persist"] !== false) core.mnemnet.persistEnvelope(repoRoot, env);
    return {
      data: { envelopeId: env.envelopeId, perVendor: env.perVendor, epsilon: env.epsilon, hmac: env.hmac },
      wisdom: `Envelope ${env.envelopeId} built · ${env.perVendor.length} vendor(s) · ε=${env.epsilon}.`,
      followUp: ["mneme.mnemnet.public_hsc"],
      confidence: { level: "high" as const },
    };
  },
};

export const mnemnetPublicHscTool: MnemeTool = {
  name: "mneme.mnemnet.public_hsc",
  category: "meta",
  description: "MNEMNET — aggregate N envelopes into a Public Honesty Court HSC. Pass envelopes:[...] to aggregate ad-hoc; omit to aggregate the local envelopes ledger.",
  whenToUse: "Compute the network-wide vendor honesty leaderboard.",
  triggers: ["public hsc", "mnemnet aggregate"],
  inputSchema: {
    type: "object",
    properties: {
      envelopes: { type: "array", description: "Optional — paste envelopes from peers. If omitted, uses local envelopes.jsonl." },
      limit: { type: "integer" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const envelopes = Array.isArray(args["envelopes"]) && args["envelopes"].length > 0
      ? (args["envelopes"] as Parameters<typeof core.mnemnet.aggregatePublicHsc>[0])
      : core.mnemnet.listEnvelopes(repoRoot, typeof args["limit"] === "number" ? (args["limit"] as number) : 500);
    const hsc = core.mnemnet.aggregatePublicHsc(envelopes);
    return {
      data: hsc,
      wisdom: `Public HSC: ${hsc.rows.length} vendor(s) from ${hsc.envelopeCount} envelope(s).`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const mnemnetVerifyTool: MnemeTool = {
  name: "mneme.mnemnet.verify",
  category: "meta",
  description: "MNEMNET — offline HMAC verify of a DP envelope.",
  whenToUse: "Cross-machine attestation.",
  triggers: ["mnemnet verify"],
  inputSchema: {
    type: "object",
    properties: { envelope: { type: "object" } },
    required: ["envelope"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = args["envelope"] as Parameters<typeof core.mnemnet.verifyEnvelope>[0];
    if (!env || typeof env !== "object") {
      return {
        data: { ok: false, reason: "envelope missing" },
        wisdom: "Pass `envelope`.",
        followUp: [], confidence: { level: "high" as const },
      };
    }
    const r = core.mnemnet.verifyEnvelope(env);
    return {
      data: r,
      wisdom: r.ok ? "Envelope HMAC verified." : `HMAC FAIL: ${r.reason}`,
      followUp: [], confidence: { level: "high" as const },
    };
  },
};

export const MNEMNET_TOOLS: MnemeTool[] = [
  mnemnetStatusTool,
  mnemnetJoinTool,
  mnemnetBuildEnvelopeTool,
  mnemnetPublicHscTool,
  mnemnetVerifyTool,
];
