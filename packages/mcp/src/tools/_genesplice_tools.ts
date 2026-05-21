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
      capsuleId: { type: "string", description: "Optional capsule id to transmit (otherwise auto-captures the CURRENT live session via live_session_mirror; falls back to newest stored capsule)." },
      receivingVendor: { type: "string", description: "Optional receiving vendor for phenotype expression." },
      includeGistPackage: { type: "boolean" },
      preferStored: { type: "boolean", description: "v2.19.94: skip live-session capture; force using stored capsules only (newest first). Default false." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Transmit session to Gemini", args: { receivingVendor: "gemini-pro" }, expectedOutput: "Soul prompt + Gemini phenotype + gist package." }],
  pitfalls: ["The soul prompt is ~500 tokens; works in any AI but loses fidelity vs full capsule.", "v2.19.94: live-session capture requires the AI editor to write its conversation to a local jsonl (Claude Code does; Cursor does not yet)."],
  composeWith: ["mneme.diaspora.capsule.save", "mneme.session.live_capture"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const capsuleId = args["capsuleId"] as string | undefined;
    const receivingVendor = args["receivingVendor"] as string | undefined;
    const includeGist = Boolean(args["includeGistPackage"]);
    const preferStored = Boolean(args["preferStored"]);

    // v2.19.94 — LIVE SESSION MIRROR.  When no explicit capsuleId is
    // given AND the caller hasn't opted out via preferStored, try to
    // read the CURRENT Claude Code conversation directly from
    // `~/.claude/projects/.../<sessionId>.jsonl`.  This fixes the bug
    // where transmit returned stale capsules from days ago.
    let cap: any = null;
    let captureSource: "live" | "stored" | "explicit" = "stored";
    if (capsuleId) {
      const allCapsules = core.diaspora.listCapsules(root);
      cap = allCapsules.find((c) => c.id === capsuleId);
      captureSource = "explicit";
    } else if (!preferStored) {
      cap = core.liveSessionMirror.captureLiveCapsule(root, { lastN: 30 });
      if (cap) captureSource = "live";
    }
    if (!cap) {
      const allCapsules = core.diaspora.listCapsules(root);
      cap = allCapsules[0];
      captureSource = "stored";
    }
    if (!cap) {
      return {
        data: { error: "no capsule available — no live session detected and no stored capsule found. Open Claude Code in this repo or call mneme.diaspora.capsule.save first." },
        wisdom: "No capsule found; save one first or run from inside a Claude Code session.",
        confidence: { level: "low" },
      };
    }
    const soul = core.genesplice.compressToSoulPrompt({ capsule: cap });
    const tailored = receivingVendor
      ? core.genesplice.expressSoulForVendor(soul.text, receivingVendor, cap.originVendor)
      : soul.text;
    const gist = includeGist ? core.genesplice.packageGist({ capsule: cap }) : null;

    const freshnessNote = captureSource === "live"
      ? "Captured from the CURRENT live Claude Code session (fresh)."
      : captureSource === "explicit"
        ? `Used explicit capsuleId=${capsuleId}.`
        : "No live session found; fell back to newest stored capsule.";

    return {
      data: { soul, tailored, gist, captureSource, freshnessNote },
      wisdom: `Brain compressed to ~${soul.estTokens} tokens. ${freshnessNote} ${receivingVendor ? `Tailored for ${receivingVendor}.` : "Paste as-is into any AI."}`,
      confidence: { level: captureSource === "live" ? "high" : captureSource === "explicit" ? "high" : "medium" },
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

/** v2.19.94 — explicit MCP surface for the live-session mirror so AI
 *  agents can grab the current brain without going through the full
 *  genesplice transmit pipeline. */
export const sessionLiveCaptureTool: MnemeTool = {
  name: "mneme.session.live_capture",
  category: "meta",
  description: "🪞 LIVE SESSION MIRROR — capture the CURRENT live AI editor session (Claude Code's local jsonl) as a SessionCapsule-shaped object marked isLive:true. Fixes v2.19.93 bug where genesplice transmit returned stale capsules.",
  whenToUse: "AI agent needs the CURRENT conversation (not a stale stored capsule) to feed into a handoff / gist / beacon flow.",
  triggers: ["capture current session", "live brain", "fresh capsule", "ดึง session ปัจจุบัน"],
  inputSchema: {
    type: "object",
    properties: {
      lastN: { type: "number", description: "How many recent turns to include (default 25)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Grab live session", args: { lastN: 30 }, expectedOutput: "{ capsule, freshness }" }],
  pitfalls: ["Returns null when no Claude Code session matches the current repoRoot.", "Drops tool_use / thinking / pure-tool_result turns by design — they're noise."],
  composeWith: ["mneme.genesplice.transmit"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const lastN = (args["lastN"] as number | undefined) ?? 25;
    const cap = core.liveSessionMirror.captureLiveCapsule(root, { lastN });
    if (!cap) {
      return {
        data: { capsule: null },
        wisdom: "No live session detected. Open this repo in Claude Code first.",
        confidence: { level: "low" },
      };
    }
    return {
      data: { capsule: cap, freshness: { createdAt: cap.createdAt, turnCount: cap.promptTrace.length, sourceFile: cap.sourceFile } },
      wisdom: `Live brain captured: ${cap.promptTrace.length} turn(s), from ${cap.sourceFile}.`,
      confidence: { level: "high" },
    };
  },
};

export const GENESPLICE_TOOLS: MnemeTool[] = [
  genespliceTransmitTool,
  genespliceIngestTool,
  genespliceRecombineTool,
  sessionLiveCaptureTool,
];
