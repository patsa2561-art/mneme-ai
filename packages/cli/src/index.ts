import { Command } from "commander";
import { getVersion } from "./version.js";
import { parseIntStrict, parseFloatStrict, parseSinceDate } from "./utils/args.js";
import { initCommand } from "./commands/init.js";
import { doCommand } from "./commands/do.js";
import { guardCommand } from "./commands/guard.js";
import { setupFreeCommand } from "./commands/setup-free.js";
import { completionCommand } from "./commands/completion.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { htcBuildCommand, htcStatsCommand } from "./commands/htc.js";
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
import { dashboardCommand } from "./commands/dashboard.js";
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
import { adversarialCommand } from "./commands/adversarial.js";
import { auditCommand } from "./commands/audit.js";
import { botCommand } from "./commands/bot.js";
import { atrophyCommand } from "./commands/atrophy.js";
import { counterfactualCommand } from "./commands/counterfactual.js";
import { orgCommand, type OrgSubcommand } from "./commands/org.js";
import { telepathyCommand } from "./commands/telepathy.js";
import { influenceCommand } from "./commands/influence.js";
import { lineageCommand } from "./commands/lineage.js";
import { nemesisCommand } from "./commands/nemesis.js";
import { nervousSystemCommand } from "./commands/nervous-system.js";
import { passportCommand } from "./commands/passport.js";
import { promiseCommand } from "./commands/promise.js";
import { karmaCommand } from "./commands/karma.js";
import { repoMriCommand } from "./commands/repo-mri.js";
import { cognitiveTwinCommand } from "./commands/cognitive-twin.js";
import { suppressCommand } from "./commands/suppress.js";
import { showFindingCommand } from "./commands/show-finding.js";
import { depsAuditCommand } from "./commands/deps-audit.js";
import { groupsCommand } from "./commands/groups.js";
import { periodicTableCommand } from "./commands/periodic-table.js";
import { composeCommand } from "./commands/compose.js";
import { libraryCommand } from "./commands/library.js";
import { runCommand } from "./commands/run.js";
import { heartbeatCommand, rewindCommand, dnaFoldCommand } from "./commands/holy.js";
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
import { registerWelcomeCommand, registerSporeCommands, registerLinCommands, registerNucleusCommands, registerInboxCommands } from "./commands/mnemeiosis.js";
import { registerAntivirusCommands } from "./commands/antivirus.js";
import { registerRetrievalCommands } from "./commands/retrieval.js";
import { registerHooksCommands } from "./commands/hooks.js";
import { registerToolsCommand, registerBotCommand, registerHealthCommand, registerDemoCommand } from "./commands/demo.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version(getVersion())
    .option("--compliance <profile>", "Cryptographic compliance profile (none | fips140). Refuses to start if profile not satisfied.", "none")
    .hook("preAction", async (thisCommand) => {
      const opts = thisCommand.opts() as { compliance?: string };
      const profile = (opts.compliance ?? "none") as "none" | "fips140";
      if (profile !== "none" && profile !== "fips140") {
        ui.error(`Unknown --compliance profile "${profile}". Use: none | fips140`);
        process.exit(1);
      }
      const { security } = await import("@mneme-ai/core");
      const check = security.compliance.enforceCompliance(profile);
      if (!check.ok) {
        ui.error(check.reason ?? "Compliance check failed.");
        process.exit(1);
      }
    })
    .addHelpText(
      "after",
      "\n" +
        "Advanced commands (Phase 2/3/4 + WILD ideas) are hidden from this help.\n" +
        "Run `mneme advanced` to see them.\n",
    );

  // ─── adversarial — meta-evaluate AI clients against repo memory ───
  program
    .command("adversarial")
    .description("Meta-evaluate any AI client — Mneme generates probes mixing real history with subtle + wholesale lies; you paste them into your AI; we compute a trust grade based on which contradictions the AI catches.")
    .option("--probes <n>", "number of probes (rounded down to a multiple of 3)", (v) => Number(v), 12)
    .option("--out <path>", "output markdown path (default .mneme/adversarial-probes.md)")
    .option("--grade <file>", "JSON responses file — switches to grading mode")
    .option("--seed <s>", "deterministic seed", "default")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { probes?: number; out?: string; grade?: string; seed?: string; json?: boolean }) => {
      process.exit(
        await adversarialCommand({
          cwd: process.cwd(),
          probes: opts.probes,
          out: opts.out,
          grade: opts.grade,
          seed: opts.seed,
          json: opts.json,
        }),
      );
    });

  // ─── v0.27.0: AI Session Audit — every AI-driven commit gets a trust certificate ───
  program
    .command("audit")
    .description("AI Session Audit — every AI-driven commit gets a trust certificate (vendor-neutral; works with any AI tool whose commits end up in `git log`)")
    .option("--baseline", "snapshot current behavior + types + perf", false)
    .option("--trace", "diff capture + AI session detection", false)
    .option("--verify", "Leviathan-style narrative vs diff check", false)
    .option("--verify-head", "claim-drift detector — flag commits whose 'remove X' claim isn't actually true in HEAD", false)
    .option("--certify", "5-axis trust certificate (CI-friendly exit code)", false)
    .option("--watch", "long-running CI gate mode", false)
    .option("--report", "produce markdown report", false)
    .option("--out <file>", "output path for --report")
    .option("--interval <seconds>", "poll interval for --watch", (v) => Number(v), 60)
    .option("--max-commits <n>", "cap commits scanned in --verify-head", (v) => Number(v), 200)
    .option("--json", "machine-readable output", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .option("--explain", "prepend a plain-English narrative summary on --certify (uses your free LLM)", false)
    .option("--strict", "treat skipped axes (insufficient data) as fail — for compliance environments", false)
    .action(async (opts: {
      baseline?: boolean; trace?: boolean; verify?: boolean; verifyHead?: boolean; certify?: boolean;
      watch?: boolean; report?: boolean; out?: string; interval?: number; maxCommits?: number;
      json?: boolean; quiet?: boolean; explain?: boolean; strict?: boolean;
    }) => {
      const mode: "baseline" | "trace" | "verify" | "verify-head" | "certify" | "watch" | "report" =
        opts.baseline ? "baseline" :
        opts.trace ? "trace" :
        opts.verify ? "verify" :
        opts.verifyHead ? "verify-head" :
        opts.certify ? "certify" :
        opts.watch ? "watch" :
        opts.report ? "report" :
        "certify"; // default
      process.exit(
        await auditCommand({
          cwd: process.cwd(),
          mode,
          json: opts.json,
          out: opts.out,
          interval: opts.interval,
          maxCommits: opts.maxCommits,
          explain: opts.explain,
          strict: opts.strict,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── bot — auto-comment on PRs / MRs across CI platforms ─────────────
  program
    .command("bot")
    .description("Auto-comment Mneme audit + atrophy + ghost results on PRs / MRs (GitHub · GitLab · Bitbucket — auto-detects CI environment).")
    .option("--pr <number>", "override PR / MR number (auto-detected from CI env by default)", (v) => Number(v))
    .option("--platform <name>", "github | gitlab | bitbucket (auto-detect default)")
    .option("--include <list>", "comma-separated analyzers: audit,atrophy,ghost,promise", "audit,atrophy")
    .option("--dry-run", "print the rendered comment without posting", false)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { pr?: number; platform?: string; include?: string; dryRun?: boolean; json?: boolean }) => {
      const platform = opts.platform as "github" | "gitlab" | "bitbucket" | undefined;
      if (platform && platform !== "github" && platform !== "gitlab" && platform !== "bitbucket") {
        ui.error("--platform must be one of: github | gitlab | bitbucket");
        process.exit(1);
      }
      process.exit(
        await botCommand({
          cwd: process.cwd(),
          pr: opts.pr,
          platform,
          include: opts.include,
          dryRun: opts.dryRun,
          json: opts.json,
        }),
      );
    });

  // ─── atrophy — knowledge half-life clock ────────────────────────────
  program
    .command("atrophy [author]")
    .description("Knowledge half-life clock — Ebbinghaus forgetting curve over (author × file) pairs. Shows who still remembers what, and where ghost-code risk is concentrated. Pass an author email to drill in, --file <path> for a per-file view.")
    .option("--file <path>", "show every author who ever knew this file (with current freshness)")
    .option("--half-life <days>", "decay half-life in days (default 180 ≈ 6 months)", (v) => Number(v), 180)
    .option("--top <n>", "rows per section", (v) => Number(v), 10)
    .option("--json", "machine-readable output", false)
    .option("--explain", "prepend a plain-English narrative summary (uses your free LLM)", false)
    .action(async (
      author: string | undefined,
      opts: { file?: string; halfLife?: number; top?: number; json?: boolean; explain?: boolean },
    ) => {
      process.exit(
        await atrophyCommand({
          cwd: process.cwd(),
          author,
          file: opts.file,
          halfLifeDays: opts.halfLife,
          topN: opts.top,
          json: opts.json,
          explain: opts.explain,
        }),
      );
    });

  // ─── telepathy — latent collaboration network ────────────────────────
  program
    .command("telepathy")
    .description("Latent collaboration network — pairs of authors who never co-author a commit but whose changes rhyme (Alice edits one part of a topic; Bob edits the other within hours; pattern repeats). Surfaces invisible teams that GitHub can't see.")
    .option("--window <hours>", "time window for rhyming commits (default 48h)", (v) => Number(v), 48)
    .option("--top <n>", "show top-N pairs", (v) => Number(v), 10)
    .option("--author <email>", "filter to pairs containing this author")
    .option("--min-events <n>", "drop pairs with fewer rhymes than this (default 3)", (v) => Number(v), 3)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { window?: number; top?: number; author?: string; minEvents?: number; json?: boolean }) => {
      process.exit(
        await telepathyCommand({
          cwd: process.cwd(),
          windowHours: opts.window,
          topN: opts.top,
          authorEmail: opts.author,
          minEvents: opts.minEvents,
          json: opts.json,
        }),
      );
    });

  // ─── influence — code-pattern PageRank (cultural alphas) ────────────
  program
    .command("influence")
    .description("Cultural-alpha ranking — who writes the patterns everyone else copies (volume-independent: a 5-commit pattern-setter outranks a 500-commit copy-paster; analyzes TypeScript / JavaScript / Python / Go)")
    .option("--top <n>", "rows to show", (v) => Number(v), 10)
    .option("--pattern-min-uses <n>", "only count patterns adopted at least this many times", (v) => Number(v), 3)
    .option("--author <email>", "deep-dive on a single author's originated patterns + adopters")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { top?: number; patternMinUses?: number; author?: string; json?: boolean }) => {
      process.exit(
        await influenceCommand({
          cwd: process.cwd(),
          topN: opts.top,
          patternMinUses: opts.patternMinUses,
          authorEmail: opts.author,
          json: opts.json,
        }),
      );
    });

  // ─── lineage — semantic ownership of code over time ─────────────────
  program
    .command("lineage <target>")
    .description("Semantic ownership of code over time — whose interpretation of whose intent currently lives in this code (NOT git blame; use for review assignment + onboarding, NOT performance reviews). Pass a file path or file:funcName.")
    .option("--depth <n>", "max commits to walk (most-recent-first slice)", (v) => Number(v), 20)
    .option("--json", "machine-readable output", false)
    .action(async (target: string, opts: { depth?: number; json?: boolean }) => {
      process.exit(
        await lineageCommand({
          cwd: process.cwd(),
          target,
          depth: opts.depth,
          json: opts.json,
        }),
      );
    });

  // ─── nemesis — engineering friction detector ────────────────────────
  program
    .command("nemesis")
    .description("Engineering friction detector — pairs of authors who consistently revert/rewrite each other's work (use for team formation, NOT performance reviews)")
    .option("--top <n>", "show top-N friction pairs", (v) => Number(v), 5)
    .option("--window <days>", "consider only events within N days", (v) => Number(v), 365)
    .option("--author <email>", "filter pairs containing this author")
    .option("--json", "machine-readable output", false)
    .option("--verbose", "expand the details tier", false)
    .action(async (opts: { top?: number; window?: number; author?: string; json?: boolean; verbose?: boolean }) => {
      process.exit(
        await nemesisCommand({
          cwd: process.cwd(),
          topN: opts.top,
          windowDays: opts.window,
          authorFilter: opts.author,
          json: opts.json,
          verbose: opts.verbose,
        }),
      );
    });

  // ─── nervous-system — repo-level neural map ─────────────────────────
  program
    .command("nervous-system")
    .description("Mneme Nervous System — combined people-analytics report (cultural alphas + latent teams + atrophy heatmap + brain lobes + mini-passports). Terminal-renderable; --html / --pdf for the printable dossier.")
    .option("--html <path>", "write a self-contained HTML report")
    .option("--pdf <path>", "write a PDF report (requires puppeteer-core)")
    .option("--top-people <n>", "number of contributors to feature", (v) => Number(v), 5)
    .option("--top-files <n>", "number of critical files to analyze", (v) => Number(v), 30)
    .option("--json", "machine-readable output", false)
    .option("--explain", "prepend a plain-English narrative summary (uses your free LLM)", false)
    .action(async (opts: { html?: string; pdf?: string; topPeople?: number; topFiles?: number; json?: boolean; explain?: boolean }) => {
      process.exit(
        await nervousSystemCommand({
          cwd: process.cwd(),
          html: opts.html,
          pdf: opts.pdf,
          topPeople: opts.topPeople,
          topFiles: opts.topFiles,
          json: opts.json,
          explain: opts.explain,
        }),
      );
    });

  // ─── passport — per-engineer dossier ────────────────────────────────
  program
    .command("passport [author]")
    .description("Engineer passport — DNA + expertise + telepathic teammates + influence + atrophy in one dossier. Pass an author email or omit to auto-pick the top contributor.")
    .option("--html <path>", "write a self-contained HTML dossier")
    .option("--pdf <path>", "write a PDF dossier (requires puppeteer-core)")
    .option("--include-friction", "include nemesis/friction section (default off)", false)
    .option("--top-files <n>", "files to include in expertise map", (v) => Number(v), 12)
    .option("--json", "machine-readable output", false)
    .action(async (
      author: string | undefined,
      opts: { html?: string; pdf?: string; includeFriction?: boolean; topFiles?: number; json?: boolean },
    ) => {
      process.exit(
        await passportCommand({
          cwd: process.cwd(),
          author,
          html: opts.html,
          pdf: opts.pdf,
          includeFriction: opts.includeFriction,
          topFiles: opts.topFiles,
          json: opts.json,
        }),
      );
    });

  // ─── promise — promise-debt tracker ─────────────────────────────────
  program
    .command("promise")
    .description("Promise-debt tracker — every \"I'll fix later\" / TODO / follow-up parsed into a ledger and verified against history (heuristic; treat as a starting list)")
    .option("--author <email>", "limit to one author")
    .option("--status <state>", "filter: open | kept | stale")
    .option("--top <n>", "rows to show", (v) => Number(v), 10)
    .option("--json", "machine-readable output", false)
    .option("--verbose", "expand the details tier", false)
    .action(async (opts: { author?: string; status?: string; top?: number; json?: boolean; verbose?: boolean }) => {
      const status = opts.status as "open" | "kept" | "stale" | undefined;
      if (status && status !== "open" && status !== "kept" && status !== "stale") {
        ui.error("--status must be one of: open | kept | stale");
        process.exit(1);
      }
      process.exit(
        await promiseCommand({
          cwd: process.cwd(),
          authorFilter: opts.author,
          status,
          topN: opts.top,
          json: opts.json,
          verbose: opts.verbose,
        }),
      );
    });

  // ─── karma — TODO/FIXME debt ledger (compounds with age) ────────────
  program
    .command("karma")
    .description("TODO/FIXME debt ledger — every TODO added is a debit, every one removed is a credit. Open balance compounds with age.")
    .option("--top <n>", "rows in the leaderboard", (v) => Number(v), 10)
    .option("--author <email>", "drill into one engineer's open debt")
    .option("--path <prefix>", "restrict scan to a path prefix (e.g. packages/core/)")
    .option("--max-commits <n>", "scan only the most-recent N commits (0 = unlimited)", (v) => Number(v), 0)
    .option("--since <date>", "only consider commits since (e.g. '1 year ago' or 2024-01-01)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { top?: number; author?: string; path?: string; maxCommits?: number; since?: string; json?: boolean }) => {
      process.exit(
        await karmaCommand({
          cwd: process.cwd(),
          topN: opts.top,
          authorEmail: opts.author,
          pathPrefix: opts.path,
          maxCommits: opts.maxCommits,
          since: opts.since,
          json: opts.json,
        }),
      );
    });

  // ─── cognitive-twin — stylometric author voice fingerprint ──────────
  program
    .command("cognitive-twin <email>")
    .alias("twin")
    .description("Author-voice fingerprint — stylometric profile of how a contributor writes commits. Optional --rewrite '<subject>' rewrites in their voice. (Heuristic, no LLM.)")
    .option("--max-commits <n>", "scan only the most-recent N commits (0 = unlimited)", (v) => Number(v), 0)
    .option("--rewrite <subject>", "rewrite a generic commit subject in this author's voice")
    .option("--json", "machine-readable output", false)
    .action(async (email: string, opts: { maxCommits?: number; rewrite?: string; json?: boolean }) => {
      process.exit(
        await cognitiveTwinCommand({
          cwd: process.cwd(),
          email,
          maxCommits: opts.maxCommits,
          rewrite: opts.rewrite,
          json: opts.json,
        }),
      );
    });

  // ─── v0.43 Holy Grails ────────────────────────────────────────────
  program
    .command("heartbeat")
    .description("Codebase pulse — 20-axis MRI snapshot vs rolling 7-day baseline; flag any axis ≥ 2σ. Cron daily for continuous health observation. (v0.43 Holy Grail #1.)")
    .option("--json", "machine-readable for Slack / email / dashboards", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (opts: any) => {
      process.exit(
        await heartbeatCommand({
          cwd: process.cwd(),
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  program
    .command("rewind <ref>")
    .description("Time-travel debug — reconstruct the working context of a single commit (surrounding commits, time-of-day, voice deviation, sandwich-mode markers). ✱ inferences are speculative. (v0.43 Holy Grail #2.)")
    .option("--window <n>", "context window size each side (default 5)", (v) => Number(v), 5)
    .option("--json", "machine-readable", false)
    .option("--quiet", "no banner", false)
    .action(async (ref: string, opts: any) => {
      process.exit(
        await rewindCommand({
          cwd: process.cwd(),
          ref,
          windowSize: opts.window,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  program
    .command("dna-fold")
    .description("Fold individual author DNAs into a team-DNA. Surfaces consensus / polarised / outliered features across the team. (v0.43 Holy Grail #3.)")
    .option("--email <emails...>", "explicit email list (defaults to top contributors by commit count)")
    .option("--top <n>", "if no --email given, use top-N contributors (default 8)", (v) => Number(v), 8)
    .option("--json", "machine-readable", false)
    .option("--quiet", "no banner", false)
    .action(async (opts: any) => {
      process.exit(
        await dnaFoldCommand({
          cwd: process.cwd(),
          emails: opts.email,
          topN: opts.top,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── library — manage the per-repo molecule library ──────────────
  program
    .command("library")
    .alias("lib")
    .description("Manage the per-repo molecule library (.mneme/library.json) — the v0.42 Second-Brain. List entries, promote frequent plans to named aliases, annotate, prune.")
    .option("--promote <id>", "promote an entry to a named alias")
    .option("--alias <name>", "explicit alias for --promote (auto-derived from intent otherwise)")
    .option("--eligible", "show entries that meet promotion criteria", false)
    .option("--archived", "show entries unused for 30+ days", false)
    .option("--annotate <id>", "add a free-form note to an entry (use with --note)")
    .option("--note <text>", "free-form note for --annotate")
    .option("--forget <id>", "remove an entry from the library")
    .option("--json", "machine-readable output", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (opts: any) => {
      process.exit(
        await libraryCommand({
          cwd: process.cwd(),
          promote: opts.promote,
          alias: opts.alias,
          eligible: opts.eligible,
          archived: opts.archived,
          annotate: opts.annotate,
          note: opts.note,
          forget: opts.forget,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── run — execute a stored library molecule ─────────────────────
  program
    .command("run <alias-or-id>")
    .description("Execute a molecule plan from the library by alias or 16-char id. Default --dry-run; pass --execute to actually run. Use --forbid-* flags for sandboxed runs.")
    .option("--execute", "actually run the plan (default is dry-run)", false)
    .option("--forbid-network", "fail-loud if a step has network side effect", false)
    .option("--forbid-filesystem", "fail-loud if a step writes to disk", false)
    .option("--forbid-git", "fail-loud if a step spawns git", false)
    .option("--forbid-subprocess", "fail-loud if a step spawns any subprocess", false)
    .option("--json", "machine-readable output", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (needle: string, opts: any) => {
      process.exit(
        await runCommand({
          cwd: process.cwd(),
          needle,
          execute: opts.execute,
          forbidNetwork: opts.forbidNetwork,
          forbidFilesystem: opts.forbidFilesystem,
          forbidGit: opts.forbidGit,
          forbidSubprocess: opts.forbidSubprocess,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── compose — natural-language → molecule plan ───────────────────
  program
    .command("compose <intent...>")
    .description("Compile a natural-language intent into a runnable pipeline of registered atoms / molecules. v0.41 plans, v0.42 also feeds the library. See Wiki: Compose-And-Compiler.")
    .option("--max-steps <n>", "cap on plan length (default 6)", (v) => Number(v), 6)
    .option("--llm", "ask the configured LLM to refine the rule-based seed plan", false)
    .option("--no-cache", "ignore the molecule cache for this run", false)
    .option("--json", "machine-readable plan output (for AI / MCP)", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (parts: string[], opts: any) => {
      process.exit(
        await composeCommand({
          cwd: process.cwd(),
          intent: parts.join(" "),
          maxSteps: opts.maxSteps,
          useLlm: opts.llm,
          noCache: opts.cache === false,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── periodic-table — Element / Atom / Molecule catalog ───────────
  program
    .command("periodic-table [id]")
    .alias("table")
    .description("Browse Mneme's Element/Atom/Molecule catalog. Pass an id (e.g. `mneme periodic-table git.log`) for full detail. v0.40 MVP — see Wiki: Periodic-Table.")
    .option("--kind <kind>", "filter: element | atom | molecule | compound")
    .option("--tag <tag>", "filter by tag (e.g. security, history, vector)")
    .option("--json", "machine-readable output (for AI / MCP)", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (id: string | undefined, opts: any) => {
      process.exit(
        await periodicTableCommand({
          id,
          kind: opts.kind,
          tag: opts.tag,
          json: opts.json,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── groups — command discoverability index ─────────────────────
  program
    .command("groups")
    .description("Browse Mneme's 40+ commands grouped by intent (security / people / history / memory / originals).")
    .option("--only <id>", "focus on one group: security | people | history | memory | originals")
    .option("--json", "machine-readable output", false)
    .action(async (opts: any) => {
      process.exit(
        await groupsCommand({ only: opts.only, json: opts.json }),
      );
    });

  // ─── deps audit — vulnerability scan over installed deps via OSV.dev
  const depsCmd = program
    .command("deps")
    .description("Dependency-level security commands (OSV.dev / CVE / GHSA cross-reference).");
  depsCmd
    .command("audit")
    .description("Scan installed dependencies for known vulnerabilities (via OSV.dev — Google-maintained, free, no auth)")
    .option("--json", "machine-readable output", false)
    .option("--max <n>", "cap inventory queried (default 5000)", (v) => Number(v))
    .option("--offline", "skip the network call (returns empty findings — for airgapped envs)", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (opts: any) => {
      process.exit(
        await depsAuditCommand({
          cwd: process.cwd(),
          json: opts.json,
          maxPackages: opts.max,
          offline: opts.offline,
          quiet: opts.quiet,
        }),
      );
    });

  // ─── suppress — manage .mneme/suppressions.json ──────────────────
  program
    .command("suppress [id]")
    .description("Suppress a vulnerability finding by id (.mneme/suppressions.json). Pass --list to see all, --remove to remove.")
    .option("--reason <text>", "why this is a false positive (required when adding)")
    .option("--expires <iso>", "optional expiry timestamp (e.g. 2026-12-31)")
    .option("--remove", "remove the suppression with this id", false)
    .option("--list", "list all active suppressions", false)
    .option("--json", "machine-readable output", false)
    .action(async (id: string | undefined, opts: any) => {
      process.exit(
        await suppressCommand({
          cwd: process.cwd(),
          id,
          reason: opts.reason,
          expiresAt: opts.expires,
          remove: opts.remove,
          list: opts.list,
          json: opts.json,
        }),
      );
    });

  // ─── show — print full context for one vulnerability finding ─────
  program
    .command("show <id>")
    .description("Print full context for a vulnerability finding by its 8-char id (commit + diff + posterior breakdown + suggested actions).")
    .option("--top <n>", "scan up to N commits looking for the id (default 500)", parseIntStrict("--top"), 500)
    .option("--json", "machine-readable output", false)
    .action(async (id: string, opts: any) => {
      process.exit(
        await showFindingCommand({
          cwd: process.cwd(),
          id,
          topN: opts.top,
          json: opts.json,
        }),
      );
    });

  // ─── repo-mri — 20-axis health diagnostic with z-scores ─────────────
  program
    .command("repo-mri")
    .alias("mri")
    .description("Repo MRI — 20-axis health diagnostic with z-scores against typical OSS repos. The fast 'what's weird about this repo' answer.")
    .option("--max-commits <n>", "scan only the most-recent N commits (0 = unlimited)", (v) => Number(v), 0)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { maxCommits?: number; json?: boolean }) => {
      process.exit(
        await repoMriCommand({
          cwd: process.cwd(),
          maxCommits: opts.maxCommits,
          json: opts.json,
        }),
      );
    });

  // ─── completion — emit a shell-completion script (bash/zsh/fish/powershell)
  program
    .command("completion <shell>")
    .description(
      "Print a shell-completion script for bash, zsh, fish, or powershell. Pipe to your completion file to enable tab-completion across every Mneme command.",
    )
    .action((shell: string) => {
      const allowed: ReadonlyArray<"bash" | "zsh" | "fish" | "powershell"> = [
        "bash",
        "zsh",
        "fish",
        "powershell",
      ];
      const requested = shell.toLowerCase() as (typeof allowed)[number];
      if (!allowed.includes(requested)) {
        ui.error(`Unsupported shell: ${shell}. Supported: ${allowed.join(", ")}`);
        process.exit(1);
      }
      process.exit(completionCommand({ program, shell: requested }));
    });

  // ─── v0.20.0: smart dispatcher — one command, world-class routing ────
  program
    .command("do <query...>")
    .description("Smart dispatcher — describe what you want, Mneme picks tools and runs them ('do find security issues' / 'do is the codebase healthy')")
    .option("--json", "structured output", false)
    .action(async (query: string[], opts: { json?: boolean }) => {
      process.exit(
        await doCommand({
          cwd: process.cwd(),
          query: query.join(" "),
          json: opts.json,
        }),
      );
    });

  // ─── v0.24.0: HTC — Hierarchical Token Cache (compress codebase for LLM) ─
  program
    .command("htc-build")
    .description("Compress every commit + cluster + memoir into LLM-ready cache (10× smaller, paid once, free LLM ladder auto-detected)")
    .option("--abstracts-only", "skip Layer 2 + 3", false)
    .option("--refresh-memoir", "regenerate Layer 3 even if recent", false)
    .option("--concurrency <n>", "parallel LLM calls (default 3)", (v) => Number(v), 3)
    .action(async (opts: { abstractsOnly?: boolean; refreshMemoir?: boolean; concurrency?: number }) => {
      process.exit(
        await htcBuildCommand({
          cwd: process.cwd(),
          abstractsOnly: opts.abstractsOnly,
          refreshMemoir: opts.refreshMemoir,
          concurrency: opts.concurrency,
        }),
      );
    });

  program
    .command("htc-stats")
    .description("Inspect HTC coverage + compression ratio (raw vs cached tokens)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { json?: boolean }) => {
      process.exit(await htcStatsCommand({ cwd: process.cwd(), json: opts.json }));
    });

  // ─── v0.22.2: bulletproof self-update ────────────────────────────────
  program
    .command("upgrade")
    .description("Update Mneme to latest — bypasses npm cache + diagnoses PATH conflicts (more reliable than `npm install -g mneme-ai@latest`)")
    .option("--force", "force re-install even if versions match", false)
    .action(async (opts: { force?: boolean }) => {
      process.exit(
        await upgradeCommand({ cwd: process.cwd(), force: opts.force }),
      );
    });

  // ─── v0.22.0: free-LLM setup wizard (assume no API key) ─────────────
  program
    .command("setup-free")
    .description("30-second guided setup for full Q&A synthesis without paying — Ollama / Groq / OpenRouter free paths")
    .action(async () => {
      process.exit(await setupFreeCommand({ cwd: process.cwd() }));
    });

  // ─── v0.20.0: pre-commit hook — install once, always-on protection ───
  program
    .command("guard")
    .description("Pre-commit hook — auto-runs anomaly + vuln + secret-redaction checks on every commit (install once, forget it exists)")
    .option("--install", "install the pre-commit hook in this repo", false)
    .option("--uninstall", "remove the pre-commit hook from this repo", false)
    .option("--check", "run the checks against currently-staged changes (used by the hook itself)", false)
    .option("--strict", "fail commit on MEDIUM-or-higher findings (default: only HIGH/CRITICAL)", false)
    .action(async (opts: { install?: boolean; uninstall?: boolean; check?: boolean; strict?: boolean }) => {
      process.exit(
        await guardCommand({
          cwd: process.cwd(),
          install: opts.install,
          uninstall: opts.uninstall,
          check: opts.check,
          strict: opts.strict,
        }),
      );
    });

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
    .option("--since <date>", "only index commits since this date (e.g. 2024-01-01, 7d)", parseSinceDate)
    .option("--max <n>", "maximum number of commits", parseIntStrict("--max"))
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
    .option("--stream", "v0.23: emit speculative-reasoning events in real-time (consider/accept/prune/verify)", false)
    .action(async (qParts: string[], opts: { topK: number; json: boolean; llm?: boolean; debug?: boolean; audit?: boolean; auditFloor?: "low" | "medium" | "high"; stream?: boolean }) => {
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
          stream: opts.stream,
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
    .description("Probe the environment (Ollama, OpenAI, hardware), check Mneme version against npm registry, and recommend next steps")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { json?: boolean }) => {
      const { runFullProbe } = await import("./probe.js");
      const { versionCheck } = await import("@mneme-ai/core");
      const probe = await runFullProbe();
      // v1.23.1 — version mismatch is the single most-asked "is my Mneme
      // okay?" check. doctor is the right place to surface it because
      // users run doctor when something feels off.
      let vCheck: Awaited<ReturnType<typeof versionCheck.checkVersion>> | null = null;
      try { vCheck = await versionCheck.checkVersion(process.cwd(), getVersion()); } catch { /* best-effort */ }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ ...probe, mnemeVersion: vCheck }, null, 2) + "\n");
        process.exit(0);
      }
      const kleur = (await import("kleur")).default;
      const stars = "★".repeat(probe.recommendation.qualityStars) + "☆".repeat(5 - probe.recommendation.qualityStars);
      ui.banner();
      process.stdout.write(`  ${kleur.bold().cyan("Mneme version")}\n`);
      if (vCheck && vCheck.latest) {
        if (vCheck.updateAvailable) {
          process.stdout.write(`    ${kleur.gray("installed ")}  ${kleur.bold(vCheck.current)}\n`);
          process.stdout.write(`    ${kleur.gray("latest    ")}  ${kleur.bold().yellow(vCheck.latest)} ${kleur.yellow("(update available)")}\n`);
          process.stdout.write(`\n    ${kleur.yellow().bold("👉 Upgrade with:")}\n`);
          process.stdout.write(`       ${kleur.cyan().bold("$")} ${kleur.bold().white("mneme upgrade --force")}\n`);
        } else {
          process.stdout.write(`    ${kleur.gray("installed ")}  ${kleur.bold(vCheck.current)} ${kleur.green("(latest)")}\n`);
        }
      } else {
        process.stdout.write(`    ${kleur.gray("installed ")}  ${kleur.bold(getVersion())} · ${kleur.gray("could not reach npm registry")}\n`);
      }
      process.stdout.write(`\n  ${kleur.bold().cyan("Environment probe")}\n`);
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

  // ─── counterfactual — Bayesian what-if: drop one author, re-simulate ───
  program
    .command("counterfactual <author-email>")
    .description("Bayesian what-if simulation — drop one author's commits and re-compute atrophy + telepathy. Surfaces which files lose their last live expert and which latent pairs disappear. Bayesian, NOT a prediction; never use to evaluate a real person.")
    .option("--top-files <n>", "max files / pairs per delta", (v) => Number(v), 10)
    .option("--no-telepathy", "skip telepathy diff (faster on huge repos)", false)
    .option("--json", "machine-readable output", false)
    .action(async (
      authorEmail: string,
      opts: { topFiles?: number; telepathy?: boolean; json?: boolean },
    ) => {
      process.exit(
        await counterfactualCommand({
          cwd: process.cwd(),
          authorEmail,
          topFiles: opts.topFiles,
          includeTelepathy: opts.telepathy !== false,
          json: opts.json,
        }),
      );
    });

  // ─── org — cross-repo nervous system ───────────────────────────────
  // Single command with manual subcommand routing — sidesteps commander's
  // parent/child option-inheritance quirks. Forms:
  //
  //   mneme org                              → run on first org
  //   mneme org <orgname>                    → run on <orgname>
  //   mneme org init <name>                  → create registry
  //   mneme org add <name> <path>            → register a repo
  //   mneme org remove <name> <path>         → unregister
  //   mneme org list                         → list every org
  //   mneme org status [name]                → indexed-or-missing report
  //   mneme org delete <name>                → delete a registry file
  program
    .command("org [args...]")
    .description(
      "Cross-repo nervous system — register multiple repos under one org, then run telepathy + atrophy across all of them. Subcommands: init <name> | add <name> <path> | remove <name> <path> | list | status [name] | delete <name>. Default (no subcommand) runs cross-repo analysis on the first registered org.",
    )
    .option("--json", "machine-readable output", false)
    .action(async (args: string[], opts: { json?: boolean }) => {
      const sub = parseOrgSub(args);
      if (!sub) {
        ui.error(
          "Unknown `org` invocation. Run `mneme org list` or `mneme org init <name>` to get started.",
        );
        process.exit(1);
      }
      process.exit(
        await orgCommand({ cwd: process.cwd(), sub, json: opts.json }),
      );
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
    .command("dashboard")
    .description("Open the Mneme Web Dashboard for the current repo (local-first; no upload).")
    .option("--port <n>", "preferred starting port (auto-finds next free)", (v) => Number(v), 3737)
    .option("--no-open", "do not launch the browser", false)
    .option("--data <path>", "use an existing nervous-system JSON instead of recomputing")
    .action(async (opts: { port?: number; open?: boolean; data?: string }) => {
      process.exit(
        await dashboardCommand({
          cwd: process.cwd(),
          port: opts.port,
          noOpen: opts.open === false,
          data: opts.data,
        }),
      );
    });

  program
    .command("mcp")
    .description("Run as an MCP server, OR --install to auto-config Claude Code / Cursor / Continue")
    .option("--install", "Auto-detect AI coding tools and add Mneme to their MCP config", false)
    .option("--tool <name>", "Force a specific tool: claude-code | cursor | continue")
    .option("--dry-run", "Print what would change, don't write", false)
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { install?: boolean; tool?: string; dryRun?: boolean; json?: boolean }) => {
      if (opts.install) {
        const { mcpInstallCommand } = await import("./commands/mcp-install.js");
        process.exit(
          await mcpInstallCommand({
            cwd: process.cwd(),
            tool: opts.tool,
            dryRun: opts.dryRun,
            json: opts.json,
          }),
        );
      }
      process.exit(await mcpCommand({ cwd: process.cwd() }));
    });

  // ── v1.10.0 — Webhooks (audit.fail / forensics.cwe.high / etc) ──
  program
    .command("webhook <action>")
    .description("Outgoing webhooks: add · list · remove · test · fire (events: audit.fail · forensics.cwe.high · atrophy.spike · court.guilty · federation.match)")
    .option("--event <name>", "Event name for add/fire")
    .option("--url <url>", "Webhook endpoint URL for add")
    .option("--id <id>", "Webhook id for remove/test")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { event?: string; url?: string; id?: string; json?: boolean }) => {
      const { webhookCommand } = await import("./commands/webhook.js");
      const allowed = ["add", "list", "remove", "test", "fire"];
      if (!allowed.includes(action)) {
        ui.error(`Unknown webhook action "${action}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await webhookCommand({
          cwd: process.cwd(),
          action: action as "add" | "list" | "remove" | "test" | "fire",
          event: opts.event as import("./commands/webhook.js").WebhookEvent | undefined,
          url: opts.url,
          id: opts.id,
          json: opts.json,
        }),
      );
    });

  // ── v1.10.0 — Persistent Cross-AI Brain (session save/resume) ──
  program
    .command("session <action>")
    .description("Persistent cross-AI session: save · resume · list · remove. Context follows you across Claude Code / Cursor / ChatGPT / Codex.")
    .option("--id <id>", "Session id")
    .option("--intent <text>", "What the user is trying to accomplish")
    .option("--ai-tool <name>", "Which AI tool is calling (e.g. claude-code, chatgpt, cursor)")
    .option("--log-entry <text>", "Append a log entry describing what just happened")
    .option("--outcome <verdict>", "Outcome: PASS | WARN | FAIL | INFO")
    .option("--files <list>", "Comma-separated list of files to anchor")
    .option("--commits <list>", "Comma-separated list of commit hashes to anchor")
    .option("--topics <list>", "Comma-separated list of topics")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { id?: string; intent?: string; aiTool?: string; logEntry?: string; outcome?: string; files?: string; commits?: string; topics?: string; json?: boolean }) => {
      const { sessionCommand } = await import("./commands/session.js");
      const allowed = ["save", "resume", "list", "remove"];
      if (!allowed.includes(action)) {
        ui.error(`Unknown session action "${action}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await sessionCommand({
          cwd: process.cwd(),
          action: action as "save" | "resume" | "list" | "remove",
          id: opts.id,
          intent: opts.intent,
          aiTool: opts.aiTool,
          logEntry: opts.logEntry,
          outcome: opts.outcome as "PASS" | "WARN" | "FAIL" | "INFO" | undefined,
          files: opts.files?.split(",").map((s) => s.trim()),
          commits: opts.commits?.split(",").map((s) => s.trim()),
          topics: opts.topics?.split(",").map((s) => s.trim()),
          json: opts.json,
        }),
      );
    });

  // ── v1.10.0 — Codebase Constitution ──
  program
    .command("constitution")
    .description("Synthesize the repo's living constitution (regret patterns · atrophy pairing · forensics rules · ADRs). AI tools auto-prepend via mneme.constitution.get MCP tool.")
    .option("--out <path>", "Write the markdown to this path (also caches at .mneme/constitution.md)")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { out?: string; json?: boolean }) => {
      const { constitutionCommand } = await import("./commands/constitution.js");
      process.exit(
        await constitutionCommand({
          cwd: process.cwd(),
          out: opts.out,
          json: opts.json,
        }),
      );
    });

  // ── v1.12.0 — Dynamic MCP: per-repo ecosystem-specific tool surface ──
  program
    .command("ecosystem")
    .description("Dynamic MCP — detect ecosystems in your repo (Stripe, React, Postgres, etc.) and show which ecosystem-specific tools Mneme will spawn for this repo.")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { json?: boolean }) => {
      const { ecosystemCommand } = await import("./commands/ecosystem.js");
      process.exit(
        await ecosystemCommand({
          cwd: process.cwd(),
          json: opts.json,
        }),
      );
    });

  // ── v1.12.0 — AI-Memory-Bench: reproducible hallucination benchmark ──
  program
    .command("bench")
    .description("AI-Memory-Bench — the first reproducible benchmark for 'AI memory layers'. Emit probes, score AI answers, render leaderboard.")
    .option("--probes-out <file>", "Emit probe questions as JSON for the AI to answer")
    .option("--score <answers>", "Score AI's answers JSON file → render leaderboard")
    .option("--label <name>", "Label for the run (e.g. 'claude-code-with-mneme')")
    .option("--category <c>", "Filter to one category: citation | api | attribution | regret | decision")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { probesOut?: string; score?: string; label?: string; category?: string; json?: boolean }) => {
      const { benchCommand } = await import("./commands/bench.js");
      process.exit(
        await benchCommand({
          cwd: process.cwd(),
          probesOut: opts.probesOut,
          score: opts.score,
          label: opts.label,
          category: opts.category as import("@mneme-ai/core").bench.ProbeCategory | undefined,
          json: opts.json,
        }),
      );
    });

  // ── v1.11.1 — One-screen security dashboard for the user ──
  program
    .command("security [action]")
    .description("Security dashboard: status (default) · on · off · verify. Shows audit log, model checksums (TOFU), scrubber, and FIPS posture in one screen.")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string | undefined, opts: { json?: boolean }) => {
      const { securityCommand } = await import("./commands/security.js");
      const allowed = ["status", "on", "off", "verify"];
      const a = action ?? "status";
      if (!allowed.includes(a)) {
        ui.error(`Unknown security action "${a}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await securityCommand({
          cwd: process.cwd(),
          action: a as "status" | "on" | "off" | "verify",
          json: opts.json,
        }),
      );
    });

  // ── v1.11.0 — HMAC-chained tamper-evident audit log (banking/SOC2/PCI-DSS) ──
  program
    .command("audit-log <action>")
    .description("HMAC-SHA-256 tamper-evident audit log: enable · disable · status · verify · rotate · show. Compliance-grade (SOC2 / PCI-DSS / banking).")
    .option("--actor <name>", "Actor name to record in the log (default: cli)")
    .option("--limit <n>", "Limit show output to last N entries", (v) => Number(v))
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { actor?: string; limit?: number; json?: boolean }) => {
      const { auditLogCommand } = await import("./commands/audit-log-cmd.js");
      const allowed = ["enable", "disable", "status", "verify", "rotate", "show"];
      if (!allowed.includes(action)) {
        ui.error(`Unknown audit-log action "${action}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await auditLogCommand({
          cwd: process.cwd(),
          action: action as "enable" | "disable" | "status" | "verify" | "rotate" | "show",
          actor: opts.actor,
          limit: opts.limit,
          json: opts.json,
        }),
      );
    });

  // ── v1.11.0 — HMAC secret rotation for audit log ──
  program
    .command("key <action>")
    .description("Cryptographic key management: rotate (re-sign HMAC audit chain under fresh secret).")
    .option("--confirm", "Actually rotate (default is dry-run)", false)
    .option("--actor <name>", "Actor name to record (default: cli)")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { confirm?: boolean; actor?: string; json?: boolean }) => {
      const { keyCommand } = await import("./commands/key.js");
      const allowed = ["rotate"];
      if (!allowed.includes(action)) {
        ui.error(`Unknown key action "${action}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await keyCommand({
          cwd: process.cwd(),
          action: action as "rotate",
          confirm: opts.confirm,
          actor: opts.actor,
          json: opts.json,
        }),
      );
    });

  // ── v1.10.0 — Self-learning loop manual tick + status ──
  program
    .command("learn <action>")
    .description("Self-learning engine: tick (run a learning cycle now) · status (show learned-state + audit trail)")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { json?: boolean }) => {
      const allowed = ["tick", "status"];
      if (!allowed.includes(action)) {
        ui.error(`Unknown learn action "${action}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      const { learning, git: gitMod } = await import("@mneme-ai/core");
      const cwd = process.cwd();
      if (!(await gitMod.isGitRepo(cwd))) {
        ui.error("Not in a git repo. Run `mneme init` first.");
        process.exit(1);
      }
      const meta = await gitMod.getRepoMeta(cwd);
      if (action === "tick") {
        const next = learning.runLearningTick(meta.rootPath);
        if (opts.json) process.stdout.write(JSON.stringify(next, null, 2) + "\n");
        else ui.success(`Learning tick ${next.tickCount} complete · ${next.observationsLastTick} observations processed · ${next.auditTrail.length} audit entries`);
        process.exit(0);
      }
      // status
      const state = learning.readState(meta.rootPath);
      if (!state) {
        if (opts.json) process.stdout.write(JSON.stringify({ initialized: false }) + "\n");
        else ui.dim("No learned state yet. Run `mneme learn tick` to seed it.");
        process.exit(0);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(state, null, 2) + "\n");
        process.exit(0);
      }
      process.stdout.write(
        `\n  🧠 Mneme self-learning state\n` +
          `  Tick count:    ${state.tickCount}\n` +
          `  Last tick:     ${state.lastTickAt}\n` +
          `  Observations:  ${state.observationsLastTick} in last tick\n` +
          `  HMRA weights:  α=${state.hmraWeights.alpha.toFixed(3)} β=${state.hmraWeights.beta.toFixed(3)} γ=${state.hmraWeights.gamma.toFixed(3)} δ=${state.hmraWeights.delta.toFixed(3)} ε=${state.hmraWeights.epsilon.toFixed(3)}\n` +
          `  Tools tracked: ${Object.keys(state.toolSuccessRates).length}\n` +
          `  Rule priors:   ${Object.keys(state.rulePriors).length}\n` +
          `  Molecules:     ${Object.keys(state.moleculeStats).length}\n\n  Recent audit trail:\n`,
      );
      for (const a of state.auditTrail.slice(-5)) {
        process.stdout.write(`    [${a.channel}] ${a.detail}\n`);
      }
      process.stdout.write("\n");
      process.exit(0);
    });

  // ── v1.8.0 — Cross-AI Adapter (export tool catalog for any vendor) ──
  program
    .command("adapter <vendor>")
    .description("Export Mneme's tool catalog as OpenAI / Anthropic / Gemini / MCP function-calling format")
    .option("--out <path>", "Write JSON to this path (default: stdout)")
    .option("--json", "Always emit JSON (default for stdout)", false)
    .action(async (vendor: string, opts: { out?: string; json?: boolean }) => {
      const allowed = ["openai", "anthropic", "gemini", "mcp"];
      if (!allowed.includes(vendor)) {
        ui.error(`Unknown vendor "${vendor}". Try: ${allowed.join(" | ")}`);
        process.exit(1);
      }
      const { adapterCommand } = await import("./commands/adapter.js");
      process.exit(
        await adapterCommand({
          cwd: process.cwd(),
          vendor: vendor as "openai" | "anthropic" | "gemini" | "mcp",
          out: opts.out,
          json: opts.json,
        }),
      );
    });

  // ── v1.6.0 — AI Memory Benchmark (Lighthouse-of-AI-memory) ──
  program
    .command("benchmark")
    .description("Run the vendor-neutral AI Memory Benchmark — grades any AI memory implementation across 24 standardized probes")
    .option("--targets <names>", "Comma-separated implementations to benchmark (default: mneme-self)")
    .option("--probes <n>", "Number of probes to run (default: all 24)", (v) => Number(v))
    .option("--out <path>", "Write the markdown leaderboard to this path")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { targets?: string; probes?: number; out?: string; json?: boolean }) => {
      const { benchmarkCommand } = await import("./commands/benchmark.js");
      const targets = opts.targets ? opts.targets.split(",").map((s) => s.trim()) : undefined;
      process.exit(
        await benchmarkCommand({
          cwd: process.cwd(),
          targets,
          probes: opts.probes,
          out: opts.out,
          json: opts.json,
        }),
      );
    });

  // ── v1.6.0 — Phase 7: Time Capsule (handover artifact) ──
  program
    .command("time-capsule")
    .description("Export a single-tarball snapshot of the repo's nervous system for handovers / new-hire onboarding")
    .option("--export <path>", "Write the time capsule tarball to this path")
    .option("--import <path>", "Restore from a time capsule tarball")
    .option("--quarter <yyyy-q>", "Tag the capsule with a quarter (e.g. 2026-Q2)")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { export?: string; import?: string; quarter?: string; json?: boolean }) => {
      const { timeCapsuleCommand } = await import("./commands/time-capsule.js");
      process.exit(
        await timeCapsuleCommand({
          cwd: process.cwd(),
          exportPath: opts.export,
          importPath: opts.import,
          quarter: opts.quarter,
          json: opts.json,
        }),
      );
    });

  // ── v1.7.0 — Phase 3: real daemon (predictive context pre-fetch) ──
  program
    .command("daemon <action>")
    .description("Mneme daemon — background process that watches git activity + auto-reindexes")
    .option("--attached", "Run in foreground (used internally by `start` to spawn a detached child)", false)
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { attached?: boolean; json?: boolean }) => {
      const { daemonCommand } = await import("./commands/daemon.js");
      const allowedActions = ["start", "stop", "status", "logs"];
      if (!allowedActions.includes(action)) {
        ui.error(`Unknown daemon action "${action}". Try: ${allowedActions.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await daemonCommand({
          cwd: process.cwd(),
          action: action as "start" | "stop" | "status" | "logs",
          attached: opts.attached,
          json: opts.json,
        }),
      );
    });

  // ── v1.6.0 — Phase 4 stub: 12-jury court preview ──
  program
    .command("court [commit]")
    .description("Mneme Court — 12-jury arbitration with cryptographic ruling PDF (preview, full implementation in v1.7.0)")
    .option("--jurors <n>", "Jury size (default 12)", (v) => Number(v))
    .option("--out <path>", "Write ruling PDF/JSON to this path")
    .option("--json", "Machine-readable output", false)
    .action(async (commit: string | undefined, opts: { jurors?: number; out?: string; json?: boolean }) => {
      const { courtCommand } = await import("./commands/court.js");
      process.exit(
        await courtCommand({
          cwd: process.cwd(),
          commit,
          jurors: opts.jurors,
          out: opts.out,
          json: opts.json,
        }),
      );
    });

  // ── v1.7.0 — Phase 5: Wisdom Federation (privacy-preserving cross-repo) ──
  program
    .command("federation <action>")
    .description("Cross-repo Wisdom Federation — DP/k-anonymity signed signals (join · leave · status · contribute · query)")
    .option("--hub <url>", "Federation hub URL (required for `join`)")
    .option("--pattern <q>", "Pattern to contribute or query (required for those actions)")
    .option("--no-post", "For contribute: print the envelope without POSTing to the hub")
    .option("--json", "Machine-readable output", false)
    .action(async (action: string, opts: { hub?: string; pattern?: string; noPost?: boolean; json?: boolean }) => {
      const { federationCommand } = await import("./commands/federation.js");
      const allowedActions = ["join", "leave", "status", "contribute", "query"];
      if (!allowedActions.includes(action)) {
        ui.error(`Unknown federation action "${action}". Try: ${allowedActions.join(" | ")}`);
        process.exit(1);
      }
      process.exit(
        await federationCommand({
          cwd: process.cwd(),
          action: action as "join" | "leave" | "status" | "contribute" | "query",
          hub: opts.hub,
          pattern: opts.pattern,
          noPost: opts.noPost,
          json: opts.json,
        }),
      );
    });

  // ── v1.5.0 — git extension: install git-mneme wrapper + git hooks ──
  program
    .command("git-install")
    .description("Install Mneme as a native git extension — enables `git mneme <cmd>` + optional hooks")
    .option("--no-hooks", "Only install the git-mneme wrapper, skip hooks")
    .option(
      "--hooks <names>",
      "Comma-separated subset of hooks (pre-commit,post-commit,pre-push,post-merge)",
    )
    .option("--dry-run", "Print what would change, don't write")
    .option("--json", "Machine-readable output", false)
    .action(async (opts: { noHooks?: boolean; hooks?: string; dryRun?: boolean; json?: boolean }) => {
      const { gitInstallCommand } = await import("./commands/git-install.js");
      const hooks = opts.hooks
        ? (opts.hooks.split(",").map((s) => s.trim()) as Array<"pre-commit" | "post-commit" | "pre-push" | "post-merge">)
        : undefined;
      process.exit(
        await gitInstallCommand({
          cwd: process.cwd(),
          noHooks: opts.noHooks,
          hooks,
          dryRun: opts.dryRun,
          json: opts.json,
        }),
      );
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
    .description("WILD #5 — render the causal chain of a single line of code (default: backward to root cause; --counterfactual: forward to consequences)")
    .option("--max-depth <n>", "how deep to walk the chain", (v) => Number(v), 8)
    .option("--counterfactual", "switch to forward mode — show downstream commits + heuristic flipped-line sketches", false)
    .option("--json", "machine-readable output", false)
    .action(async (target: string, opts: any) => {
      process.exit(
        await palimpsestCommand({
          cwd: process.cwd(),
          target,
          maxDepth: opts.maxDepth,
          counterfactual: opts.counterfactual,
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
    .description("WILD #6 — review co-pilot: risk-score a PR against your repo's own history. --dual-jury renders prosecution + defense + verdict.")
    .option("--diff-file <path>", "read a unified diff from this file")
    .option("--stdin", "read a unified diff from stdin", false)
    .option("--recency-days <n>", "consider commits within this window", (v) => Number(v), 365)
    .option("--top <n>", "top-N similar past commits", (v) => Number(v), 8)
    .option("--dual-jury", "show prosecution + defense + verdict from real history", false)
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
          dualJury: opts.dualJury,
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
    .option("--auto-pull", "auto-download the default Ollama model if it isn't installed (~2 GB, one-time)", false)
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
          autoPull: opts.autoPull,
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
    .option("--auto-pull", "auto-download the default Ollama model if it isn't installed (~2 GB, one-time)", false)
    .action(async (target: string, opts: any) => {
      process.exit(
        await teachCommand({
          cwd: process.cwd(),
          target,
          provider: opts.provider,
          model: opts.model,
          json: opts.json,
          noLlm: opts.llm === false,
          autoPull: opts.autoPull,
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
    .command("attribute [commit]")
    .description("Who most-likely wrote this commit? (defaults to HEAD if omitted)")
    .option("--top <n>", "show N candidates", parseIntStrict("--top"), 5)
    .option("--json", "structured output", false)
    .action(async (commit: string | undefined, opts: any) =>
      process.exit(
        await forensicsAttributeCommand({
          cwd: process.cwd(),
          commitHash: commit ?? "HEAD",
          topN: opts.top,
          json: opts.json,
        }),
      ),
    );

  forensicsCmd
    .command("vulns")
    .description("Find security holes in your git history (CWE-aligned scanner — Bayesian-filtered)")
    .option("--since <date>", "only scan commits since this date (e.g. 2024-01-01, 7d)", parseSinceDate)
    .option("--top <n>", "scan up to N commits", parseIntStrict("--top"), 500)
    .option("--json", "structured output", false)
    .option("--sarif <path>", "emit SARIF v2.1.0 to <path> (use \"-\" for stdout) — feeds GitHub Code Scanning")
    .option("--min-posterior <n>", "drop findings whose Bayesian posterior is below this (default 0.3)", parseFloatStrict("--min-posterior"))
    .option("--no-stack", "disable stack-aware filtering — run every rule (regression mode)", false)
    .option("--explain", "show the why-I-flagged-this evidence trail per finding", false)
    .option("--quiet", "no banner, no decorative chars", false)
    .action(async (opts: any) =>
      process.exit(
        await forensicsVulnsCommand({
          cwd: process.cwd(),
          since: opts.since,
          topN: opts.top,
          json: opts.json,
          sarif: opts.sarif,
          minPosterior: opts.minPosterior,
          noStack: opts.stack === false,
          explain: opts.explain,
          quiet: opts.quiet,
        }),
      ),
    );

  forensicsCmd
    .command("anomaly")
    .description("Catch suspicious commits before merge (insider-threat / credential-compromise)")
    .option("--threshold <n>", "deviation threshold to surface (0..4)", parseFloatStrict("--threshold"), 0.9)
    .option("--top <n>", "show N findings", parseIntStrict("--top"), 10)
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

  // ─── mneme whats-new (v1.24.1) ─────────────────────────────────────
  program
    .command("whats-new")
    .alias("wn")
    .description("Show curated highlights of what's new in this Mneme version (mirrors mneme.whats_new MCP tool).")
    .option("--since <semver>", "Only highlights newer than this version.")
    .option("--limit <n>", "Max highlights (default 3).", (v) => Number(v))
    .option("--json", "JSON output.")
    .action(async (opts: { since?: string; limit?: number; json?: boolean }) => {
      const { whatsNew } = await import("@mneme-ai/core");
      const currentVersion = getVersion();
      const digest = whatsNew.buildDigest({ currentVersion, sinceVersion: opts.since, limit: opts.limit ?? 3 });
      if (opts.json) {
        process.stdout.write(JSON.stringify(digest, null, 2) + "\n");
        return;
      }
      process.stdout.write(`Mneme v${currentVersion} -- What's new\n\n`);
      for (const h of digest.highlights) {
        process.stdout.write(`v${h.version}  ${h.headline}\n`);
        process.stdout.write(`            ${h.body}\n`);
        if (h.suggestedAction) process.stdout.write(`            -> ${h.suggestedAction}\n`);
        process.stdout.write(`\n`);
      }
      process.stdout.write(`(${digest.highlights.length} of ${digest.totalAvailable} highlights shown.)\n`);
    });

  // ─── MneMeiosis Lineage commands (v1.19.0) ─────────────────────────
  registerWelcomeCommand(program);
  registerSporeCommands(program);
  registerLinCommands(program);
  // ─── NUCLEUS Infinity Wisdom Brain (v1.21.0) ──────────────────────
  registerNucleusCommands(program);
  // ─── Inbox / RLHF Force-Push (v1.23.0) ────────────────────────────
  registerInboxCommands(program);
  // ─── Antivirus / Vaccine Lab (v1.24.0) ────────────────────────────
  registerAntivirusCommands(program);
  // ─── Retrieval Lab (v1.25.0) ──────────────────────────────────────
  registerRetrievalCommands(program);
  // ─── Hooks (v1.25.2) ──────────────────────────────────────────────
  registerHooksCommands(program);
  // ─── CLI wow-feature exposure (v1.22.0) ───────────────────────────
  registerToolsCommand(program);
  registerBotCommand(program);
  registerHealthCommand(program);
  registerDemoCommand(program);

  program.exitOverride((err) => {
    if (err.code === "commander.help" || err.code === "commander.helpDisplayed") process.exit(0);
    if (err.code === "commander.version") process.exit(0);
    process.exit(err.exitCode ?? 1);
  });

  // v1.23.1 — fire the npm version-check from the CLI too. Previously
  // this only ran inside the MCP server boot path, so any user who
  // hadn't wired Mneme as MCP never got an update notification +
  // .mneme/CURRENT_VERSION.md never got written.
  //
  // Strategy: AWAIT only when the cache is stale/missing (otherwise the
  // command would exit before the fire-and-forget IIFE writes the memo).
  // Cache hit (95%+ of invocations once primed) = ≤1ms, no perceptible
  // latency. Cache miss = ≤2s timeout to avoid hanging the CLI on a slow
  // network. Total cost amortizes to ~0 once the 1h cache is warm.
  try {
    const { versionCheck } = await import("@mneme-ai/core");
    const cached = versionCheck.readCachedVersionCheck(process.cwd(), getVersion());
    const cacheAgeOk = cached !== null && (Date.now() - Date.parse(cached.lastChecked)) < 60 * 60 * 1000;
    if (cacheAgeOk) {
      // Refresh in background — current cache is good enough to satisfy this command.
      void versionCheck.checkVersion(process.cwd(), getVersion()).catch(() => { /* ignore */ });
    } else {
      // Wait briefly so the memo + cache get written before this command exits.
      await Promise.race([
        versionCheck.checkVersion(process.cwd(), getVersion()).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
    }
  } catch { /* best-effort — never block CLI commands */ }

  try {
    await program.parseAsync(argv);
  } catch (err) {
    ui.error((err as Error).message);
    process.exit(1);
  }
}

/**
 * Parse `mneme org [args...]` into a structured subcommand. Returns null
 * when the invocation is plainly invalid — the caller surfaces a friendly
 * error.
 */
function parseOrgSub(args: string[]): OrgSubcommand | null {
  // No args → run cross-repo on the first registered org.
  if (args.length === 0) return { kind: "run" };
  const head = args[0]!;
  switch (head) {
    case "init": {
      if (args.length !== 2) return null;
      return { kind: "init", name: args[1]! };
    }
    case "add": {
      if (args.length !== 3) return null;
      return { kind: "add", name: args[1]!, path: args[2]! };
    }
    case "remove": {
      if (args.length !== 3) return null;
      return { kind: "remove", name: args[1]!, path: args[2]! };
    }
    case "list": {
      if (args.length !== 1) return null;
      return { kind: "list" };
    }
    case "status": {
      if (args.length === 1) return { kind: "status" };
      if (args.length === 2) return { kind: "status", name: args[1]! };
      return null;
    }
    case "delete": {
      if (args.length !== 2) return null;
      return { kind: "delete", name: args[1]! };
    }
    default: {
      // Treat the first arg as an org name → run on that org.
      if (args.length === 1) return { kind: "run", name: head };
      return null;
    }
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
