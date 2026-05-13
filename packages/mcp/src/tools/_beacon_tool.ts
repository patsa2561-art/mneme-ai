/**
 * v2.9.0 -- BEACON MCP wrapper.
 *
 *   mneme.beacon.spawn  — spawn a local HTTP server + return LAN URL + QR
 *                          + clipboard + markdown paths in ONE response.
 *
 * Designed for the "user can't see files" reality: the AI agent renders
 * the QR data: URI as an inline image in chat, the LAN URL as a clickable
 * link, and tells the user to scan / click / paste. NO file system access.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const beaconSpawnTool: MnemeTool = {
  name: "mneme.beacon.spawn",
  category: "meta",
  description:
    "BEACON -- spawn a local HTTP server that hosts the soul prompt at http://<LAN-IP>:7741/<token>, return: clipboard path + LAN URL(s) + inline QR (data:image/svg+xml so AI agent renders it directly in chat) + markdown fallback. Phone on same WiFi scans the QR / clicks the URL → opens a Mneme-served page with the soul prompt and a Copy button. Cross-WiFi works via pasteCrossWifi() fallback (dpaste.com).",
  whenToUse: "User wants to send brain to phone / iPad / another PC, and AI agent needs to give them paths it can render INLINE in the chat (no file system, no source tree).",
  triggers: ["beacon", "send brain to phone", "ส่งสมองไปมือถือ", "cross device sync", "same wifi handoff"],
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "string" },
      targetVendor: { type: "string", description: "claude / chatgpt / gemini / etc — shapes the destination paste hint." },
      label: { type: "string" },
      port: { type: "integer", description: "Listen port. 0 = ephemeral. Default 7741." },
      bindHost: { type: "string", description: "Bind host. 0.0.0.0 (default) for LAN; 127.0.0.1 for local-only." },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Send brain to my phone (same WiFi)",
    args: { payload: "## SOUL PROMPT\n...", targetVendor: "claude" },
    expectedOutput: "{ token, port, lanIPs, paths: [{id:'clipboard'}, {id:'lan-url-192.168.1.10', content:'http://...'}, {id:'lan-qr-192.168.1.10', content:'data:image/svg+xml;base64,...', displayHint:'image-data-uri'}, {id:'markdown'}] }",
  }],
  pitfalls: [
    "The server stays running until idle 10 min — for hands-off scripts call beacon.spawn then surface the paths to user, the timer auto-stops the listener.",
    "On different WiFi networks, the LAN URL won't be reachable from the phone. Use pasteCrossWifi as a fallback (separate call) and surface the resulting public URL.",
    "The data:image/svg+xml QR can be rendered inline in chat by AI agents that support markdown images.",
  ],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.beacon.spawnBeacon({
      payload: String(args["payload"] ?? ""),
      targetVendor: args["targetVendor"] ? String(args["targetVendor"]) : undefined,
      label: args["label"] ? String(args["label"]) : undefined,
      port: args["port"] as number | undefined,
      bindHost: args["bindHost"] ? String(args["bindHost"]) : undefined,
    });
    // Don't return the live Server object via MCP — it's not serialisable.
    const payload = {
      token: r.token,
      port: r.port,
      lanIPs: r.lanIPs,
      paths: r.paths,
      generatedAt: r.generatedAt,
    };
    return {
      data: payload,
      wisdom: core.beacon.formatBeaconPulseLine(r),
      followUp: ["mneme.beacon.cross_wifi"],
      confidence: { level: r.port ? "high" : "medium", notes: r.port ? `LAN server listening on port ${r.port}. AI agent should render the LAN-QR data: URI inline in chat.` : "LAN bind failed; only clipboard + markdown paths available." },
    };
  },
};

export const beaconCrossWifiTool: MnemeTool = {
  name: "mneme.beacon.cross_wifi",
  category: "meta",
  description:
    "BEACON -- cross-WiFi fallback. POSTs the soul prompt to dpaste.com (anonymous, no auth, 1-day expiry default) and returns the public URL + a QR for the URL (data:image/svg+xml inline). Use when the phone is on a DIFFERENT network than the desktop.",
  whenToUse: "After mneme.beacon.spawn when the user reports the LAN URL doesn't work on their phone (e.g., cellular data, different WiFi).",
  triggers: ["cross wifi", "different network", "public paste"],
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "string" },
      ttlSeconds: { type: "integer", description: "Expiry. Default 86400 (1 day)." },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Make it work on cellular", args: { payload: "..." }, expectedOutput: "{ url: 'https://dpaste.com/ABC...', qrDataUri: 'data:image/svg+xml...' }" }],
  pitfalls: [
    "Requires internet on the calling machine. Returns null on network failure — caller should surface the LAN URL or clipboard path instead.",
    "Public paste — DO NOT use for sensitive soul prompts. dpaste content is unauthenticated and publicly fetchable until expiry.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.beacon.pasteCrossWifi(String(args["payload"] ?? ""), {
      ttlSeconds: args["ttlSeconds"] as number | undefined,
    });
    if (!r) {
      return { data: null, wisdom: "BEACON cross-wifi · network failed", confidence: { level: "low", notes: "Fall back to clipboard / markdown / LAN path." } };
    }
    const qrDataUri = core.beacon.qrForUrl(r.url);
    return {
      data: { ...r, qrDataUri },
      wisdom: `BEACON cross-wifi · paste at ${r.url}`,
      confidence: { level: "high", notes: "Public paste — share only what you'd post publicly." },
    };
  },
};

export const BEACON_TOOLS: MnemeTool[] = [beaconSpawnTool, beaconCrossWifiTool];
