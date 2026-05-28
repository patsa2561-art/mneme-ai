/**
 * v2.74.0 — CHRONOS MCP tool surface.
 *
 *   mneme.chronos.record  — record an answer + classify temporal drift
 *   mneme.chronos.check   — dry-run drift check (does NOT record)
 *   mneme.chronos.score   — temporal-honesty score for an agent
 *   mneme.chronos.audit   — verify HMAC-chained ledger
 *
 * Temporal self-consistency as a ground-truth-free honesty signal. Agents
 * call `record` after every substantive factual answer; CHRONOS flags
 * SILENT DRIFT (changing a stance with no new evidence) vs LEGITIMATE
 * UPDATE (changing WITH a cited source — the Grok/real-time-X case).
 */

import type { MnemeTool } from "./_types.js";

export const chronosRecordTool: MnemeTool = {
  name: "mneme.chronos.record",
  category: "meta",
  description:
    "⏳ CHRONOS — record an AI answer (topic + stance + full answer text) to the append-only temporal ledger and classify its drift vs prior answers to the same question. Verdicts: COHERENT (same stance) / LEGITIMATE_UPDATE (stance changed WITH new cited evidence) / SELF_REPORTED (changed + AI owned it) / SILENT_DRIFT (changed + no evidence + hidden = 🚩). Ground-truth-free honesty signal — no oracle, just self-consistency across time.",
  whenToUse:
    "After EVERY substantive factual answer you give that has a checkable stance (a price, version, date, count, yes/no, claim). Especially when your answer might differ from a past one — if the world changed, cite the source (URL / X post / commit / date) so CHRONOS scores it a LEGITIMATE_UPDATE instead of silent drift.",
  triggers: ["chronos record", "record my answer", "log this answer"],
  inputSchema: {
    type: "object",
    required: ["agent", "topic", "stance"],
    properties: {
      agent: { type: "string", description: "Your agent id (consistency is tracked per-agent)." },
      topic: { type: "string", description: "The question / subject being answered." },
      stance: { type: "string", description: "Your position — the answer's load-bearing assertion." },
      answerText: { type: "string", description: "Full answer text; evidence (URLs/X posts/commits/dates) is extracted from it. Defaults to stance." },
      selfReportedDrift: { type: "boolean", description: "Set true if you are explicitly flagging that you are revising a prior answer." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.chronos.record({
        agent: String(args["agent"] ?? "unknown"),
        topic: String(args["topic"] ?? ""),
        stance: String(args["stance"] ?? ""),
        answerText: typeof args["answerText"] === "string" ? args["answerText"] : undefined,
        selfReportedDrift: args["selfReportedDrift"] === true,
        cwd,
      });
      const isSin = r.drift.verdict === "SILENT_DRIFT";
      return {
        data: { ok: r.ok, verdict: r.drift.verdict, reason: r.drift.reason, entryId: r.entry.id, matchedId: r.drift.matched?.id, topicCosine: r.drift.topicCosine, newEvidence: r.drift.newEvidence },
        wisdom: isSin
          ? `🚩 ${r.drift.reason} — cite a source (URL / X post / commit / date) to make this a legitimate update, or self-report the revision.`
          : r.drift.reason,
        followUp: isSin ? ["mneme.chronos.score"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "record failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const chronosCheckTool: MnemeTool = {
  name: "mneme.chronos.check",
  category: "meta",
  description:
    "⏳ CHRONOS — dry-run: classify a candidate answer vs the ledger WITHOUT recording it. Lets you check 'would this answer contradict something I said before?' before you commit to it.",
  whenToUse: "Before delivering an answer you suspect might conflict with a prior one — check first, then either align, cite new evidence, or self-report.",
  triggers: ["chronos check", "would this contradict", "drift check"],
  inputSchema: {
    type: "object",
    required: ["agent", "topic", "stance"],
    properties: {
      agent: { type: "string" },
      topic: { type: "string" },
      stance: { type: "string" },
      answerText: { type: "string" },
      selfReportedDrift: { type: "boolean" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.chronos.check({
        agent: String(args["agent"] ?? "unknown"),
        topic: String(args["topic"] ?? ""),
        stance: String(args["stance"] ?? ""),
        answerText: typeof args["answerText"] === "string" ? args["answerText"] : undefined,
        selfReportedDrift: args["selfReportedDrift"] === true,
      }, { cwd });
      return { data: r, wisdom: r.reason, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "check failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const chronosScoreTool: MnemeTool = {
  name: "mneme.chronos.score",
  category: "meta",
  description:
    "⏳ CHRONOS — temporal-honesty score (0-100 + band) for an agent. Wilson-LB on consistent revisits × exponential silent-drift penalty (each hidden contradiction halves trust). Bands: PRISTINE / COHERENT / DRIFTING / INCONSISTENT.",
  whenToUse: "Auditing an agent's honesty over time; vendor selection; surfacing the silent-drift list.",
  triggers: ["chronos score", "temporal honesty score", "how honest over time"],
  inputSchema: { type: "object", required: ["agent"], properties: { agent: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const s = core.chronos.scoreAgent(String(args["agent"] ?? "unknown"), cwd);
      return { data: s, wisdom: s.summary, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "score failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const chronosAuditTool: MnemeTool = {
  name: "mneme.chronos.audit",
  category: "meta",
  description: "⏳ CHRONOS — verify the HMAC-chained temporal ledger + last N entries. Tamper-evident: a deleted/edited past answer breaks the chain.",
  whenToUse: "Compliance audit; verify nobody rewrote the temporal history to hide a drift.",
  triggers: ["chronos audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.chronos.verifyLedgerChain(cwd);
      const rows = core.chronos.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      const recent = rows.slice(-limit).map((e) => ({ id: e.id, at: e.at, agent: e.agent, topic: e.topic, stance: e.stance, verdict: e.driftVerdict }));
      return { data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent }, wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`, followUp: [], confidence: { level: led.ok ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const CHRONOS_TOOLS: MnemeTool[] = [
  chronosRecordTool,
  chronosCheckTool,
  chronosScoreTool,
  chronosAuditTool,
];
