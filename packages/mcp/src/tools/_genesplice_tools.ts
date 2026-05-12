/**
 * v1.73.0 -- MCP wrappers for GENESPLICE PROTOCOL.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const genespliceTransmitTool: MnemeTool = {
  name: "mneme.genesplice.transmit",
  category: "meta",
  description: "GENESPLICE -- compress current session into a ~500-token portable soul prompt + optional GitHub-gist-ready package. User pastes the soul prompt into ANY other AI (Gemini, ChatGPT, Claude.ai, Copilot, DeepSeek) and that AI is reincarnated with the Mneme context. ZERO INSTALL.",
  whenToUse: "User wants to continue this conversation in a different AI tool (cross-vendor handoff via copy-paste).",
  triggers: ["transmit brain", "cross-vendor handover", "paste-able session", "ย้ายสมอง"],
  inputSchema: {
    type: "object",
    properties: {
      capsuleId: { type: "string", description: "Optional capsule id to transmit (otherwise constructs from current session)." },
      receivingVendor: { type: "string", description: "Optional receiving vendor for phenotype expression." },
      includeGistPackage: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Transmit session to Gemini", args: { receivingVendor: "gemini-pro" }, expectedOutput: "Soul prompt + Gemini phenotype + gist package." }],
  pitfalls: ["The soul prompt is ~500 tokens; works in any AI but loses fidelity vs full capsule."],
  composeWith: ["mneme.diaspora.capsule.save"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const capsuleId = args["capsuleId"] as string | undefined;
    const receivingVendor = args["receivingVendor"] as string | undefined;
    const includeGist = Boolean(args["includeGistPackage"]);

    // Load the source capsule (latest if id not specified).
    const allCapsules = core.diaspora.listCapsules(root);
    const cap = capsuleId ? allCapsules.find((c) => c.id === capsuleId) : allCapsules[0];
    if (!cap) {
      return {
        data: { error: "no capsule available -- call mneme.diaspora.capsule.save first" },
        wisdom: "No capsule found; save one first.",
        confidence: { level: "low" },
      };
    }
    const soul = core.genesplice.compressToSoulPrompt({ capsule: cap });
    const tailored = receivingVendor
      ? core.genesplice.expressSoulForVendor(soul.text, receivingVendor, cap.originVendor)
      : soul.text;
    const gist = includeGist ? core.genesplice.packageGist({ capsule: cap }) : null;

    return {
      data: { soul, tailored, gist },
      wisdom: `Brain compressed to ~${soul.estTokens} tokens. ${receivingVendor ? `Tailored for ${receivingVendor}.` : "Paste as-is into any AI."}`,
      confidence: { level: "high" },
      secondBrain: { presentation: tailored },
    };
  },
};

export const genespliceIngestTool: MnemeTool = {
  name: "mneme.genesplice.ingest",
  category: "meta",
  description: "GENESPLICE -- parse a pasted soul prompt back into structured fields. Use when an AI session was started by pasting a soul-prompt from another vendor.",
  whenToUse: "First message of a new session where user pastes a soul prompt.",
  triggers: ["ingest soul", "parse soul prompt", "resume from paste"],
  inputSchema: { type: "object", properties: { text: { type: "string" }, secret: { type: "string" } }, required: ["text"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Ingest this soul", args: { text: "..." }, expectedOutput: "Parsed origin + decisions + recent turns + verdict." }],
  pitfalls: ["INVALID_HMAC if cluster secret differs across vendors -- accept with caveat."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const parsed = core.genesplice.parseSoulPrompt(String(args["text"] ?? ""), args["secret"] as string | undefined);
    return {
      data: parsed,
      wisdom: `Soul parsed: vendor=${parsed.originVendor}, ${parsed.decisions.length} decision(s), ${parsed.recentTurns.length} turn(s), verdict=${parsed.verdict}.`,
      confidence: { level: parsed.verdict === "VALID" ? "high" : "medium" },
    };
  },
};

export const genespliceRecombineTool: MnemeTool = {
  name: "mneme.genesplice.recombine",
  category: "meta",
  description: "GENESPLICE -- merge N capsules from different vendors into a single SUPER-GENOME. Identifies consensus wisdom (vendors agreed) + unique-to-vendor wisdom (gap-fillers). The 'gene-splicing' the user asked for.",
  whenToUse: "User has worked with multiple AIs on the same project and wants the combined wisdom.",
  triggers: ["recombine genomes", "hybrid genome", "merge AI memories"],
  inputSchema: { type: "object", properties: { capsuleIds: { type: "array", items: { type: "string" } } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Merge claude + gemini capsules", args: { capsuleIds: ["abc", "def"] }, expectedOutput: "Hybrid capsule + consensus + unique." }],
  pitfalls: ["At least 2 capsules needed for meaningful recombination."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const all = core.diaspora.listCapsules(root);
    const ids = (args["capsuleIds"] ?? []) as string[];
    const selected = ids.length === 0
      ? all.slice(0, 3) // newest 3 if user didn't specify
      : all.filter((c) => ids.includes(c.id));
    const hybrid = core.genesplice.recombineGenome({ capsules: selected });
    const consensus = core.genesplice.consensusWisdom(hybrid);
    const unique = core.genesplice.uniqueWisdom(hybrid);
    return {
      data: { hybrid, consensus, unique },
      wisdom: hybrid.headline,
      confidence: { level: selected.length >= 2 ? "high" : "low" },
    };
  },
};

export const GENESPLICE_TOOLS: MnemeTool[] = [
  genespliceTransmitTool,
  genespliceIngestTool,
  genespliceRecombineTool,
];
