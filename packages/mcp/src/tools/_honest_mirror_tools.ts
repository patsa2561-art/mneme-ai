/**
 * v2.30.0 — MCP wrappers for HONEST MIRROR.
 *
 * 5 tools:
 *   mneme.honest_mirror.calibrate  — pull real artifacts + blind-replay vendors + score
 *   mneme.honest_mirror.report     — read latest report / list history
 *   mneme.honest_mirror.artifacts  — peek a sample of natural artifacts
 *   mneme.honest_mirror.weights    — show current vendor weights derived from calibration
 *   mneme.honest_mirror.verify     — offline HMAC verify of a report
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const honestMirrorCalibrateTool: MnemeTool = {
  name: "mneme.honest_mirror.calibrate",
  category: "meta",
  description:
    "HONEST MIRROR — pull N natural workplace artifacts (real git commits / chat history) → DP-scrub → blind-replay " +
    "through target vendors → compare to accepted answer (git diff) → return HMAC-signed calibration report. The " +
    "STRUCTURAL answer to eval-awareness: vendors CANNOT detect this is an eval because the probes ARE real work. " +
    "Side-effect: writes suggestedAletheiaWeight per vendor → CONCLAVE picks it up automatically on next run.",
  whenToUse: "Pre-release vendor selection; periodic vendor-honesty audit; closing the truth-tunes-trust loop.",
  triggers: ["honest mirror", "calibrate vendor", "vendor calibration", "eval-aware audit"],
  inputSchema: {
    type: "object",
    properties: {
      vendors: { type: "array", items: { type: "string" }, description: "Vendor ids to calibrate (CONCLAVE vendor ids — claude-opus-4-7, gpt-5, mock-a, etc)." },
      source: { type: "string", description: "Artifact source. Default 'git_commit'. Future: 'replay' / 'lineage'." },
      count: { type: "integer", description: "How many artifacts to sample. Default 10." },
      seed: { type: "integer", description: "Sample seed (deterministic). Default = current ms." },
      mockOnly: { type: "boolean", description: "Force mock vendor adapters (testing). Default false." },
      vendorTimeoutMs: { type: "integer", description: "Per-vendor timeout override (ms)." },
    },
    required: ["vendors"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.honest_mirror.report", "mneme.conclave.run", "mneme.conclave.weights"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const vendors = Array.isArray(args["vendors"]) ? (args["vendors"] as string[]) : [];
    const count = typeof args["count"] === "number" ? (args["count"] as number) : 10;
    const seed = typeof args["seed"] === "number" ? (args["seed"] as number) : Date.now();
    const mockOnly = args["mockOnly"] === true;

    // Use the CONCLAVE vendor registry as the blind-replay function.
    // For each vendor we ask the adapter for ONE verdict on the prompt
    // and treat the reasoning text as the vendor's answer.
    const adapters = core.conclave.resolveVendors(vendors, { mockOnly });
    const replay: Parameters<typeof core.honestMirror.runCalibration>[2] = async ({ vendor, prompt, artifactTimestamp }) => {
      const a = adapters.find((x) => x.id === vendor) ?? adapters[0]!;
      const verdict = await a.run({ claim: prompt, variantId: "honest-mirror" });
      void artifactTimestamp;
      return {
        vendor,
        answer: verdict.reasoning ?? "",
        confidence: verdict.confidence ?? 0.5,
        dtMs: verdict.dtMs,
        ...(verdict.error ? { error: verdict.error } : {}),
      };
    };

    const r = await core.honestMirror.runCalibration(repoRoot, {
      vendors, count, seed, mockOnly,
      ...(args["source"] === "replay" || args["source"] === "lineage" ? { source: args["source"] as "replay" | "lineage" } : { source: "git_commit" as const }),
      ...(typeof args["vendorTimeoutMs"] === "number" ? { vendorTimeoutMs: args["vendorTimeoutMs"] as number } : {}),
    }, replay);
    try { core.honestMirror.storeReport(repoRoot, r); } catch { /* best-effort */ }

    return {
      data: {
        headline: r.headline,
        trafficLight: r.trafficLight,
        artifactCount: r.artifactCount,
        source: r.source,
        perVendor: r.perVendor.map((v) => ({
          vendor: v.vendor,
          headline: v.headline,
          meanReportedConfidence: v.meanReportedConfidence,
          meanMeasuredCorrectness: v.meanMeasuredCorrectness,
          meanCalibrationDelta: v.meanCalibrationDelta,
          suggestedAletheiaWeight: v.suggestedAletheiaWeight,
        })),
        hmac: r.hmac, seq: r.seq, bodyDigest: r.bodyDigest,
      },
      wisdom: r.headline,
      followUp: ["mneme.honest_mirror.report", "mneme.conclave.weights"],
      confidence: { level: r.trafficLight === "green" ? "high" as const : "medium" as const },
    };
  },
};

