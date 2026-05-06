import { Command } from "commander";
import { getVersion } from "./version.js";
import { initCommand } from "./commands/init.js";
import { indexCommand } from "./commands/index-cmd.js";
import { askCommand } from "./commands/ask.js";
import { guardianCommand } from "./commands/guardian.js";
import {
  forensicsMatchCommand,
  forensicsAttributeCommand,
  forensicsVulnsCommand,
  forensicsAnomalyCommand,
} from "./commands/forensics.js";
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
import { conscienceCommand } from "./commands/conscience.js";
import { teachCommand } from "./commands/teach.js";
import { blastCommand } from "./commands/blast.js";
import { adaptCommand } from "./commands/adapt.js";
import { geniusCommand } from "./commands/genius.js";
import { feedbackCommand, calibrateCommand, watchCommand } from "./commands/wisdom-cli.js";
import {
  whoKnowsCommand,
  decisionsCommand,
  stackTraceCommand,
  storyCommand,
  dreamCommand,
  chatCommand,
  regretCommand,
  busFactorCommand,
  paradoxCommand,
  commitCoachCommand,
  crystalBallCommand,
  timeMachineCommand,
  premortemCommand,
  ghostCommand,
  dnaCommand,
  driftCommand,
  chronicleCommand,
  oracleCommand,
  constellationCommand,
  clusterCommand,
  networkCommand,
  manageCommand,
  exportBundleCommand,
} from "./commands/insights-cli.js";
import {
  drawdownCommand,
  alphaCommand,
  backtestCommand,
  blackSwanCommand,
  insiderTradingCommand,
  moneyballCommand,
  greekCommand,
  correlationMatrixCommand,
  impliedVolatilityCommand,
  taxLossHarvestCommand,
} from "./commands/quant-cli.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version(getVersion())
    .addHelpText(
      "after",
      "\n" +
        "Advanced commands (Phase 2/3/4 + WILD ideas) are hidden from this help.\n" +
        "Run `mneme advanced` to see them.\n",
    );

  program
    .command("init")
    .description("Initialize Mneme in the current repo (probes environment to recommend the best embedder)")
    .option("--force", "overwrite existing config", false)
    .option("--skip-probe", "skip environment probe (useful in scripts)", false)
    .action(async (opts: { force?: boolean; skipProbe?: boolean }) => {
      process.exit(await initCommand({ cwd: process.cwd(), force: opts.force, skipProbe: opts.skipProbe }));
    });

  program
    .command("index")
    .description("Index commits, PRs, and embeddings — or analyze the existing index")
    .option("--since <date>", "only index commits since this date (e.g. 2024-01-01)")
    .option("--max <n>", "maximum number of commits", (v) => Number(v))
    .option("--embedder <kind>", "auto | ollama | openai | hash", "auto")
    .option("--model <name>", "embedding model name override")
    .option("--no-redact", "disable built-in secret redaction (default: on)")
    .option("--aggressive-redact", "enable lower-confidence redaction patterns (password=, hex blobs)", false)
    .option("--no-llm", "deterministic mode — force hash embedder, never call Ollama/OpenAI")
    .option("--analyze", "skip indexing — print quality report on the existing index", false)
    .option("--json", "machine-readable output (only with --analyze)", false)
    .action(async (opts: { since?: string; max?: number; embedder?: "auto"|"ollama"|"openai"|"hash"; model?: string; redact?: boolean; aggressiveRedact?: boolean; llm?: boolean; analyze?: boolean; json?: boolean }) => {
      process.exit(
        await indexCommand({
          cwd: process.cwd(),
          since: opts.since,
          maxCount: opts.max,
          embedder: opts.embedder,
          model: opts.model,
          // commander turns --no-redact into opts.redact === false; we pass that as noRedact
          noRedact: opts.redact === false,
          aggressiveRedact: opts.aggressiveRedact,
          noLlm: opts.llm === false,
          analyze: opts.analyze,
          json: opts.json,
        }),
      );
    });

  program
    .command("ask <question...>")
    .description("Ask the memory: \"why does payment.ts use try/catch?\"")
    .option("-k, --top-k <n>", "number of results", (v) => Number(v), 8)
    .option("--json", "machine-readable JSON output", false)
    .option("--no-llm", "skip LLM synthesis — extractive answer only")
    .option("--debug", "show intent classification + raw scores", false)
    .option("--audit", "refuse to answer below confidence floor or with unverified citations", false)
    .option("--audit-floor <level>", "audit confidence floor: low | medium | high", "medium")
    .action(async (qParts: string[], opts: { topK: number; json: boolean; llm?: boolean; debug?: boolean; audit?: boolean; auditFloor?: "low" | "medium" | "high" }) => {
      process.exit(
        await askCommand({
          cwd: process.cwd(),
          question: qParts.join(" "),
          topK: opts.topK,
          json: opts.json,
          noLlm: opts.llm === false,
          debug: opts.debug,
          audit: opts.audit,
          auditFloor: opts.auditFloor,
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
    .command("doctor")
    .description("Probe the environment (Ollama, OpenAI, hardware) and recommend the best embedder")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { json?: boolean }) => {
      const { runFullProbe } = await import("./probe.js");
      const probe = await runFullProbe();
      if (opts.json) {
        process.stdout.write(JSON.stringify(probe, null, 2) + "\n");
        process.exit(0);
      }
      const kleur = (await import("kleur")).default;
      const stars = "★".repeat(probe.recommendation.qualityStars) + "☆".repeat(5 - probe.recommendation.qualityStars);
      ui.banner();
      process.stdout.write(`  ${kleur.bold().cyan("Environment probe")}\n`);
      process.stdout.write(`    ${kleur.gray("hardware ")}  ${probe.hardware.ramGB}GB RAM · ${probe.hardware.cpuCount} cpus · ${probe.hardware.platform}/${probe.hardware.arch} (${probe.hardware.tier})\n`);
      process.stdout.write(`    ${kleur.gray("ollama   ")}  ${probe.ollama.reachable ? kleur.green("reachable") : kleur.gray("not running")}${probe.ollama.hasEmbedModel ? kleur.green(" · embed model pulled") : probe.ollama.reachable ? kleur.yellow(" · embed model NOT pulled") : ""}\n`);
      process.stdout.write(`    ${kleur.gray("openai   ")}  ${probe.openai.hasKey ? kleur.green(`key set …${probe.openai.keyTail}`) : kleur.gray("no key")}\n`);
      process.stdout.write(`\n  ${kleur.bold().magenta("Recommendation")} ${kleur.bold(probe.recommendation.pick)} ${kleur.gray(stars)}\n`);
      process.stdout.write(`    ${probe.recommendation.reason}\n`);
      if (probe.recommendation.action) {
        process.stdout.write("\n");
        process.stdout.write(`    ${kleur.yellow().bold("👉 Run this in your terminal:")}\n`);
        process.stdout.write(`       ${kleur.cyan().bold("$")} ${kleur.bold().white(probe.recommendation.action)}\n`);
        process.stdout.write(`    ${kleur.gray("(takes ~1 min, then run `mneme index`)")}\n`);
      }
      process.stdout.write("\n");
      process.exit(0);
    });

  program
    .command("correlate", { hidden: true })
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
    .command("entities", { hidden: true })
    .description("Phase 2 — parse and embed every function/class/type in tracked TS/JS files")
    .action(async () => {
      process.exit(await entitiesCommand({ cwd: process.cwd() }));
    });

  program
    .command("clones", { hidden: true })
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
    .command("heal", { hidden: true })
    .description("Synthesize WHY notes for commits with poor messages (turns bad history into searchable memory)")
    .option("--max <n>", "max commits to heal in this run", (v) => Number(v), 100)
    .option("--subject-min-len <n>", "subjects shorter than this are candidates", (v) => Number(v), 20)
    .option("--dry-run", "list candidates without calling the LLM", false)
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override model name (e.g. llama3.2:1b, gpt-4o-mini)")
    .option("--force", "re-heal commits that already have a synthesized note", false)
    .option("--no-llm", "deterministic mode — refuse to run (heal needs an LLM)")
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
          noLlm: opts.llm === false,
        }),
      );
    });

  program
    .command("wisdom", { hidden: true })
    .description("Print a meditation from the Mneme manifesto (rotates daily)")
    .option("-n, --num <n>", "show a specific meditation by number (1..13)", (v) => Number(v))
    .option("--all", "print every meditation", false)
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { num?: number; all?: boolean; json?: boolean }) => {
      process.exit(await wisdomCommand({ index: opts.num, all: opts.all, json: opts.json }));
    });

  program
    .command("manifesto", { hidden: true })
    .description("Print the full Mneme manifesto — every meditation, in order")
    .option("--json", "machine-readable JSON output", false)
    .action(async (opts: { json?: boolean }) => {
      process.exit(await manifestoCommand(opts));
    });

  // ─── WILD ideas — see WILD_IDEAS.md ───

  program
    .command("echo", { hidden: true })
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
    .command("palimpsest <target>", { hidden: true })
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
    .command("runaway", { hidden: true })
    .description("WILD #14 — files that have grown silently across many commits")
    .option("--top <n>", "show top-N", (v) => Number(v), 15)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await runawayCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json }),
      );
    });

  program
    .command("mirror", { hidden: true })
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
    .command("rumor", { hidden: true })
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
    .command("fossil", { hidden: true })
    .description("WILD #10 — files deleted from HEAD but still alive in git history")
    .option("--top <n>", "show top-N", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await fossilCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json }),
      );
    });

  program
    .command("ledger", { hidden: true })
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

  program
    .command("conscience [files...]", { hidden: true })
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
    .command("blast <commit>", { hidden: true })
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
    .command("adapt", { hidden: true })
    .description("Mutant mode — inspect this repo and recommend the next 1-3 commands")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(await adaptCommand({ cwd: process.cwd(), json: opts.json }));
    });

  // ─── Wisdom Mutant Engine (Phase 4) ───
  program
    .command("feedback <id-or-prefix> <vote>", { hidden: true })
    .description("Wisdom Mutant — record feedback on a previous `mneme ask` (vote: up | down)")
    .action(async (idOrPrefix: string, vote: string) => {
      if (vote !== "up" && vote !== "down") {
        ui.error("vote must be 'up' or 'down'");
        process.exit(1);
      }
      process.exit(await feedbackCommand({ cwd: process.cwd(), idOrPrefix, vote }));
    });

  program
    .command("calibrate", { hidden: true })
    .description("Wisdom Mutant — re-tune search knobs against accumulated feedback")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(await calibrateCommand({ cwd: process.cwd(), json: opts.json }));
    });

  program
    .command("watch")
    .description("Wisdom Mutant — 24/7 daemon: re-index on commit, calibrate hourly, self-eval daily")
    .option("--calibrate-ms <n>", "override calibrate interval", (v) => Number(v))
    .option("--self-eval-ms <n>", "override self-eval interval", (v) => Number(v))
    .option("--quiet", "only print errors", false)
    .action(async (opts: any) => {
      process.exit(
        await watchCommand({
          cwd: process.cwd(),
          calibrateMs: opts.calibrateMs,
          selfEvalMs: opts.selfEvalMs,
          quiet: opts.quiet,
        }),
      );
    });

  program
    .command("genius <question...>", { hidden: true })
    .description("AI agent — plans and runs multi-step Mneme workflows to answer hard questions")
    .option("--max-steps <n>", "cap on tool steps in the plan", (v) => Number(v), 4)
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override LLM model name")
    .option("--trace", "print raw tool outputs while running", false)
    .option("--json", "machine-readable output", false)
    .option("--no-llm", "deterministic mode — refuse and suggest a non-LLM alternative")
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
          noLlm: opts.llm === false,
        }),
      );
    });

  program
    .command("teach <target>", { hidden: true })
    .description("Explain a folder or file in plain language (layer classification + LLM summary)")
    .option("--provider <kind>", "auto | ollama | openai", "auto")
    .option("--model <name>", "override model name")
    .option("--json", "machine-readable output", false)
    .option("--no-llm", "deterministic mode — print classification only, skip the LLM summary")
    .action(async (target: string, opts: any) => {
      process.exit(
        await teachCommand({
          cwd: process.cwd(),
          target,
          provider: opts.provider,
          model: opts.model,
          json: opts.json,
          noLlm: opts.llm === false,
        }),
      );
    });

  // ─── Insights (Sprint 2 — killer commands) ───
  program
    .command("who-knows <topic...>", { hidden: true })
    .description("Surface the people most likely to know about a topic (commit history)")
    .option("-n, --top <n>", "top-N candidates", (v) => Number(v), 5)
    .option("--json", "machine-readable output", false)
    .action(async (topicParts: string[], opts: any) => {
      process.exit(
        await whoKnowsCommand({
          cwd: process.cwd(),
          topic: topicParts.join(" "),
          topN: opts.top,
          json: opts.json,
        }),
      );
    });

  program
    .command("decisions", { hidden: true })
    .description("Auto-extract architectural decisions (ADRs) from commit history")
    .option("--format <kind>", "table | markdown | json | obsidian", "table")
    .option("--out <path>", "write to file (markdown/json) or vault folder (obsidian)")
    .option("--since <iso>", "only commits since this date")
    .option("--min-confidence <n>", "drop matches below this confidence", (v) => Number(v), 0.6)
    .action(async (opts: any) => {
      process.exit(
        await decisionsCommand({
          cwd: process.cwd(),
          format: opts.format,
          out: opts.out,
          since: opts.since,
          minConfidence: opts.minConfidence,
        }),
      );
    });

  program
    .command("stack-trace", { hidden: true })
    .description("Parse an error / stack trace and find historical context for each frame")
    .option("--from <file>", "read trace from file (otherwise stdin)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await stackTraceCommand({
          cwd: process.cwd(),
          fromFile: opts.from,
          json: opts.json,
        }),
      );
    });

  program
    .command("story <topic...>", { hidden: true })
    .description("Narrate the evolution of a topic across acts (with optional LLM polish)")
    .option("--json", "machine-readable output", false)
    .option("--no-llm", "skip LLM act narration", false)
    .option("--obsidian-out <path>", "write the story to an Obsidian vault folder")
    .action(async (topicParts: string[], opts: any) => {
      process.exit(
        await storyCommand({
          cwd: process.cwd(),
          topic: topicParts.join(" "),
          json: opts.json,
          noLlm: opts.llm === false,
          obsidianOut: opts.obsidianOut,
        }),
      );
    });

  program
    .command("dream", { hidden: true })
    .description("Speculative ideas grounded in your codebase patterns")
    .option("-n, --count <n>", "how many ideas to generate", (v) => Number(v), 5)
    .option("--json", "machine-readable output", false)
    .option("--no-llm", "use deterministic heuristic ideas instead of LLM")
    .action(async (opts: any) => {
      process.exit(
        await dreamCommand({
          cwd: process.cwd(),
          count: opts.count,
          json: opts.json,
          noLlm: opts.llm === false,
        }),
      );
    });

  program
    .command("chat", { hidden: true })
    .description("Multi-turn conversational REPL over your repo's history")
    .option("--no-llm", "skip LLM synthesis (extractive answers only)")
    .action(async (opts: any) => {
      process.exit(await chatCommand({ cwd: process.cwd(), noLlm: opts.llm === false }));
    });

  // ─── Sprint 4 killer commands ────────────────────────────────────────
  program
    .command("regret", { hidden: true })
    .description("Surface commits that were shipped and immediately fixed/reverted")
    .option("--window-days <n>", "follow-up window", (v) => Number(v), 7)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await regretCommand({
          cwd: process.cwd(),
          windowDays: opts.windowDays,
          json: opts.json,
        }),
      );
    });

  program
    .command("bus-factor", { hidden: true })
    .description("Identify single-source-of-truth knowledge holders + pairing recommendations")
    .option("-n, --top <n>", "top-N risky files", (v) => Number(v), 20)
    .option("--min-touches <n>", "ignore files with fewer touches", (v) => Number(v), 3)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await busFactorCommand({
          cwd: process.cwd(),
          topN: opts.top,
          minTouches: opts.minTouches,
          json: opts.json,
        }),
      );
    });

  program
    .command("paradox", { hidden: true })
    .description("Detect architectural flip-flops (decisions reversed over time)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(await paradoxCommand({ cwd: process.cwd(), json: opts.json }));
    });

  program
    .command("commit-coach", { hidden: true })
    .description("Pre-commit AI partner — message, reviewers, scope, past warnings")
    .option("--from <file>", "read diff from file (default: git diff --staged)")
    .option("--stdin", "read diff from stdin", false)
    .option("--json", "machine-readable output", false)
    .option("--no-llm", "skip LLM polish on the suggested message")
    .action(async (opts: any) => {
      process.exit(
        await commitCoachCommand({
          cwd: process.cwd(),
          diffFile: opts.from,
          fromStdin: opts.stdin,
          json: opts.json,
          noLlm: opts.llm === false,
        }),
      );
    });

  program
    .command("crystal-ball", { hidden: true })
    .description("Predict CI / follow-up failure probability before you push")
    .option("--from <file>", "read diff from file (default: git diff --staged)")
    .option("--stdin", "read diff from stdin", false)
    .option("--window-days <n>", "follow-up window for past failures", (v) => Number(v), 14)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await crystalBallCommand({
          cwd: process.cwd(),
          diffFile: opts.from,
          fromStdin: opts.stdin,
          windowDays: opts.windowDays,
          json: opts.json,
        }),
      );
    });

  // ─── v0.11.0: Time Machine, Pre-mortem, Ghost ────────────────────────
  program
    .command("time-machine <file>")
    .description("Narrate a file's evolution as eras (birth, rewrite, firefight, plateau)")
    .option("--plateau-days <n>", "minimum gap to mark a plateau", (v) => Number(v), 60)
    .option("--json", "machine-readable output", false)
    .action(async (filePath: string, opts: any) => {
      process.exit(
        await timeMachineCommand({
          cwd: process.cwd(),
          filePath,
          plateauDays: opts.plateauDays,
          json: opts.json,
        }),
      );
    });

  program
    .command("premortem <intent...>")
    .description("Predict regret risk for a proposed change, grounded in your repo's failure history")
    .option("--similarity <n>", "min similarity score 0..1", (v) => Number(v), 0.25)
    .option("--window-days <n>", "follow-up window for regret detection", (v) => Number(v), 14)
    .option("--json", "machine-readable output", false)
    .action(async (intentParts: string[], opts: any) => {
      const intent = intentParts.join(" ");
      process.exit(
        await premortemCommand({
          cwd: process.cwd(),
          intent,
          similarityFloor: opts.similarity,
          windowDays: opts.windowDays,
          json: opts.json,
        }),
      );
    });

  program
    .command("ghost")
    .description("Surface ghost code — half-finished features, stale TODOs, files born and forgotten")
    .option("--top <n>", "show N most haunted files", (v) => Number(v), 10)
    .option("--stale-days <n>", "stale threshold in days", (v) => Number(v), 180)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await ghostCommand({
          cwd: process.cwd(),
          topN: opts.top,
          staleDays: opts.staleDays,
          json: opts.json,
        }),
      ),
    );

  // ─── v0.12.0: King of Git ─ DNA / Drift / Chronicle / Oracle / Constellation
  program
    .command("dna [author]")
    .description("Extract Codebase DNA — a portable fingerprint of a contributor's style, hours, and file affinity")
    .option("--compare <author>", "compare DNA against another author")
    .option("-o, --output <file>", "write DNA strand to JSON file")
    .option("--json", "machine-readable output", false)
    .action(async (author: string | undefined, opts: any) => {
      process.exit(
        await dnaCommand({
          cwd: process.cwd(),
          author,
          compare: opts.compare,
          output: opts.output,
          json: opts.json,
        }),
      );
    });

  program
    .command("drift")
    .description("Visualize topical drift — features → refactors → firefights → polish over time")
    .option("--granularity <quarter|month>", "bucket size", "quarter")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await driftCommand({
          cwd: process.cwd(),
          granularity: opts.granularity,
          json: opts.json,
        }),
      ),
    );

  program
    .command("chronicle")
    .description("Auto-generate a chaptered narrative documentary of your codebase")
    .option("-o, --output <file>", "write Markdown chronicle to file (e.g. CHRONICLE.md)")
    .option("--gap-days <n>", "minimum gap to start a new chapter", (v) => Number(v), 30)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await chronicleCommand({
          cwd: process.cwd(),
          output: opts.output,
          gapDays: opts.gapDays,
          json: opts.json,
        }),
      ),
    );

  program
    .command("oracle")
    .description("Predict next-window co-edits and surface likely author collisions on the same file")
    .option("--window-days <n>", "lookback window in days", (v) => Number(v), 90)
    .option("--top <n>", "show N predictions/collisions", (v) => Number(v), 8)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await oracleCommand({
          cwd: process.cwd(),
          windowDays: opts.windowDays,
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  program
    .command("constellation")
    .description("Build a graph view of the repo — files as stars, authors as orbitals, commits as edges")
    .option("-o, --output <file>", "write graph JSON to file")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await constellationCommand({
          cwd: process.cwd(),
          output: opts.output,
          json: opts.json,
        }),
      ),
    );

  // ─── v0.17.0: Forensics — applied forensic science for code ──────────
  const forensicsCmd = program
    .command("forensics")
    .description("Applied forensic science for code: STR-loci attribution, vulnerability hunt, anomaly detection");

  forensicsCmd
    .command("match <commit> <author>")
    .description("STR-loci likelihood-ratio match: did this author write this commit?")
    .option("--json", "structured output", false)
    .action(async (commit: string, author: string, opts: any) =>
      process.exit(
        await forensicsMatchCommand({
          cwd: process.cwd(),
          commitHash: commit,
          authorEmail: author,
          json: opts.json,
        }),
      ),
    );

  forensicsCmd
    .command("attribute <commit>")
    .description("Anonymous attribution: rank candidate authors by likelihood ratio")
    .option("--top <n>", "show N candidates", (v) => Number(v), 5)
    .option("--json", "structured output", false)
    .action(async (commit: string, opts: any) =>
      process.exit(
        await forensicsAttributeCommand({
          cwd: process.cwd(),
          commitHash: commit,
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  forensicsCmd
    .command("vulns")
    .description("Hunt vulnerability patterns across commit history (CWE-aligned)")
    .option("--since <date>", "only scan commits since this date")
    .option("--top <n>", "scan up to N commits", (v) => Number(v), 500)
    .option("--json", "structured output", false)
    .action(async (opts: any) =>
      process.exit(
        await forensicsVulnsCommand({
          cwd: process.cwd(),
          since: opts.since,
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  forensicsCmd
    .command("anomaly")
    .description("Detect insider-threat / compromised-credential commits via per-author baselines")
    .option("--threshold <n>", "deviation threshold to surface (0..4)", (v) => Number(v), 0.9)
    .option("--top <n>", "show N findings", (v) => Number(v), 10)
    .option("--json", "structured output", false)
    .action(async (opts: any) =>
      process.exit(
        await forensicsAnomalyCommand({
          cwd: process.cwd(),
          threshold: opts.threshold,
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  // ─── v0.16.0: Guardian — 24/7 self-healing daemon ────────────────────
  program
    .command("guardian")
    .description("24/7 self-healing engine — diagnose weaknesses + auto-fix safe actions")
    .option("--watch", "run forever, polling every --interval seconds", false)
    .option("--once", "run a single pass and exit (default if --watch is absent)", false)
    .option("--interval <seconds>", "poll interval in seconds (--watch only)", (v) => Number(v), 300)
    .option("--apply", "actually apply auto-policy actions (otherwise observe-only)", false)
    .option("--max-iterations <n>", "stop after N ticks (testing / cron-style)", (v) => Number(v))
    .option("--json", "structured JSON output", false)
    .action(async (opts: any) =>
      process.exit(
        await guardianCommand({
          cwd: process.cwd(),
          watch: opts.watch,
          intervalSeconds: opts.interval,
          apply: opts.apply,
          json: opts.json,
          maxIterations: opts.maxIterations,
        }),
      ),
    );

  // ─── v0.13.0: Black Sheep — cluster / network / manage / export ──────
  program
    .command("cluster")
    .description("Semantic clustering of commit messages — find topic islands across history")
    .option("--similarity <n>", "join threshold 0..1", (v) => Number(v), 0.15)
    .option("--min-size <n>", "minimum cluster size", (v) => Number(v), 3)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await clusterCommand({
          cwd: process.cwd(),
          similarity: opts.similarity,
          minSize: opts.minSize,
          json: opts.json,
        }),
      ),
    );

  program
    .command("network")
    .description("Author network — semantic collaboration graph with co-edit + co-time + co-topic edges")
    .option("--window-days <n>", "co-time window", (v) => Number(v), 7)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await networkCommand({
          cwd: process.cwd(),
          windowDays: opts.windowDays,
          json: opts.json,
        }),
      ),
    );

  program
    .command("manage")
    .description("Engineering management dashboard — health, succession, skill matrix, trajectory")
    .option("--window-days <n>", "rolling window in days", (v) => Number(v), 90)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await manageCommand({
          cwd: process.cwd(),
          windowDays: opts.windowDays,
          json: opts.json,
        }),
      ),
    );

  program
    .command("export-bundle")
    .alias("bundle")
    .description("Export the universal bundle — DNA + drift + chronicle + oracle + constellation + clusters + network + manage + ghost")
    .option("-o, --output <file>", "output filename base (no extension)", "mneme-bundle")
    .option("--format <json|markdown|both>", "output format", "both")
    .option("--top-authors <n>", "DNA strands to include", (v) => Number(v), 5)
    .action(async (opts: any) =>
      process.exit(
        await exportBundleCommand({
          cwd: process.cwd(),
          output: opts.output,
          format: opts.format,
          topAuthors: opts.topAuthors,
        }),
      ),
    );

  // ─── Sprint 5: Wall Street meets Git ─────────────────────────────────
  program
    .command("drawdown", { hidden: true })
    .description("Worst losing streaks — periods of pure firefighting")
    .option("--min-length <n>", "minimum streak length", (v) => Number(v), 3)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await drawdownCommand({ cwd: process.cwd(), minLength: opts.minLength, json: opts.json })),
    );

  program
    .command("alpha", { hidden: true })
    .description("Kelly-criterion allocation across technical-debt items")
    .option("--items <file>", "JSON file: array of { id, name, edge, variance, effortDays }")
    .option("--budget-days <n>", "sprint budget in dev-days", (v) => Number(v), 25)
    .option("--multiplier <n>", "fractional Kelly multiplier (0..1)", (v) => Number(v), 0.25)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await alphaCommand({
          cwd: process.cwd(),
          itemsFile: opts.items,
          budgetDays: opts.budgetDays,
          multiplier: opts.multiplier,
          json: opts.json,
        }),
      ),
    );

  program
    .command("backtest", { hidden: true })
    .description("Validate any binary predictor against historical outcomes")
    .option("--samples <file>", "JSON file: array of { id, predicted, actual }")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await backtestCommand({ cwd: process.cwd(), samplesFile: opts.samples, json: opts.json })),
    );

  program
    .command("black-swan", { hidden: true })
    .description("Rare-but-catastrophic file patterns (tail risk)")
    .option("-n, --top <n>", "top-N candidates", (v) => Number(v), 10)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await blackSwanCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json })),
    );

  program
    .command("insider-trading", { hidden: true })
    .description("Authors who repeatedly fix bugs they introduced themselves")
    .option("--window-days <n>", "max days from ship to fix", (v) => Number(v), 14)
    .option("--min-patterns <n>", "minimum patterns to flag", (v) => Number(v), 2)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await insiderTradingCommand({
          cwd: process.cwd(),
          windowDays: opts.windowDays,
          minPatterns: opts.minPatterns,
          json: opts.json,
        }),
      ),
    );

  program
    .command("moneyball", { hidden: true })
    .description("Undervalued contributors — high impact, low LOC volume")
    .option("-n, --top <n>", "top-N", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await moneyballCommand({ cwd: process.cwd(), topN: opts.top, json: opts.json })),
    );

  program
    .command("greek", { hidden: true })
    .description("Codebase Greeks (Δ Γ Θ) — sensitivity analysis")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await greekCommand({ cwd: process.cwd(), json: opts.json })),
    );

  program
    .command("correlation-matrix", { hidden: true })
    .description("Hidden behavioral coupling between files (no static deps needed)")
    .option("-n, --top <n>", "top-N pairs", (v) => Number(v), 20)
    .option("--min-lift <n>", "minimum lift over random", (v) => Number(v), 1.5)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await correlationMatrixCommand({ cwd: process.cwd(), topN: opts.top, minLift: opts.minLift, json: opts.json }),
      ),
    );

  program
    .command("implied-volatility", { hidden: true })
    .description("Project chaos predicted from commit message tone")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(await impliedVolatilityCommand({ cwd: process.cwd(), json: opts.json })),
    );

  program
    .command("tax-loss-harvest", { hidden: true })
    .description("Dead-code candidates — delete to offset technical debt")
    .option("--min-stale-days <n>", "minimum days since last touch", (v) => Number(v), 180)
    .option("-n, --top <n>", "top-N candidates", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) =>
      process.exit(
        await taxLossHarvestCommand({
          cwd: process.cwd(),
          minStaleDays: opts.minStaleDays,
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  program
    .command("advanced")
    .description("Show advanced commands grouped by phase (hidden from main --help)")
    .action(() => {
      process.stdout.write(renderAdvancedHelp());
      process.exit(0);
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

function renderAdvancedHelp(): string {
  return [
    "",
    "  μνήμη  ·  Mneme — advanced commands",
    "  ─────────────────────────────────────────────────────────────",
    "",
    "  Phase 2 — semantic similarity",
    "    entities                  parse + embed every TS/JS/Python/Go symbol",
    "    clones [--threshold]      surface near-duplicate functions",
    "",
    "  Phase 3 — incident correlation",
    "    correlate --source ...    join commits with incidents (pager / manual)",
    "    blast <commit>            predict incidents likely to follow a commit",
    "    palimpsest <file>:<line>  walk the causal chain of a single line",
    "    conscience [files...]     risk-score a PR against history",
    "",
    "  Wisdom Mutant Engine (Phase 4)",
    "    feedback <id> up|down     record explicit feedback on a query",
    "    calibrate                 re-tune search knobs against feedback set",
    "",
    "  Insights — the killer commands",
    "    who-knows <topic>         verdict on who knows X (% confidence + backup + risk)",
    "    decisions                 auto-extract ADRs from commit messages",
    "    stack-trace [--from F]    paste an error, get historical context per frame",
    "    story <topic>             narrate the evolution of <topic> across acts",
    "    dream                     speculative ideas grounded in your patterns",
    "    chat                      multi-turn REPL over your repo's history",
    "",
    "  Innovations (Sprint 4) — wisdom + world-class + uniqueness",
    "    regret                    commits shipped + immediately fixed/reverted (regret rate)",
    "    bus-factor                files where one author owns ≥75% — fragility map",
    "    paradox                   architectural flip-flops (A → B → A patterns)",
    "    commit-coach [--stdin]    pre-commit review: message + reviewers + warnings",
    "    crystal-ball [--stdin]    predict CI/follow-up failure probability for staged diff",
    "",
    "  Quant (Sprint 5) — Wall Street meets Git",
    "    drawdown                  worst losing streaks (firefighting periods)",
    "    alpha --items F           Kelly-criterion allocation for technical debt",
    "    backtest --samples F      validate any predictor against history",
    "    black-swan                rare-but-catastrophic file patterns",
    "    insider-trading           authors who fix bugs they introduced",
    "    moneyball                 undervalued contributors (high ROI, low LOC)",
    "    greek                     codebase Greeks (Δ Γ Θ) sensitivity",
    "    correlation-matrix        hidden behavioral coupling between files",
    "    implied-volatility        chaos predicted from commit message tone",
    "    tax-loss-harvest          dead-code deletion candidates",
    "",
    "  WILD — opinionated extras",
    "    heal [--dry-run]          synthesize WHY notes for poor commit messages",
    "    echo [--id|--query]       find past incidents resembling current",
    "    runaway                   files growing silently across many commits",
    "    mirror                    onboarding dossier (5 PRs, 3 people, 2 incidents)",
    "    rumor                     tribal phrases mentioned but never documented",
    "    fossil                    files deleted from HEAD but alive in history",
    "    ledger --since ...        tamper-evident audit log (SOX/SOC2)",
    "    adapt                     mutant detector — recommend next 1-3 commands",
    "    teach <target>            explain a folder/file in plain language",
    "    genius <question>         multi-step LLM agent over Mneme commands",
    "",
    "  Brand",
    "    wisdom [-n <1..13>]       a meditation from the Mneme manifesto",
    "    manifesto                 the full canon",
    "",
    "  Each command has its own --help with options and examples.",
    "  Full design notes: WILD_IDEAS.md, ROADMAP.md.",
    "",
  ].join("\n");
}
