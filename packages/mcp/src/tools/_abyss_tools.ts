/**
 * v1.76.0 -- MCP wrappers for ABYSS PROTOCOL (3 minions).
 */

import { resolve } from "node:path";

import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const scythePruneTool: MnemeTool = {
  name: "mneme.abyss.scythe.prune",
  category: "meta",
  description:
    "SCYTHE -- prune `.mneme/capsules/` according to TTL (default 30 days) + max-count cap (default 200). Keeps capsules marked `keep:true`. Writes audit log to `.mneme/abyss/scythe.jsonl`.",
  whenToUse:
    "Nightly automatic; manual when capsule directory looks bloated. Pass dryRun:true to preview without deleting.",
  triggers: ["prune capsules", "capsule TTL", "clean session"],
  inputSchema: {
    type: "object",
    properties: {
      ttlMs: { type: "integer" },
      maxCount: { type: "integer" },
      dryRun: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Capsule folder is huge -- clean it up", args: {}, expectedOutput: "Prune report with byte reclamation." },
  ],
  pitfalls: ["Default TTL is 30 days. Pass a larger ttlMs if you want longer retention.", "Always uses the current working directory as repoRoot."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const r = core.abyss.pruneCapsules(repoRoot, {
      ttlMs: args["ttlMs"] as number | undefined,
      maxCount: args["maxCount"] as number | undefined,
      dryRun: Boolean(args["dryRun"]),
    });
    const headline = r.dryRun
      ? `dry-run: would prune ${r.prunedCount}/${r.scannedCount} capsules (${r.bytesReclaimed} bytes)`
      : `pruned ${r.prunedCount}/${r.scannedCount} capsules (${r.bytesReclaimed} bytes reclaimed)`;
    return {
      data: r,
      wisdom: headline,
      confidence: { level: "high" },
    };
  },
};

export const revenantArchiveTool: MnemeTool = {
  name: "mneme.abyss.revenant.archive",
  category: "meta",
  description:
    "REVENANT -- archive a soul prompt to `.mneme/abyss/souls/<id>.json` for later replay. Git-reflog for cross-vendor handovers.",
  whenToUse: "Automatic on every soul-prompt generation. Manual when the user says 'save this brain for later'.",
  triggers: ["archive soul", "save brain", "reflog"],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      vendor: { type: "string" },
      fingerprint: { type: "string" },
      destinationVendor: { type: "string" },
    },
    required: ["text", "vendor", "fingerprint"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Save this soul for later", args: {}, expectedOutput: "{ id, createdAt, ... }" }],
  pitfalls: ["No size cap on archive directory yet -- pair with SCYTHE for full hygiene."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const entry = core.abyss.archiveSoul(repoRoot, {
      text: String(args["text"] ?? ""),
      vendor: String(args["vendor"] ?? ""),
      fingerprint: String(args["fingerprint"] ?? ""),
      destinationVendor: args["destinationVendor"] as string | undefined,
    });
    return {
      data: entry,
      wisdom: `Archived soul ${entry.id} (${entry.length} chars).`,
      confidence: { level: "high" },
    };
  },
};

export const revenantListTool: MnemeTool = {
  name: "mneme.abyss.revenant.list",
  category: "meta",
  description: "REVENANT -- list archived souls (newest first). Filter by vendor / used / unused.",
  whenToUse: "User asks 'show me past handovers' or 'which souls have been used'.",
  triggers: ["list souls", "soul history", "past handovers"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      usedOnly: { type: "boolean" },
      unusedOnly: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What past souls do I have?", args: {}, expectedOutput: "Array of archived souls newest-first." }],
  pitfalls: ["Returns the full text per entry; can be heavy if archive is large -- consider adding a `summary` flag in future."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const list = core.abyss.listSouls(repoRoot, {
      vendor: args["vendor"] as string | undefined,
      usedOnly: Boolean(args["usedOnly"]),
      unusedOnly: Boolean(args["unusedOnly"]),
    });
    return {
      data: list,
      wisdom: `${list.length} archived soul(s).`,
      confidence: { level: "high" },
    };
  },
};

export const homunculusRequestTool: MnemeTool = {
  name: "mneme.abyss.homunculus.request",
  category: "meta",
  description:
    "HOMUNCULUS -- render a write-back contract block to append to a soul prompt. The foreign AI returns decisions / reasoning / next-actions in a structured format the local Mneme can ingest.",
  whenToUse: "Embed in soul prompts when the originating AI wants the receiving AI to RETURN its own brain at session end.",
  triggers: ["write-back contract", "receiver returns soul"],
  inputSchema: {
    type: "object",
    properties: {
      originatorVendor: { type: "string" },
      ask: { type: "array", items: { type: "string" } },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Tell ChatGPT to send its brain back when done", args: {}, expectedOutput: "Markdown contract block." }],
  pitfalls: ["Some receivers will ignore the contract. Treat as best-effort."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const md = core.abyss.renderHomunculusRequest({
      originatorVendor: args["originatorVendor"] as string | undefined,
      ask: args["ask"] as ("decisions" | "reasoning" | "vaccines" | "next-actions")[] | undefined,
    });
    return {
      data: { contract: md },
      wisdom: `Homunculus request block ready (${md.length} chars).`,
      confidence: { level: "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const homunculusIngestTool: MnemeTool = {
  name: "mneme.abyss.homunculus.ingest",
  category: "meta",
  description:
    "HOMUNCULUS -- parse a pasted `# HOMUNCULUS RETURN` block from a foreign AI and surface the decisions / reasoning / vaccines / next-actions back to the local Mneme.",
  whenToUse: "After the user pastes a return block from ChatGPT/Gemini back into their editor AI.",
  triggers: ["homunculus return", "ingest return", "receiver replied"],
  inputSchema: {
    type: "object",
    properties: { pastedText: { type: "string" } },
    required: ["pastedText"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "I got this back from ChatGPT, ingest it.", args: { pastedText: "# HOMUNCULUS RETURN\n..." }, expectedOutput: "Parsed sections + summary." },
  ],
  pitfalls: ["If the foreign AI didn't follow the exact contract, parse returns null."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const parsed = core.abyss.parseHomunculusReturn(String(args["pastedText"] ?? ""));
    if (!parsed) {
      return {
        data: { parsed: null },
        wisdom: "No HOMUNCULUS RETURN block found in pasted text.",
        confidence: { level: "high" },
      };
    }
    const summary = core.abyss.summarizeHomunculusReturn(parsed);
    return {
      data: parsed,
      wisdom: summary,
      confidence: { level: "high" },
    };
  },
};

export const ABYSS_TOOLS: MnemeTool[] = [
  scythePruneTool,
  revenantArchiveTool,
  revenantListTool,
  homunculusRequestTool,
  homunculusIngestTool,
];
