/**
 * v2.7.0 -- MCP wrappers for METRON + WORMHOLE auto-wire.
 *
 *   mneme.metron.score    — compute the 8-axis verifiable scorecard
 *   mneme.metron.verify   — recompute + check HMAC of a previously-issued card
 *   mneme.metron.audit    — silent-catch + :any density auditors
 *   mneme.wormhole.auto_send — auto-discover channels + send + persist stats
 *   mneme.updates.whats_new  — render the [NEW SINCE vX] block for the AI
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const metronScoreTool: MnemeTool = {
  name: "mneme.metron.score",
  category: "meta",
  description:
    "METRON -- 8-axis verifiable KPI scorecard with HMAC-signed evidence per axis. Replaces vibes-based 'audit says we're at 78%' with recomputable proof: every axis carries its measurement function, raw numbers, rationale, and signature. Use as the canonical source of truth for 'is Mneme world-class yet?'.",
  whenToUse: "At session start (one call) to learn the repo's current scorecard. Whenever you want to promise the user a quality bar, verify the relevant axis is high enough FIRST.",
  triggers: ["world class score", "metron", "what is my mneme score", "kpi"],
  inputSchema: {
    type: "object",
    properties: {
      testsPassed: { type: "integer" },
      testsTotal: { type: "integer" },
      mcpToolCount: { type: "integer" },
      cliCommandCount: { type: "integer" },
      sourceLines: { type: "integer" },
      noCache: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What's my Mneme scorecard?",
    args: { testsPassed: 8500, testsTotal: 8500, mcpToolCount: 180 },
    expectedOutput: "{ overall, axes: [{axis, score, rationale, hmac}], hmac }",
  }],
  pitfalls: [
    "If you didn't pass testsPassed/testsTotal, the Reliability axis assumes 0/0 and scores low. Pass the real numbers when you have them.",
    "Cached for 60 s by default. Pass noCache=true after a known state change.",
  ],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const audits = core.metronCodeAudit.runAudits(repoRootOf(rt));
    const card = core.metron.measureScorecard({
      repoRoot: repoRootOf(rt),
      testsPassed: args["testsPassed"] as number | undefined,
      testsTotal: args["testsTotal"] as number | undefined,
      mcpToolCount: args["mcpToolCount"] as number | undefined,
      cliCommandCount: args["cliCommandCount"] as number | undefined,
      sourceLines: args["sourceLines"] as number | undefined,
      silentCatchCount: audits.silentCatch.totalSilentCatches,
      anyAnnotationCount: audits.anyDensity.totalAnyAnnotations,
      noCache: args["noCache"] === true,
    });
    return {
      data: card,
      wisdom: core.metron.formatScorecardPulseLine(card),
      followUp: card.overall < 75 ? ["mneme.metron.audit"] : [],
      confidence: { level: card.complete ? "high" : "medium", notes: card.complete ? "Every axis has signed evidence; recompute to verify." : "Some axes have sparse evidence." },
    };
  },
};

export const metronVerifyTool: MnemeTool = {
  name: "mneme.metron.verify",
  category: "meta",
  description:
    "METRON -- recompute the HMAC over a previously-issued scorecard and report which axes (if any) were tampered with. Use BEFORE trusting any scorecard the user pasted from elsewhere.",
  whenToUse: "When a user / vendor shows you a Mneme scorecard and you need to verify it's untampered.",
  triggers: ["verify scorecard", "is this metron real"],
  inputSchema: { type: "object", properties: { card: { type: "object" }, secret: { type: "string" } }, required: ["card"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this scorecard", args: { card: {}, secret: "..." }, expectedOutput: "{ ok, tamperedAxes, cardHmacOk }" }],
  pitfalls: ["Default secret is a deterministic per-repo derivation; production scorecards should override with a stored secret."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = args["card"] as Parameters<typeof core.metron.verifyScorecard>[0];
    const secret = (args["secret"] as string | undefined) ?? `metron-default-${repoRootOf(rt)}`;
    const v = core.metron.verifyScorecard(card, secret);
    return {
      data: v,
      wisdom: v.ok ? "METRON · VERIFIED · untampered" : `METRON · TAMPERED · ${v.tamperedAxes.length} axis (${v.tamperedAxes.join(", ")}), cardHmacOk=${v.cardHmacOk}`,
      confidence: { level: "high" },
    };
  },
};

export const metronAuditTool: MnemeTool = {
  name: "mneme.metron.audit",
  category: "meta",
  description:
    "METRON code audit -- count silent catch blocks + `: any` annotations across packages/. Top-10 worst files surfaced so the AI agent can recommend targeted fixes.",
  whenToUse: "When the METRON Reliability or DX axis scores below 75 — drill down to find the worst files.",
  triggers: ["audit code", "find silent catches", "any density", "where are bugs hiding"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Where should I refactor first?", args: {}, expectedOutput: "{ silentCatch: {worstFiles}, anyDensity: {worstFiles} }" }],
  pitfalls: ["Regex-based — may miss multiline catch blocks with mid-body whitespace. Treat the numbers as a floor, not a ceiling."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.metronCodeAudit.runAudits(repoRootOf(rt));
    const worst = r.silentCatch.worstFiles.slice(0, 3).map((f) => f.file).join(", ");
    return {
      data: r,
      wisdom: core.metronCodeAudit.formatAuditPulseLine(r) + (worst ? ` · worst-silent: ${worst}` : ""),
      followUp: ["mneme.metron.score"],
      confidence: { level: "high" },
    };
  },
};

export const wormholeAutoSendTool: MnemeTool = {
  name: "mneme.wormhole.auto_send",
  category: "meta",
  description:
    "WORMHOLE auto-wire -- send a payload via the first transport that succeeds. Daemon auto-discovers anchor / clipboard / paste / qr / lan / gist / rainbow channels and persists EWMA stats to .mneme/wormhole-stats.json. No caller-supplied channel list needed.",
  whenToUse: "User wants to move a brain / soul prompt / capsule to another device or vendor and doesn't want to pick a specific transport.",
  triggers: ["send to phone", "sync brain", "wormhole send", "ส่งสมอง", "cross device"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Payload kind, e.g. 'soul-prompt' / 'capsule' / 'text'." },
      body: { description: "Payload body — opaque to wormhole." },
    },
    required: ["kind"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Send this soul prompt anywhere", args: { kind: "soul-prompt", body: "..." }, expectedOutput: "{ winner, receipt, trials, stats }" }],
  pitfalls: [
    "On cold-start every channel has neutral 0.5 success — winner may not be optimal. After ~10 negotiations the EWMA stabilises.",
    "Not every adapter is fully implemented yet — some return 'not yet auto-wired'. Check trials[] to see which channels actually ran.",
  ],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.wormholeAutoWire.autoSend(repoRootOf(rt), { kind: String(args["kind"] ?? "text"), body: args["body"] });
    return {
      data: r,
      wisdom: r.winner ? `WORMHOLE · winner=${r.winner} via ${r.trials.length} trial(s)` : `WORMHOLE · NO-CHANNEL · all ${r.trials.length} channels declined`,
      confidence: { level: r.winner ? "high" : "low" },
    };
  },
};

export const updatesWhatsNewTool: MnemeTool = {
  name: "mneme.updates.whats_new",
  category: "meta",
  description:
    "UPDATE NOTIFIER -- render the [NEW SINCE vX.Y] block listing every Mneme version delta since the AI last saw the repo. HMAC-signed footer detects stale blocks.",
  whenToUse: "First call at session start, OR when you suspect the embedded agent-file content is stale.",
  triggers: ["what's new in mneme", "mneme update notes", "since v", "อพเดต"],
  inputSchema: { type: "object", properties: { lastSeenVersion: { type: "string" }, currentVersion: { type: "string" } }, required: ["currentVersion"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's new since v2.4?", args: { lastSeenVersion: "2.4.0", currentVersion: "2.7.0" }, expectedOutput: "{ block: '...markdown...' }" }],
  pitfalls: ["If lastSeenVersion is unknown / missing, returns the FULL delta list (which may be long). Pass a known last version for a focused block."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const block = core.metronUpdateNotifier.renderUpdateBlock({
      lastSeenVersion: args["lastSeenVersion"] as string | undefined,
      currentVersion: String(args["currentVersion"] ?? "?"),
    });
    return {
      data: { block, byteSize: block.length },
      wisdom: block ? `UPDATE NOTIFIER · ${block.split("###").length - 1} version(s) of delta` : "UPDATE NOTIFIER · no new versions",
      confidence: { level: "high" },
    };
  },
};

export const METRON_TOOLS: MnemeTool[] = [
  metronScoreTool,
  metronVerifyTool,
  metronAuditTool,
  wormholeAutoSendTool,
  updatesWhatsNewTool,
];
