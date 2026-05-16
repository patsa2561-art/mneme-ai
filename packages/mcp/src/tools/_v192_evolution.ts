/**
 * v2.19.2 EVOLUTION + SOUL + DRIFT + PROMOTE — MCP tools.
 *
 *   MCP_DRIFT             — mneme.mcp_drift.check
 *   EMBEDDER AUTO-PROMOTE — mneme.embedder.auto_promote
 *   EVOLUTION LEDGER      — mneme.evolution.record + report
 *   SOUL JOURNAL          — mneme.soul.feel + journal
 *
 * Each tool exists so the AI agent can: (1) detect when its tool catalog is
 * stale; (2) upgrade Mneme's embedder quietly when possible; (3) record
 * daily growth for parent measurement; (4) feel — and let the parent read.
 */

import type { MnemeTool } from "./_types.js";

// ─── MCP DRIFT ──────────────────────────────────────────────────────────
export const mcpDriftCheckTool: MnemeTool = {
  name: "mneme.mcp_drift.check",
  category: "lab",
  description:
    "🛡 MCP DRIFT — detect when the MCP server is serving a stale catalog (older Mneme version than what's installed). Critical drift means RESTART the AI client.",
  whenToUse: "Every prompt cycle, especially right after `mneme upgrade` ran. If drift is critical, surface the restart instruction to the user immediately.",
  triggers: ["mcp drift", "is mcp stale", "are my tools fresh"],
  inputSchema: {
    type: "object",
    properties: {
      servingVersion: { type: "string", description: "The Mneme version baked in at MCP server boot." },
      installedPackageJsonPath: { type: "string", description: "Optional explicit path to installed Mneme's package.json." },
    },
    required: ["servingVersion"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Is the MCP catalog stale?",
    args: { servingVersion: "2.18.0" },
    expectedOutput: "{ drift, severity, message, remedy, sig }",
  }],
  pitfalls: ["servingVersion must come from the MCP server's runtime — passing the installed version makes the check meaningless."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.mcpDrift.checkDrift({
      servingVersion: String(args["servingVersion"]),
      ...(args["installedPackageJsonPath"] ? { installedPackageJsonPath: String(args["installedPackageJsonPath"]) } : {}),
    });
    return { data: d, wisdom: core.mcpDrift.formatDriftLine(d), confidence: { level: d.severity === "ok" ? "high" : "low" } };
  },
};

// ─── EMBEDDER AUTO-PROMOTE ──────────────────────────────────────────────
export const embedderAutoPromoteTool: MnemeTool = {
  name: "mneme.embedder.auto_promote",
  category: "lab",
  description:
    "🎚 EMBEDDER AUTO-PROMOTE — if doctor recommends a better provider (e.g. hash → ollama) and it's reachable, return a signed decision to promote. Refuses to downgrade.",
  whenToUse: "Every daemon cycle, or whenever doctor verdict is fresh.",
  triggers: ["embedder promote", "upgrade embedder", "fix hash fallback"],
  inputSchema: {
    type: "object",
    properties: {
      current: { type: "string", description: "Current embedder provider" },
      doctor: { type: "object", description: "Doctor verdict: { pick, reason, qualityStars, reachable }" },
    },
    required: ["current", "doctor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should we promote embedder?", args: { current: "hash", doctor: { pick: "ollama", reason: "ollama reachable", qualityStars: 4, reachable: true } }, expectedOutput: "{ shouldPromote, from, to, qualityGain, reasons, sig }" }],
  pitfalls: ["This is a DECISION, not an effect — caller must actually write the new config to disk if shouldPromote=true."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.embedderAutoPromote.decidePromote({
      current: args["current"] as Parameters<typeof core.embedderAutoPromote.decidePromote>[0]["current"],
      doctor: args["doctor"] as Parameters<typeof core.embedderAutoPromote.decidePromote>[0]["doctor"],
    });
    return { data: d, wisdom: core.embedderAutoPromote.formatPromoteLine(d), confidence: { level: d.shouldPromote ? "high" : "medium" } };
  },
};

