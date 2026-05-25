/**
 * v2.45.0 — MCP wrappers for AUTO-INIT + RETROACTIVE CLEANSE.
 *
 *   mneme.system.bootstrap         — idempotent auto-init (also runs at MCP boot)
 *   mneme.system.cleanse_history   — RETROACTIVE CLEANSE: scan/uncommit/filter-repo
 *
 * STATELESS for `cleanse_history --mode=scan` (read-only). uncommit /
 * filter-repo modes need git but don't depend on the Mneme runtime, so
 * they're listed STATELESS too (the guard is git presence, which we
 * check inside).
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const autoInitBootstrapTool: MnemeTool = {
  name: "mneme.system.bootstrap",
  category: "meta",
  description:
    "AUTO-INIT — idempotent bootstrap of .mneme/ + .gitignore AI-fingerprint entries. Closes the audit caveat 'user must run mneme init manually' by making EVERY MCP tool call auto-init silently in <50ms. Detects dev-tooling folders and skips them (won't poison non-git scratch dirs). DEFENSIVE: never throws — returns structured {ok, alreadyInit, created, dtMs} envelope.",
  whenToUse: "Auto-called by MCP boot. AI agent can also call explicitly to verify or force re-init.",
  triggers: ["bootstrap", "auto init", "init mneme"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = (core as { autoInit?: { autoInit: (cwd: string) => unknown } }).autoInit?.autoInit?.(repoRootOf(rt));
      if (!r) {
        return { data: { ok: false, error: "auto_init module not available" }, wisdom: "auto_init not loaded", followUp: [], confidence: { level: "low" as const } };
      }
      const verdict = r as { ok: boolean; alreadyInit?: boolean; created: string[]; dtMs: number; skippedReason?: string; reason?: string };
      return {
        data: verdict,
        wisdom: verdict.ok
          ? (verdict.alreadyInit
              ? `✓ already initialized (${verdict.dtMs}ms)`
              : verdict.skippedReason
                ? `✓ skipped: ${verdict.skippedReason}`
                : `✓ initialized ${verdict.created.join(", ")} (${verdict.dtMs}ms)`)
          : `✗ init failed: ${verdict.reason ?? "?"}`,
        followUp: verdict.ok ? [] : ["mneme.system.bootstrap"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "bootstrap failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const cleanseHistoryTool: MnemeTool = {
  name: "mneme.system.cleanse_history",
  category: "meta",
  description:
    "RETROACTIVE CLEANSE — closes the audit caveat 'AI-fingerprint files committed BEFORE Mneme install stay in git history forever'. Three modes (DRY-RUN by default): scan (read-only, lists findings), uncommit (git rm --cached, safe — file stays on disk + history stays), filter-repo (destructive history rewrite, requires confirm:true). HMAC-signed receipt to .mneme/auto_init/cleanse-receipts.jsonl.",
  whenToUse: "User asks 'ลบ CLAUDE.md ออกจาก git', 'clean up AI tooling files from repo', 'why is CLAUDE.md still tracked'. Default scan; only escalate to uncommit/filter-repo after showing user the plan.",
  triggers: ["cleanse history", "remove ai files from git", "git filter ai tooling"],
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", description: "scan | uncommit | filter-repo. Default scan." },
      dryRun: { type: "boolean", description: "Don't mutate. Default true." },
      confirm: { type: "boolean", description: "Required true for filter-repo mode (destructive)." },
    },
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.system.bootstrap"],
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cleanseFn = (core as unknown as { cleanse?: (i: unknown) => unknown }).cleanse;
      if (typeof cleanseFn !== "function") {
        return { data: { ok: false, error: "cleanse not available" }, wisdom: "cleanse not loaded", followUp: [], confidence: { level: "low" as const } };
      }
      const input = {
        repoRoot: repoRootOf(rt),
        mode: String(args["mode"] ?? "scan") as "scan" | "uncommit" | "filter-repo",
        dryRun: args["dryRun"] === undefined ? true : Boolean(args["dryRun"]),
        confirm: Boolean(args["confirm"]),
      };
      const r = cleanseFn(input) as { ok: boolean; mode: string; dryRun: boolean; findings: Array<{ path: string }>; plan: string[]; actions: unknown[]; reason?: string; hmac?: string };
      return {
        data: r,
        wisdom: r.ok
          ? `${r.mode}${r.dryRun ? " [DRY-RUN]" : ""} — ${r.findings.length} finding(s); ${r.plan.length} planned, ${r.actions.length} executed`
          : `cleanse failed: ${r.reason}`,
        followUp: r.mode === "scan" && r.findings.length > 0 ? ["mneme.system.cleanse_history"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "cleanse failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const AUTO_INIT_TOOLS: MnemeTool[] = [
  autoInitBootstrapTool,
  cleanseHistoryTool,
];
