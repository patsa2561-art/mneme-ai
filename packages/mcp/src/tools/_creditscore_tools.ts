/**
 * v2.81.0 — HONESTY CREDIT SCORE MCP tools (💎5, on the NOTARY spine).
 *
 *   mneme.creditscore.score  — compute (+ optionally sign) a portable honesty score
 *   mneme.creditscore.verify — verify a score receipt OFFLINE + a trust decision
 *
 * The truth axis ERC-8004 reputation never touches: "does the agent tell the
 * TRUTH?" — portable, signed, and un-self-promotable.
 */

import type { MnemeTool } from "./_types.js";

export const creditScoreScoreTool: MnemeTool = {
  name: "mneme.creditscore.score",
  category: "meta",
  description:
    "📊 HONESTY CREDIT SCORE — compute an agent's portable honesty score from its verified claim record (trueCount/falseCount/partialCount). Wilson 95% LOWER bound on the true-rate: small/under-measured agents score LOW by design (reputation can't be faked). With sign=true, returns a portable Ed25519-signed NOTARY receipt that any agent verifies OFFLINE before trusting this one.",
  whenToUse: "Publishing an agent's honesty reputation, or before delegating work/payment to another agent — sign your own score to share, or score a counterparty from its track record.",
  triggers: ["credit score", "honesty score", "trust score", "how honest is this agent"],
  inputSchema: {
    type: "object",
    required: ["agent", "trueCount", "falseCount"],
    properties: {
      agent: { type: "string" },
      trueCount: { type: "number", description: "Claims independently verified TRUE." },
      falseCount: { type: "number", description: "Claims independently verified FALSE." },
      partialCount: { type: "number", description: "Partially-true claims (half weight)." },
      sign: { type: "boolean", description: "Return a portable signed receipt." },
      ttlDays: { type: "number", description: "Validity window for a signed score (default 90)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const score = core.honestyScore.computeHonestyScore({
        agent: String(args["agent"] ?? "unknown"),
        trueCount: Number(args["trueCount"] ?? 0),
        falseCount: Number(args["falseCount"] ?? 0),
        partialCount: Number(args["partialCount"] ?? 0),
      });
      if (args["sign"] === true) {
        const receipt = core.honestyScore.issueHonestyReceipt(cwd, score, { ttlDays: typeof args["ttlDays"] === "number" ? args["ttlDays"] as number : undefined });
        return { data: { score, receipt }, wisdom: `${score.agent}: ${score.score}/100 (${score.band}) — signed receipt issued`, followUp: ["mneme.creditscore.verify"], confidence: { level: "high" as const } };
      }
      return { data: score, wisdom: `${score.agent}: ${score.score}/100 (${score.band})`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "score failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const creditScoreVerifyTool: MnemeTool = {
  name: "mneme.creditscore.verify",
  category: "meta",
  description:
    "📊 HONESTY CREDIT SCORE — verify another agent's score receipt OFFLINE (Ed25519 signature + expiry) and decide whether to trust it at minBand. A forged band/score breaks the signature; expired scores are rejected; optionally assert the issuer fingerprint. The 'check before you delegate' call.",
  whenToUse: "Before handing work, code, or payment to another agent that presented an honesty credit receipt.",
  triggers: ["verify credit score", "verify honesty score", "should I trust this agent"],
  inputSchema: {
    type: "object",
    required: ["receipt"],
    properties: {
      receipt: { description: "The honesty score receipt (object or JSON string)." },
      minBand: { type: "string", description: "PLATINUM | GOLD | SILVER | BRONZE (default SILVER)." },
      expectedIssuerFingerprint: { type: "string", description: "Assert the issuer you trust." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    void rt;
    try {
      const core = await import("@mneme-ai/core");
      let receipt: unknown = args["receipt"];
      if (typeof receipt === "string") { try { receipt = JSON.parse(receipt); } catch { /* leave → fails verify */ } }
      const bands = new Set(["PLATINUM", "GOLD", "SILVER", "BRONZE"]);
      const minBand = typeof args["minBand"] === "string" && bands.has(args["minBand"] as string) ? args["minBand"] as import("@mneme-ai/core").honestyScore.HonestyBand : "SILVER";
      const v = core.honestyScore.verifyHonestyReceipt(receipt);
      const trust = core.honestyScore.shouldTrust(receipt, minBand, { expectedIssuerFingerprint: typeof args["expectedIssuerFingerprint"] === "string" ? args["expectedIssuerFingerprint"] as string : undefined });
      return { data: { verify: v, trust }, wisdom: !v.valid ? `🔴 invalid: ${v.reason}` : trust.trust ? `🟢 trust ${v.score!.agent} (${trust.band})` : `🟡 do NOT trust: ${trust.reason}`, followUp: [], confidence: { level: v.valid ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const CREDITSCORE_TOOLS: MnemeTool[] = [
  creditScoreScoreTool,
  creditScoreVerifyTool,
];
