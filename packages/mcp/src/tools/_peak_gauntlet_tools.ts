/**
 * v2.26.0 — MCP wrappers for PEAK PERFORMANCE GAUNTLET / AUTO-OPTIMIZER.
 *
 * 4 tools:
 *   mneme.tune.run          — run all 12 probes + emit signed scorecard
 *   mneme.tune.report       — read latest scorecard / list history
 *   mneme.tune.findings     — list the 12 finding definitions
 *   mneme.tune.suggest_fix  — given finding id, return remediation
 *
 * Note: this file is NEW in v2.26.0 — the existing _tune_tools.ts is
 * unrelated (embedder autodiagnose + windowed compliance from v1.65).
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const tuneRunTool: MnemeTool = {
  name: "mneme.tune.run",
  category: "meta",
  description:
    "PEAK PERFORMANCE GAUNTLET — run all 12 deep-findings probes (N1-N12) against this install's MCP server + emit " +
    "an HMAC-signed scorecard. Each finding scored 0-10 stars; aggregate 0-100. Persists to .mneme/tune/.",
  whenToUse: "Pre-release self-grade; nightly governance audit; after touching MCP server code.",
  triggers: ["mneme tune", "run gauntlet", "self grade", "peak gauntlet"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  composeWith: ["mneme.tune.report", "mneme.tune.suggest_fix"],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const card = await core.tune.runGauntlet({ cwd: repoRoot });
    try { core.tune.storeCard(repoRoot, card); } catch { /* best-effort */ }
    return {
      data: {
        headline: card.headline,
        trafficLight: card.trafficLight,
        overall: card.overall,
        findings: card.findings,
        hmac: card.hmac,
        seq: card.seq,
        bodyDigest: card.bodyDigest,
      },
      wisdom: card.headline,
      followUp: card.overall >= 90 ? [] : ["mneme.tune.suggest_fix"],
      confidence: { level: "high" as const },
    };
  },
};

export const tuneReportTool: MnemeTool = {
  name: "mneme.tune.report",
  category: "meta",
  description:
    "PEAK PERFORMANCE GAUNTLET — read the latest signed scorecard, or the last N ledger entries.",
  whenToUse: "After tune.run; periodic check.",
  triggers: ["tune report", "show scorecard", "peak gauntlet report"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "If set, return the last N ledger entries instead of the full latest card." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.tune.listCards(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} scorecard(s) recorded.`,
        followUp: ["mneme.tune.run"],
        confidence: { level: "high" as const },
      };
    }
    const latest = core.tune.readLatestCard(repoRoot);
    return {
      data: latest ? { card: latest } : { card: null, note: "No scorecard yet — run mneme.tune.run first." },
      wisdom: latest ? latest.headline : "No gauntlet scorecard on disk yet.",
      followUp: latest ? [] : ["mneme.tune.run"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const tuneFindingsTool: MnemeTool = {
  name: "mneme.tune.findings",
  category: "meta",
  description:
    "PEAK PERFORMANCE GAUNTLET — list the 12 finding definitions (N1-N12) with title + spec + sinceVersion.",
  whenToUse: "Audit prep; documenting which classes are scored.",
  triggers: ["list findings", "tune findings"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const list = core.tune.ALL_FINDINGS.map((f) => ({
      id: f.id,
      title: f.title,
      spec: f.spec,
      sinceVersion: f.sinceVersion,
      remediation: f.remediation,
    }));
    return {
      data: { count: list.length, findings: list },
      wisdom: `${list.length} deep-findings probes loaded.`,
      followUp: ["mneme.tune.run"],
      confidence: { level: "high" as const },
    };
  },
};

/**
 * v2.26.1 — abort-aware probe tool used by the N6 cancellation finding.
 * Reads `args.__mneme_signal` (an AbortSignal injected by the dispatcher)
 * + short-circuits if the signal fires during the sleep. This proves end-
 * to-end that the cancel manager's AbortController reaches handlers that
 * opt-in.
 */
export const tuneProbeLongSleepTool: MnemeTool = {
  name: "mneme.tune.probe.long_sleep",
  category: "meta",
  description:
    "Probe-only — sleep for up to N ms, returning early if the dispatcher-injected AbortSignal fires. Used by the " +
    "N6 cancellation probe to verify end-to-end abort propagation. Default sleep is 2500ms; the probe sends a " +
    "cancellation immediately + expects this tool to return in <500ms with `aborted:true`.",
  whenToUse: "Internal probe surface. Don't call directly.",
  triggers: [],
  inputSchema: {
    type: "object",
    properties: {
      sleepMs: { type: "integer", description: "Max sleep duration in ms (default 2500)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const sleepMs = typeof args["sleepMs"] === "number" ? Math.max(1, Math.min(30_000, args["sleepMs"] as number)) : 2500;
    const signal = args["__mneme_signal"] as AbortSignal | undefined;
    const t0 = Date.now();
    const aborted = await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (wasAborted: boolean) => { if (!done) { done = true; resolve(wasAborted); } };
      const timer = setTimeout(() => finish(false), sleepMs);
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); finish(true); return; }
        signal.addEventListener("abort", () => { clearTimeout(timer); finish(true); }, { once: true });
      }
    });
    const dtMs = Date.now() - t0;
    return {
      data: { aborted, dtMs, sleepMs },
      wisdom: aborted ? `🛑 short-circuited by abort signal after ${dtMs}ms (max ${sleepMs}ms)` : `slept ${dtMs}ms / ${sleepMs}ms`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const tuneSuggestFixTool: MnemeTool = {
  name: "mneme.tune.suggest_fix",
  category: "meta",
  description:
    "PEAK PERFORMANCE GAUNTLET — given a finding id (e.g. N3), return step-by-step remediation + concrete commands.",
  whenToUse: "After tune.run flags a sub-9-star finding.",
  triggers: ["how to fix finding", "tune suggest"],
  inputSchema: {
    type: "object",
    properties: {
      findingId: { type: "string", description: "Finding id like N1, N2 ... N12." },
    },
    required: ["findingId"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const id = String(args["findingId"] ?? "");
    if (!/^N\d{1,2}$/.test(id)) {
      return {
        data: { ok: false, reason: `invalid findingId '${id}'; expected N1..N12` },
        wisdom: "Pass findingId like N3.",
        followUp: ["mneme.tune.findings"],
        confidence: { level: "high" as const },
      };
    }
    const suggestion = core.tune.suggestFix(id as `N${number}`);
    if (!suggestion) {
      return {
        data: { ok: false, reason: `no finding with id ${id}` },
        wisdom: "No such finding.",
        followUp: ["mneme.tune.findings"],
        confidence: { level: "high" as const },
      };
    }
    return {
      data: { ok: true, suggestion },
      wisdom: `${id}: ${suggestion.steps.length} remediation step(s).`,
      followUp: ["mneme.tune.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const PEAK_GAUNTLET_TOOLS: MnemeTool[] = [
  tuneRunTool,
  tuneReportTool,
  tuneFindingsTool,
  tuneSuggestFixTool,
  tuneProbeLongSleepTool,
];
