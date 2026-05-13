/**
 * v1.89.0 -- MCP wrappers for RAINBOW PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const rainbowProbeTool: MnemeTool = {
  name: "mneme.rainbow.probe",
  category: "meta",
  description:
    "RAINBOW -- probe which handoff channels are live right now (LAN HTTP server / data: URL bridge / dpaste raw / roadmap channels). Returns recommended channel + per-channel scenario coverage.",
  whenToUse:
    "Before generating a handoff: ask which channels work in the current network state. Source AI then renders the appropriate QR(s).",
  triggers: ["probe channels", "which transport works", "rainbow status"],
  inputSchema: {
    type: "object",
    properties: {
      soulText: { type: "string" },
      lanUrl: { type: "string" },
      dpasteUrl: { type: "string" },
    },
    required: ["soulText"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Which channels are live for handoff right now?",
      args: { soulText: "...", lanUrl: "http://192.168.1.10:7741", dpasteUrl: "https://dpaste.com/x" },
      expectedOutput: "{ recommended: 'data-bridge', channels: [...] }",
    },
  ],
  pitfalls: [
    "v1.89 ships only LAN + data-bridge + dpaste-raw. ggwave/cloudflared/webrtc are roadmap (v1.90); they always show available=false.",
    "data-bridge is recommended over LAN when both work because it covers more network scenarios.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const fakeSoul = { text: String(args["soulText"] ?? ""), estTokens: 0, id: "", hmac: null };
    const report = core.rainbow.probeChannels(fakeSoul, {
      lanUrl: (args["lanUrl"] as string | undefined) ?? null,
      dpasteUrl: (args["dpasteUrl"] as string | undefined) ?? null,
    });
    return {
      data: report,
      wisdom: report.summary,
      confidence: { level: report.recommended ? "high" : "low" },
    };
  },
};

export const rainbowDataBridgeTool: MnemeTool = {
  name: "mneme.rainbow.data_bridge",
  category: "meta",
  description:
    "RAINBOW -- build the data: URL bridge for a dpaste URL. Returns a `data:text/html` URL that, when scanned via QR, opens a self-contained HTML page on the phone that fetches the soul + renders a Web Share button. Works on ANY network.",
  whenToUse: "Cross-network handoff when LAN bridge isn't reachable. The wild move: HTML page lives in the QR.",
  triggers: ["data url bridge", "qr-embedded handoff"],
  inputSchema: {
    type: "object",
    properties: { dpasteUrl: { type: "string" } },
    required: ["dpasteUrl"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Build the data: URL for this dpaste",
      args: { dpasteUrl: "https://dpaste.com/abc.txt" },
      expectedOutput: "{ url: 'data:text/html;charset=utf-8,...' }",
    },
  ],
  pitfalls: [
    "Mobile browser must allow data: URL navigation from camera scans (most do).",
    "The QR holding the data: URL must be high-density; phone scanner needs a clear high-contrast camera shot.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const url = core.rainbow.buildDataBridgeUrl(String(args["dpasteUrl"] ?? ""));
    return {
      data: { url, bytes: url.length },
      wisdom: `data: URL bridge ${url.length} chars`,
      confidence: { level: "high" },
    };
  },
};

export const rainbowTunnelTool: MnemeTool = {
  name: "mneme.rainbow.tunnel_detect",
  category: "meta",
  description:
    "RAINBOW v1.90 -- detect cloudflared on PATH (free quick tunnels, no account). Returns availability + version + install hint per OS. Caller starts a tunnel separately when available.",
  whenToUse: "Before generating a cross-network handoff: check if cloudflared can give us a public HTTPS URL.",
  triggers: ["detect tunnel", "cloudflared check", "is tunnel available"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is cloudflared installed?", args: {}, expectedOutput: "{ available: true, version: '...', installHint: '...' }" }],
  pitfalls: ["Detection is on-demand; cloudflared can be installed mid-session and re-detected next call."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const r = core.rainbow.detectCloudflared();
    return {
      data: r,
      wisdom: r.available ? `cloudflared ${r.version} at ${r.path}` : `cloudflared not found -- install: ${r.installHint}`,
      confidence: { level: "high" },
    };
  },
};

export const rainbowMultiPasteTool: MnemeTool = {
  name: "mneme.rainbow.multi_paste",
  category: "meta",
  description:
    "RAINBOW v1.90 -- upload soul to public paste with automatic backend fallback (dpaste → paste.rs → 0x0.st). Handles rate limits + transient failures.",
  whenToUse: "Cross-network handoff. Always try this before falling back to local-only modes.",
  triggers: ["upload paste", "publish soul", "paste with fallback"],
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string" },
      order: { type: "array", items: { type: "string" } },
      retryWaitMs: { type: "integer" },
    },
    required: ["content"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Upload soul with fallback", args: { content: "..." }, expectedOutput: "{ ok: true, url: '...', backend: 'dpaste', attempts: [...] }" },
  ],
  pitfalls: [
    "Default retryWaitMs is 1100ms (dpaste 1 req/sec); lowering risks rate-limit cascade.",
    "Returns ok=false with full attempt log when ALL backends fail.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.rainbow.uploadResilient({
      content: String(args["content"] ?? ""),
      order: args["order"] as ("dpaste" | "pasters" | "zero-x-zero")[] | undefined,
      retryWaitMs: args["retryWaitMs"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r.ok
        ? `uploaded via ${r.backend} (${r.totalMs}ms, ${r.attempts.length} attempt${r.attempts.length === 1 ? "" : "s"})`
        : `all backends failed: ${r.attempts.map((a) => `${a.backend}=${a.reason ?? "?"}`).join("; ")}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const RAINBOW_TOOLS: MnemeTool[] = [rainbowProbeTool, rainbowDataBridgeTool, rainbowTunnelTool, rainbowMultiPasteTool];
