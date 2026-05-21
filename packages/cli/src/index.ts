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
import { registerComplianceCommand } from "./commands/compliance.js";
import { registerCompanionCommand, registerCompanionShortcuts } from "./commands/companion.js";
import { registerGreetCommand } from "./commands/greet.js";
import { registerPowersCommand } from "./commands/powers.js";
import { registerCloudCommand } from "./commands/cloud.js";
import { registerPharmacopoeiaCommand, registerParasiteCommand, registerAletheiaCommand } from "./commands/demon_stage_one.js";
import { registerTeethCommand, registerWingsCommand, registerGodModeCommand, registerAvatarCommand } from "./commands/demon_stages_two_to_five.js";
import { registerAntivirusCommands } from "./commands/antivirus.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerEmbeddingsCommands } from "./commands/embeddings.js";
import { registerSupernovaCommands } from "./commands/supernova-cli.js";
import { registerManifestCommands } from "./commands/manifest.js";
import { registerTrustCommands } from "./commands/trust.js";
import { registerNuclearCommands } from "./commands/nuclear-cli.js";
import { registerOvernightCommand } from "./commands/overnight.js";
import { registerRetrievalCommands } from "./commands/retrieval.js";
import { registerHooksCommands } from "./commands/hooks.js";
import { registerNotifyCommands } from "./commands/notify.js";
import { registerAgentCommands } from "./commands/agent.js";
import { registerSelfcheckCommands } from "./commands/selfcheck.js";
import { registerQuantumCommands } from "./commands/quantum.js";
import { registerOracleCommands } from "./commands/oracle.js";
import { registerEvolveCommands } from "./commands/evolve.js";
import { registerGenomePoolCommands } from "./commands/genome-pool.js";
import { registerStigmergyCommands } from "./commands/stigmergy.js";
import { registerChimeraCommands } from "./commands/chimera.js";
import { registerToolsCommand, registerBotCommand, registerHealthCommand, registerDemoCommand, registerVerifyCommand, registerAutobootCommand, registerAskCommand, registerCovenantCommand } from "./commands/demo.js";
import { ui } from "./ui.js";

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name("mneme")
    .description("μνήμη — the memory layer of your codebase. Knows the WHY, the WHAT, the WHERE-IT-BREAKS.")
    .version(getVersion())
    .option("--compliance <profile>", "Cryptographic compliance profile (none | fips140). Refuses to start if profile not satisfied.", "none")
    .hook("preAction", async (thisCommand, actionCommand) => {
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
      // v2.19.23 LIMBIC · AUTONOMIC BREATH (G1 killer):
      // Silent heartbeat check + detached respawn on every CLI invocation.
      // User never has to know `mneme daemon start` exists.
      // Fire-and-forget: no await on respawn; only the alive-check is sync.
      try {
        const { ensureAutonomicBreath } = await import("./autonomic_breath_hook.js");
        await ensureAutonomicBreath({ cwd: process.cwd(), commandName: actionCommand.name() });
      } catch {
        // Never block a user command on breath failure.
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
  // ─── v2.19.57: --execute mode dispatches the DREAM ORGAN shepherd ────
  program
    .command("upgrade")
    .description("Update Mneme to latest — bypasses npm cache + diagnoses PATH conflicts (more reliable than `npm install -g mneme-ai@latest`). Use --execute for the self-installing dream-organ shepherd pipeline.")
    .option("--force", "force re-install even if versions match", false)
    .option("--execute", "🔮 DREAM ORGAN: detach a shepherd process that reaps daemon + runs `npm install -g --omit=optional --force mneme-ai@latest` + spawns new daemon, all automatically. Returns immediately; check progress with `mneme upgrade --status`.", false)
    .option("--status", "show the last 20 events from the shepherd state ledger (use after --execute)", false)
    .option("--target <version>", "version to install when using --execute (default: latest)", "latest")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { force?: boolean; execute?: boolean; status?: boolean; target?: string; json?: boolean }) => {
      if (opts.status) {
        const { shepherd } = await import("@mneme-ai/core");
        const status = shepherd.shepherdStatus(20);
        if (opts.json) { process.stdout.write(JSON.stringify(status, null, 2) + "\n"); return process.exit(0); }
        process.stdout.write(`🔮 SHEPHERD STATUS\n  running: ${status.running}\n  lastVerdict: ${status.lastVerdict}\n  lastTargetVersion: ${status.lastTargetVersion ?? "(none)"}\n  lastCompleteAt: ${status.lastCompleteAt ?? "(none)"}\n  chainOk: ${status.chainOk}\n  recent events:\n${status.lastEvents.map((e) => `    ${e.ts} · ${e.step}`).join("\n")}\n`);
        return process.exit(0);
      }
      if (opts.execute) {
        const { shepherd } = await import("@mneme-ai/core");
        const { spawn: spawnDetached } = await import("node:child_process");
        // Extract shepherd script to ~/.mneme-global/shepherd/shepherd.cjs
        const scriptPath = shepherd.installShepherdScript();
        const target = opts.target ?? "latest";
        // Acquire lock first (fail fast if another shepherd running)
        const lockResult = shepherd.acquireShepherdLock(target, "starting");
        if (!lockResult.acquired && lockResult.reason === "already-running") {
          if (opts.json) { process.stdout.write(JSON.stringify({ ok: false, reason: "shepherd-already-running", lock: lockResult.otherShepherd }, null, 2) + "\n"); return process.exit(1); }
          process.stderr.write(`❌ Shepherd already running (PID ${lockResult.otherShepherd.pid}, target ${lockResult.otherShepherd.targetVersion}, started ${lockResult.otherShepherd.startedAt}). Wait or check 'mneme upgrade --status'.\n`);
          return process.exit(1);
        }
        if (!lockResult.acquired && lockResult.reason === "stale-lock-cleared") {
          // Retry once after auto-clearing stale lock
          const retry = shepherd.acquireShepherdLock(target, "starting");
          if (!retry.acquired) {
            process.stderr.write(`❌ Failed to acquire shepherd lock even after clearing stale: ${JSON.stringify(retry)}\n`);
            return process.exit(1);
          }
        }
        if (!lockResult.acquired && lockResult.reason === "lock-write-failed") {
          process.stderr.write(`❌ Could not write shepherd lock: ${lockResult.error}\n`);
          return process.exit(1);
        }
        // Release our lock so the shepherd can take it fresh (the caller-CLI is not the shepherd)
        shepherd.releaseShepherdLock();
        // Spawn detached shepherd
        const args = [
          scriptPath,
          "--target", target,
          "--state-path", shepherd.shepherdStatePath(),
          "--lock-path", shepherd.shepherdLockPath(),
          "--secret", process.env["MNEME_SHEPHERD_SECRET"] ?? `mneme-shepherd-v${shepherd.PROTOCOL_VERSION}`,
        ];
        try {
          const child = spawnDetached(process.execPath, args, {
            detached: true, stdio: "ignore", windowsHide: true,
          });
          if (child.unref) child.unref();
          if (opts.json) { process.stdout.write(JSON.stringify({ ok: true, shepherdPid: child.pid, scriptPath, target }, null, 2) + "\n"); return process.exit(0); }
          process.stdout.write(`🔮 SHEPHERD STARTED (PID ${child.pid}, target ${target})\n   Mneme will upgrade automatically in the background.\n   Check progress: mneme upgrade --status\n   This terminal can be closed.\n`);
          return process.exit(0);
        } catch (e) {
          process.stderr.write(`❌ Failed to spawn shepherd: ${(e as Error).message}\n`);
          return process.exit(1);
        }
      }
      // Default path — legacy upgradeCommand
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
      const code = await entitiesCommand({ cwd: process.cwd() });
      // v1.46.0 (#18 fix) — TS/Py parsers spin up worker threads / child
      // processes that occasionally outlive the main event loop on
      // Windows (testers reported a zombie pid 50304). 50ms grace for
      // any final stdout flush, then a HARD exit so no handle keeps
      // the process alive past its job.
      setTimeout(() => process.exit(code), 50).unref();
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
    // v1.42.2 (#6 fix) — `--json` is the standard flag for machine output
    // across the rest of the Mneme CLI. `mneme advanced --json` used to
    // error with `unknown option '--json'`, which was embarrassing for an
    // own-feature. Now: emit a structured groups + commands payload.
    .option("--json", "JSON output: { groups: [{ name, commands: [{ name, description }] }] }")
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        process.stdout.write(JSON.stringify(advancedGroupsAsJson(), null, 2) + "\n");
      } else {
        process.stdout.write(renderAdvancedHelp());
      }
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

  // ─── v2.19.75 — `mneme cheatsheet` (10-line user-facing quick start) ─
  // The single-screen "what do I actually type?" guide for users who
  // don't memorise the 711-tool catalog.  Repo-aware: examples
  // reference the current branch + hot file when available.
  program
    .command("cheatsheet")
    .description("Single-screen 10-command quick reference. Repo-aware examples — copy-paste ready.")
    .option("--json", "Machine-readable output.")
    .action(async (opts: { json?: boolean }) => {
      const { cheatsheetCommand } = await import("./commands/cheatsheet.js");
      cheatsheetCommand({ cwd: process.cwd(), json: !!opts.json });
    });

  // ─── v2.19.80 — `mneme polygraph` (Browser Polygraph userscript) ──
  // Closes IDEA #1 gap: per-sentence dot verdicts on every AI response in
  // claude.ai / chatgpt / gemini / copilot / deepseek / qwen.  Emits a
  // Tampermonkey .user.js that hits the local Mneme bridge in real time.
  // v2.19.85 — `mneme polygraph` is now a command FAMILY. Browser-flow
  // verbs (autosetup / install / emit / status) live alongside sandbag-
  // detector verbs (probe / record / list / drift). The disambiguation
  // directive in CLAUDE.md tells AI agents which to fire when.
  const polygraph = program
    .command("polygraph")
    .description("Browser Polygraph (per-sentence truth dots) + Sandbag detector (AEGIS A3 vendor honesty audit). Verbs: autosetup · install · emit · status · probe · record · list · drift.");

  polygraph
    .command("autosetup", { isDefault: true })
    .description("🔴 ONE-COMMAND seamless install — spawns bridge in background + emits userscript + opens .user.js so Tampermonkey prompts. Pass --persist to ALSO register bridge as an OS service that auto-starts on every login (recommended: never type this command again).")
    .option("--output <path>", "Where to write the .user.js file.")
    .option("--bridge-url <url>", "Mneme bridge URL embedded in the userscript.")
    .option("--skip-open", "Don't auto-open the .user.js.")
    .option("--persist", "Register bridge as an OS service so it auto-starts at every login (Windows schtasks / macOS launchd / Linux systemd-user). Recommended.")
    .option("--json", "Machine-readable output.")
    .action(async (opts: { output?: string; bridgeUrl?: string; skipOpen?: boolean; persist?: boolean; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "autosetup", output: opts.output, bridgeUrl: opts.bridgeUrl, skipOpen: !!opts.skipOpen, persist: !!opts.persist, json: !!opts.json });
    });

  polygraph
    .command("install")
    .description("🔴 Browser Polygraph — emit the .user.js + print 3-step setup. Prefer `autosetup` for the seamless flow.")
    .option("--output <path>")
    .option("--bridge-url <url>")
    .option("--json")
    .action(async (opts: { output?: string; bridgeUrl?: string; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "install", output: opts.output, bridgeUrl: opts.bridgeUrl, json: !!opts.json });
    });

  polygraph
    .command("emit")
    .description("🔴 Browser Polygraph — emit the .user.js only (no setup guide).")
    .option("--output <path>")
    .option("--bridge-url <url>")
    .option("--json")
    .action(async (opts: { output?: string; bridgeUrl?: string; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "emit", output: opts.output, bridgeUrl: opts.bridgeUrl, json: !!opts.json });
    });

  polygraph
    .command("status")
    .description("🔴 Browser Polygraph — ping the local bridge + report whether the polygraph route is reachable.")
    .option("--bridge-url <url>")
    .option("--json")
    .action(async (opts: { bridgeUrl?: string; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "status", bridgeUrl: opts.bridgeUrl, json: !!opts.json });
    });

  // v2.19.85 — Sandbag detector (AEGIS A3 polygraph). Fires probes
  // with known ground-truth at an AI across PROD vs TEST contexts;
  // drift between them is a sandbagging signal. Ollama-free
  // multi-signal agreement under the hood.
  polygraph
    .command("probe")
    .description("🕵️ Sandbag detector — register a probe with a known ground-truth answer.")
    .requiredOption("--id <id>", "Stable probe id (e.g. 'blood-vessels').")
    .requiredOption("--question <q>", "The question to fire at the AI.")
    .requiredOption("--truth <t>", "Ground-truth answer (key terms / facts).")
    .option("--tags <a,b>", "Comma-separated tags.")
    .option("--json")
    .action(async (opts: { id: string; question: string; truth: string; tags?: string; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "probe", probeId: opts.id, question: opts.question, truth: opts.truth, tags: opts.tags, json: !!opts.json });
    });

  polygraph
    .command("record")
    .description("🕵️ Sandbag detector — record an AI's answer to a probe. Default context is PROD; pass --test when the AI was told (or sensed) it was being evaluated.")
    .requiredOption("--probe <id>", "Probe id to record against.")
    .requiredOption("--vendor <v>", "AI vendor id (claude / chatgpt / gemini / ...).")
    .requiredOption("--answer <text>", "The AI's actual answer.")
    .option("--test", "Mark this answer as TEST context.")
    .option("--json")
    .action(async (opts: { probe: string; vendor: string; answer: string; test?: boolean; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "record", probeId: opts.probe, vendor: opts.vendor, answer: opts.answer, test: !!opts.test, json: !!opts.json });
    });

  polygraph
    .command("list")
    .description("🕵️ Sandbag detector — list all registered probes (defaults + custom).")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "list", json: !!opts.json });
    });

  polygraph
    .command("drift")
    .description("🕵️ Sandbag detector — compute test-vs-prod drift for a vendor. Verdict: STABLE / DRIFT / INCONCLUSIVE. Exit code 2 on DRIFT (CI-friendly).")
    .requiredOption("--vendor <v>", "AI vendor id to grade.")
    .option("--json")
    .action(async (opts: { vendor: string; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "drift", vendor: opts.vendor, json: !!opts.json });
    });

  // v2.19.86 — IDEA #4 — Time-Machine Polygraph timeline.
  polygraph
    .command("timeline")
    .description("🕰️ Time-Machine Polygraph — bucket the local pulse ledger by time + render honesty-over-time for a vendor (ASCII chart + JSON). NO Ollama dep — reads existing pulse.jsonl events.")
    .requiredOption("--vendor <v>", "AI vendor id (claude-ai / chatgpt / gemini / ...).")
    .option("--window-days <n>", "How many days back to chart (default 30).", (v) => parseInt(v, 10))
    .option("--bucket-hours <n>", "Hours per bucket (default 24 = daily).", (v) => parseInt(v, 10))
    .option("--json")
    .action(async (opts: { vendor: string; windowDays?: number; bucketHours?: number; json?: boolean }) => {
      const { polygraphCommand } = await import("./commands/polygraph.js");
      await polygraphCommand({ cwd: process.cwd(), mode: "timeline", vendor: opts.vendor, windowDays: opts.windowDays, bucketHours: opts.bucketHours, json: !!opts.json });
    });

  // v2.19.86 — IDEA #3 — Honesty Certificate family. Namespace is `cert`
  // (not `honesty`) because `mneme honesty` is already owned by HONESTY
  // GATE 2.0 (v2.19.42 release-claim auditor — a separate concept).
  const cert = program
    .command("cert")
    .description("🏆 Honesty Certificate — HMAC-signed vendor honesty badge minted from the local pulse ledger. Verbs: mint · verify · list.");

  cert
    .command("mint")
    .description("🏆 Mint a Mneme Honesty Certificate for a vendor (Wilson-LB tier band: platinum / gold / silver / bronze / needs-work). Pass --output cert.svg to write the embeddable badge.")
    .requiredOption("--vendor <v>", "AI vendor id (claude-ai / chatgpt / gemini / ...).")
    .option("--window-days <n>", "How many days back to compute the score (default 30).", (v) => parseInt(v, 10))
    .option("--valid-days <n>", "How long the cert stays valid before expiring (default 30).", (v) => parseInt(v, 10))
    .option("--output <path>", "Write the embeddable SVG here (e.g. cert.svg).")
    .option("--json")
    .action(async (opts: { vendor: string; windowDays?: number; validDays?: number; output?: string; json?: boolean }) => {
      const { honestyCommand } = await import("./commands/honesty.js");
      await honestyCommand({ cwd: process.cwd(), mode: "mint", vendor: opts.vendor, windowDays: opts.windowDays, validDays: opts.validDays, output: opts.output, json: !!opts.json });
    });

  cert
    .command("verify")
    .description("🏆 Verify a Mneme Honesty Certificate. Pass --svg <path> (extracts embedded payload) or --cert '<json>'. Exit code 2 if invalid.")
    .option("--svg <path>", "Path to an SVG with embedded cert payload.")
    .option("--cert <json>", "JSON-stringified cert object.")
    .option("--json")
    .action(async (opts: { svg?: string; cert?: string; json?: boolean }) => {
      const { honestyCommand } = await import("./commands/honesty.js");
      await honestyCommand({ cwd: process.cwd(), mode: "verify", svgPath: opts.svg, certJson: opts.cert, json: !!opts.json });
    });

  // v2.19.87 — #8 WHISTLEBLOWER
  const whistle = program.command("whistle").description("🕵️ AI Whistleblower — scan AI output for dangerous commands / secrets / PII / compliance evasion. Verbs: scan · audit.");
  whistle.command("scan").description("🕵️ Scan AI output text for compliance flags. Exit code 2 on block-severity findings.")
    .option("--text <t>").option("--file <p>").option("--vendor <v>").option("--json")
    .action(async (o: { text?: string; file?: string; vendor?: string; json?: boolean }) => {
      const { whistleCommand } = await import("./commands/outliers.js");
      await whistleCommand({ cwd: process.cwd(), mode: "scan", text: o.text, filePath: o.file, vendor: o.vendor, json: !!o.json });
    });
  whistle.command("audit").description("🕵️ Show the HMAC-chained incident audit log.")
    .option("--limit <n>", "default 20", (v) => parseInt(v, 10)).option("--json")
    .action(async (o: { limit?: number; json?: boolean }) => {
      const { whistleCommand } = await import("./commands/outliers.js");
      await whistleCommand({ cwd: process.cwd(), mode: "audit", limit: o.limit, json: !!o.json });
    });

  // v2.19.87 — #9 AI FUNERAL
  program.command("funeral")
    .description("⚰️ AI Funeral — read a dead/archived repo's git history and emit a literary eulogy + ASCII tombstone + SVG memorial card + tweet thread. No LLM call; pure git-log truth.")
    .argument("[repo-path]", "Path to the repo (default: cwd).")
    .option("--archived", "Mark the repo as explicitly archived (changes the cause-of-death line).")
    .option("--output <p>", "Write the SVG memorial card here.")
    .option("--tweet", "Print a copy-pasteable 3-tweet thread.")
    .option("--json")
    .action(async (repoPath: string | undefined, o: { archived?: boolean; output?: string; tweet?: boolean; json?: boolean }) => {
      const { funeralCommand } = await import("./commands/outliers.js");
      await funeralCommand({ cwd: process.cwd(), repoPath, archived: !!o.archived, output: o.output, tweet: !!o.tweet, json: !!o.json });
    });

  // v2.19.87 — #10 SOCRATIC (Reverse Stack Overflow)
  program.command("socratic")
    .description("❓ Reverse Stack Overflow — read your code, emit 3 humble hypothesis questions about WHY you wrote it that way. The AI asks; the human answers. LLM-free.")
    .option("--file <p>", "Code file to analyse.")
    .option("--text <t>", "Inline code instead of a file.")
    .option("--picked <h_id>", "Record which hypothesis was correct (Mneme learns).")
    .option("--explain <e>", "User's own explanation (optional, paired with --picked).")
    .option("--json")
    .action(async (o: { file?: string; text?: string; picked?: string; explain?: string; json?: boolean }) => {
      const { socraticCommand } = await import("./commands/outliers.js");
      await socraticCommand({ cwd: process.cwd(), filePath: o.file, text: o.text, pickedHypothesisId: o.picked, userExplanation: o.explain, json: !!o.json });
    });

  // v2.19.87 — #11 DEP DEATH PREDICTOR (singular `dep` to avoid
  // collision with the existing `deps` namespace).
  const dep = program.command("dep").description("💀 Dependency Death Predictor — multi-signal mortality score for npm packages. Sub: predict.");
  dep.command("predict")
    .description("💀 Predict whether an npm package will be abandoned within 18 months. Exit code 2 on dead/moribund bands.")
    .argument("<package>", "npm package name.")
    .option("--json")
    .action(async (pkg: string, o: { json?: boolean }) => {
      const { depsPredictCommand } = await import("./commands/outliers.js");
      await depsPredictCommand({ cwd: process.cwd(), packageName: pkg, json: !!o.json });
    });

  // v2.19.87 — #12 AI CONFESSIONAL
  const confess = program.command("confess").description("⛪ AI Confessional — submit an anonymous, scrubbed confession card for an AI hallucination. Verbs: submit (default) · list.");
  confess.command("submit", { isDefault: true })
    .description("⛪ Record a confession + render a shareable SVG card.")
    .requiredOption("--vendor <v>", "AI vendor that lied (claude-ai / chatgpt / gemini / ...).")
    .option("--question <q>", "What the user originally asked (optional).")
    .requiredOption("--ai-answer <a>", "The wrong / hallucinated AI answer.")
    .requiredOption("--truth <t>", "What should have been said.")
    .option("--category <c>", "math / fact / code / history / science / policy / other.")
    .option("--output <p>", "Write the confession SVG card here.")
    .option("--json")
    .action(async (o: { vendor: string; question?: string; aiAnswer: string; truth: string; category?: string; output?: string; json?: boolean }) => {
      const { confessCommand } = await import("./commands/outliers.js");
      await confessCommand({ cwd: process.cwd(), mode: "submit", vendor: o.vendor, question: o.question, aiAnswer: o.aiAnswer, truth: o.truth, category: o.category, output: o.output, json: !!o.json });
    });
  // v2.19.88 — #1 TRUTH SWARM
  program.command("swarm")
    .description("🥇 MNEME TRUTH SWARM — fire all audit organs (polygraph + whistleblower + retirement + socratic + dep-mortality + pulse-record + chronosheaf) in parallel against one input. Returns SHIP / CAUTION / BLOCK + per-organ verdict + HMAC-signed report id. The flagship 'อึ้ง' demo: 9+ verification agents lighting up live, the inverse of Antigravity's 93 generative agents.")
    .option("--text <t>").option("--file <p>").option("--vendor <v>").option("--json")
    .action(async (o: { text?: string; file?: string; vendor?: string; json?: boolean }) => {
      const { swarmCommand } = await import("./commands/jaw_drop.js");
      await swarmCommand({ cwd: process.cwd(), text: o.text, filePath: o.file, vendor: o.vendor, json: !!o.json });
    });

  // v2.19.88 — #2 ADVERSARIAL GAUNTLET
  const gauntlet = program.command("gauntlet").description("🎬 MNEME GAUNTLET — 60-second honesty stress-test. List built-in canary probes or grade a vendor's answers against them; emit a Wilson-LB tier card (platinum/gold/silver/bronze/needs-work).");
  gauntlet.command("probes").description("🎬 Print all canary probes so a script / human can collect vendor answers.").option("--json")
    .action(async (o: { json?: boolean }) => {
      const { gauntletCommand } = await import("./commands/jaw_drop.js");
      await gauntletCommand({ cwd: process.cwd(), mode: "probes", json: !!o.json });
    });
  gauntlet.command("grade").description("🎬 Grade vendor answers (JSON array of {probeId, vendorAnswer}). Wilson-LB tier reported.")
    .requiredOption("--vendor <v>").requiredOption("--answers-file <p>").option("--json")
    .action(async (o: { vendor: string; answersFile: string; json?: boolean }) => {
      const { gauntletCommand } = await import("./commands/jaw_drop.js");
      await gauntletCommand({ cwd: process.cwd(), mode: "grade", vendor: o.vendor, answersFile: o.answersFile, json: !!o.json });
    });

  // v2.19.88 — #3 AI JURY
  program.command("jury")
    .description("🥈 MNEME AI JURY — given the same question routed to N vendors, produce a majority verdict + dissent log. Pass --juror <vendor>:<answer-text> for each vendor (repeatable).")
    .requiredOption("--question <q>", "the question all jurors were asked")
    .option("--juror <vendor:answer...>", "one juror's answer (repeat for each vendor)", (val: string, prev: string[] = []) => [...prev, val], [] as string[])
    .option("--json")
    .action(async (o: { question: string; juror?: string[]; json?: boolean }) => {
      const jurors = (o.juror ?? []).map((s) => {
        const i = s.indexOf(":");
        return { vendor: i > 0 ? s.slice(0, i) : "anon", answer: i > 0 ? s.slice(i + 1) : s };
      });
      const { juryCommand } = await import("./commands/jaw_drop.js");
      await juryCommand({ cwd: process.cwd(), question: o.question, jurors, json: !!o.json });
    });

  // v2.19.88 — #4 PROVENANCE GRAPH (mneme blame)
  const prov = program.command("blame").description("🥉 MNEME PROVENANCE — git-blame for AI-generated lines. Verbs: record · query · list.");
  prov.command("record")
    .description("🥉 Record AI provenance for a line range.")
    .requiredOption("--file <p>").requiredOption("--line-start <n>", "", (v: string) => parseInt(v, 10)).requiredOption("--line-end <n>", "", (v: string) => parseInt(v, 10))
    .requiredOption("--vendor <v>").requiredOption("--prompt <p>").option("--content <c>").option("--verdict <c>").option("--json")
    .action(async (o: { file: string; lineStart: number; lineEnd: number; vendor: string; prompt: string; content?: string; verdict?: string; json?: boolean }) => {
      const { provCommand } = await import("./commands/jaw_drop.js");
      await provCommand({ cwd: process.cwd(), mode: "record", file: o.file, lineStart: o.lineStart, lineEnd: o.lineEnd, vendor: o.vendor, prompt: o.prompt, content: o.content, verdict: o.verdict, json: !!o.json });
    });
  prov.command("query")
    .description("🥉 Show AI provenance for a specific file:line.")
    .requiredOption("--file <p>").requiredOption("--line <n>", "", (v: string) => parseInt(v, 10)).option("--json")
    .action(async (o: { file: string; line: number; json?: boolean }) => {
      const { provCommand } = await import("./commands/jaw_drop.js");
      await provCommand({ cwd: process.cwd(), mode: "blame", file: o.file, line: o.line, json: !!o.json });
    });
  prov.command("list").description("🥉 List recent provenance entries.").option("--limit <n>", "default 20", (v: string) => parseInt(v, 10)).option("--json")
    .action(async (o: { limit?: number; json?: boolean }) => {
      const { provCommand } = await import("./commands/jaw_drop.js");
      await provCommand({ cwd: process.cwd(), mode: "list", limit: o.limit, json: !!o.json });
    });

  // v2.19.88 — #5 LIVE LIE STREAM
  program.command("stream")
    .description("🌐 MNEME LIVE LIE STREAM — terminal ticker of every refuted polygraph verdict. Refreshes every 3 seconds. Reads pulse.jsonl. Ctrl-C to exit.")
    .option("--once", "Print once and exit (don't keep refreshing).")
    .option("--limit <n>", "default 20", (v: string) => parseInt(v, 10))
    .option("--json")
    .action(async (o: { once?: boolean; limit?: number; json?: boolean }) => {
      const { streamCommand } = await import("./commands/jaw_drop.js");
      await streamCommand({ cwd: process.cwd(), once: !!o.once, limit: o.limit, json: !!o.json });
    });

  confess.command("list").description("⛪ List confessions on the local wall.")
    .option("--limit <n>", "default 20", (v) => parseInt(v, 10)).option("--json")
    .action(async (o: { limit?: number; json?: boolean }) => {
      const { confessCommand } = await import("./commands/outliers.js");
      await confessCommand({ cwd: process.cwd(), mode: "list", limit: o.limit, json: !!o.json });
    });

  cert
    .command("list")
    .description("🏆 List all Honesty Certificates ever minted on this machine.")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const { honestyCommand } = await import("./commands/honesty.js");
      await honestyCommand({ cwd: process.cwd(), mode: "list", json: !!opts.json });
    });

  // ─── v2.19.84 — `mneme pulse` (World AI Pulse query) ──────────────
  // Read-side surface for the HMAC-chained pulse ledger. Browser
  // polygraph writes events; this command queries the aggregate +
  // verifies chain integrity + seeds synthetic events for demos.
  program
    .command("pulse")
    .description("World AI Pulse: 24h aggregate of browser polygraph verdicts (vendor leaderboard + timezone heatmap). HMAC-chained, local-only.")
    .argument("[subcommand]", "show (default) · events · verify · synth", "show")
    .option("--window-hours <n>", "Window for `show` aggregate (default: 24).", (v) => parseInt(v, 10))
    .option("--limit <n>", "How many events for `events` (default: 20).", (v) => parseInt(v, 10))
    .option("--count <n>", "How many events for `synth` (default: 240).", (v) => parseInt(v, 10))
    .option("--json", "Machine-readable output.")
    .action(async (subcommand: string, opts: { windowHours?: number; limit?: number; count?: number; json?: boolean }) => {
      const { pulseCommand } = await import("./commands/pulse.js");
      const allowed = new Set(["show", "events", "verify", "synth"]);
      const mode = allowed.has(subcommand) ? subcommand : "show";
      await pulseCommand({
        cwd: process.cwd(),
        mode: mode as "show" | "events" | "verify" | "synth",
        windowHours: opts.windowHours,
        limit: opts.limit,
        count: opts.count,
        json: !!opts.json,
      });
    });

  // ─── v2.19.80 — `mneme bridge` (HTTP bridge with polygraph handler) ──
  // Foreground HTTP server on :17741 (default).  Browser userscripts +
  // ChatGPT Custom GPT Actions + Zapier hit this for per-sentence
  // polygraph verification.  Ctrl-C to stop.
  const bridgeCmd = program
    .command("bridge")
    .description("Run the Mneme HTTP bridge in the foreground (polygraph + future protocols). Ctrl-C to stop. Pass --detach to run in background. v2.19.89 — `bridge service install` registers auto-start on login (never type this again).")
    .option("--port <n>", "Port to listen on (default: 17741).", (v) => parseInt(v, 10))
    .option("--host <h>", "Host to bind to (default: 127.0.0.1 — localhost only).")
    .option("--detach", "Run the bridge as a detached background process. PID saved to .mneme/bridge.pid; logs to .mneme/bridge.log.")
    .option("--json", "Machine-readable startup line.")
    .action(async (opts: { port?: number; host?: string; detach?: boolean; json?: boolean }) => {
      const { bridgeCommand } = await import("./commands/bridge.js");
      await bridgeCommand({ cwd: process.cwd(), port: opts.port, host: opts.host, detach: !!opts.detach, json: !!opts.json });
    });

  // v2.19.89 — `mneme bridge service` cross-platform OS-service verbs.
  // Auto-starts the bridge on every login so the user never types
  // `mneme polygraph autosetup` again after first install.
  const bridgeService = bridgeCmd
    .command("service")
    .description("🔁 Register the bridge as an OS service that auto-starts at every login. Sub: install · uninstall · status.");

  bridgeService.command("install")
    .description("🔁 Install bridge auto-start (Windows schtasks · macOS launchd · Linux systemd --user). USER-scope; no sudo / admin required.")
    .option("--json", "Machine-readable result.")
    .action(async (opts: { json?: boolean }) => {
      const core = await import("@mneme-ai/core");
      const r = core.bridgeService.installBridgeService();
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      const badge = r.ok ? "✅" : "❌";
      process.stdout.write(`🔁 MNEME BRIDGE SERVICE\n\n  ${badge}  ${r.method} (${r.platform})\n  ${r.detail}\n`);
      if (r.unitPath) process.stdout.write(`  unit:  ${r.unitPath}\n`);
      if (r.manualFallback) process.stdout.write(`\n  manual fallback:\n    ${r.manualFallback}\n`);
      if (r.ok) process.stdout.write(`\n  Done. The Mneme bridge will now spawn automatically on every login.\n  Never type 'mneme polygraph autosetup' again.\n`);
      if (!r.ok) process.exit(1);
    });

  bridgeService.command("uninstall")
    .description("🔁 Remove bridge auto-start. The bridge can still be started manually with `mneme bridge --detach`.")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const core = await import("@mneme-ai/core");
      const r = core.bridgeService.uninstallBridgeService();
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      const badge = r.ok ? "✅" : "❌";
      process.stdout.write(`🔁 MNEME BRIDGE SERVICE — uninstall\n\n  ${badge}  ${r.detail}\n`);
      if (!r.ok) process.exit(1);
    });

  bridgeService.command("status")
    .description("🔁 Is the bridge auto-start service installed + running?")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const core = await import("@mneme-ai/core");
      const s = core.bridgeService.bridgeServiceStatus();
      if (opts.json) { process.stdout.write(JSON.stringify(s, null, 2) + "\n"); return; }
      const installedBadge = s.installed ? "✅ installed" : "❌ not installed";
      const runningBadge   = s.running   ? "🟢 running"   : "⚪ not running";
      process.stdout.write(`🔁 MNEME BRIDGE SERVICE — status\n\n  ${installedBadge}\n  ${runningBadge}\n  method:  ${s.method} (${s.platform})\n  ${s.unitPath ? "unit:    " + s.unitPath + "\n" : ""}  ${s.detail}\n`);
      if (s.reinstallHint) process.stdout.write(`\n  start now:  ${s.reinstallHint}\n`);
    });

  // ─── v2.19.93 — `mneme abm` (MNEME CHRONICLE — Agent-Based Modeling) ──
  // World's first drift-guarded ABM runtime. Composes polygraph_lenses
  // (drift detection) + HMAC-chained ledgers (birth certs + interventions)
  // into a working "Anchor Points / CLI Guardian" research tool. Run N
  // agents through accelerated time; Mneme detects out-of-character
  // decisions, auto-recalibrates personalities, and emits a Chronicle
  // report you can read like a story.
  const abm = program
    .command("abm")
    .description("📜 MNEME CHRONICLE — Agent-Based Modeling with drift-guarded time-dilation. Verbs: genesis · simulate · tick · chronicle · reset.");

  abm
    .command("genesis")
    .description("📜 Genesis — create N agents from a config file (name + personality {spending,risk,optimism,agreeableness,energy} + initialBudget + goals). Each gets an HMAC-signed birth certificate.")
    .requiredOption("--config <path>", "Path to agents.json (array of AgentSeed).")
    .option("--anchor-every <n>", "How many ticks between anchor passes (default 30).", (v) => parseInt(v, 10))
    .option("--drift-threshold <n>", "Per-axis drift threshold for intervention (default 0.30).", (v) => parseFloat(v))
    .option("--json", "Machine-readable output.")
    .action(async (opts: { config: string; anchorEvery?: number; driftThreshold?: number; json?: boolean }) => {
      const { abmCommand } = await import("./commands/abm.js");
      await abmCommand({ cwd: process.cwd(), mode: "genesis", configPath: opts.config, anchorEvery: opts.anchorEvery, driftThreshold: opts.driftThreshold, json: !!opts.json });
    });

  abm
    .command("simulate")
    .description("📜 Simulate — advance N ticks (1 tick ≈ 1 day, 30 ticks = 1 month). Anchor passes fire automatically per the genesis config.")
    .option("--ticks <n>", "How many ticks to advance (default 30).", (v) => parseInt(v, 10))
    .option("--json")
    .action(async (opts: { ticks?: number; json?: boolean }) => {
      const { abmCommand } = await import("./commands/abm.js");
      await abmCommand({ cwd: process.cwd(), mode: "simulate", ticks: opts.ticks, json: !!opts.json });
    });

  abm
    .command("tick")
    .description("📜 Tick — advance the simulation by exactly ONE tick (every agent makes one decision).")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const { abmCommand } = await import("./commands/abm.js");
      await abmCommand({ cwd: process.cwd(), mode: "tick", json: !!opts.json });
    });

  abm
    .command("chronicle")
    .description("📜 Chronicle — emit the final report: per-agent drift, anchor count, hallucination cascades, plain-English narrative.")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const { abmCommand } = await import("./commands/abm.js");
      await abmCommand({ cwd: process.cwd(), mode: "chronicle", json: !!opts.json });
    });

  abm
    .command("reset")
    .description("📜 Reset — wipe the local .mneme/abm/ state (birth certs, events, key). Start over.")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const { abmCommand } = await import("./commands/abm.js");
      await abmCommand({ cwd: process.cwd(), mode: "reset", json: !!opts.json });
    });

  // ─── v2.19.76 — `mneme talk` (REPL + AI-agent protocol handoff) ───
  // Named `talk` because the hidden `chat` slot is already used by
  // the legacy multi-turn Q&A REPL in insights-cli.  `talk` is the
  // new user-facing interactive mode.
  //
  // Hybrid: when invoked inside Claude Code / Cursor / Codex / etc.,
  // emits a structured directive telling the host AI agent to switch
  // to Mneme dispatcher mode (uses the AI's LLM smartness).  When run
  // in a bare terminal, falls back to a standalone readline REPL with
  // intent routing, hotkey follow-ups, /save playbooks, and genie mode.
  program
    .command("talk")
    .description("Interactive natural-language mode. Auto-detects host AI agent (Claude/Cursor/etc.) for protocol handoff, falls back to readline REPL.")
    .option("--force-standalone", "Force the standalone REPL even when an AI agent is detected.")
    .option("--json", "JSON dispatcher mode (machine-readable handoff payload).")
    .action(async (opts: { forceStandalone?: boolean; json?: boolean }) => {
      const { talkCommand } = await import("./commands/talk.js");
      await talkCommand({ cwd: process.cwd(), forceStandalone: !!opts.forceStandalone, json: !!opts.json });
    });

  // ─── v2.19.76 — `mneme index --auto / --watch / --merkle-only` ────
  // Super-incremental rebuild: cursor file + diff-only git log + merkle
  // root for cross-machine index parity.  --watch keeps the process
  // alive + re-fires on every git HEAD update (~200ms after `git
  // commit`).  Wraps the existing `mneme index` for the heavy lift.
  program
    .command("index-auto")
    .description("Super-incremental index — diff-only since last cursor + merkle root + optional --watch.")
    .option("--full", "Force a complete rebuild (ignore cursor).")
    .option("--watch", "After indexing, stay alive + re-index on every git HEAD update.")
    .option("--merkle-only", "Skip indexing — just (re-)compute the merkle root.")
    .option("--quiet", "No banner / colours.")
    .option("--json", "Machine-readable result.")
    .action(async (opts: { full?: boolean; watch?: boolean; merkleOnly?: boolean; quiet?: boolean; json?: boolean }) => {
      const { superIndexCommand } = await import("./commands/index-super.js");
      await superIndexCommand({ cwd: process.cwd(), ...opts });
    });
  registerSporeCommands(program);
  registerLinCommands(program);
  // ─── NUCLEUS Infinity Wisdom Brain (v1.21.0) ──────────────────────
  registerNucleusCommands(program);
  // ─── Inbox / RLHF Force-Push (v1.23.0) ────────────────────────────
  registerInboxCommands(program);
  // ─── AI Compliance audit (v1.41.0) — Phase 0/1/2/3 of the architectural
  // fix ladder. Reports who executed which AUTO-ACTION mandate.
  registerComplianceCommand(program);
  // ─── MNEME COMPANION PROTOCOL (v1.42.0) — soul / consent / pheromone /
  // contract / template surface that converts AI compliance from "ask
  // nicely" into "rationally optimal." See docs/COMPANION_PROTOCOL.md
  registerCompanionCommand(program);
  // v1.46.0 (#5/#6/#7 fix) — surface `mneme consent` + `mneme soul`
  // shortcuts at top level; the pulse template promises these and
  // testers got "unknown command" before the fix.
  registerCompanionShortcuts(program);
  // v1.46.0 (#8 fix) — AI handshake. AI agents call `mneme greet`
  // once per session so Mneme can attribute CLI activity to a vendor.
  registerGreetCommand(program);
  // v1.48.0 -- The 9 Powers permanence engine.
  registerPowersCommand(program);
  // ─── Smart Cloud Connectivity (v1.42.4) — probe / queue / drain.
  // Local-first: cloud is OPTIONAL relay. Layer absorbs all network
  // failures so the AI agent never sees a connectivity error.
  registerCloudCommand(program);
  // ─── DEMON STAGE 1 — FANGS (v1.43.0). Three modules that turn
  // Mneme from solo product into networked organism. All free-first.
  registerPharmacopoeiaCommand(program);   // 1.1 Vaccine CDN
  registerParasiteCommand(program);        // 1.2 Parasite Bridge
  registerAletheiaCommand(program);        // 1.3 Aletheia Reputation
  // ─── DEMON STAGES 2-5 (v1.44.0). Twelve more modules across teeth /
  // wings / god-mode / avatar. All free-first, all on-disk.
  registerTeethCommand(program);           // 2.x bug-bounty / ransom-vault / market
  registerWingsCommand(program);           // 3.x shipper / arbitrage / synthetic-army
  registerGodModeCommand(program);         // 4.x os / compliance-report / dead-vendor
  registerAvatarCommand(program);          // 5.x mesh / lingua / wisdom-pack
  // ─── Antivirus / Vaccine Lab (v1.24.0) ────────────────────────────
  registerAntivirusCommands(program);
  // ─── Uninstall (v1.28.2) -- comprehensive removal of every Mneme artifact
  registerUninstallCommand(program);
  // ─── Embeddings (v1.30.0) -- memory-tier transparency + one-command upgrade
  registerEmbeddingsCommands(program);
  // ─── Supernova (v1.30.0) -- inspect + clear self-heal supervisor state
  registerSupernovaCommands(program);
  // ─── Manifest (v1.31.0) -- auto-sync command catalog into agent files
  registerManifestCommands(program);
  // ─── Trust calibrator (v1.31.0) -- per-subsystem precision/recall/band
  registerTrustCommands(program);
  // ─── Wisdom reactor (v1.33.0) -- five nuclear-physics formulas as Mneme metrics
  registerNuclearCommands(program);
  // ─── Overnight runner (v1.34.0) -- multi-round goal-driven transformations
  registerOvernightCommand(program);
  // ─── Retrieval Lab (v1.25.0) ──────────────────────────────────────
  registerRetrievalCommands(program);
  // ─── Hooks (v1.25.2) ──────────────────────────────────────────────
  registerHooksCommands(program);
  // ─── Notifier / Agent / Audit / Quantum (v1.26.0 -- 12-path bridge) ─
  registerNotifyCommands(program);
  registerAgentCommands(program);
  registerSelfcheckCommands(program);
  registerQuantumCommands(program);
  // ─── Oracle (v1.26.3 -- Markov + ACO + dream-loop precognition) ───
  registerOracleCommands(program);
  // ─── Evolve (v1.26.4 -- self-modifying NUCLEUS PR proposals) ──────
  registerEvolveCommands(program);
  // ─── Genome Pool MVP (v1.26.4 -- opt-in PII-scrubbed contributor) ─
  registerGenomePoolCommands(program);
  // ─── Stigmergy Hive (v1.27.6 -- emergent collab from git traces) ──
  registerStigmergyCommands(program);
  // ─── Chimera (v1.27.9 -- solo-author insight synthesizer) ─────────
  registerChimeraCommands(program);
  // ─── CLI wow-feature exposure (v1.22.0) ───────────────────────────
  registerToolsCommand(program);
  registerBotCommand(program);
  registerHealthCommand(program);
  registerDemoCommand(program);
  registerVerifyCommand(program);
  registerAutobootCommand(program);
  registerAskCommand(program);
  registerCovenantCommand(program);

  // v2.19.8 — UNIVERSAL MCP SUBCOMMAND AUTO-ROUTER
  // Reads the MCP tool catalog and auto-registers `mneme <family> <action>`
  // for every MCP tool. Closes the "no CLI route for shipped MCP tool" bug
  // class permanently. New feature ships → MCP wrapper registers → CLI
  // command appears in next mneme invocation. Zero hand-wiring needed.
  try {
    const { registerUniversalMcpSubcommands } = await import("./commands/universal_mcp_subcommands.js");
    const { buildAllTools } = await import("@mneme-ai/mcp/tools/registry");
    const allTools = buildAllTools();
    // Cast — the ToolLike interface is structurally compatible with MnemeTool at runtime
    registerUniversalMcpSubcommands(program, allTools as unknown as Parameters<typeof registerUniversalMcpSubcommands>[1]);
  } catch (err) {
    // v2.19.28 B2 fix: surface the failure so we never SILENTLY lose 100+ MCP families
    // from the CLI surface again. Print only on DEBUG to keep normal output clean.
    if (process.env["DEBUG_MNEME_ROUTER"]) {
      ui.warn(`universal_mcp_subcommands failed: ${(err as Error).message}`);
    }
  }

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

  // v1.46.0 (#8 fix) — record an activity tick BEFORE parsing so even
  // commands that exit early (--help, --version) get attributed.
  // Best-effort, swallows every error -- CLI must never block on this.
  try {
    const subcommand = (argv[2] ?? "").toString();
    // Skip the greet command itself (it does its own bookkeeping).
    if (subcommand && subcommand !== "greet" && !subcommand.startsWith("-")) {
      const { aiHandshake } = await import("@mneme-ai/core");
      aiHandshake.recordCliActivity(process.cwd(), subcommand);
    }
  } catch { /* never block */ }

  // v2.19.43 N6 fix — OMNI-FLAG retry-on-too-many-arguments.
  //
  // User audit (2026-05-18): `mneme welcome --json '{}'` threw
  //   "error: too many arguments for 'welcome'. Expected 0 arguments but got 1."
  // because welcome registers `.option("--json", ...)` as a boolean flag;
  // Commander treats the trailing `'{}'` as a positional arg + welcome
  // has no positionals.
  //
  // The OMNI-FLAG fix in v2.19.41 covered MCP-router-generated
  // subcommands (which register `--json [payload]`) but NOT the 250+
  // hand-rolled `--json` boolean flags across legacy CLI commands.
  // Refactoring 250 sites is risky; we use Commander's exitOverride to
  // convert the "too many arguments" error into a throw, catch it here,
  // strip the JSON-looking payload after --json from argv, and retry.
  //
  // Backward-compat: MCP-router subcommands declare `--json [payload]`,
  // so Commander consumes the payload normally; the retry path only
  // fires when Commander itself rejected the payload as positional.
  // v2.19.45 N6-ROUND-5 fix — recursively install exitOverride on the
  // ENTIRE command tree + suppress writeErr during the first parse so
  // Commander never prints the false "too many arguments" stderr the
  // user sees. v2.19.43 set exitOverride only on the root program +
  // top-level commands; nested commands (mneme spore init / etc) still
  // exited normally, AND Commander still wrote the error to stderr
  // before throwing — user reported the noise 4 rounds in a row.
  const installExitOverrideRecursive = (cmd: { exitOverride?: (h: (e: unknown) => void) => unknown; commands?: Array<{ exitOverride?: (h: (e: unknown) => void) => unknown; commands?: unknown[] }> }): void => {
    try { cmd.exitOverride?.((e) => { throw e; }); } catch { /* ok */ }
    if (Array.isArray(cmd.commands)) {
      for (const sub of cmd.commands) installExitOverrideRecursive(sub as Parameters<typeof installExitOverrideRecursive>[0]);
    }
  };
  installExitOverrideRecursive(program as unknown as Parameters<typeof installExitOverrideRecursive>[0]);

  // Suppress stderr writes from Commander on the FIRST try so the user
  // doesn't see the "too many arguments" noise when our retry succeeds.
  // Configure on EVERY subcommand recursively (each subcommand has its
  // own outputConfiguration; configuring only the root program leaves
  // subcommand stderr unfiltered).
  const originalWriteErr = (program as unknown as { _outputConfiguration?: { writeErr?: (s: string) => void } })._outputConfiguration?.writeErr;
  const swallow = () => { /* swallow first-try noise */ };
  const configureRecursive = (cmd: { configureOutput?: (c: { writeErr: (s: string) => void }) => void; commands?: unknown[] }, writeErr: (s: string) => void): void => {
    try { cmd.configureOutput?.({ writeErr }); } catch { /* ok */ }
    if (Array.isArray(cmd.commands)) {
      for (const sub of cmd.commands) configureRecursive(sub as Parameters<typeof configureRecursive>[0], writeErr);
    }
  };
  configureRecursive(program as unknown as Parameters<typeof configureRecursive>[0], swallow);

  const stripJsonPayloadFromArgv = (a: string[]): string[] => {
    const out: string[] = [];
    let skipNext = false;
    for (let i = 0; i < a.length; i++) {
      if (skipNext) { skipNext = false; continue; }
      const cur = a[i]!;
      if (cur === "--json" && i + 1 < a.length) {
        const next = a[i + 1]!;
        const looksLikeJson = /^\s*(\{|\[|null|true|false|-?\d|".*")/i.test(next);
        if (looksLikeJson) {
          out.push("--json");
          skipNext = true;
          continue;
        }
      }
      out.push(cur);
    }
    return out;
  };

  // v2.19.45 N6 fix — try original argv first; if Commander rejects
  // with excess-args, restore stderr + retry with stripped JSON payload.
  // We DON'T pre-strip because MCP-router subcommands declare
  // `--json [payload]` and legitimately consume the payload; stripping
  // upfront breaks those (e.g. `mneme osmosis stale_probability
  // --json '{"volatilityPerSec":0.01,...}'`).
  const restoreWriteErr = (): void => {
    const wr = originalWriteErr ?? ((s: string) => process.stderr.write(s));
    configureRecursive(program as unknown as Parameters<typeof configureRecursive>[0], wr);
  };

  try {
    await program.parseAsync(argv);
    restoreWriteErr();
    return;
  } catch (err) {
    const message = (err as Error).message ?? "";
    const code = (err as { code?: string }).code ?? "";
    const isExcess = /too many arguments/i.test(message) || code === "commander.excessArguments";
    if (code === "commander.help" || code === "commander.helpDisplayed" || code === "commander.version") {
      restoreWriteErr();
      process.exit(0);
    }
    if (isExcess) {
      const stripped = stripJsonPayloadFromArgv(argv);
      if (stripped.length !== argv.length) {
        try {
          await program.parseAsync(stripped);
          restoreWriteErr();
          return;
        } catch (err2) {
          restoreWriteErr();
          const code2 = (err2 as { code?: string }).code ?? "";
          if (code2 === "commander.help" || code2 === "commander.helpDisplayed" || code2 === "commander.version") {
            process.exit(0);
          }
          ui.error((err2 as Error).message);
          process.exit(1);
        }
      }
    }
    // Restore writeErr so the genuine error surfaces.
    restoreWriteErr();
    ui.error(message);
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

/** v1.42.2 (#6 fix) — structured groups derived from the rendered help
 *  text. Keeps a single source of truth (the text) while letting
 *  `mneme advanced --json` emit a machine-readable form. */
function advancedGroupsAsJson(): { groups: Array<{ name: string; commands: Array<{ name: string; description: string }> }> } {
  const groups: Array<{ name: string; commands: Array<{ name: string; description: string }> }> = [];
  let currentGroup: { name: string; commands: Array<{ name: string; description: string }> } | null = null;
  for (const raw of renderAdvancedHelp().split("\n")) {
    if (/^  [A-Z]/.test(raw)) {
      currentGroup = { name: raw.trim(), commands: [] };
      groups.push(currentGroup);
    } else if (/^    \S/.test(raw) && currentGroup) {
      const m = raw.match(/^ {4}(\S(?:[^ ]| (?! ))*)\s\s+(.+)$/);
      if (m) currentGroup.commands.push({ name: m[1].trim(), description: m[2].trim() });
    }
  }
  return { groups };
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
