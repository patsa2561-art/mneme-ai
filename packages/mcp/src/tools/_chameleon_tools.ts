/**
 * v1.86.0 -- MCP wrappers for CHAMELEON PROTOCOL.
 */

import { resolve } from "node:path";

import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const chameleonProbeTool: MnemeTool = {
  name: "mneme.chameleon.probe",
  category: "meta",
  description:
    "CHAMELEON probe -- detect git/CI/CODEOWNERS/ownership for this repo without any external API calls. Used to gate spore push + recommend transports.",
  whenToUse: "Before any cross-machine action when you're unsure if git push is safe.",
  triggers: ["probe env", "is this repo safe", "check spore safety"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this repo safe for spore push?", args: {}, expectedOutput: "{ pushRisky, riskReasons[] }" }],
  pitfalls: ["Heuristics only. CODEOWNERS without rules still counts as 'present'."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const env = core.chameleon.probeEnvironment(repoRootOf(rt));
    return {
      data: env,
      wisdom: env.pushRisky ? `risky: ${env.riskReasons.join("; ")}` : "repo looks safe for spore push",
      confidence: { level: "high" },
    };
  },
};

export const chameleonSelectTool: MnemeTool = {
  name: "mneme.chameleon.select_transport",
  category: "meta",
  description:
    "CHAMELEON -- pick the SAFEST transport for a destination given the current repo's environment. Refuses to recommend spore-git on risky repos.",
  whenToUse: "Source AI decides which transport to use; this tool returns the recommendation + fallbacks + warnings.",
  triggers: ["select transport", "pick best path", "which transport"],
  inputSchema: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        enum: ["same-pc-other-ai", "same-wifi-other-device", "phone-or-mobile-app", "different-network-personal", "offline-usb", "continuous-sync"],
      },
    },
    required: ["destination"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Best transport for my phone?",
      args: { destination: "phone-or-mobile-app" },
      expectedOutput: "{ primary: 'relay-paste', fallbacks: [...] }",
    },
  ],
  pitfalls: ["Warnings array is non-empty when the env probe flagged risks; surface them to the user."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = core.chameleon.probeEnvironment(repoRootOf(rt));
    const r = core.chameleon.selectTransport(args["destination"] as Parameters<typeof core.chameleon.selectTransport>[0], env);
    return {
      data: { recommendation: r, env },
      wisdom: `recommended: ${r.primary}${r.fallbacks.length > 0 ? ` (fallback: ${r.fallbacks.join(", ")})` : ""}`,
      confidence: { level: r.warnings.length === 0 ? "high" : "medium" },
    };
  },
};

export const chameleonOptInTool: MnemeTool = {
  name: "mneme.chameleon.spore_opt_in",
  category: "meta",
  description:
    "CHAMELEON -- write the explicit spore OPT_IN marker after the user acknowledged the env risks. Without this marker, spore push REFUSES (default OFF in v1.86+).",
  whenToUse:
    "User has reviewed env risks (from mneme.chameleon.probe) and explicitly says 'yes, push to my git remote'. Only call after explicit consent.",
  triggers: ["opt in spore", "enable spore push", "acknowledge git push"],
  inputSchema: {
    type: "object",
    properties: { acknowledgement: { type: "string", description: "What the user agreed to, free text." } },
    required: ["acknowledgement"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "I understand the risks; enable spore", args: { acknowledgement: "ack" }, expectedOutput: "{ ok: true, path: '.mneme/spore/OPT_IN' }" }],
  pitfalls: ["Never call without first showing the user the env probe risks. This is a privacy-sensitive operation."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chameleon.writeSporeOptIn(repoRootOf(rt), String(args["acknowledgement"] ?? "acknowledged"));
    return {
      data: r,
      wisdom: r.ok ? "spore opt-in recorded" : "opt-in write failed",
      confidence: { level: "high" },
    };
  },
};

export const chameleonGateTool: MnemeTool = {
  name: "mneme.chameleon.spore_gate",
  category: "meta",
  description: "CHAMELEON -- evaluate whether spore push is allowed in this repo right now. Returns the full decision + env probe + opt-in state.",
  whenToUse: "Source AI is about to call spore push; ALWAYS gate first.",
  triggers: ["check spore gate", "can I push"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Can I push spore right now?", args: {}, expectedOutput: "{ allow: false, howToOptIn: '...' }" }],
  pitfalls: ["Default after v1.86 is allow=false until OPT_IN is written. This is intentional safety."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const d = core.chameleon.sporeGate(repoRootOf(rt));
    return {
      data: d,
      wisdom: d.allow ? "spore push ALLOWED" : `spore push REFUSED: ${d.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const CHAMELEON_TOOLS: MnemeTool[] = [chameleonProbeTool, chameleonSelectTool, chameleonOptInTool, chameleonGateTool];
