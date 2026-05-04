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
import { echoCommand } from "./commands/echo.js";
import { palimpsestCommand } from "./commands/palimpsest.js";
import {
  runawayCommand,
  mirrorCommand,
  rumorCommand,
  fossilCommand,
  ledgerCommand,
} from "./commands/wild-features.js";
import {
  oracleCommand,
  genomeCommand,
  dialogueCommand,
  tributeCommand,
} from "./commands/wild-stubs.js";
import { conscienceCommand } from "./commands/conscience.js";
import { teachCommand } from "./commands/teach.js";
import { blastCommand } from "./commands/blast.js";
import { adaptCommand } from "./commands/adapt.js";
import { geniusCommand } from "./commands/genius.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version("0.8.4");

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
    .description("Correlate incidents with commits (pager / manual JSON)")
    .option("--source <kind>", "incident source: pager | manual")
    .option("--org <slug>", "org slug (with --source pager)")
    .option("--project <slug>", "project slug (with --source pager)")
    .option("--base-url <url>", "base URL for self-hosted observability")
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

  // ─── WILD ideas — see WILD_IDEAS.md ───

  program
    .command("echo")
    .description("WILD #2 — find past incidents that resemble the current one")
    .option("--id <id>", "stored incident id (e.g. \"sentry:12345\")")
    .option("--query <text>", "freeform incident description")
    .option("--top <n>", "top-N most similar", (v) => Number(v), 5)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await echoCommand({
          cwd: process.cwd(),
          id: opts.id,
          query: opts.query,
          topK: opts.top,
          json: opts.json,
        }),
      );
    });

  program
    .command("palimpsest <target>")
    .description("WILD #5 — render the causal chain of a single line of code")
    .option("--max-depth <n>", "how deep to walk the chain", (v) => Number(v), 8)
    .option("--json", "machine-readable output", false)
    .action(async (target: string, opts: any) => {
      process.exit(
        await palimpsestCommand({
          cwd: process.cwd(),
          target,
          maxDepth: opts.maxDepth,
          json: opts.json,
        }),
      );
    });

  program
    .command("runaway")
    .description("WILD #14 — files that have grown silently across many commits")
    .option("--top <n>", "show top-N", (v) => Number(v), 15)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await runawayCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json }),
      );
    });

  program
    .command("mirror")
    .description("WILD #13 — onboarding dossier (5 PRs, 3 people, 2 incidents)")
    .option("--top-prs <n>", "top PRs", (v) => Number(v), 5)
    .option("--top-people <n>", "top contributors", (v) => Number(v), 3)
    .option("--top-incidents <n>", "top incidents", (v) => Number(v), 2)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await mirrorCommand({
          cwd: process.cwd(),
          topPrs: opts.topPrs,
          topPeople: opts.topPeople,
          topIncidents: opts.topIncidents,
          json: opts.json,
        }),
      );
    });

  program
    .command("rumor")
    .description("WILD #12 — tribal phrases mentioned in commits but no doc explains")
    .option("--min-mentions <n>", "phrase must appear in this many commits", (v) => Number(v), 4)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await rumorCommand({
          cwd: process.cwd(),
          minMentions: opts.minMentions,
          json: opts.json,
        }),
      );
    });

  program
    .command("fossil")
    .description("WILD #10 — files deleted from HEAD but still alive in git history")
    .option("--top <n>", "show top-N", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await fossilCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json }),
      );
    });

  program
    .command("ledger")
    .description("WILD #3 — tamper-evident audit log for compliance (SOX/SOC2)")
    .option("--since <iso>", "start date")
    .option("--until <iso>", "end date")
    .option("--format <kind>", "json | csv", "json")
    .option("--out <path>", "write to file instead of stdout")
    .action(async (opts: any) => {
      process.exit(
        await ledgerCommand({
          cwd: process.cwd(),
          since: opts.since,
          until: opts.until,
          format: opts.format,
          out: opts.out,
        }),
      );
    });

  // ─── Stubs (planned features — print design when invoked) ───

  program
    .command("oracle")
    .description("WILD #4 — historical risk analysis on a snippet (planned)")
    .action(async () => {
      process.exit(await oracleCommand());
    });

  program
    .command("conscience [files...]")
    .description("WILD #6 — review co-pilot: risk-score a PR against your repo's own history")
    .option("--diff-file <path>", "read a unified diff from this file")
    .option("--stdin", "read a unified diff from stdin", false)
    .option("--recency-days <n>", "consider commits within this window", (v) => Number(v), 365)
    .option("--top <n>", "top-N similar past commits", (v) => Number(v), 8)
    .option("--json", "machine-readable output", false)
    .action(async (files: string[], opts: any) => {
      process.exit(
        await conscienceCommand({
          cwd: process.cwd(),
          files,
          diffFile: opts.diffFile,
          stdin: opts.stdin,
          recencyDays: opts.recencyDays,
          topN: opts.top,
          json: opts.json,
        }),
      );
    });

  program
    .command("blast <commit>")
    .description("Predict incidents likely to follow shipping <commit> (blast radius)")
    .option("--window-hours <n>", "post-deploy window for base rate", (v) => Number(v), 48)
    .option("--json", "machine-readable output", false)
    .action(async (commit: string, opts: any) => {
      process.exit(
        await blastCommand({
          cwd: process.cwd(),
          commit,
          windowHours: opts.windowHours,
          json: opts.json,
        }),
      );
    });

  program
    .command("adapt")
    .description("Mutant mode — inspect this repo and recommend the next 1-3 commands")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(await adaptCommand({ cwd: process.cwd(), json: opts.json }));
    });

  program
    .command("genius <question...>")
    .description("AI agent — plans and runs multi-step Mneme workflows to answer hard questions")
    .option("--max-steps <n>", "cap on tool steps in the plan", (v) => Number(v), 4)
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override LLM model name")
    .option("--trace", "print raw tool outputs while running", false)
    .option("--json", "machine-readable output", false)
    .action(async (qParts: string[], opts: any) => {
      process.exit(
        await geniusCommand({
          cwd: process.cwd(),
          question: qParts.join(" "),
          maxSteps: opts.maxSteps,
          provider: opts.provider,
          model: opts.model,
          trace: opts.trace,
          json: opts.json,
        }),
      );
    });

  program
    .command("teach <target>")
    .description("Explain a folder or file in plain language (layer classification + LLM summary)")
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override model name")
    .option("--json", "machine-readable output", false)
    .action(async (target: string, opts: any) => {
      process.exit(
        await teachCommand({
          cwd: process.cwd(),
          target,
          provider: opts.provider,
          model: opts.model,
          json: opts.json,
        }),
      );
    });

  program
    .command("genome")
    .description("WILD #9 — codebase fingerprint + ancestry (planned)")
    .action(async () => {
      process.exit(await genomeCommand());
    });

  program
    .command("dialogue")
    .description("WILD #11 — conversational chat over your repo (planned)")
    .action(async () => {
      process.exit(await dialogueCommand());
    });

  program
    .command("tribute")
    .description("WILD #15 — your codebase as a 60-sec movie (planned)")
    .action(async () => {
      process.exit(await tributeCommand());
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
