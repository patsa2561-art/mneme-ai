/**
 * mneme.release_notes -- proactively teach the AI agent what's new in the
 * running version. AGENT_INSTRUCTIONS.md tells the AI to call this tool
 * automatically right after `mneme.welcome` and surface the highlights
 * to the user.
 */

import { whatsNew } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export const whatsNewTool: MnemeTool = {
  name: "mneme.release_notes",
  category: "meta",
  description:
    "Return a curated What's New digest for the current Mneme version. " +
    "Each highlight has a plain-English headline + 2-3 sentence body + " +
    "optional suggestedAction. Use IMMEDIATELY after mneme.welcome on a " +
    "fresh session so you can tell the user 'by the way, Mneme just " +
    "shipped X, Y, Z -- here's how to use them'. Pass sinceVersion to " +
    "filter to only what's new since the user's last seen version.",
  whenToUse:
    "Right after mneme.welcome. Or whenever the user asks 'what's new in Mneme?' / 'what version is this?'.",
  triggers: ["whats new", "what's new", "what changed", "release notes", "new features"],
  inputSchema: {
    type: "object",
    properties: {
      sinceVersion: { type: "string", description: "Optional semver. Returns only highlights newer than this." },
      limit: { type: "number", description: "Max highlights to return (default 3, max 20)." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      currentVersion: { type: "string" },
      highlights: { type: "array" },
      totalAvailable: { type: "number" },
      oneLineSummary: { type: "string" },
      builtAt: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "What's new in Mneme?",
      expectedOutput: "Returns the latest 3 highlights with headline + body + suggestedAction. The AI surfaces all 3 to the user.",
    },
  ],
  pitfalls: [
    "Highlights are CURATED -- written FOR users, not for engineers. Don't try to read engineering detail from this; use mneme.system.upgrade for that.",
    "If the user is on an older version, the highlights for newer versions might describe features they don't have yet. Always cross-check with currentVersion.",
  ],
  composeWith: ["mneme.welcome", "mneme.system.upgrade"],
  handler: async (rt, args) => {
    void rt;
    const { resolveMnemeVersion } = await import("@mneme-ai/core");
    const currentVersion = resolveMnemeVersion();
    const sinceVersion = typeof args["sinceVersion"] === "string" ? (args["sinceVersion"] as string) : undefined;
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 3;
    const digest = whatsNew.buildDigest({ currentVersion, sinceVersion, limit });
    return {
      data: digest,
      wisdom: digest.oneLineSummary,
      confidence: { level: "high" },
      secondBrain: {
        presentation:
          "Surface every highlight to the user, in order. Use the body verbatim (translate to user's language). If a highlight has a suggestedAction, end with it. Two short paragraphs per highlight is plenty -- this is a digest, not a manual.",
      },
      followUp: digest.highlights.some((h) => h.suggestedAction) ? ["mneme.capabilities"] : [],
    };
  },
};
