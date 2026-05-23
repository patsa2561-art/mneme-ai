/**
 * v2.31.0 — MCP wrappers for REWIND (Time-Capsule Regression Replay).
 *
 * 5 tools:
 *   mneme.rewind.run       — seal a capsule + fire at vendors + emit cards
 *   mneme.rewind.card      — read latest card / list cards / markdown render
 *   mneme.rewind.capsules  — list pinned capsules (the time-capsules)
 *   mneme.rewind.regression — quick regression-only summary across cards
 *   mneme.rewind.verify    — offline HMAC verify of a card
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const rewindRunTool: MnemeTool = {
  name: "mneme.rewind.run",
  category: "meta",
  description:
    "REWIND — Time-Capsule Regression Replay. Seal a set of past git commits as a Capsule, blind-replay them at N " +
    "vendors, score answers vs the accepted diff per intent class, and emit an HMAC-signed VendorRegressionCard. The " +
    "Capsule can be reused on every new vendor release (reuseCapsuleId) to track regression / improvement over time. " +
    "Side-effect: writes suggestedAletheiaWeight to .mneme/aletheia/honest_mirror_weights.json so CONCLAVE picks it " +
    "up automatically (composes with HONEST MIRROR).",
  whenToUse: "After a vendor releases a new model version; periodic vendor regression audit; pre-release routing decision.",
  triggers: ["rewind", "regression replay", "time capsule", "vendor regression card"],
  inputSchema: {
    type: "object",
    properties: {
      vendors: { type: "array", items: { type: "string" }, description: "Vendor ids (CONCLAVE registry — claude-opus-4-7, gpt-5, mock-a, etc)." },
      range: { type: "string", description: "Git range to sample. Default HEAD~100..HEAD." },
      count: { type: "integer", description: "Sample count. Default 20. 0 = all commits in range." },
      seed: { type: "integer", description: "Deterministic sample seed. Default = current ms." },
      reuseCapsuleId: { type: "string", description: "Reuse an existing sealed capsule by id to fire SAME prompts at a new vendor release (the time-capsule loop)." },
      mockOnly: { type: "boolean", description: "Force mock vendor adapters. Default false." },
    },
    required: ["vendors"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.rewind.card", "mneme.honest_mirror.calibrate", "mneme.conclave.weights"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const vendors = Array.isArray(args["vendors"]) ? (args["vendors"] as string[]) : [];
    const mockOnly = args["mockOnly"] === true;
    const adapters = core.conclave.resolveVendors(vendors, { mockOnly });
    const replay: Parameters<typeof core.rewind.runRewind>[2] = async ({ vendor, prompt, artifactTimestamp }) => {
      const a = adapters.find((x) => x.id === vendor) ?? adapters[0]!;
      const verdict = await a.run({ claim: prompt, variantId: "rewind" });
      void artifactTimestamp;
      return {
        vendor,
        vendorVersion: a.id, // adapter id doubles as a stable model-version string for now
        answer: verdict.reasoning ?? "",
        confidence: verdict.confidence ?? 0.5,
        dtMs: verdict.dtMs,
        ...(verdict.error ? { error: verdict.error } : {}),
      };
    };
    const r = await core.rewind.runRewind(repoRoot, {
      vendors,
      ...(typeof args["range"] === "string" ? { range: args["range"] as string } : {}),
      ...(typeof args["count"] === "number" ? { count: args["count"] as number } : {}),
      ...(typeof args["seed"] === "number" ? { seed: args["seed"] as number } : {}),
      ...(typeof args["reuseCapsuleId"] === "string" ? { reuseCapsuleId: args["reuseCapsuleId"] as string } : {}),
    }, replay);
    return {
      data: {
        capsuleId: r.capsule.id,
        commitCount: r.capsule.commitCount,
        cards: r.cards.map((c) => ({
          vendor: c.vendor,
          vendorVersion: c.vendorVersion,
          headline: c.headline,
          meanCorrectness: c.meanCorrectness,
          meanConfidence: c.meanConfidence,
          meanCalibrationDelta: c.meanCalibrationDelta,
          regression: c.regression,
          suggestedAletheiaWeight: c.suggestedAletheiaWeight,
          seq: c.seq,
          hmac: c.hmac,
        })),
      },
      wisdom: r.cards[0]?.headline ?? "no cards produced (no commits in range?)",
      followUp: ["mneme.rewind.card", "mneme.conclave.weights"],
      confidence: { level: "high" as const },
    };
  },
};

export const rewindCardTool: MnemeTool = {
  name: "mneme.rewind.card",
  category: "meta",
  description: "REWIND — read the latest card or list ledger entries; render markdown of a specific seq.",
  whenToUse: "After rewind.run; sharing a card; comparing prior vendor versions.",
  triggers: ["rewind card", "regression card"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "List N most-recent ledger entries. Default 20." },
      seq: { type: "integer", description: "Specific card seq to fetch + render markdown." },
      markdown: { type: "boolean", description: "Include markdown render in the response. Default false (skinny)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 20;
    const ledger = core.rewind.listCards(repoRoot, limit);
    let mdRender: string | undefined;
    if (typeof args["seq"] === "number") {
      const want = args["seq"] as number;
      const entry = ledger.find((e) => e.seq === want);
      if (entry) {
        const card = core.rewind.readCard(repoRoot, entry.file);
        if (card && args["markdown"] === true) mdRender = core.rewind.renderMarkdownCard(card);
      }
    }
    return {
      data: { count: ledger.length, ledger, ...(mdRender ? { markdown: mdRender } : {}) },
      wisdom: ledger.length === 0
        ? "No regression cards yet — run mneme.rewind.run first."
        : `${ledger.length} regression cards on file. Latest: ${ledger[ledger.length - 1]?.headline ?? ""}`,
      followUp: ledger.length === 0 ? ["mneme.rewind.run"] : [],
      confidence: { level: ledger.length === 0 ? "low" as const : "high" as const },
    };
  },
};

export const rewindCapsulesTool: MnemeTool = {
  name: "mneme.rewind.capsules",
  category: "meta",
  description: "REWIND — list pinned capsule ids. Each capsule is a reusable time-capsule of past commits that can be fired at every vendor release.",
  whenToUse: "Choosing a capsule to replay against a new vendor version (reuseCapsuleId).",
  triggers: ["rewind capsules", "list capsules"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const ids = core.rewind.listCapsules(repoRoot);
    return {
      data: { count: ids.length, capsuleIds: ids },
      wisdom: ids.length === 0 ? "No capsules sealed yet." : `${ids.length} capsule(s) sealed.`,
      followUp: ids.length === 0 ? ["mneme.rewind.run"] : ["mneme.rewind.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const rewindRegressionTool: MnemeTool = {
  name: "mneme.rewind.regression",
  category: "meta",
  description: "REWIND — quick regression-only summary: latest card per vendor + their regression status.",
  whenToUse: "At-a-glance vendor regression dashboard; routing pre-flight check.",
  triggers: ["rewind regression", "vendor regression summary"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const all = core.rewind.listCards(repoRoot, 500);
    const latestByVendor = new Map<string, typeof all[number]>();
    for (const e of all) latestByVendor.set(e.vendor, e);
    const summary = Array.from(latestByVendor.values()).map((e) => ({
      vendor: e.vendor,
      vendorVersion: e.vendorVersion,
      regression: e.regression,
      correctness: e.correctness,
      delta: e.delta,
      weight: e.weight,
      seq: e.seq,
      headline: e.headline,
    }));
    return {
      data: { vendors: summary.length, summary },
      wisdom: summary.length === 0
        ? "No regression history yet — run mneme.rewind.run."
        : `${summary.length} vendor(s) tracked; ${summary.filter((s) => s.regression === "regression").length} flagged regression.`,
      followUp: summary.length === 0 ? ["mneme.rewind.run"] : ["mneme.rewind.card"],
      confidence: { level: "high" as const },
    };
  },
};

export const rewindVerifyTool: MnemeTool = {
  name: "mneme.rewind.verify",
  category: "meta",
  description: "REWIND — verify a pasted VendorRegressionCard's HMAC chain offline.",
  whenToUse: "Cross-machine attestation; receipts.",
  triggers: ["rewind verify"],
  inputSchema: {
    type: "object",
    properties: { card: { type: "object" }, prevChainLink: { type: "string" } },
    required: ["card"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = args["card"] as Parameters<typeof core.rewind.verifyCard>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!card || typeof card !== "object") {
      return {
        data: { ok: false, reason: "card argument missing" },
        wisdom: "Pass `card` (full VendorRegressionCard).",
        followUp: ["mneme.rewind.card"],
        confidence: { level: "high" as const },
      };
    }
    const v = core.rewind.verifyCard(card, prev);
    return {
      data: v,
      wisdom: v.ok ? "Regression card HMAC verified." : `HMAC FAIL: ${v.reason}`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

void existsSync; void readFileSync; // reserved for future passthrough surfaces

export const REWIND_TOOLS: MnemeTool[] = [
  rewindRunTool,
  rewindCardTool,
  rewindCapsulesTool,
  rewindRegressionTool,
  rewindVerifyTool,
];
