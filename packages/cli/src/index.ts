import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { indexCommand } from "./commands/index-cmd.js";
import { askCommand } from "./commands/ask.js";
import { whyCommand } from "./commands/why.js";
import { statusCommand } from "./commands/status.js";
import { correlateCommand } from "./commands/correlate.js";
import { mcpCommand } from "./commands/mcp.js";
import { wisdomCommand, manifestoCommand } from "./commands/wisdom.js";
import { entitiesCommand, clonesCommand } from "./commands/clones.js";
import { healCommand } from "./commands/heal.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version("0.4.0");

  program
    .command("init")
    .description("Initialize Mneme in the current repo")
    .option("--force", "overwrite existing config", false)
    .action(async (opts: { force?: boolean }) => {
      process.exit(await initCommand({ cwd: process.cwd(), force: opts.force }));
    });

  program
    .command("index")
    .description("Index commits, PRs, and embeddings")
    .option("--since <date>", "only index commits since this date (e.g. 2024-01-01)")
    .option("--max <n>", "maximum number of commits", (v) => Number(v))
    .option("--embedder <kind>", "auto | ollama | openai | hash", "auto")
    .option("--model <name>", "embedding model name override")
    .action(async (opts: { since?: string; max?: number; embedder?: "auto"|"ollama"|"openai"|"hash"; model?: string }) => {
      process.exit(
        await indexCommand({
          cwd: process.cwd(),
          since: opts.since,
          maxCount: opts.max,
          embedder: opts.embedder,
          model: opts.model,
        }),
      );
    });

  program
    .command("ask <question...>")
    .description("Ask the memory: \"why does payment.ts use try/catch?\"")
    .option("-k, --top-k <n>", "number of results", (v) => Number(v), 8)
    .option("--json", "machine-readable JSON output", false)
    .action(async (qParts: string[], opts: { topK: number; json: boolean }) => {
      process.exit(
        await askCommand({
          cwd: process.cwd(),
          question: qParts.join(" "),
          topK: opts.topK,
          json: opts.json,
        }),
      );
    });

  program
    .command("why <target>")
    .description("Why does this exist? Pass file:line, file:start-end, or just file")
    .option("-k, --top-k <n>", "related commits to fetch", (v) => Number(v), 5)
    .action(async (target: string, opts: { topK: number }) => {
      process.exit(await whyCommand({ cwd: process.cwd(), target, topK: opts.topK }));
    });

  program
    .command("status")
    .description("Show memory + repo status")
    .action(async () => {
      process.exit(await statusCommand({ cwd: process.cwd() }));
    });

  program
    .command("correlate")
    .description("Correlate incidents with commits (Sentry / manual JSON)")
    .option("--source <kind>", "incident source: sentry | manual")
    .option("--org <slug>", "Sentry org slug (with --source sentry)")
    .option("--project <slug>", "Sentry project slug (with --source sentry)")
    .option("--base-url <url>", "Sentry base URL for self-hosted")
    .option("--file <path>", "JSON file path (with --source manual)")
    .option("--since <iso>", "only incidents/commits since this date")
    .option("--until <iso>", "only incidents/commits until this date")
    .option("--window-days <n>", "correlation window in days", (v) => Number(v), 7)
    .option("--threshold <n>", "minimum confidence (0..1)", (v) => Number(v), 0.3)
    .option("--top <n>", "top-N rows", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await correlateCommand({
          cwd: process.cwd(),
          source: opts.source,
          org: opts.org,
          project: opts.project,
          baseUrl: opts.baseUrl,
          file: opts.file,
          since: opts.since,
          until: opts.until,
          windowDays: opts.windowDays,
          threshold: opts.threshold,
          topN: opts.top,
          json: opts.json,
        }),
      );
    });

  program
    .command("mcp")
    .description("Run as an MCP server (for Claude Code, Cursor, Continue, etc.)")
    .action(async () => {
      process.exit(await mcpCommand({ cwd: process.cwd() }));
    });

  program
    .command("entities")
    .description("Phase 2 — parse and embed every function/class/type in tracked TS/JS files")
    .action(async () => {
      process.exit(await entitiesCommand({ cwd: process.cwd() }));
    });

  program
    .command("clones")
    .description("Phase 2 — find semantic clones (functions doing the same thing)")
    .option("-t, --threshold <n>", "cosine threshold (0..1), default 0.85", (v) => Number(v))
    .option("-N, --top <n>", "show top-N clusters, default 20", (v) => Number(v), 20)
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { threshold?: number; top?: number; json?: boolean }) => {
      process.exit(
        await clonesCommand({
          cwd: process.cwd(),
          threshold: opts.threshold,
          topN: opts.top,
          json: opts.json,
        }),
      );
    });

  program
    .command("heal")
    .description("Synthesize WHY notes for commits with poor messages (turns bad history into searchable memory)")
    .option("--max <n>", "max commits to heal in this run", (v) => Number(v), 100)
    .option("--subject-min-len <n>", "subjects shorter than this are candidates", (v) => Number(v), 20)
    .option("--dry-run", "list candidates without calling the LLM", false)
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override model name (e.g. llama3.2:1b, gpt-4o-mini)")
    .option("--force", "re-heal commits that already have a synthesized note", false)
    .action(async (opts: any) => {
      process.exit(
        await healCommand({
          cwd: process.cwd(),
          max: opts.max,
          subjectMinLen: opts.subjectMinLen,
          dryRun: opts.dryRun,
          provider: opts.provider,
          model: opts.model,
          force: opts.force,
        }),
      );
    });

  program
    .command("wisdom")
    .description("Print a meditation from the Mneme manifesto (rotates daily)")
    .option("-n, --num <n>", "show a specific meditation by number (1..13)", (v) => Number(v))
    .option("--all", "print every meditation", false)
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { num?: number; all?: boolean; json?: boolean }) => {
      process.exit(await wisdomCommand({ index: opts.num, all: opts.all, json: opts.json }));
    });

  program
    .command("manifesto")
    .description("Print the full Mneme manifesto — every meditation, in order")
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { json?: boolean }) => {
      process.exit(await manifestoCommand(opts));
    });

  program.exitOverride((err) => {
    if (err.code === "commander.help" || err.code === "commander.helpDisplayed") process.exit(0);
    if (err.code === "commander.version") process.exit(0);
    process.exit(err.exitCode ?? 1);
  });

  try {
    await program.parseAsync(argv);
  } catch (err) {
    ui.error((err as Error).message);
    process.exit(1);
  }
}
