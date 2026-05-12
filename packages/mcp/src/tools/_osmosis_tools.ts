/**
 * v1.82.0 -- MCP wrappers for OSMOSIS PROTOCOL.
 */

import { resolve } from "node:path";

import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const osmosisConsentTool: MnemeTool = {
  name: "mneme.osmosis.consent",
  category: "meta",
  description:
    "OSMOSIS -- grant or revoke harvesting consent for a specific vendor. Default is OPT-OUT for every vendor; nothing is harvested until you explicitly enable it.",
  whenToUse: "User says 'let Mneme learn from my <vendor> sessions' OR 'stop harvesting from <vendor>'.",
  triggers: ["consent osmosis", "let mneme learn", "stop harvesting"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      enabled: { type: "boolean" },
    },
    required: ["vendor", "enabled"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Let Mneme learn from my Claude sessions", args: { vendor: "claude-opus-4-7", enabled: true }, expectedOutput: "{ vendors: { 'claude-opus-4-7': true } }" }],
  pitfalls: ["Default is OPT-OUT. Nothing leaves the user's machine regardless."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.osmosis.setConsent(repoRootOf(rt), String(args["vendor"] ?? ""), Boolean(args["enabled"]));
    return {
      data: c,
      wisdom: `consent for ${args["vendor"]}: ${args["enabled"] ? "ENABLED" : "DISABLED"}`,
      confidence: { level: "high" },
    };
  },
};

export const osmosisHarvestTool: MnemeTool = {
  name: "mneme.osmosis.harvest",
  category: "meta",
  description:
    "OSMOSIS -- record a single observation (reply / tool-call / refusal / verdict / decision) from a vendor's session. Gate: only records if consent is granted AND the observation is not a duplicate.",
  whenToUse: "After significant AI turns the user wants captured for long-term wisdom (verdicts, decisions, refusals).",
  triggers: ["harvest observation", "remember this"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      kind: { type: "string", enum: ["reply", "tool-call", "refusal", "verdict", "decision"] },
      text: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      observedAt: { type: "string" },
    },
    required: ["vendor", "kind", "text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Harvest this Claude decision", args: { vendor: "claude", kind: "decision", text: "prefer Gist over clipboard" }, expectedOutput: "{ recorded: true }" }],
  pitfalls: ["Returns recorded=false when vendor is not opted-in OR the observation is a duplicate (same content hash)."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.osmosis.harvest(repoRootOf(rt), {
      vendor: String(args["vendor"] ?? ""),
      kind: (args["kind"] as "reply" | "tool-call" | "refusal" | "verdict" | "decision") ?? "reply",
      text: String(args["text"] ?? ""),
      tags: args["tags"] as readonly string[] | undefined,
      observedAt: (args["observedAt"] as string | undefined) ?? new Date().toISOString(),
    });
    return {
      data: r,
      wisdom: r.recorded ? "harvested" : `skipped: ${r.reason}`,
      confidence: { level: r.recorded ? "high" : "medium" },
    };
  },
};

export const osmosisDistillTool: MnemeTool = {
  name: "mneme.osmosis.distill",
  category: "meta",
  description:
    "OSMOSIS -- distill recent observations into a signed wisdom shard. Each shard chains to the previous (hash-chain) so the wisdom log is tamper-evident.",
  whenToUse: "Periodic (nightly via daemon) or manual when user wants a wisdom snapshot.",
  triggers: ["distill wisdom", "shard observations"],
  inputSchema: {
    type: "object",
    properties: {
      observations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vendor: { type: "string" },
            kind: { type: "string" },
            text: { type: "string" },
            observedAt: { type: "string" },
          },
        },
      },
      rule: { type: "string" },
    },
    required: ["observations"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Distill these 5 observations", args: { observations: [] }, expectedOutput: "{ id, hash, confidence }" }],
  pitfalls: ["Distilling with 0 observations creates an empty shard; pass at least 1."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const obs = (args["observations"] as Array<{ vendor: string; kind: "reply" | "tool-call" | "refusal" | "verdict" | "decision"; text: string; observedAt?: string; tags?: string[] }>) ?? [];
    const normalized = obs.map((o) => ({
      vendor: o.vendor,
      kind: o.kind,
      text: o.text,
      observedAt: o.observedAt ?? new Date().toISOString(),
      tags: o.tags,
    }));
    const shard = core.osmosis.distill(repoRootOf(rt), normalized, args["rule"] as string | undefined);
    return {
      data: shard,
      wisdom: `shard ${shard.id} · ${normalized.length} observations · confidence ${(shard.confidence * 100).toFixed(0)}%`,
      confidence: { level: "high" },
    };
  },
};

export const osmosisVerifyTool: MnemeTool = {
  name: "mneme.osmosis.verify",
  category: "meta",
  description: "OSMOSIS -- verify the wisdom hash-chain. Detects any tampering in the wisdom log.",
  whenToUse: "Periodic audit; or when the user suspects the wisdom log was modified externally.",
  triggers: ["verify wisdom", "audit chain"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Audit the wisdom chain", args: {}, expectedOutput: "{ valid: true, brokenAtIndex: null }" }],
  pitfalls: ["When valid=false, brokenAtIndex points at the first corrupted shard; everything after is suspect."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.osmosis.verifyChain(repoRootOf(rt));
    return {
      data: r,
      wisdom: r.valid ? "chain valid ✓" : `chain broken at index ${r.brokenAtIndex}`,
      confidence: { level: "high" },
    };
  },
};

export const OSMOSIS_TOOLS: MnemeTool[] = [osmosisConsentTool, osmosisHarvestTool, osmosisDistillTool, osmosisVerifyTool];
