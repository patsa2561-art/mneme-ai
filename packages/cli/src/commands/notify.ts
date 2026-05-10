/**
 * `mneme notify` -- multi-channel outbound CLI.
 *
 *   mneme notify status                        list channels + availability
 *   mneme notify send <title> [--severity X]   broadcast to every available channel
 *   mneme notify test                          fire a test notice on every channel
 */

import type { Command } from "commander";
import { notifier } from "@mneme-ai/core";
import { randomUUID } from "node:crypto";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

export function registerNotifyCommands(program: Command): void {
  const n = program
    .command("notify")
    .description("Multi-channel outbound notifications (OS toast, TTS, mobile push, email, agent files).");

  n.command("status")
    .description("List notifier channels + availability + minSeverity.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const all = notifier.buildAllNotifiers(process.cwd());
      const statuses = await notifier.notifierStatuses(all);
      if (opts.json) { writeJson(statuses); return; }
      writeText(`Channel                         minSev      available`);
      for (const s of statuses) {
        writeText(`  ${s.id.padEnd(28)} ${s.minSeverity.padEnd(10)}  ${s.available ? "yes" : "no"}`);
      }
    });

  n.command("send <title>")
    .description("Send a notice to every AVAILABLE channel.")
    .option("--body <text>", "Body text.", "(no body)")
    .option("--severity <s>", "info | action | warning | critical", "info")
    .option("--to <ids>", "Comma-separated subset of channel ids (e.g., os-toast,tts-voice).")
    .option("--json", "JSON output.")
    .action(async (title: string, opts: { body?: string; severity?: string; to?: string } & CommonOpts) => {
      const sev = (opts.severity === "action" || opts.severity === "warning" || opts.severity === "critical")
        ? opts.severity : "info";
      const all = notifier.buildAllNotifiers(process.cwd());
      const filtered = opts.to
        ? all.filter((x) => opts.to!.split(",").includes(x.id))
        : all;
      const notice = {
        id: randomUUID(), severity: sev as "info" | "action" | "warning" | "critical",
        title, body: opts.body ?? "(no body)",
      };
      const results = await notifier.notifyAll(notice, filtered);
      if (opts.json) { writeJson(results); return; }
      writeText(`Notice "${title}" (${sev}) sent to ${results.length} channel(s):`);
      for (const r of results) {
        writeText(`  ${r.notifierId.padEnd(28)} ${r.ok ? "OK" : "FAIL"}  ${r.ms}ms  ${r.detail ?? r.error ?? ""}`);
      }
    });

  n.command("test")
    .description("Fire a test notice on every available channel + show results.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const all = notifier.buildAllNotifiers(process.cwd());
      const notice = {
        id: randomUUID(), severity: "info" as const,
        title: "Mneme test",
        body: "If you see this, your notifier channel is working.",
      };
      const results = await notifier.notifyAll(notice, all);
      if (opts.json) { writeJson(results); return; }
      writeText(`Tested ${results.length} channel(s):`);
      for (const r of results) {
        writeText(`  ${r.notifierId.padEnd(28)} ${r.ok ? "OK" : "FAIL"}  ${r.ms}ms  ${r.detail ?? r.error ?? ""}`);
      }
    });
}
