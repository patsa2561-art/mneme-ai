/**
 * v1.83.0 -- MCP wrappers for AURA PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const auraPairTool: MnemeTool = {
  name: "mneme.aura.pair",
  category: "meta",
  description:
    "AURA -- build a signed pairing payload (LAN URL + NEXUS code + expiry + owner fingerprint) for same-WiFi auto-handover. Owner-only: office neighbours can't use the payload even on the same WiFi.",
  whenToUse:
    "When user wants the AI on another device on the SAME WiFi to fetch the brain automatically -- no URL to type. Encode pairing → show QR → destination scans → auto-fetches.",
  triggers: ["pair device", "same wifi handoff", "auto pair"],
  inputSchema: {
    type: "object",
    properties: {
      lanUrl: { type: "string" },
      code: { type: "string" },
      expiresAt: { type: "string" },
      ownerSecret: { type: "string" },
      ownerPubKeyHash: { type: "string" },
    },
    required: ["lanUrl", "code", "expiresAt", "ownerSecret", "ownerPubKeyHash"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Pair my desktop to my phone on the same WiFi",
      args: { lanUrl: "http://192.168.1.42:7741", code: "K7M9X2", expiresAt: "2026-05-14T00:00:00Z", ownerSecret: "...", ownerPubKeyHash: "..." },
      expectedOutput: "{ token: '<base64url>' }",
    },
  ],
  pitfalls: [
    "Other devices on the same WiFi without the owner key will FAIL to decode -- this is intentional privacy.",
    "Payload expires; mint a fresh one if the destination is slow.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.aura.encodePairing({
      lanUrl: String(args["lanUrl"] ?? ""),
      code: String(args["code"] ?? ""),
      expiresAt: String(args["expiresAt"] ?? ""),
      ownerSecret: String(args["ownerSecret"] ?? ""),
      ownerPubKeyHash: String(args["ownerPubKeyHash"] ?? ""),
    });
    return {
      data: { token: r.token, payload: r.payload },
      wisdom: `pairing token ready (${r.token.length} chars); expires ${r.payload.expiresAt}`,
      confidence: { level: "high" },
    };
  },
};

export const auraDiscoverTool: MnemeTool = {
  name: "mneme.aura.discover",
  category: "meta",
  description:
    "AURA -- list this machine's LAN IPv4 candidates + the recommended LAN URL for hosting the pairing bridge. NO broadcast on the wire; nothing leaves this machine.",
  whenToUse: "Before pairing: figure out which LAN URL to embed in the pairing payload.",
  triggers: ["discover lan", "find local ip", "lan address"],
  inputSchema: { type: "object", properties: { port: { type: "integer" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's my LAN IP?", args: {}, expectedOutput: "{ candidates: [...], lanUrl: 'http://192.168.1.42:7741' }" }],
  pitfalls: ["Returns lanUrl=null when the machine isn't on any private network — use Gist transport instead."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const port = (args["port"] as number | undefined) ?? 7741;
    const candidates = core.aura.discoverLanAddresses();
    const lanUrl = core.aura.buildLanUrl(port);
    return {
      data: { candidates, lanUrl },
      wisdom: lanUrl ? `LAN URL: ${lanUrl} (${candidates.length} interface${candidates.length === 1 ? "" : "s"})` : "no private LAN found -- use Gist instead",
      confidence: { level: lanUrl ? "high" : "low" },
    };
  },
};

export const AURA_TOOLS: MnemeTool[] = [auraPairTool, auraDiscoverTool];
