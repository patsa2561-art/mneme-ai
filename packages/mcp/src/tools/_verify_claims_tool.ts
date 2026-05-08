/**
 * mneme.verify_claims — Hallucination Auto-Block (MVP).
 *
 * The post-draft verifier. AI client passes a draft answer string and
 * Mneme runs every commit-hash claim through `git rev-parse` to detect
 * hallucinated hashes. Returns the list of fake refs + a recommendation
 * to rewrite.
 *
 * Future v1.11.0+: when MCP spec supports token-stream interception,
 * this will run pre-delivery (catch lies BEFORE user sees them).
 *
 * For v1.10.0 the AI is expected to call this between drafting and
 * delivering — same loop as mneme.grade.answer, but specifically for
 * citation correctness.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

interface VerifyResult {
  total: number;
  resolved: string[];
  hallucinated: string[];
  recommendedRewrite: boolean;
}

export const verifyClaimsTool: MnemeTool = {
  name: "mneme.verify_claims",
  category: "meta",
  description:
    "Hallucination Auto-Block. Pass an AI draft answer; Mneme extracts every commit-hash-looking string " +
    "and verifies each via `git rev-parse`. Returns the list of HALLUCINATED hashes (not present in this repo). " +
    "AI client MUST call this AFTER drafting and BEFORE delivering ANY answer that includes commit hashes — " +
    "if hallucinated hashes are found, rewrite the answer using only the ones in `resolved` (or remove the " +
    "claim entirely). This is the post-draft pre-delivery citation gate.",
  whenToUse:
    "You drafted a user-facing answer that cites commit hashes — you MUST verify them before delivery.",
  triggers: [
    "verify the commit hashes in this draft",
    "check for hallucinated citations",
    "are these hashes real",
  ],
  inputSchema: {
    type: "object",
    properties: {
      draft: { type: "string", description: "The draft answer text to verify" },
    },
    required: ["draft"],
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number", description: "Number of hash-shaped strings found in the draft." },
      resolved: { type: "array", items: { type: "string" }, description: "Hashes that exist in this repo (safe to cite)." },
      hallucinated: { type: "array", items: { type: "string" }, description: "Hashes that DO NOT exist (must be removed or replaced)." },
      recommendedRewrite: { type: "boolean", description: "True if any hallucinated hashes were found." },
    },
  },
  examples: [
    {
      userQuery: "(internal — agent calls between draft and delivery)",
      args: { draft: "The auth refactor in commit a3f9b21 introduced the 7-day token TTL (see also c0e2d5f)." },
      expectedOutput:
        "Returns { total: 2, resolved: [...], hallucinated: [...] }. If hallucinated.length > 0, the wisdom field says STOP and the secondBrain instructs rewrite — DO NOT deliver the draft as-is.",
    },
  ],
  pitfalls: [
    "Catches commit-hash hallucinations only — does NOT verify URLs, file paths, or numeric claims (use mneme.grade.answer for those).",
    "A 7-char hex string is interpreted as a possible hash; very rare false positives on UUIDs / random IDs that happen to be all-hex.",
    "Requires the working directory to be a git repo with the relevant history fetched.",
  ],
  composeWith: ["mneme.grade.answer", "mneme.memory.search_commits"],
  handler: async (rt, args) => {
    const draft = String(args["draft"] ?? "");
    const hashes = Array.from(new Set(draft.match(/\b[a-f0-9]{7,40}\b/gi) ?? []));
    const resolved: string[] = [];
    const hallucinated: string[] = [];
    for (const h of hashes) {
      const r = spawnSync("git", ["rev-parse", "--verify", h], { cwd: rt.meta.rootPath, stdio: "pipe" });
      if (r.status === 0) resolved.push(h);
      else hallucinated.push(h);
    }
    const result: VerifyResult = {
      total: hashes.length,
      resolved,
      hallucinated,
      recommendedRewrite: hallucinated.length > 0,
    };
    return {
      data: result,
      wisdom:
        hallucinated.length === 0
          ? `All ${resolved.length} cited hash${resolved.length === 1 ? "" : "es"} resolve to real commits. Safe to deliver.`
          : `STOP — ${hallucinated.length} hallucinated hash${hallucinated.length === 1 ? "" : "es"} detected: ${hallucinated.slice(0, 3).join(", ")}${hallucinated.length > 3 ? ", ..." : ""}. Rewrite the draft using only the hashes in data.resolved (${resolved.length} real ones), OR remove the unbacked claim entirely.`,
      followUp: hallucinated.length > 0 ? ["mneme.memory.search_commits"] : [],
      confidence: { level: "high" },
      secondBrain: {
        presentation:
          hallucinated.length === 0
            ? "Deliver the draft to the user."
            : "DO NOT deliver this draft. Either rewrite using data.resolved hashes only, or call mneme.memory.search_commits to find real related commits, then rewrite. Re-call mneme.verify_claims with the new draft. Loop until hallucinated.length === 0.",
      },
    };
  },
};