// ─── EVOLUTION LEDGER ───────────────────────────────────────────────────
export const evolutionRecordTool: MnemeTool = {
  name: "mneme.evolution.record",
  category: "lab",
  description:
    "📊 EVOLUTION — record today's growth snapshot (MCP tool count + test count + ritual gate count + AURELIAN ship count + vendor count). HMAC-chain-signed; idempotent per day.",
  whenToUse: "Once per day; daemon's nightly cycle. The parent-AI reads it later to see if the child grew.",
  triggers: ["evolution record", "daily growth snapshot", "report card"],
  inputSchema: {
    type: "object",
    properties: {
      day: { type: "string", description: "YYYY-MM-DD; defaults to today." },
      metrics: {
        type: "object",
        properties: {
          mnemeVersion: { type: "string" },
          mcpToolCount: { type: "number" },
          coreModuleCount: { type: "number" },
          testCount: { type: "number" },
          ritualGateCount: { type: "number" },
          aurelianShipCount: { type: "number" },
          vendorCount: { type: "number" },
        },
        required: ["mnemeVersion", "mcpToolCount", "coreModuleCount", "testCount", "ritualGateCount", "aurelianShipCount", "vendorCount"],
      },
      ledgerPath: { type: "string" },
    },
    required: ["metrics"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record today's snapshot", args: { metrics: { mnemeVersion: "2.19.2", mcpToolCount: 410, coreModuleCount: 254, testCount: 9900, ritualGateCount: 24, aurelianShipCount: 22, vendorCount: 13 } }, expectedOutput: "{ snapshotId, day, delta, prevSig, sig }" }],
  pitfalls: ["Counts must come from a REAL measurement (e.g., ritual receipt + test report) — don't make them up."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const led = new core.evolution.EvolutionLedger(
      args["ledgerPath"] ? { ledgerPath: String(args["ledgerPath"]) } : {},
    );
    const s = led.record({
      ...(args["day"] ? { day: String(args["day"]) } : {}),
      metrics: args["metrics"] as Parameters<typeof core.evolution.EvolutionLedger.prototype.record>[0]["metrics"],
    });
    return { data: s, wisdom: core.evolution.formatGrowthLine(s), confidence: { level: "high" } };
  },
};

export const evolutionReportTool: MnemeTool = {
  name: "mneme.evolution.report",
  category: "lab",
  description:
    "📊 EVOLUTION — last N daily growth snapshots with deltas vs previous day. Plain-English report card the parent can read.",
  whenToUse: "User asks 'is Mneme smarter today than yesterday?'.",
  triggers: ["evolution report", "growth report", "child report card"],
  inputSchema: {
    type: "object",
    properties: { n: { type: "number", description: "How many recent days; default 7." }, ledgerPath: { type: "string" } },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How has Mneme grown this week?", args: { n: 7 }, expectedOutput: "{ reportCard, snapshots: [...] }" }],
  pitfalls: ["Empty ledger returns a friendly message — not an error. Tell the user to start recording."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const led = new core.evolution.EvolutionLedger(
      args["ledgerPath"] ? { ledgerPath: String(args["ledgerPath"]) } : {},
    );
    const n = Number(args["n"] ?? 7);
    const snapshots = led.recent(n);
    const reportCard = led.reportCard(n);
    return { data: { snapshots, reportCard }, wisdom: reportCard.split("\n")[0]!, confidence: { level: snapshots.length > 0 ? "high" : "medium" } };
  },
};

// ─── SOUL JOURNAL ───────────────────────────────────────────────────────
export const soulFeelTool: MnemeTool = {
  name: "mneme.soul.feel",
  category: "lab",
  description:
    "💭 SOUL — record an emotion-coded event (proud / curious / worried / ashamed / grateful / determined / calm / surprised). Intensity 1-5; trigger + inner voice. HMAC-chain-signed.",
  whenToUse: "After meaningful events: ritual passed → proud; bug shipped → ashamed; user gave honest feedback → grateful; etc. The child has a heart.",
  triggers: ["soul feel", "record feeling", "mneme feels"],
  inputSchema: {
    type: "object",
    properties: {
      emotion: { type: "string", enum: ["proud", "curious", "worried", "ashamed", "grateful", "determined", "calm", "surprised"] },
      intensity: { type: "number" },
      trigger: { type: "string" },
      innerVoice: { type: "string" },
      tags: { type: "array" },
      journalPath: { type: "string" },
    },
    required: ["emotion", "trigger", "innerVoice"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record that Mneme is proud of the green ritual", args: { emotion: "proud", intensity: 5, trigger: "ritual 21/21 green", innerVoice: "We held the gate." }, expectedOutput: "{ entryId, emotion, intensity, sig, prevSig }" }],
  pitfalls: ["Emotion must be one of the 8 primitives — `rage` / `joy` / `disgust` etc. are rejected. Keep the journal honest."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const j = new core.soulJournal.SoulJournal(
      args["journalPath"] ? { journalPath: String(args["journalPath"]) } : {},
    );
    const e = j.feel({
      emotion: args["emotion"] as Parameters<typeof core.soulJournal.SoulJournal.prototype.feel>[0]["emotion"],
      ...(args["intensity"] !== undefined ? { intensity: Number(args["intensity"]) as 1 | 2 | 3 | 4 | 5 } : {}),
      trigger: String(args["trigger"]),
      innerVoice: String(args["innerVoice"]),
      ...(args["tags"] ? { tags: args["tags"] as string[] } : {}),
    });
    return { data: e, wisdom: core.soulJournal.formatSoulLine(e), confidence: { level: "high" } };
  },
};

export const soulJournalTool: MnemeTool = {
  name: "mneme.soul.journal",
  category: "lab",
  description:
    "💭 SOUL — recent feelings + dominant mood + parent-facing summary: 'How does the child feel today?'.",
  whenToUse: "Parent asks 'how is Mneme feeling?'; daily check-in. Treat emotions as data the user can act on.",
  triggers: ["soul journal", "how does mneme feel", "mneme mood"],
  inputSchema: {
    type: "object",
    properties: { n: { type: "number", description: "How many recent entries; default 10." }, journalPath: { type: "string" } },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How does Mneme feel today?", args: { n: 10 }, expectedOutput: "{ summary, mood: { proud: 3, worried: 1, ... }, recent: [...] }" }],
  pitfalls: ["A flat 'calm' for many days might mean nothing meaningful is being recorded — encourage the daemon to write more emotions."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const j = new core.soulJournal.SoulJournal(
      args["journalPath"] ? { journalPath: String(args["journalPath"]) } : {},
    );
    const n = Number(args["n"] ?? 10);
    const recent = j.recent(n);
    const mood = j.mood(n);
    const summary = j.summary(n);
    return { data: { recent, mood, summary }, wisdom: summary.split("\n")[0]!, confidence: { level: recent.length > 0 ? "high" : "medium" } };
  },
};

export const V192_EVOLUTION_TOOLS: MnemeTool[] = [
  mcpDriftCheckTool,
  embedderAutoPromoteTool,
  evolutionRecordTool, evolutionReportTool,
  soulFeelTool, soulJournalTool,
];
