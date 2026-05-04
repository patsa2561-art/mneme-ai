import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { indexCommand } from "./commands/index-cmd.js";
import { askCommand } from "./commands/ask.js";
import { whyCommand } from "./commands/why.js";
import { statusCommand } from "./commands/status.js";
import { correlateCommand } from "./commands/correlate.js";
import { mcpCommand } from "./commands/mcp.js";
import { wisdomCommand, manifestoCommand } from "./commands/wisdom.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version("0.1.0");

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
    .description("Correlate incidents with commits (phase 3)")
    .action(async () => {
      process.exit(await correlateCommand());
    });

  program
    .command("mcp")
    .description("Run as an MCP server (for Claude Code, Cursor, Continue, etc.)")
    .action(async () => {
      process.exit(await mcpCommand({ cwd: process.cwd() }));
    });

  program
    .command("wisdom")
    .description("Print a meditation from the Mneme manifesto (rotates daily)")
    .option("-n, --index <n>", "show a specific meditation by number", (v) => Number(v))
    .option("--all", "print every meditation", false)
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { index?: number; all?: boolean; json?: boolean }) => {
      process.exit(await wisdomCommand(opts));
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
