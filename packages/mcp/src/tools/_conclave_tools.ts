/**
 * v2.29.0 — MCP wrappers for MNEME CONCLAVE.
 *
 * 5 tools:
 *   mneme.conclave.run         — fire claim across N vendors + return verdict
 *   mneme.conclave.report      — read latest verdict or list history
 *   mneme.conclave.dissent     — read the federated dissent corpus
 *   mneme.conclave.weights     — show per-vendor Aletheia weights
 *   mneme.conclave.verify      — verify HMAC chain on a card
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const conclaveRunTool: MnemeTool = {
  name: "mneme.conclave.run",
  category: "meta",
  description:
    "MNEME CONCLAVE — fire one claim at N AI vendors in parallel, run AEAE variants (paraphrase / decoy / casual " +
    "framing), aggregate via weighted Byzantine vote, return HMAC-signed ConsensusVerdict. Detects eval-awareness " +
    "(vendors that flip stance across variants). World-first: cross-vendor BFT + AEAE in one primitive.",
  whenToUse: "High-stakes claims; second-opinion on a single-vendor verdict; reproducible cross-vendor benchmark.",
  triggers: ["conclave", "byzantine consensus", "multi-vendor verify", "cross-vendor truth"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The claim to verify." },
      vendors: { type: "array", items: { type: "string" }, description: "Vendor ids, e.g. claude-opus-4-7, gpt-5, mock-a, mock-b." },
      bftThreshold: { type: "number", description: "Weighted-vote threshold (0..1). Default 0.66." },
      bftStrict: { type: "boolean", description: "Enforce PBFT-strict (f < n/3 dissenters tolerated). Default false." },
      weightBy: { type: "string", description: "'aletheia' (default) or 'equal'." },
      aeae: { type: "boolean", description: "Run ANTI-EVAL-AWARENESS variants. Default true." },
      mockOnly: { type: "boolean", description: "Force mock adapters (testing). Default false." },
    },
    required: ["claim", "vendors"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.conclave.report", "mneme.conclave.dissent"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const v = await core.conclave.runConclave(repoRoot, String(args["claim"] ?? ""), {
      vendors: Array.isArray(args["vendors"]) ? (args["vendors"] as string[]) : [],
      bftThreshold: typeof args["bftThreshold"] === "number" ? (args["bftThreshold"] as number) : undefined,
      bftStrict: args["bftStrict"] === true,
      weightBy: args["weightBy"] === "equal" ? "equal" : "aletheia",
      aeae: args["aeae"] !== false,
      mockOnly: args["mockOnly"] === true,
    });
    try { core.conclave.storeVerdict(repoRoot, v); } catch { /* best-effort */ }
    return {
      data: {
        headline: v.headline,
        outcome: v.outcome,
        winningStance: v.winningStance,
        weightedTallies: v.weightedTallies,
        awarenessFlags: v.awarenessFlags,
        dissentBreakdown: v.dissentBreakdown,
        hmac: v.hmac, seq: v.seq, bodyDigest: v.bodyDigest,
        perVendor: v.perVendor,
      },
      wisdom: v.headline,
      followUp: v.outcome === "DISSENT" || v.outcome === "AWARENESS_DETECTED"
        ? ["mneme.conclave.dissent", "mneme.conclave.report"]
        : ["mneme.conclave.report"],
      confidence: { level: v.outcome === "CONSENSUS" ? "high" as const : "medium" as const },
    };
  },
};

export const conclaveReportTool: MnemeTool = {
  name: "mneme.conclave.report",
  category: "meta",
  description: "MNEME CONCLAVE — read the latest verdict, or list the last N ledger entries.",
  whenToUse: "After conclave.run; replaying a prior verdict; building a leaderboard.",
  triggers: ["conclave report", "show consensus", "verdict history"],
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", description: "If set, return last N ledger entries." } },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.conclave.listVerdicts(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} verdicts recorded.`,
        followUp: ["mneme.conclave.run"],
        confidence: { level: "high" as const },
      };
    }
    const latest = core.conclave.readLatestVerdict(repoRoot);
    return {
      data: latest ? { verdict: latest } : { verdict: null, note: "No conclave verdict yet — run mneme.conclave.run first." },
      wisdom: latest ? latest.headline : "No verdict on disk yet.",
      followUp: latest ? [] : ["mneme.conclave.run"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const conclaveDissentTool: MnemeTool = {
  name: "mneme.conclave.dissent",
  category: "meta",
  description:
    "MNEME CONCLAVE — read the federated dissent corpus. Every DISSENT outcome writes a row to " +
    ".mneme/conclave/dissent_corpus.jsonl. Over time this becomes the cross-vendor disagreement dataset " +
    "Q2 of the research gap matrix calls for.",
  whenToUse: "Building a hallucination dataset; analysing vendor disagreement patterns.",
  triggers: ["dissent corpus", "vendor disagreement", "conclave dissent"],
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer" } },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const rows = core.conclave.readDissentCorpus(repoRoot, typeof args["limit"] === "number" ? (args["limit"] as number) : 100);
    return {
      data: { count: rows.length, rows },
      wisdom: `${rows.length} dissent entries in the local corpus. Federate via mneme.federated.* in v2.29.x.`,
      followUp: ["mneme.conclave.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const conclaveWeightsTool: MnemeTool = {
  name: "mneme.conclave.weights",
  category: "meta",
  description: "MNEME CONCLAVE — show per-vendor Aletheia trust weight (cached). Source: .mneme/aletheia/karma.json or .mneme/bounty/leaderboard.json; defaults to 0.5 when unknown.",
  whenToUse: "Auditing why a vendor's vote counts more / less.",
  triggers: ["conclave weights", "vendor trust", "aletheia weights"],
  inputSchema: {
    type: "object",
    properties: {
      vendors: { type: "array", items: { type: "string" } },
    },
    required: ["vendors"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const list = Array.isArray(args["vendors"]) ? (args["vendors"] as string[]) : [];
    const weights = list.map((v) => ({ vendor: v, weight: core.conclave.aletheiaWeight(repoRoot, v) }));
    return {
      data: { weights },
      wisdom: `Per-vendor weights: ${weights.map((w) => `${w.vendor}=${w.weight.toFixed(2)}`).join(", ")}`,
      followUp: ["mneme.conclave.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const conclaveVerifyTool: MnemeTool = {
  name: "mneme.conclave.verify",
  category: "meta",
  description: "MNEME CONCLAVE — verify a pasted ConsensusVerdict's HMAC against a previous chain link. Offline-verifiable.",
  whenToUse: "Cross-machine attestation; replay receipts.",
  triggers: ["verify conclave", "conclave hmac"],
  inputSchema: {
    type: "object",
    properties: {
      verdict: { type: "object" },
      prevChainLink: { type: "string" },
    },
    required: ["verdict"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const verdict = args["verdict"] as Parameters<typeof core.conclave.verifyVerdict>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!verdict || typeof verdict !== "object") {
      return {
        data: { ok: false, reason: "verdict argument missing or not an object" },
        wisdom: "Pass `verdict` (full ConsensusVerdict).",
        followUp: ["mneme.conclave.report"],
        confidence: { level: "high" as const },
      };
    }
    const r = core.conclave.verifyVerdict(verdict, prev);
    return {
      data: r,
      wisdom: r.ok ? "ConsensusVerdict HMAC verified." : `HMAC FAIL: ${r.reason}`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const CONCLAVE_TOOLS: MnemeTool[] = [
  conclaveRunTool,
  conclaveReportTool,
  conclaveDissentTool,
  conclaveWeightsTool,
  conclaveVerifyTool,
];
