/**
 * v1.65.1 -- MCP wrappers for embedder autodiagnose + windowed compliance.
 *
 * Two tools that fix the v1.65 residual signals:
 *   - mneme.embedder.autodiagnose  (root-cause check: WASM works but
 *     config says hash; auto-upgrades on persist=true)
 *   - mneme.compliance.window      (30-day sliding-window rate so
 *     historical Windows-lock failures stop dragging the metric)
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const embedderAutodiagnoseTool: MnemeTool = {
  name: "mneme.embedder.autodiagnose",
  category: "meta",
  description: "Probe all embedder tiers (openai / ollama / bundled WASM / hash), detect upgrade gap vs the configured provider, and (with persist=true) auto-upgrade .mneme/config.json. Fixes the 'stuck on hash tier' state when WASM/Ollama is actually reachable.",
  whenToUse: "When the pulse reports degraded memory tier; once per repo on first setup; after installing/starting Ollama.",
  triggers: ["embedder check", "memory tier", "upgrade embeddings", "ตรวจ embedder", "hash tier"],
  inputSchema: {
    type: "object",
    properties: {
      persist: { type: "boolean", description: "When true, rewrite .mneme/config.json to the best available tier." },
      skipOllama: { type: "boolean" },
      skipBundled: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Check my embedder tier", args: { persist: false }, expectedOutput: "Probes + currentTier + bestAvailable + recommendation." }],
  pitfalls: ["Persist=true rewrites config; safe but explicit upgrade.", "Bundled probe imports @huggingface/transformers (~50ms first time)."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.embedderAutodiagnose.autodiagnose(repoRootOf(rt), {
      persist: Boolean(args["persist"]),
      skipOllama: Boolean(args["skipOllama"]),
      skipBundled: Boolean(args["skipBundled"]),
    });
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
    };
  },
};

export const complianceWindowTool: MnemeTool = {
  name: "mneme.compliance.window",
  category: "meta",
  description: "Compute windowed compliance stats over the last N days (default 30). Avoids legacy failures dragging the lifetime rate down once their root cause is fixed. Returns rate-in-window + excluded-older count + lifetime breakdown.",
  whenToUse: "When current compliance metric looks worse than recent reality (historical-failure tail).",
  triggers: ["compliance rate", "compliance window", "30-day compliance", "อัตรา compliance"],
  inputSchema: { type: "object", properties: { windowDays: { type: "number", description: "Window size, default 30." } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compliance over last 30 days", args: { windowDays: 30 }, expectedOutput: "Rate + total + excluded-older + per-mandate breakdown." }],
  pitfalls: ["Entries with invalid timestamps are excluded; small log can give a brittle rate."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const entries = core.aiCompliance.readComplianceLog(root, 1000);
    const days = args["windowDays"] !== undefined ? Number(args["windowDays"]) : 30;
    const windowed = core.aiCompliance.computeWindowedComplianceStats(entries, days);
    const ratePct = (windowed.inlineComplianceRate * 100).toFixed(1);
    return {
      data: windowed,
      wisdom: `${ratePct}% compliance over the last ${days} days (${windowed.total} entries; ${windowed.excludedOlderCount} legacy entries excluded).`,
      confidence: { level: windowed.total >= 3 ? "high" : "low", notes: windowed.total < 3 ? "Window has very few entries; rate may be brittle." : undefined },
    };
  },
};

export const TUNE_TOOLS: MnemeTool[] = [
  embedderAutodiagnoseTool,
  complianceWindowTool,
];