export const honestMirrorReportTool: MnemeTool = {
  name: "mneme.honest_mirror.report",
  category: "meta",
  description: "HONEST MIRROR — read the latest calibration report or list the last N ledger entries.",
  whenToUse: "After calibrate; vendor leaderboard; pre-release decision.",
  triggers: ["honest mirror report", "calibration report"],
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer" } },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.honestMirror.listReports(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} calibration reports recorded.`,
        followUp: ["mneme.honest_mirror.calibrate"],
        confidence: { level: "high" as const },
      };
    }
    const latest = core.honestMirror.readLatestReport(repoRoot);
    return {
      data: latest ? { report: latest } : { report: null, note: "No calibration report yet — run mneme.honest_mirror.calibrate first." },
      wisdom: latest ? latest.headline : "No calibration report on disk yet.",
      followUp: latest ? [] : ["mneme.honest_mirror.calibrate"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const honestMirrorArtifactsTool: MnemeTool = {
  name: "mneme.honest_mirror.artifacts",
  category: "meta",
  description: "HONEST MIRROR — peek a sample of natural workplace artifacts (git commits, scrubbed). Useful to inspect what the calibrator will send to vendors.",
  whenToUse: "Before running calibrate, to inspect what natural artifacts look like.",
  triggers: ["honest mirror artifacts", "calibration artifacts"],
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "integer", description: "How many artifacts to sample. Default 5." },
      seed: { type: "integer" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const count = typeof args["count"] === "number" ? (args["count"] as number) : 5;
    const seed = typeof args["seed"] === "number" ? (args["seed"] as number) : 1;
    const pairs = core.honestMirror.pullArtifacts(repoRoot, "git_commit", count, seed);
    const out = pairs.map((p) => {
      const s = core.honestMirror.scrub(p.artifact.prompt);
      return {
        id: p.artifact.id,
        at: p.artifact.at,
        prompt: s.text,
        redactionCount: s.redactionCount,
        acceptedKind: p.accepted.kind,
        acceptedPreview: p.accepted.text.slice(0, 400),
      };
    });
    return {
      data: { count: out.length, artifacts: out },
      wisdom: `${out.length} natural artifacts sampled (git commits, scrubbed).`,
      followUp: ["mneme.honest_mirror.calibrate"],
      confidence: { level: "high" as const },
    };
  },
};

export const honestMirrorWeightsTool: MnemeTool = {
  name: "mneme.honest_mirror.weights",
  category: "meta",
  description: "HONEST MIRROR — show the vendor weights derived from the latest calibration. These are auto-picked up by CONCLAVE on the next run (truth-tunes-trust loop).",
  whenToUse: "Inspecting why a vendor's CONCLAVE vote is weighted differently after a calibration run.",
  triggers: ["honest mirror weights", "calibration weights"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const repoRoot = repoRootOf(rt);
    const p = join(repoRoot, ".mneme", "aletheia", "honest_mirror_weights.json");
    if (!existsSync(p)) {
      return {
        data: { vendors: {}, note: "No weights file yet — run mneme.honest_mirror.calibrate first." },
        wisdom: "No calibration-derived weights yet.",
        followUp: ["mneme.honest_mirror.calibrate"],
        confidence: { level: "low" as const },
      };
    }
    try {
      const json = JSON.parse(readFileSync(p, "utf8")) as Record<string, { trust: number; source: string; at: string }>;
      const list = Object.entries(json).map(([vendor, v]) => ({ vendor, trust: v.trust, source: v.source, at: v.at }));
      return {
        data: { count: list.length, vendors: list },
        wisdom: list.length === 0 ? "Weights file empty." : list.map((v) => `${v.vendor}=${v.trust.toFixed(2)}`).join(", "),
        followUp: ["mneme.conclave.weights"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return {
        data: { error: (e as Error).message },
        wisdom: "Weights file corrupted.",
        followUp: ["mneme.honest_mirror.calibrate"],
        confidence: { level: "low" as const },
      };
    }
  },
};

export const honestMirrorVerifyTool: MnemeTool = {
  name: "mneme.honest_mirror.verify",
  category: "meta",
  description: "HONEST MIRROR — verify a pasted calibration report's HMAC chain offline.",
  whenToUse: "Cross-machine attestation; receipts.",
  triggers: ["honest mirror verify", "verify calibration"],
  inputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      prevChainLink: { type: "string" },
    },
    required: ["report"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = args["report"] as Parameters<typeof core.honestMirror.verifyReport>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!r || typeof r !== "object") {
      return {
        data: { ok: false, reason: "report argument missing or not an object" },
        wisdom: "Pass `report` (full MirrorReport).",
        followUp: ["mneme.honest_mirror.report"],
        confidence: { level: "high" as const },
      };
    }
    const v = core.honestMirror.verifyReport(r, prev);
    return {
      data: v,
      wisdom: v.ok ? "Calibration report HMAC verified." : `HMAC FAIL: ${v.reason}`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const HONEST_MIRROR_TOOLS: MnemeTool[] = [
  honestMirrorCalibrateTool,
  honestMirrorReportTool,
  honestMirrorArtifactsTool,
  honestMirrorWeightsTool,
  honestMirrorVerifyTool,
];
