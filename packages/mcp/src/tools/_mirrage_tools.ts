/**
 * v2.62.0 — MIRRAGE MCP tool surface.
 *
 *   mneme.mirrage.scan      — scan a draft + emit nudges (with conscience ladder)
 *   mneme.mirrage.ack       — acknowledge a nudge (bumps fatigue + optional broadcast)
 *   mneme.mirrage.wisdom    — show cross-agent wisdom feed
 *   mneme.mirrage.audit     — verify HMAC-chained nudge ledger
 *
 * Wraps core/src/mirrage/. Agents call `scan` BEFORE shipping a draft;
 * nudge IDs are stable across `scan` invocations on the same sentence,
 * so the agent can `ack` after applying the suggestion.
 */

import type { MnemeTool } from "./_types.js";

export const mirrageScanTool: MnemeTool = {
  name: "mneme.mirrage.scan",
  category: "meta",
  description:
    "🪞 MIRRAGE — scan a draft for refutable claims BEFORE shipping. Per-sentence nudges graded by 5-level conscience ladder (✨ hint / 💡 suggestion / ⚠ warning / 🛑 block / 🚨 reject). Returns suggested edit + ship-block decision. Lightweight heuristic (<10ms typical). Reverse-channel angle: Mneme injects warnings into agent's reflection step.",
  whenToUse:
    "BEFORE sending a draft to the user. Especially for drafts containing specific entities (versions, dates, paths, function names, commit hashes) — these are hallucination magnets.",
  triggers: ["scan draft", "mirrage scan", "check my draft for errors"],
  inputSchema: {
    type: "object",
    required: ["draft", "agent"],
    properties: {
      draft: { type: "string", description: "Draft text to scan." },
      agent: { type: "string", description: "Requesting agent (for fatigue + wisdom tracking)." },
      cursorPos: { type: "number", description: "Streaming mode: only scan sentences ending before this offset." },
      minRisk: { type: "number", description: "Risk threshold below which no nudge emits (default 0.30)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.mirrage.scanDraft({
        draft: String(args["draft"] ?? ""),
        agent: String(args["agent"] ?? "unknown"),
        cursorPos: typeof args["cursorPos"] === "number" ? args["cursorPos"] as number : undefined,
        minRisk: typeof args["minRisk"] === "number" ? args["minRisk"] as number : 0.30,
        cwd,
      });
      return {
        data: r,
        wisdom: r.blocksShip
          ? `🛑 SHIP BLOCKED — ${r.nudges.filter((n) => n.blocksShip).length} blocking nudge(s)`
          : r.nudges.length > 0
          ? `${r.nudges.length} nudge(s) — review before ship`
          : "✓ clean — no nudges",
        followUp: r.nudges.length > 0 ? ["mneme.mirrage.ack"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "scan failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const mirrageAckTool: MnemeTool = {
  name: "mneme.mirrage.ack",
  category: "meta",
  description:
    "🪞 MIRRAGE — acknowledge a nudge. Bumps the agent's fatigue counter for that sentence fingerprint (avoids nag spam on the next scan). Optional --broadcast appends the lesson to the cross-agent wisdom feed so other agents in the project see it.",
  whenToUse: "After agent applied a nudge's suggested edit OR explicitly decided to keep the draft as-is.",
  triggers: ["ack nudge", "mirrage ack"],
  inputSchema: {
    type: "object",
    required: ["scanId", "nudgeId", "agent"],
    properties: {
      scanId: { type: "string" },
      nudgeId: { type: "string" },
      agent: { type: "string" },
      broadcast: { type: "boolean", description: "Append lesson to cross-agent wisdom feed." },
      sentence: { type: "string", description: "Required when broadcast=true." },
      level: { type: "string", enum: ["hint", "suggestion", "warning", "block", "reject"] },
      reason: { type: "string", description: "Plain-English explanation for the broadcast." },
      fingerprint: { type: "string", description: "Sentence fingerprint hash (for fatigue gating)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.mirrage.acknowledgeNudge({
        scanId: String(args["scanId"]),
        nudgeId: String(args["nudgeId"]),
        agent: String(args["agent"]),
        broadcast: args["broadcast"] === true,
        sentence: typeof args["sentence"] === "string" ? args["sentence"] : undefined,
        level: args["level"] as import("@mneme-ai/core").mirrage.NudgeLevel | undefined,
        reason: typeof args["reason"] === "string" ? args["reason"] : undefined,
        fingerprint: typeof args["fingerprint"] === "string" ? args["fingerprint"] : undefined,
        cwd,
      });
      return {
        data: r,
        wisdom: r.hint,
        followUp: r.broadcast ? ["mneme.mirrage.wisdom"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "ack failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const mirrageWisdomTool: MnemeTool = {
  name: "mneme.mirrage.wisdom",
  category: "meta",
  description:
    "🪞 MIRRAGE — show the cross-agent wisdom feed. Lessons broadcast from one agent's nudge ack become candidates for other agents in the same project to consult.",
  whenToUse: "Onboarding a new agent; periodic review of accumulated project wisdom.",
  triggers: ["mirrage wisdom", "show project wisdom"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const rows = core.mirrage.readWisdom(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return {
        data: { ok: true, total: rows.length, recent: rows.slice(-limit) },
        wisdom: `${rows.length} wisdom entr(ies) shared across agents`,
        followUp: [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "wisdom fetch failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const mirrageAuditTool: MnemeTool = {
  name: "mneme.mirrage.audit",
  category: "meta",
  description:
    "🪞 MIRRAGE — verify the HMAC-chained nudge ledger + return last N entries. Tamper-evident record of every scan + ack + broadcast.",
  whenToUse: "Compliance audit; investigating an agent's claim history; chain integrity check.",
  triggers: ["mirrage audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.mirrage.verifyLedgerChain(cwd);
      const rows = core.mirrage.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return {
        data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) },
        wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`,
        followUp: [],
        confidence: { level: led.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const MIRRAGE_TOOLS: MnemeTool[] = [
  mirrageScanTool,
  mirrageAckTool,
  mirrageWisdomTool,
  mirrageAuditTool,
];
