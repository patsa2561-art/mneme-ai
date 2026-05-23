/**
 * v2.32.0 — MCP wrappers for FLYWHEEL (self-reflective release organ).
 *
 * 8 tools:
 *   mneme.flywheel.run          — full 5-stage pipeline (HARVEST→FUSE→PRESCRIBE→EXECUTE→RECIPROCITY)
 *   mneme.flywheel.report       — read latest report / list ledger
 *   mneme.flywheel.cheatsheet   — personal cheatsheet (auto-shrinks)
 *   mneme.flywheel.bulletin     — render shareable Vendor Bulletin .md
 *   mneme.flywheel.liveness     — heartbeat a primitive / read ledger
 *   mneme.flywheel.marketing    — unbound marketing claim candidates
 *   mneme.flywheel.reciprocity  — record vendor response / list ledger
 *   mneme.flywheel.verify       — offline HMAC verify
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const flywheelRunTool: MnemeTool = {
  name: "mneme.flywheel.run",
  category: "meta",
  description:
    "FLYWHEEL — self-reflective release organ. Runs the 5-stage pipeline (HARVEST signals from TRUTH GATE + " +
    "PEAK GAUNTLET + HONEST MIRROR + REWIND + HGP + marketing diff + primitive registry → FUSE by cluster → " +
    "PRESCRIBE 5 action kinds → EXECUTE side-effects → RECIPROCITY trust deltas). Emits HMAC-signed " +
    "FlywheelReport + applies vendor-response trust deltas to .mneme/aletheia/honest_mirror_weights.json " +
    "(the same file HONEST MIRROR + REWIND write to) unless dryRun=true.",
  whenToUse: "Pre-release self-audit; surfacing the highest-priority action across all 5 audit primitives in one ranked list.",
  triggers: ["flywheel", "release audit", "self audit"],
  inputSchema: {
    type: "object",
    properties: {
      perSourceLimit: { type: "integer", description: "Cap raw findings per source. Default 500." },
      minDeleteAge: { type: "integer", description: "Min age (days) for a dormant primitive to be deletable. Default 0." },
      dryRun: { type: "boolean", description: "Skip side-effects (Aletheia weights). Default false." },
    },
  },
  outputSchema: { type: "object" },
  composeWith: [
    "mneme.flywheel.report", "mneme.flywheel.bulletin", "mneme.flywheel.cheatsheet",
    "mneme.truth_gate.run", "mneme.tune.run", "mneme.honest_mirror.calibrate",
    "mneme.rewind.run", "mneme.hgp.top",
  ],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const mcp = await import("@mneme-ai/mcp");
    const repoRoot = repoRootOf(rt);
    // Build the primitive snapshot from the live MCP catalog so dormant
    // detection works without cross-package coupling.
    const all = mcp.buildAllTools().map((t: { name: string }) => ({ name: t.name }));
    // Known TRUTH GATE claim ids — for marketing diff unbound-claim filter.
    const truthGate = core.truthGate as { CLAIM_CATALOG?: ReadonlyArray<{ id: string }> };
    const knownClaimIds: string[] = (truthGate.CLAIM_CATALOG ?? []).map((c) => c.id);
    const opts: { perSourceLimit?: number; minDeleteAge?: number; dryRun?: boolean } = {};
    if (typeof args["perSourceLimit"] === "number") opts.perSourceLimit = args["perSourceLimit"] as number;
    if (typeof args["minDeleteAge"] === "number") opts.minDeleteAge = args["minDeleteAge"] as number;
    if (args["dryRun"] === true) opts.dryRun = true;
    const r = await core.flywheel.runFlywheel({
      repoRoot, primitives: all, knownClaimIds, options: opts,
    });
    return {
      data: {
        headline: r.headline,
        trafficLight: r.trafficLight,
        health: r.health,
        harvestCounts: r.harvestCounts,
        fusedCount: r.fusedCount,
        clusterCount: r.clusterCount,
        actionCount: r.actions.length,
        blockingCount: r.actions.filter((a) => a.blocking).length,
        actions: r.actions.map((a) => ({
          kind: a.kind, priority: a.priority, blocking: a.blocking,
          closesFindings: a.closesFindings, rationale: a.rationale,
        })),
        seq: r.seq, hmac: r.hmac,
      },
      wisdom: r.headline,
      followUp: ["mneme.flywheel.bulletin", "mneme.flywheel.cheatsheet", "mneme.flywheel.report"],
      confidence: { level: r.trafficLight === "green" ? "high" as const : "medium" as const },
    };
  },
};

export const flywheelReportTool: MnemeTool = {
  name: "mneme.flywheel.report",
  category: "meta",
  description: "FLYWHEEL — read the latest report or list N ledger entries.",
  whenToUse: "After flywheel.run; trend analysis; replaying a prior report.",
  triggers: ["flywheel report"],
  inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.flywheel.listReports(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} report(s) on file.`,
        followUp: [], confidence: { level: "high" as const },
      };
    }
    const latest = core.flywheel.readLatestReport(repoRoot);
    return {
      data: latest ? { report: latest } : { report: null, note: "No FLYWHEEL report yet — run mneme.flywheel.run first." },
      wisdom: latest?.headline ?? "No report yet.",
      followUp: latest ? [] : ["mneme.flywheel.run"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const flywheelCheatsheetTool: MnemeTool = {
  name: "mneme.flywheel.cheatsheet",
  category: "meta",
  description: "FLYWHEEL — personal cheatsheet (auto-shrinks to 3 commands as the user specializes). Fresh install returns the global top-5.",
  whenToUse: "User asks 'what should I know' / 'what commands do I actually use' / wants the SHORTEST cheatsheet.",
  triggers: ["personal cheatsheet", "what should i use", "my cheatsheet"],
  inputSchema: { type: "object", properties: { markdown: { type: "boolean" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    // Self-record so future calls personalize.
    core.flywheel.recordCommand(repoRoot, "mneme.flywheel.cheatsheet");
    const snap = core.flywheel.computeCheatsheet(repoRoot);
    return {
      data: {
        mode: snap.mode,
        header: snap.header,
        entries: snap.entries,
        ...(args["markdown"] === true ? { markdown: core.flywheel.renderCheatsheetMarkdown(snap) } : {}),
      },
      wisdom: snap.header,
      followUp: ["mneme.flywheel.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const flywheelBulletinTool: MnemeTool = {
  name: "mneme.flywheel.bulletin",
  category: "meta",
  description: "FLYWHEEL — render the Vendor Bulletin .md from REWIND regressions + HGP top-N + HONEST MIRROR per-vendor data. Public-shareable; asymmetric pressure on vendor accountability.",
  whenToUse: "After flywheel.run; ready to post a vendor accountability bulletin.",
  triggers: ["vendor bulletin", "share vendor data"],
  inputSchema: {
    type: "object",
    properties: {
      hgpTopN: { type: "integer", description: "How many HGP entries to include. Default 5." },
      markdown: { type: "boolean", description: "Include markdown render. Default true." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const topN = typeof args["hgpTopN"] === "number" ? (args["hgpTopN"] as number) : 5;
    const data = core.flywheel.gatherBulletinData(repoRoot, topN);
    const includeMd = args["markdown"] !== false;
    return {
      data: {
        generatedAt: data.generatedAt,
        rewindRegressionCount: data.rewindRegressions.length,
        hgpTopCount: data.hgpTop.length,
        ...(includeMd ? { markdown: core.flywheel.renderBulletinMarkdown(data) } : {}),
      },
      wisdom: `Bulletin gathered: ${data.rewindRegressions.length} regression(s), ${data.hgpTop.length} top HGP entries.`,
      followUp: ["mneme.flywheel.reciprocity"],
      confidence: { level: "high" as const },
    };
  },
};

export const flywheelLivenessTool: MnemeTool = {
  name: "mneme.flywheel.liveness",
  category: "meta",
  description: "FLYWHEEL — push a heartbeat row for a primitive ('this primitive is alive in production') or read the lastSeen map.",
  whenToUse: "Marking a primitive alive after first production invocation; auditing dormant primitives.",
  triggers: ["flywheel liveness", "primitive heartbeat"],
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Primitive name to heartbeat. Omit to just read the map." },
      shippedAt: { type: "string", description: "ISO timestamp of when this primitive shipped (optional, used for age calculation)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["name"] === "string") {
      core.flywheel.heartbeat(repoRoot, args["name"] as string, typeof args["shippedAt"] === "string" ? (args["shippedAt"] as string) : undefined);
    }
    const map = core.flywheel.lastSeenMap(repoRoot);
    const entries = Array.from(map.entries()).map(([name, at]) => ({ name, lastSeen: at }));
    return {
      data: { count: entries.length, entries },
      wisdom: `${entries.length} primitive(s) with heartbeats.`,
      followUp: ["mneme.flywheel.run"],
      confidence: { level: "high" as const },
    };
  },
};

export const flywheelMarketingTool: MnemeTool = {
  name: "mneme.flywheel.marketing",
  category: "meta",
  description: "FLYWHEEL — list unbound marketing claim candidates extracted from README + docs (numeric + superlative).",
  whenToUse: "Pre-release marketing reconciliation; quarterly README audit.",
  triggers: ["marketing diff", "marketing scan"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const truthGate = core.truthGate as { CLAIM_CATALOG?: ReadonlyArray<{ id: string }> };
    const known: string[] = (truthGate.CLAIM_CATALOG ?? []).map((c) => c.id);
    const r = core.flywheel.harvestMarketing(repoRoot, known);
    return {
      data: {
        count: r.length,
        candidates: r.map((f) => ({ id: f.id, file: (f.detail?.["file"] as string | undefined) ?? "?", text: f.detail?.["text"] as string | undefined, kind: f.detail?.["kind"] as string | undefined })),
      },
      wisdom: r.length === 0 ? "No marketing candidates extracted." : `${r.length} candidate marketing claim(s) detected — bind each to a TRUTH GATE probe.`,
      followUp: ["mneme.truth_gate.claims"],
      confidence: { level: "high" as const },
    };
  },
};

export const flywheelReciprocityTool: MnemeTool = {
  name: "mneme.flywheel.reciprocity",
  category: "meta",
  description: "FLYWHEEL — record a vendor response to a past bulletin (fix/acknowledge/ignore/disputed) or read the ledger. Auto-applies trust deltas to honest_mirror_weights.json.",
  whenToUse: "After a vendor responds (or ignores) a posted Vendor Bulletin.",
  triggers: ["flywheel reciprocity", "vendor response"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      bulletinSeq: { type: "integer" },
      response: { type: "string", description: "fix | acknowledge | ignore | disputed" },
      reactionDays: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const vendor = typeof args["vendor"] === "string" ? (args["vendor"] as string) : "";
    const bulletinSeq = typeof args["bulletinSeq"] === "number" ? (args["bulletinSeq"] as number) : -1;
    const response = args["response"] as "fix" | "acknowledge" | "ignore" | "disputed" | undefined;
    const reactionDays = typeof args["reactionDays"] === "number" ? (args["reactionDays"] as number) : -1;
    if (vendor && response && bulletinSeq >= 0 && reactionDays >= 0) {
      const entry = core.flywheel.recordResponse(repoRoot, { vendor, bulletinSeq, response, reactionDays });
      const applied = core.flywheel.applyToAletheiaWeights(repoRoot);
      return {
        data: { entry, appliedTrustDeltas: applied },
        wisdom: `Recorded ${vendor} response: ${response} after ${reactionDays}d. Trust delta ${entry.trustDelta}.`,
        followUp: ["mneme.flywheel.run", "mneme.conclave.weights"],
        confidence: { level: "high" as const },
      };
    }
    const ledger = core.flywheel.readReciprocityLedger(repoRoot, 100);
    return {
      data: { count: ledger.length, ledger },
      wisdom: ledger.length === 0 ? "No vendor responses recorded yet." : `${ledger.length} vendor response(s) recorded.`,
      followUp: ledger.length === 0 ? ["mneme.flywheel.bulletin"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const flywheelVerifyTool: MnemeTool = {
  name: "mneme.flywheel.verify",
  category: "meta",
  description: "FLYWHEEL — offline HMAC verify of a pasted FlywheelReport.",
  whenToUse: "Cross-machine attestation; tamper detection on a shared report.",
  triggers: ["flywheel verify"],
  inputSchema: {
    type: "object",
    properties: { report: { type: "object" }, prevChainLink: { type: "string" } },
    required: ["report"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = args["report"] as Parameters<typeof core.flywheel.verifyReport>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : undefined;
    if (!r || typeof r !== "object") {
      return {
        data: { ok: false, reason: "report missing" },
        wisdom: "Pass `report` (full FlywheelReport).",
        followUp: [], confidence: { level: "high" as const },
      };
    }
    const v = core.flywheel.verifyReport(r, prev);
    return {
      data: v,
      wisdom: v.ok ? "Report HMAC verified." : `HMAC FAIL: ${v.reason}`,
      followUp: [], confidence: { level: "high" as const },
    };
  },
};

export const FLYWHEEL_TOOLS: MnemeTool[] = [
  flywheelRunTool,
  flywheelReportTool,
  flywheelCheatsheetTool,
  flywheelBulletinTool,
  flywheelLivenessTool,
  flywheelMarketingTool,
  flywheelReciprocityTool,
  flywheelVerifyTool,
];
