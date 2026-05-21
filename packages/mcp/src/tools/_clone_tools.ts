/**
 * v2.19.95 — MCP wrappers for the unified CLONE family.
 *
 * One verb per transport.  Auto-captures the live AI editor session
 * (live_session_mirror) so callers never need to pass a payload.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const cloneToClipboardTool: MnemeTool = {
  name: "mneme.clone.clipboard",
  category: "meta",
  description: "📡 CLONE — auto-capture the CURRENT live AI editor session + write the soul prompt to the OS clipboard. User opens a new Claude Code / Cursor / Codex session and presses Ctrl/Cmd-V. NO --payload required.",
  whenToUse: "User says 'clone this session', 'send brain to another AI on this PC', 'ส่งสมอง', 'ย้ายไปคุยต่อ', 'continue in another editor'. Default same-machine transport.",
  triggers: [
    "clone session", "clone this session", "clone session to another",
    "send brain", "send memory", "handoff session", "continue elsewhere",
    "copy session", "duplicate session",
    "ส่งสมอง", "ส่งความจำ", "ส่งสมองไปอีก session", "clone session นี้ไปอีก session",
    "ย้ายสมอง", "ย้ายไปคุยต่อ", "ส่งไปให้ AI ตัวอื่น", "ส่งให้ Cursor",
    "ส่งให้ ChatGPT", "ส่งให้ Gemini",
  ],
  inputSchema: {
    type: "object",
    properties: {
      receivingVendor: { type: "string", description: "claude / chatgpt / gemini / cursor / cline / codex — shapes phenotype." },
      lastN: { type: "number", description: "How many recent turns to include (default 30)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "clone session นี้", args: {}, expectedOutput: "{ ok: true, tool: 'win-clip', bytes: ..., soulPreview: ... }" }],
  pitfalls: [
    "Requires Claude Code (or other AI editor that writes session jsonl) running in this repo.",
    "Clipboard sync to phone needs Phone Link / Universal Clipboard / KDE Connect pre-configured.",
  ],
  composeWith: ["mneme.session.live_capture"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.clone.cloneToClipboard(repoRootOf(rt), {
      receivingVendor: args["receivingVendor"] as string | undefined,
      lastN: args["lastN"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r.ok
        ? `Live session (~${r.estTokens} tokens) on the clipboard. Paste in the destination AI to resume.`
        : `Clipboard write failed: ${r.reason ?? "unknown"}.`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const cloneViaQrTool: MnemeTool = {
  name: "mneme.clone.qr",
  category: "meta",
  description: "📡 CLONE — auto-capture the CURRENT live session + spawn a local HTTP server + emit a scannable QR. Destination device (phone, iPad, second PC on same WiFi) scans the QR; the page auto-copies the soul prompt to their clipboard.",
  whenToUse: "User says 'send to my phone', 'beam to iPad', 'cross-device same WiFi', 'ส่งสมองไปมือถือ', 'แสกน QR'.",
  triggers: [
    "send to phone", "send to iPad", "send to second PC", "same wifi",
    "QR handoff", "scan QR", "beam brain",
    "ส่งไปมือถือ", "ส่งไป iPad", "ส่งสมองไปมือถือ", "แสกน QR",
  ],
  inputSchema: {
    type: "object",
    properties: {
      receivingVendor: { type: "string" },
      lastN: { type: "number" },
      port: { type: "number", description: "LAN port. Default 7741." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "ส่งสมองไปมือถือ", args: {}, expectedOutput: "{ lanUrls, qrDataUri, port, token }" }],
  pitfalls: [
    "Server stays running 10 min idle then auto-stops.",
    "Destination device must be on the SAME WiFi. For cross-network use `mneme.clone.remote`.",
  ],
  composeWith: ["mneme.clone.remote"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.clone.cloneViaLan(repoRootOf(rt), {
      receivingVendor: args["receivingVendor"] as string | undefined,
      lastN: args["lastN"] as number | undefined,
      port: args["port"] as number | undefined,
    });
    // Don't return the live Server object — not serialisable.
    return {
      data: { ...r, server: undefined },
      wisdom: `LAN beacon listening on port ${r.port}. AI agent: render the QR data: URI inline + surface the URL.`,
      confidence: { level: r.port ? "high" : "medium" },
    };
  },
};

export const cloneViaRemoteTool: MnemeTool = {
  name: "mneme.clone.remote",
  category: "meta",
  description: "📡 CLONE — auto-capture the CURRENT live session + upload to an anonymous paste service (dpaste.com, 1-day expiry) and return a public short URL + QR. For cross-network handoff (different WiFi, cellular, different city).",
  whenToUse: "User says 'send to my other PC at home', 'cross-network', 'phone is on cellular', 'ส่งไปคอมอื่น', 'ส่งข้ามเครือข่าย'.",
  triggers: [
    "cross network", "different wifi", "cellular", "remote handoff",
    "another PC", "another laptop", "send to colleague",
    "ส่งไปคอมอื่น", "ส่งข้ามเครือข่าย", "ส่งทางไกล", "ส่งให้เพื่อน",
  ],
  inputSchema: {
    type: "object",
    properties: {
      receivingVendor: { type: "string" },
      lastN: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "ส่งสมองไปคอมที่บ้าน", args: {}, expectedOutput: "{ url, qrDataUri, expiresAt }" }],
  pitfalls: [
    "PUBLIC paste — DO NOT use for sessions that contain secrets / PII.",
    "Requires internet at call-time.",
  ],
  composeWith: ["mneme.clone.qr"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.clone.cloneViaRelay(repoRootOf(rt), {
      receivingVendor: args["receivingVendor"] as string | undefined,
      lastN: args["lastN"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r.url ? `Soul posted to ${r.url} (expires ${r.expiresAt ?? "soon"}).` : "Remote relay failed — no internet?",
      confidence: { level: r.url ? "high" : "low", notes: "Public paste — share only what you'd post publicly." },
    };
  },
};

export const CLONE_TOOLS: MnemeTool[] = [
  cloneToClipboardTool,
  cloneViaQrTool,
  cloneViaRemoteTool,
];
