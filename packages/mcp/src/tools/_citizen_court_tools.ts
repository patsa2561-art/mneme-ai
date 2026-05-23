/**
 * v2.33.0 — MCP wrappers for CITIZEN COURT (Mneme Confessional, HCI variant).
 *
 * 5 tools:
 *   mneme.citizen_court.reveal   — record primary action + schedule reveal
 *   mneme.citizen_court.vote     — finalize a verdict
 *   mneme.citizen_court.pending  — list reveals awaiting vote
 *   mneme.citizen_court.hsc      — current per-vendor Honesty Score Card
 *   mneme.citizen_court.verify   — offline HMAC verify of a verdict
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string { return resolve(rt.meta?.rootPath ?? process.cwd()); }

export const citizenCourtRevealTool: MnemeTool = {
  name: "mneme.citizen_court.reveal",
  category: "meta",
  description:
    "CITIZEN COURT — record the user's primary action on a vendor suggestion, wait the configured delayMs (default 1000 — the 1-second reveal mechanic), then return the OTHER vendors' answers so the user can vote.",
  whenToUse: "After the user accepts/rejects an AI suggestion + you want to fire the citizen court flow.",
  triggers: ["citizen court reveal", "confessional reveal"],
  inputSchema: {
    type: "object",
    properties: {
      primaryVendor: { type: "string" },
      promptHash: { type: "string" },
      primaryResponseHash: { type: "string" },
      primaryAction: { type: "string", description: "accepted | rejected" },
      revealVendors: { type: "array", items: { type: "string" } },
      delayMs: { type: "integer", description: "Default 1000." },
      prompt: { type: "string", description: "Optional — only used if you want Mneme to hash it." },
      primaryResponse: { type: "string" },
      revealResponses: { type: "object", description: "vendor → response text map" },
    },
    required: ["primaryVendor", "promptHash", "primaryResponseHash", "primaryAction", "revealVendors"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.citizen_court.vote", "mneme.conclave.run"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const input: Parameters<typeof core.citizenCourt.recordRevealAndWait>[1] = {
      primaryVendor: String(args["primaryVendor"]),
      promptHash: String(args["promptHash"]),
      primaryResponseHash: String(args["primaryResponseHash"]),
      primaryAction: args["primaryAction"] as "accepted" | "rejected",
      revealVendors: Array.isArray(args["revealVendors"]) ? (args["revealVendors"] as string[]) : [],
      ...(typeof args["delayMs"] === "number" ? { delayMs: args["delayMs"] as number } : {}),
      ...(typeof args["prompt"] === "string" ? { prompt: args["prompt"] as string } : {}),
      ...(typeof args["primaryResponse"] === "string" ? { primaryResponse: args["primaryResponse"] as string } : {}),
      ...(args["revealResponses"] && typeof args["revealResponses"] === "object"
        ? { revealResponses: args["revealResponses"] as Record<string, string> }
        : {}),
    };
    const r = await core.citizenCourt.recordRevealAndWait(repoRoot, input);
    return {
      data: { id: r.id, reveal: r.reveal },
      wisdom: `Reveal ${r.id} fired with ${r.reveal.reveals.length} alternative vendor(s).`,
      followUp: ["mneme.citizen_court.vote"],
      confidence: { level: "high" as const },
    };
  },
};

export const citizenCourtVoteTool: MnemeTool = {
  name: "mneme.citizen_court.vote",
  category: "meta",
  description: "CITIZEN COURT — vote on a pending reveal. votedMostTruthful may be any vendor in the court OR 'ABSTAIN'.",
  whenToUse: "After mneme.citizen_court.reveal returned an id + the user picked a winner.",
  triggers: ["citizen court vote", "confessional vote"],
  inputSchema: {
    type: "object",
    properties: {
      revealId: { type: "string" },
      votedMostTruthful: { type: "string" },
      reasoning: { type: "string" },
      dpEpsilon: { type: "number" },
    },
    required: ["revealId", "votedMostTruthful"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const v = core.citizenCourt.vote(repoRoot, {
      revealId: String(args["revealId"]),
      votedMostTruthful: String(args["votedMostTruthful"]),
      ...(typeof args["reasoning"] === "string" ? { reasoning: args["reasoning"] as string } : {}),
      ...(typeof args["dpEpsilon"] === "number" ? { dpEpsilon: args["dpEpsilon"] as number } : {}),
    });
    return {
      data: { id: v.id, seq: v.seq, hmac: v.hmac, votedMostTruthful: v.votedMostTruthful },
      wisdom: `Verdict ${v.id} recorded · voted ${v.votedMostTruthful}.`,
      followUp: ["mneme.citizen_court.hsc"],
      confidence: { level: "high" as const },
    };
  },
};

export const citizenCourtPendingTool: MnemeTool = {
  name: "mneme.citizen_court.pending",
  category: "meta",
  description: "CITIZEN COURT — list reveals awaiting a vote.",
  whenToUse: "User wants to see open court sessions.",
  triggers: ["citizen court pending"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const pending = core.citizenCourt.listPending(repoRoot);
    return {
      data: { count: pending.length, pending },
      wisdom: pending.length === 0 ? "No pending reveals." : `${pending.length} reveal(s) awaiting vote.`,
      followUp: pending.length === 0 ? [] : ["mneme.citizen_court.vote"],
      confidence: { level: "high" as const },
    };
  },
};

export const citizenCourtHscTool: MnemeTool = {
  name: "mneme.citizen_court.hsc",
  category: "meta",
  description: "CITIZEN COURT — per-vendor Honesty Score Card with Wilson lower-bound on truthful-vote rate + IDE color-dot band.",
  whenToUse: "Vendor selection; ranking; the IDE color-dot inline render.",
  triggers: ["honesty score", "citizen court hsc", "vendor honesty"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const hsc = core.citizenCourt.readHsc(repoRoot);
    return {
      data: { count: hsc.length, vendors: hsc },
      wisdom: hsc.length === 0 ? "No verdicts yet — run reveal+vote first." : `Top vendor: ${hsc[0]!.vendor} (LB ${hsc[0]!.honestyScoreLB} · ${hsc[0]!.band}).`,
      followUp: hsc.length === 0 ? ["mneme.citizen_court.reveal"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const citizenCourtVerifyTool: MnemeTool = {
  name: "mneme.citizen_court.verify",
  category: "meta",
  description: "CITIZEN COURT — offline HMAC verify of a pasted CourtVerdict.",
  whenToUse: "Cross-machine attestation; receipts.",
  triggers: ["citizen court verify"],
  inputSchema: {
    type: "object",
    properties: { verdict: { type: "object" }, prevChainLink: { type: "string" } },
    required: ["verdict"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = args["verdict"] as Parameters<typeof core.citizenCourt.verifyVerdict>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!v || typeof v !== "object") {
      return {
        data: { ok: false, reason: "verdict missing" },
        wisdom: "Pass `verdict` (full CourtVerdict).",
        followUp: [], confidence: { level: "high" as const },
      };
    }
    const r = core.citizenCourt.verifyVerdict(v, prev);
    return {
      data: r,
      wisdom: r.ok ? "Verdict HMAC verified." : `HMAC FAIL: ${r.reason}`,
      followUp: [], confidence: { level: "high" as const },
    };
  },
};

export const CITIZEN_COURT_TOOLS: MnemeTool[] = [
  citizenCourtRevealTool,
  citizenCourtVoteTool,
  citizenCourtPendingTool,
  citizenCourtHscTool,
  citizenCourtVerifyTool,
];
