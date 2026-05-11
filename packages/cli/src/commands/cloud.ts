/**
 * `mneme cloud` (v1.42.4) — read-side surface for the smart cloud
 * connectivity layer. Subcommands:
 *
 *   status                    one-line summary (offline / online / queued)
 *   probe                     force a fresh /healthz probe (bypass cache)
 *   queue [list|drain|count]  inspect or sync the pending event queue
 *
 * The user never types these directly — the AI agent calls them when
 * the user describes an outcome ("show me cloud status", "force a
 * cloud sync", etc.). Per `feedback_ai_does_everything.md`.
 */

import type { Command } from "commander";

const DEFAULT_BRAIN_URL = "https://brain.mneme.dev";

interface CommonOpts { json?: boolean; baseUrl?: string }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

export function registerCloudCommand(program: Command): void {
  const cloud = program
    .command("cloud")
    .description("Smart Cloud Connectivity — probe / queue / drain. Local-first; cloud is OPTIONAL relay (vaccine CDN, federated PRECOG, compliance scoreboard).");

  cloud
    .command("status")
    .description("One-line summary: cached state + queued events. Cheap (no network).")
    .option("--base-url <url>", "Cloud brain base URL (default https://brain.mneme.dev or MNEME_CLOUD env var)")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { CloudConnectivity } = await import("@mneme-ai/core");
      const baseUrl = opts.baseUrl ?? process.env["MNEME_CLOUD"] ?? DEFAULT_BRAIN_URL;
      const c = new CloudConnectivity({ baseUrl, repoRoot: process.cwd() });
      const state = c.readState();
      const queue = c.readQueue();
      out(opts, { baseUrl, state, queueDepth: queue.length }, [
        `cloud:    ${baseUrl}`,
        `${c.explain(state)}`,
      ]);
    });

  cloud
    .command("probe")
    .description("Force a fresh /healthz probe (bypasses 60s cache). Updates .mneme/cloud-state.json.")
    .option("--base-url <url>", "Cloud brain base URL")
    .option("--timeout <ms>", "Probe timeout in ms (default 4000)", (v) => parseInt(v, 10), 4000)
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts & { timeout: number }) => {
      const { CloudConnectivity } = await import("@mneme-ai/core");
      const baseUrl = opts.baseUrl ?? process.env["MNEME_CLOUD"] ?? DEFAULT_BRAIN_URL;
      const c = new CloudConnectivity({ baseUrl, repoRoot: process.cwd(), probeTimeoutMs: opts.timeout });
      const state = await c.probe();
      out(opts, state, [`cloud:    ${baseUrl}`, c.explain(state)]);
    });

  const q = cloud.command("queue").description("Manage the pending upload queue (.mneme/cloud-queue.jsonl).");
  q
    .command("list")
    .description("Print every pending event with its retry count.")
    .option("--base-url <url>", "Cloud brain base URL")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { CloudConnectivity } = await import("@mneme-ai/core");
      const baseUrl = opts.baseUrl ?? process.env["MNEME_CLOUD"] ?? DEFAULT_BRAIN_URL;
      const c = new CloudConnectivity({ baseUrl, repoRoot: process.cwd() });
      const events = c.readQueue();
      if (opts.json) { process.stdout.write(JSON.stringify(events, null, 2) + "\n"); return; }
      if (events.length === 0) { process.stdout.write("(queue is empty)\n"); return; }
      for (const e of events) process.stdout.write(`  ${e.id}  ${e.path}  attempts=${e.attempts}  ts=${e.ts}\n`);
    });
  q
    .command("count")
    .description("Just print the integer count.")
    .option("--base-url <url>", "Cloud brain base URL")
    .action(async (opts: { baseUrl?: string }) => {
      const { CloudConnectivity } = await import("@mneme-ai/core");
      const baseUrl = opts.baseUrl ?? process.env["MNEME_CLOUD"] ?? DEFAULT_BRAIN_URL;
      const c = new CloudConnectivity({ baseUrl, repoRoot: process.cwd() });
      process.stdout.write(c.readQueue().length + "\n");
    });
  q
    .command("drain")
    .description("Probe cloud + upload as many queued events as possible. Failed events stay queued for next drain.")
    .option("--base-url <url>", "Cloud brain base URL")
    .option("--max <n>", "Max events to send in one drain", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts & { max: number }) => {
      const { CloudConnectivity } = await import("@mneme-ai/core");
      const baseUrl = opts.baseUrl ?? process.env["MNEME_CLOUD"] ?? DEFAULT_BRAIN_URL;
      const c = new CloudConnectivity({ baseUrl, repoRoot: process.cwd() });
      const r = await c.drainQueue({ maxBatch: opts.max });
      out(opts, r, [`drain:   attempted=${r.attempted}  succeeded=${r.succeeded}  remaining=${r.remaining}`]);
    });
}
