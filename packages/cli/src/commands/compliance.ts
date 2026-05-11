/**
 * `mneme compliance` (v1.41.0) — read-side surface for the AI Compliance
 * pre-executor's audit log. Three subcommands:
 *
 *   show   — table of mandate × outcome counts + inline compliance rate
 *   log    — tail recent .mneme/ai-compliance.jsonl entries
 *   stats  — JSON summary for cron / CI pipelines
 *
 * Phase 3 of the architectural fix ladder. The scoreboard makes the
 * historical compliance trend visible, which is what eventually lets
 * users (and AI vendors) see whether AI agents are obeying mandates or
 * the pulse pre-executor is covering for them.
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }

function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  } else {
    for (const line of humanLines) process.stdout.write(line + "\n");
  }
}

function pad(s: string, w: number): string { return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length); }

export function registerComplianceCommand(program: Command): void {
  const cmp = program
    .command("compliance")
    .description("AI Compliance audit — who executed which AUTO-ACTION mandate (pulse pre-executor / daemon-queue / ai-agent).");

  cmp
    .command("show")
    .description("Render a one-screen table of mandate × outcome counts.")
    .option("--limit <n>", "How many recent log entries to consider", (v) => parseInt(v, 10), 500)
    .option("--json", "JSON output")
    .action(async (opts: { limit: number } & CommonOpts) => {
      const { aiCompliance } = await import("@mneme-ai/core");
      const entries = aiCompliance.readComplianceLog(process.cwd(), opts.limit);
      const stats = aiCompliance.computeComplianceStats(entries);

      if (entries.length === 0) {
        out(opts, { entries: 0 }, [
          "AI Compliance — no entries yet.",
          "",
          "  The compliance log is written by the pulse pre-executor (.mneme/ai-compliance.jsonl)",
          "  the first time a mandate fires. Trigger one by running:",
          "    mneme nucleus pulse --no-quiet  (when an [AUTO-ACTION] is pending)",
          "",
          "  Then re-run `mneme compliance show`.",
        ]);
        return;
      }

      const lines: string[] = [];
      lines.push("AI Compliance — last " + entries.length + " mandate attempt(s)");
      lines.push("");
      lines.push("  Inline compliance rate: " + (stats.inlineComplianceRate * 100).toFixed(1) + "%   (executed / [executed + skipped + failed])");
      lines.push("");
      lines.push("  By outcome:");
      for (const [k, v] of Object.entries(stats.byOutcome).sort((a, b) => b[1] - a[1])) {
        lines.push("    " + pad(k, 10) + " " + v);
      }
      lines.push("");
      lines.push("  By executor:");
      for (const [k, v] of Object.entries(stats.byExecutor).sort((a, b) => b[1] - a[1])) {
        lines.push("    " + pad(k, 22) + " " + v);
      }
      lines.push("");
      lines.push("  By mandate:");
      lines.push("  " + pad("mandate", 40) + pad("total", 8) + pad("exec", 6) + pad("queue", 7) + pad("skip", 6) + "fail");
      lines.push("  " + "-".repeat(40 + 8 + 6 + 7 + 6 + 6));
      const ranked = Object.entries(stats.byMandate).sort((a, b) => b[1].total - a[1].total);
      for (const [m, v] of ranked) {
        lines.push("  " + pad(m, 40) + pad(String(v.total), 8) + pad(String(v.executed), 6) + pad(String(v.queued), 7) + pad(String(v.skipped), 6) + String(v.failed));
      }
      lines.push("");
      lines.push("  Tip: --json for machine-readable output | mneme compliance log for raw entries");
      out(opts, stats, lines);
    });

  cmp
    .command("log")
    .description("Print the last N raw entries from .mneme/ai-compliance.jsonl.")
    .option("-n <n>", "How many recent entries to show", (v) => parseInt(v, 10), 20)
    .option("--json", "JSON output")
    .action(async (opts: { n: number } & CommonOpts) => {
      const { aiCompliance } = await import("@mneme-ai/core");
      const entries = aiCompliance.readComplianceLog(process.cwd(), opts.n);
      if (opts.json) { process.stdout.write(JSON.stringify(entries, null, 2) + "\n"); return; }
      if (entries.length === 0) { process.stdout.write("AI Compliance log is empty.\n"); return; }
      for (const e of entries) {
        process.stdout.write(`[${e.ts}] ${pad(e.outcome, 10)} ${pad(e.executor, 22)} ${e.mandate}` + (e.durationMs != null ? ` (${e.durationMs}ms)` : "") + (e.error ? ` ERR=${e.error}` : "") + "\n");
      }
    });

  cmp
    .command("stats")
    .description("JSON-only stats summary for cron / CI.")
    .option("--limit <n>", "How many recent log entries to consider", (v) => parseInt(v, 10), 500)
    .action(async (opts: { limit: number }) => {
      const { aiCompliance } = await import("@mneme-ai/core");
      const entries = aiCompliance.readComplianceLog(process.cwd(), opts.limit);
      const stats = aiCompliance.computeComplianceStats(entries);
      process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    });
}
