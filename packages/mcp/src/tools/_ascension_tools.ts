/**
 * v1.68.0 -- MCP wrappers for ASCENSION PROTOCOL.
 *
 * Single aggregate tool surfaces all 6 axes; per-axis tools available
 * for targeted use.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const ascensionStatusTool: MnemeTool = {
  name: "mneme.ascension.status",
  category: "meta",
  description: "ASCENSION PROTOCOL -- 6-axis improvement layer over existing Mneme. Surfaces circadian heartbeat, superposed antivirus cache hit rate, conformal apoptosis effective precision, prophetic embedder drift, sovereign-mode label, alert-vs-routine inbox separation.",
  whenToUse: "Periodic health audit; after any v1.65/1.66/1.67 ship; when investigating why a metric isn't at 100%.",
  triggers: ["ascension", "improvement audit", "ดันคะแนน", "push to 100"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run ascension audit", args: {}, expectedOutput: "6-axis score + recommendations." }],
  pitfalls: ["Pure-read; each axis must be activated separately for full credit."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const inbox = core.inbox.readInbox(repoRootOf(rt));
    const a = core.ascension.ascensionAudit(repoRootOf(rt), {
      inboxMessages: inbox.map((m) => ({ id: m.id, createdAt: m.createdAt, priority: m.priority, source: m.source, title: m.title, sent: m.sent })),
    });
    return {
      data: a,
      wisdom: a.headline,
      confidence: { level: a.score >= 70 ? "high" : "medium" },
    };
  },
};

export const ascensionConformalBenchTool: MnemeTool = {
  name: "mneme.ascension.conformal.bench",
  category: "meta",
  description: "Run the CONFORMAL APOPTOSIS bench -- adds UNCERTAIN tier to push auto-decided precision toward 100% (uncertain cases punt to human review). Reports precision/coverage delta vs raw APOPTOSIS.",
  whenToUse: "Verify the UNCERTAIN tier is working; quarterly precision audit.",
  triggers: ["conformal bench", "uncertain tier", "precision push"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Conformal bench", args: {}, expectedOutput: "autoPrecision + coverage + uncertain count." }],
  pitfalls: ["Bench mutates state; use tmp repo for pristine."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.ascension.runConformalBench(repoRootOf(rt));
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
    };
  },
};

export const ascensionProphecyTool: MnemeTool = {
  name: "mneme.ascension.prophecy",
  category: "meta",
  description: "ASC-4 PROPHETIC EMBEDDER -- compare config tier vs Schroedinger winner vs indexer-last-tier. Detects + reports specific drift cause with a named fix step.",
  whenToUse: "When pulse reports hash:fnv-256 despite config saying ollama; suspected embedder drift.",
  triggers: ["embedder prophecy", "tier drift", "ตรวจ embedder drift"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Why is mneme on hash tier?", args: {}, expectedOutput: "Config/Schroedinger/meta diagnosis + fix." }],
  pitfalls: ["If sources aligned, returns 'aligned' headline + no fix needed."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const p = core.ascension.prophecy(repoRootOf(rt));
    return {
      data: p,
      wisdom: core.ascension.prophecyHeadline(p),
      confidence: { level: "high" },
    };
  },
};

export const ascensionSovereignTool: MnemeTool = {
  name: "mneme.ascension.sovereign",
  category: "meta",
  description: "ASC-5 SOVEREIGN MODE -- distinguish intentional-offline from broken-offline. enable=true marks the cloud as intentionally off; classifyCloud returns SOVEREIGN instead of OFFLINE.",
  whenToUse: "After destroying cloud infra intentionally; when user wants local-first label not error.",
  triggers: ["sovereign mode", "local-first label", "ปิด cloud โดยตั้งใจ"],
  inputSchema: {
    type: "object",
    properties: {
      enable: { type: "boolean" },
      reason: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Enable sovereign mode -- destroyed DO droplet", args: { enable: true, reason: "DO destroyed 2026-05-12" }, expectedOutput: "Verdict SOVEREIGN + reason recorded." }],
  pitfalls: ["enable=false re-allows OFFLINE labeling."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    if (args["enable"]) {
      const s = core.ascension.enableSovereign(root, String(args["reason"] ?? "user opt-in"));
      return { data: s, wisdom: `Sovereign mode ENABLED: ${s.reason}`, confidence: { level: "high" } };
    } else if (args["enable"] === false) {
      core.ascension.disableSovereign(root);
      return { data: { enabled: false }, wisdom: "Sovereign mode DISABLED.", confidence: { level: "high" } };
    }
    const s = core.ascension.readSovereignState(root);
    return { data: s, wisdom: s?.enabled ? `SOVEREIGN: ${s.reason}` : "Not in sovereign mode.", confidence: { level: "high" } };
  },
};

export const ASCENSION_TOOLS: MnemeTool[] = [
  ascensionStatusTool,
  ascensionConformalBenchTool,
  ascensionProphecyTool,
  ascensionSovereignTool,
];
