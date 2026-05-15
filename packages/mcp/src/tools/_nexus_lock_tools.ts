/**
 * v2.10.0 -- MCP wrappers for NEXUS-LOCK.
 *
 *   mneme.handoff.fresh        — generate a v2 soul prompt with VERSION-LOCKED block
 *   mneme.handoff.parse_echo   — parse a pasted-back AI reply, score into ledger
 *   mneme.handoff.scorecard    — per-vendor obedience scorecard (Wilson LB)
 *   mneme.handoff.selftest     — run deterministic structure tests
 *   mneme.handoff.test_protocol — emit user-runnable test protocol for real AIs
 *   mneme.stargate.publish     — post current state to dpaste; return URL
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

function readVersion(repoRoot: string): string {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    return JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/cli/package.json"), "utf8")).version ?? "unknown";
  } catch { return "unknown"; }
}

export const handoffFreshTool: MnemeTool = {
  name: "mneme.handoff.fresh",
  category: "meta",
  description:
    "NEXUS-LOCK -- generate a fresh v2 soul prompt with VERSION-LOCKED block at the top, 4-rule contract (status emoji first / version claims gated / mandatory HOMUNCULUS RETURN footer / no improvisation), HMAC signature, optional Stargate URL. The receiving AI cannot mis-prioritize old Context because there is no separate Context block — the locked block IS the only authoritative state.",
  whenToUse: "User wants to clone Mneme to ANY web/mobile AI. ALWAYS use this instead of improvising a soul prompt manually — improvised prompts bypass LIVE STATE injection and lead the receiving AI to quote stale versions.",
  triggers: ["fresh handoff", "nexus lock", "soul prompt v2", "clone to ai"],
  inputSchema: {
    type: "object",
    properties: {
      receivingVendor: { type: "string", description: "claude / gemini / chatgpt / cursor / codex / etc" },
      currentMnemeVersion: { type: "string", description: "auto-detected from package.json if omitted" },
      stargateUrl: { type: "string", description: "Optional URL where current state is posted (use mneme.stargate.publish first)" },
      conversationContext: { type: "string", description: "Free-form context summary; do NOT include version claims" },
      recentTurns: { type: "array", description: "[{ts, role, text}, ...]" },
      staleAfterHours: { type: "integer", description: "Default 24" },
    },
    required: ["receivingVendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Generate fresh handoff for Gemini", args: { receivingVendor: "gemini" }, expectedOutput: "{ text, sig, generatedAt, bytes }" }],
  pitfalls: ["The receiving AI's compliance with the contract is empirical — different vendors obey at different rates. Use mneme.handoff.scorecard after collecting trials."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const version = (args["currentMnemeVersion"] as string | undefined) ?? readVersion(repoRoot);
    const out = core.nexusLock.buildSoulPromptV2({
      receivingVendor: String(args["receivingVendor"] ?? "any"),
      originatingVendor: "claude-opus-4-7",
      currentMnemeVersion: version,
      npmLatestVersion: null,
      stargateUrl: args["stargateUrl"] ? String(args["stargateUrl"]) : null,
      conversationContext: args["conversationContext"] ? String(args["conversationContext"]) : undefined,
      recentTurns: args["recentTurns"] as Parameters<typeof core.nexusLock.buildSoulPromptV2>[0]["recentTurns"],
      staleAfterHours: args["staleAfterHours"] as number | undefined,
    });
    return {
      data: out,
      wisdom: core.nexusLock.formatSoulPromptV2PulseLine(out),
      followUp: ["mneme.handoff.parse_echo"],
      confidence: { level: "high", notes: "Soul prompt is structurally complete + signed. Receiving-AI compliance varies; check scorecard." },
    };
  },
};

export const handoffParseEchoTool: MnemeTool = {
  name: "mneme.handoff.parse_echo",
  category: "audit",
  description:
    "NEXUS-LOCK -- parse a HOMUNCULUS RETURN footer from an AI reply pasted back to the parent. Returns { vendor, seenVersion, freshness, turn, emojiFirst } plus updates the local obedience ledger.",
  whenToUse: "After the user pastes a receiving AI's reply back to you. Call this to extract the structured echo + score the vendor.",
  triggers: ["parse echo", "parse homunculus return", "score this reply"],
  inputSchema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "The full AI reply text including the HOMUNCULUS RETURN footer" },
      expectedVersion: { type: "string", description: "The version that was in the LIVE STATE block of the soul prompt the AI received" },
      staleProbe: { type: "boolean", description: "Was the soul prompt deliberately stale (test B)?" },
    },
    required: ["reply"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Parse Gemini's reply", args: { reply: "🟢 ...\\n\\n# HOMUNCULUS RETURN\\nvendor: gemini\\n..." }, expectedOutput: "{ parsed, trial }" }],
  pitfalls: ["Returns parsed=null if the AI omitted the footer. That itself is a compliance signal — count it as a tier-F trial."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reply = String(args["reply"] ?? "");
    const expected = String(args["expectedVersion"] ?? "");
    const staleProbe = args["staleProbe"] === true;
    const parsed = core.nexusLock.parseHomunculusReturn(reply);
    const trial = parsed ? core.nexusLock.trialFromReturn(parsed, expected, staleProbe) : null;
    return {
      data: { parsed, trial },
      wisdom: parsed
        ? `parse-echo · vendor=${parsed.vendor} seen=${parsed.seenVersion} fresh=${parsed.freshness} emoji=${parsed.emojiFirst}`
        : `parse-echo · NO FOOTER · vendor failed to obey Rule 3`,
      confidence: { level: parsed ? "high" : "low" },
    };
  },
};

export const handoffSelfTestTool: MnemeTool = {
  name: "mneme.handoff.selftest",
  category: "audit",
  description:
    "NEXUS-LOCK -- run the deterministic structure self-tests. Verifies every required block, HMAC determinism, parser round-trips, freshness math, and tampering detection. ~16 tests, all pass = soul prompt machinery is healthy.",
  whenToUse: "After every Mneme upgrade; after any change to the NEXUS-LOCK module; before relying on a fresh handoff in production.",
  triggers: ["nexus lock selftest", "verify handoff machinery"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify the soul prompt machinery", args: {}, expectedOutput: "{ results: [{ test, ok, detail }, ...], report: '...' }" }],
  pitfalls: ["These tests verify our SIDE only. Receiving-AI obedience is empirical — see mneme.handoff.test_protocol for the user-side A/B."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const results = core.nexusLock.runSelfTests();
    const ok = results.filter((r) => r.ok).length;
    const total = results.length;
    return {
      data: { results, report: core.nexusLock.renderSelfTestReport(results), ok, total },
      wisdom: `NEXUS-LOCK selftest · ${ok}/${total} pass`,
      confidence: { level: ok === total ? "high" : "low" },
    };
  },
};

export const handoffTestProtocolTool: MnemeTool = {
  name: "mneme.handoff.test_protocol",
  category: "audit",
  description:
    "NEXUS-LOCK -- emit the user-runnable A/B test protocol for measuring REAL receiving-AI obedience (Gemini Free / ChatGPT browse / Claude.ai web / Cursor / Copilot / Gemma). Returns markdown with TEST A/B/C/D blocks the user runs on their actual phone or browser.",
  whenToUse: "When the user wants to measure 'does Gemini actually obey the contract?' empirically. Run the protocol; paste each AI reply back; the obedience ledger learns.",
  triggers: ["how do i test handoff", "ab test gemini", "obedience protocol"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me the test protocol", args: {}, expectedOutput: "{ markdown: '# NEXUS-LOCK USER A/B TEST PROTOCOL ...' }" }],
  pitfalls: ["This is a USER-side test. We cannot run it from inside the codebase — the user must paste the protocol into a chat, then paste the AI reply back."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const md = core.nexusLock.buildUserTestProtocol();
    return { data: { markdown: md }, wisdom: "Run TEST A → B → C → D on the receiving AI. Paste each reply back to me for scoring.", confidence: { level: "high" } };
  },
};

export const stargatePublishTool: MnemeTool = {
  name: "mneme.stargate.publish",
  category: "meta",
  description:
    "STARGATE -- post current Mneme state to dpaste.com (anonymous, public, expires after TTL). Returns the public URL. Embed in a NEXUS-LOCK soul prompt so fetch-capable AIs (ChatGPT browse / Claude with web) can pull live updates between turns.",
  whenToUse: "Before generating a soul prompt for ChatGPT browse / Claude.ai with web access / Cursor / Copilot — they CAN fetch the URL and verify state freshness.",
  triggers: ["publish stargate", "post live state"],
  inputSchema: {
    type: "object",
    properties: {
      mnemeVersion: { type: "string" },
      npmLatest: { type: "string" },
      ttlSeconds: { type: "integer", description: "Default 86400 (1 day)" },
      recentCommits: { type: "array" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Publish state to Stargate", args: { mnemeVersion: "2.10.0" }, expectedOutput: "{ url, expiresAt }" }],
  pitfalls: ["dpaste is PUBLIC. Do NOT publish secrets. The state JSON is version + commit metadata only."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const version = (args["mnemeVersion"] as string | undefined) ?? readVersion(repoRoot);
    const r = await core.nexusLock.publishToStargate({
      state: {
        mnemeVersion: version,
        npmLatest: (args["npmLatest"] as string | undefined) ?? null,
        recentCommits: (args["recentCommits"] as Array<{ sha: string; subject: string }>) ?? [],
        generatedAt: new Date().toISOString(),
        originator: "claude-opus-4-7",
      },
      ttlSeconds: args["ttlSeconds"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r ? `STARGATE · ${r.url}` : "STARGATE · OFFLINE (network failed)",
      confidence: { level: r ? "high" : "low", notes: r ? "Embed this URL in mneme.handoff.fresh's stargateUrl arg." : "Fall back to PIGEON POST round-trip." },
    };
  },
};

export const NEXUS_LOCK_TOOLS: MnemeTool[] = [
  handoffFreshTool,
  handoffParseEchoTool,
  handoffSelfTestTool,
  handoffTestProtocolTool,
  stargatePublishTool,
];
