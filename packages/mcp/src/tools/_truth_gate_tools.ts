/**
 * v2.27.0 — MCP wrappers for the MARKETING TRUTH GATE.
 *
 * 4 tools:
 *   mneme.truth_gate.run        — run every probe + reconcile + sign
 *   mneme.truth_gate.report     — read latest matrix or list ledger
 *   mneme.truth_gate.claims     — list the claim catalog
 *   mneme.truth_gate.verify     — verify a pasted matrix's HMAC
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const truthRunTool: MnemeTool = {
  name: "mneme.truth_gate.run",
  category: "meta",
  description:
    "MARKETING TRUTH GATE — run every probe against the live install + reconcile against the claim catalog. Returns " +
    "HMAC-signed truth matrix with traffic light + drift/refuted list. Persists to .mneme/truth_gate/.",
  whenToUse: "Pre-release; periodic audit; after editing README marketing copy.",
  triggers: ["truth gate", "reconcile marketing", "verify claims", "marketing audit"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  composeWith: ["mneme.truth_gate.report", "mneme.truth_gate.claims"],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const m = await core.truthGate.reconcileAll({ cwd: repoRoot });
    try { core.truthGate.storeMatrix(repoRoot, m); } catch { /* best-effort */ }
    return {
      data: {
        headline: m.headline,
        trafficLight: m.trafficLight,
        score: m.summary.truthScore,
        summary: m.summary,
        drifted: m.entries.filter((e) => e.verdict === "drift" || e.verdict === "refuted").map((e) => ({ claimId: e.claim.id, verdict: e.verdict, reason: e.reason })),
        hmac: m.hmac,
        seq: m.seq,
      },
      wisdom: m.headline,
      followUp: m.summary.drift + m.summary.refuted > 0 ? ["mneme.truth_gate.report"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const truthReportTool: MnemeTool = {
  name: "mneme.truth_gate.report",
  category: "meta",
  description:
    "MARKETING TRUTH GATE — read the latest truth matrix, or list the last N ledger entries.",
  whenToUse: "After truth_gate.run; release-note prep; cross-machine sync.",
  triggers: ["truth report", "marketing report"],
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", description: "If set, return the last N ledger entries instead of latest matrix." } },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.truthGate.listMatrices(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} truth matrices recorded.`,
        followUp: ["mneme.truth_gate.run"],
        confidence: { level: "high" as const },
      };
    }
    const latest = core.truthGate.readLatestMatrix(repoRoot);
    return {
      data: latest ? { matrix: latest } : { matrix: null, note: "No truth matrix yet — run mneme.truth_gate.run first." },
      wisdom: latest ? latest.headline : "No truth matrix on disk yet.",
      followUp: latest ? [] : ["mneme.truth_gate.run"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const truthClaimsTool: MnemeTool = {
  name: "mneme.truth_gate.claims",
  category: "meta",
  description:
    "MARKETING TRUTH GATE — list every claim binding (id + source + text + probe + severity). Useful for editing marketing copy.",
  whenToUse: "Adding a new marketing claim; reviewing what's measured.",
  triggers: ["list claims", "truth catalog"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const list = core.truthGate.CLAIM_CATALOG.map((c) => ({
      id: c.id,
      source: c.source,
      text: c.text,
      kind: c.kind,
      asserted: c.asserted,
      probeId: c.probeId,
      severity: c.severity,
    }));
    return {
      data: { count: list.length, claims: list },
      wisdom: `${list.length} marketing claims bound to live probes.`,
      followUp: ["mneme.truth_gate.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const truthVerifyTool: MnemeTool = {
  name: "mneme.truth_gate.verify",
  category: "meta",
  description:
    "MARKETING TRUTH GATE — verify a pasted truth matrix's HMAC against a previous chain link. Offline-verifiable.",
  whenToUse: "Cross-machine attestation; release artifact verification.",
  triggers: ["verify truth matrix", "truth verify"],
  inputSchema: {
    type: "object",
    properties: {
      matrix: { type: "object" },
      prevChainLink: { type: "string" },
    },
    required: ["matrix"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const m = args["matrix"] as Parameters<typeof core.truthGate.verifyMatrix>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!m || typeof m !== "object") {
      return {
        data: { ok: false, reason: "matrix argument missing or not an object" },
        wisdom: "Pass `matrix` (full TruthMatrix).",
        followUp: ["mneme.truth_gate.report"],
        confidence: { level: "high" as const },
      };
    }
    const v = core.truthGate.verifyMatrix(m, prev);
    return {
      data: v,
      wisdom: v.ok ? "Truth matrix HMAC verified." : `Truth matrix HMAC FAIL: ${v.reason}`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const TRUTH_GATE_TOOLS: MnemeTool[] = [
  truthRunTool,
  truthReportTool,
  truthClaimsTool,
  truthVerifyTool,
];
