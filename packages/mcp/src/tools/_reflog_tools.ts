/**
 * v2.66.0 — REFLOG MCP tool surface (time-machine).
 *
 *   mneme.reflog.checkpoint  — create HMAC-signed checkpoint
 *   mneme.reflog.list        — list all checkpoints
 *   mneme.reflog.rewind      — PREVIEW rewind proposal (dry-run by design)
 *   mneme.reflog.audit       — verify HMAC-chained ledger
 */

import type { MnemeTool } from "./_types.js";

export const reflogCheckpointTool: MnemeTool = {
  name: "mneme.reflog.checkpoint",
  category: "meta",
  description:
    "⏪ REFLOG — create an HMAC-signed per-file checkpoint with AI pheromone tag (detects active agent from env: CLAUDECODE / CURSOR_AGENT / etc). Selective via include/exclude globs. Tracks up to 5000 files by default (>5MB files skipped).",
  whenToUse:
    "Before any risky operation (refactor / rewrite / framework upgrade); after a working state worth saving. Cheap (<1s for typical repo).",
  triggers: ["create checkpoint", "save snapshot", "reflog checkpoint"],
  inputSchema: {
    type: "object",
    properties: {
      label: { type: "string" },
      include: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      maxFiles: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.reflog.createCheckpoint({
        cwd,
        label: typeof args["label"] === "string" ? args["label"] : undefined,
        include: Array.isArray(args["include"]) ? args["include"] as string[] : undefined,
        exclude: Array.isArray(args["exclude"]) ? args["exclude"] as string[] : undefined,
        maxFiles: typeof args["maxFiles"] === "number" ? args["maxFiles"] as number : undefined,
      });
      return { data: r, wisdom: r.hint, followUp: ["mneme.reflog.list"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "checkpoint failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const reflogListTool: MnemeTool = {
  name: "mneme.reflog.list",
  category: "meta",
  description: "⏪ REFLOG — list all checkpoints with id / at / label / fileCount / pheromone, newest first.",
  whenToUse: "Choosing a target for rewind; auditing what was saved.",
  triggers: ["list checkpoints", "reflog list"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const list = core.reflog.listCheckpoints(cwd);
      return { data: { ok: true, count: list.length, checkpoints: list }, wisdom: `${list.length} checkpoint(s)`, followUp: ["mneme.reflog.rewind"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "list failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const reflogRewindTool: MnemeTool = {
  name: "mneme.reflog.rewind",
  category: "meta",
  description:
    "⏪ REFLOG — PREVIEW a selective rewind (dry-run by design). Returns toRevert + toKeep with HMAC proof. Path-predicate filter (include/exclude) keeps tests intact while reverting prod code. Optional pheromone filter (only rewind cursor's edits). Never touches working tree — caller applies via IDE.",
  whenToUse: "Bad commit just landed; need to selectively undo. Use `--exclude tests/**` to keep tests; use `--since 2h` for time-window rewind.",
  triggers: ["rewind", "undo", "reflog rewind", "time machine"],
  inputSchema: {
    type: "object",
    properties: {
      since: { type: "string", description: "Time window like '2h', '30m', '1d'." },
      checkpointId: { type: "string", description: "Specific checkpoint id." },
      include: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      pheromone: { type: "string", description: "Only files where target checkpoint had this pheromone." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.reflog.rewindPreview({
        cwd,
        since: typeof args["since"] === "string" ? args["since"] : undefined,
        checkpointId: typeof args["checkpointId"] === "string" ? args["checkpointId"] : undefined,
        include: Array.isArray(args["include"]) ? args["include"] as string[] : undefined,
        exclude: Array.isArray(args["exclude"]) ? args["exclude"] as string[] : undefined,
        pheromone: typeof args["pheromone"] === "string" ? args["pheromone"] : undefined,
      });
      return {
        data: r,
        wisdom: r.summary + "\n" + (r.ok ? core.reflog.renderRewindBanner(r) : ""),
        followUp: [],
        confidence: { level: r.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "rewind failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const reflogAuditTool: MnemeTool = {
  name: "mneme.reflog.audit",
  category: "meta",
  description: "⏪ REFLOG — verify HMAC-chained reflog ledger + last N entries (checkpoint / rewind_preview).",
  whenToUse: "Audit time-machine history; chain integrity check.",
  triggers: ["reflog audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.reflog.verifyLedgerChain(cwd);
      const rows = core.reflog.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return { data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) }, wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`, followUp: [], confidence: { level: led.ok ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const REFLOG_TOOLS: MnemeTool[] = [
  reflogCheckpointTool,
  reflogListTool,
  reflogRewindTool,
  reflogAuditTool,
];
