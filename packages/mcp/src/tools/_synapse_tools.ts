/**
 * v1.81.0 -- MCP wrappers for SYNAPSE PROTOCOL.
 */

import { resolve } from "node:path";

import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const synapseMintCodeTool: MnemeTool = {
  name: "mneme.synapse.mint_code",
  category: "meta",
  description:
    "SYNAPSE -- mint a 6-char NEXUS code that resolves to a soul prompt. User types the code on another device (phone / tablet / second laptop) to fetch the brain. Like AirDrop PIN for AI conversations.",
  whenToUse: "User wants to continue a session on a different device. Generate the code; user types it on the destination.",
  triggers: ["mint code", "device handoff", "นัดโค้ดข้ามเครื่อง"],
  inputSchema: {
    type: "object",
    properties: {
      soulText: { type: "string" },
      gistUrl: { type: "string", description: "Optional Gist URL to cache alongside the code." },
      ttlMs: { type: "integer" },
    },
    required: ["soulText"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Make a code I can type on my phone", args: { soulText: "# SOUL\nbody" }, expectedOutput: "{ code: 'K7M9X2', expiresAt: ... }" },
  ],
  pitfalls: ["Codes expire after 24h by default. Mint a fresh one if the destination device says 'unknown code'."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const entry = core.synapse.mintNexusCode(repoRootOf(rt), {
      soulText: String(args["soulText"] ?? ""),
      gistUrl: args["gistUrl"] as string | undefined,
      ttlMs: args["ttlMs"] as number | undefined,
    });
    return {
      data: entry,
      wisdom: `code ${entry.code} (valid until ${entry.expiresAt})`,
      confidence: { level: "high" },
    };
  },
};

export const synapseResolveCodeTool: MnemeTool = {
  name: "mneme.synapse.resolve_code",
  category: "meta",
  description: "SYNAPSE -- resolve a NEXUS code back to its soul prompt. Use on the destination device.",
  whenToUse: "User typed a 6-char code received from another device. Look up the soul; bump resolve count.",
  triggers: ["resolve code", "fetch by code", "ดึงสมองจากโค้ด"],
  inputSchema: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fetch K7M9X2", args: { code: "K7M9X2" }, expectedOutput: "{ soulText: ..., resolveCount: 1 }" }],
  pitfalls: ["Returns null when code is unknown OR expired. Tell user to mint a fresh code on the source device."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const entry = core.synapse.resolveNexusCode(repoRootOf(rt), String(args["code"] ?? ""));
    return {
      data: entry,
      wisdom: entry ? `resolved (${entry.soulText ? entry.soulText.length + " chars" : "gist only"})` : "code unknown or expired",
      confidence: { level: entry ? "high" : "low" },
    };
  },
};

export const synapseQRTool: MnemeTool = {
  name: "mneme.synapse.qr",
  category: "meta",
  description: "SYNAPSE -- render any short payload (NEXUS code, URL, or short soul snippet) as an SVG QR-style anchor for cross-device transfer via camera scan.",
  whenToUse: "User wants to scan a code on their phone instead of typing.",
  triggers: ["qr code", "show qr", "สแกน qr"],
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "string" },
      moduleSize: { type: "integer" },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "QR for K7M9X2", args: { payload: "K7M9X2" }, expectedOutput: "{ svg: '<svg>...</svg>', size: 264 }" }],
  pitfalls: ["For payloads > 100 chars, share a NEXUS code or Gist URL instead."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.synapse.encodeQRAnchor(String(args["payload"] ?? ""), {
      moduleSize: args["moduleSize"] as number | undefined,
    });
    return {
      data: a,
      wisdom: `QR ${a.size}x${a.size}px${a.warning ? ` -- ${a.warning}` : ""}`,
      confidence: { level: a.warning ? "medium" : "high" },
    };
  },
};

export const synapseCompressTool: MnemeTool = {
  name: "mneme.synapse.compress",
  category: "meta",
  description: "SYNAPSE -- compress a soul prompt or any Mneme-flavored text via deterministic codebook substitution. Typical savings 30-50% on long prompts.",
  whenToUse: "Before pasting into a tight-context-window destination (mobile AI app). Or to save tokens on every cross-vendor handoff.",
  triggers: ["compress prompt", "shrink soul", "saveญ tokens"],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      includeHeader: { type: "boolean" },
    },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compress this soul prompt", args: { text: "## VOICE DIRECTIVE..." }, expectedOutput: "{ compressed: '@@V...', ratio: 0.55 }" }],
  pitfalls: ["Compressed prompts are only decodable by AIs that know the codebook (have Mneme installed) OR have the inline header. Pass includeHeader=true for first-time recipients."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.synapse.compressText(String(args["text"] ?? ""), {
      includeHeader: Boolean(args["includeHeader"]),
    });
    return {
      data: r,
      wisdom: `compressed ${r.originalChars}→${r.compressedChars} chars (${Math.round((1 - r.ratio) * 100)}% saved)`,
      confidence: { level: "high" },
    };
  },
};

export const synapseDecompressTool: MnemeTool = {
  name: "mneme.synapse.decompress",
  category: "meta",
  description: "SYNAPSE -- decompress text produced by mneme.synapse.compress (or any AI that obeyed the SYNAPSE-CODEBOOK header).",
  whenToUse: "Destination AI received a compressed soul prompt; expand it before reading.",
  triggers: ["decompress", "expand soul"],
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Decompress this", args: { text: "@@V\nblah" }, expectedOutput: "{ decoded: '## VOICE DIRECTIVE...\\nblah' }" }],
  pitfalls: ["No-op when input has no SYNAPSE codes; returns input verbatim minus the header line."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const decoded = core.synapse.decompressText(String(args["text"] ?? ""));
    return {
      data: { decoded, originalChars: String(args["text"] ?? "").length, decodedChars: decoded.length },
      wisdom: `decompressed (${decoded.length} chars)`,
      confidence: { level: "high" },
    };
  },
};

export const SYNAPSE_TOOLS: MnemeTool[] = [
  synapseMintCodeTool,
  synapseResolveCodeTool,
  synapseQRTool,
  synapseCompressTool,
  synapseDecompressTool,
];
