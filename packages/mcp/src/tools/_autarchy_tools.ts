/**
 * v1.66.0 -- MCP wrapper for AUTARCHY PROTOCOL.
 *
 * One tool returns the 0..100 self-sufficiency score across all four
 * axes (mesh-as-cloud / Schroedinger embedder / timecrystal
 * pharmacopoeia / quantum checksum). install=true triggers the
 * one-time setup (baked vaccine install + embedder probe + pin).
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const autarchyStatusTool: MnemeTool = {
  name: "mneme.autarchy.status",
  category: "meta",
  description: "AUTARCHY PROTOCOL -- self-sufficiency score 0..100 across four axes (mesh-as-cloud, Schroedinger embedder, timecrystal pharmacopoeia, quantum checksum pin). One call surfaces every external-dependency gap + recommendations to close it. install=true seeds baked vaccines + probes embedders + pins checksums.",
  whenToUse: "First-run setup; periodic self-audit; whenever the pulse reports external-dependency degradation.",
  triggers: ["autarchy", "self-sufficient", "offline ready", "mneme alone", "pึ่งตนเอง", "ตรวจความพร้อม"],
  inputSchema: {
    type: "object",
    properties: {
      install: { type: "boolean", description: "Install baked pharmacopoeia + probe embedder + pin checksums (idempotent)." },
      forceEmbedderProbe: { type: "boolean" },
      skipOllama: { type: "boolean" },
      skipBundled: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run autarchy status with install", args: { install: true }, expectedOutput: "Score + 4 axes + recommendations." }],
  pitfalls: ["First install=true call writes to .mneme/ -- safe but explicit setup."],
  composeWith: ["mneme.embedder.autodiagnose", "mneme.compliance.window"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const rep = await core.autarchy.autarchy(root, {
      install: Boolean(args["install"]),
      forceEmbedderProbe: Boolean(args["forceEmbedderProbe"]),
      skipOllama: Boolean(args["skipOllama"]),
      skipBundled: Boolean(args["skipBundled"]),
    });
    return {
      data: rep,
      wisdom: rep.headline,
      confidence: { level: rep.score >= 70 ? "high" : "medium" },
      secondBrain: {
        presentation: `Render score prominently. List 4 axes succinctly. Quote recommendations as numbered list. Do not show raw JSON.`,
      },
    };
  },
};

export const AUTARCHY_TOOLS: MnemeTool[] = [autarchyStatusTool];
