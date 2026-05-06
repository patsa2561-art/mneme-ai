/**
 * Sprint 5 CLI surface — Wall Street meets Git.
 *
 * Each command wraps a pure analyzer in @mneme-ai/core/quant with the
 * Mneme rendering style: section dividers, tier badges, plain-English
 * verdicts. All store-backed; no LLM calls.
 */

import { readFileSync } from "node:fs";
import kleur from "kleur";
import { git, store, util, quant } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import {
  ui,
  header,
  section,
  pill,
  meter,
  emptyState,
  nextSteps,
  sparkline,
} from "../ui.js";

async function withStore<T>(cwd: string, f: (s: store.MnemeStore) => Promise<T> | T): Promise<T | number> {
  if (!(await git.isGitRepo(cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }
  try {
    return await f(s);
  } finally {
    s.close();
  }
}

// ─── 1. drawdown ────────────────────────────────────────────────────────

export async function drawdownCommand(opts: { cwd: string; minLength?: number; json?: boolean }): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const drawdowns = quant.detectDrawdowns(commits, { minLength: opts.minLength ?? 3 });
    const summary = quant.summarizeDrawdowns(commits, drawdowns);
    return { drawdowns, summary };
  });
  if (typeof result === "number") return result;
  const { drawdowns, summary } = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ drawdowns, summary }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("📉", "Drawdowns — periods of pure firefighting",
    "consecutive `fix:`/revert windows that drained shipping velocity",
    "Find the worst weeks — when the team only fixed bugs instead of shipping. Reveals capacity drains before quarter planning.") + "\n\n");

  process.stdout.write(section("✦ Summary") + "\n\n");
  process.stdout.write(
    `    ${kleur.bold(String(summary.total))} drawdowns  ·  longest streak ${kleur.bold(String(summary.longestStreak))} commits  ·  ${kleur.bold(summary.totalFixingDays + "d")} firefighting\n`,
  );
  const ddPct = (summary.drawdownFraction * 100).toFixed(1);
  process.stdout.write(
    `    ${meter(Math.min(1, summary.drawdownFraction), { width: 16 })}  ${kleur.cyan(ddPct + "%")} ${kleur.gray(`(${ddPct}% of repo lifespan was firefighting, not shipping new value)`)}\n\n`,
  );

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• A")} ${kleur.bold("drawdown")} ${kleur.gray("is a streak of consecutive")} ${kleur.cyan("`fix:` / revert")} ${kleur.gray("commits — the team was firefighting, not shipping new value.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Longer streaks = bigger capacity drains. Use this before quarter planning to size hidden tax.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")} ${kleur.red("CRITICAL")} ${kleur.gray("(major outage-grade streak)  ·")} ${kleur.yellow("SEVERE")} ${kleur.gray("(week+ of pure fixing)  ·")} ${kleur.cyan("MODERATE")} ${kleur.gray("(noticeable drag)  ·")} ${kleur.gray("MINOR (small bump)")}\n\n`);

  if (drawdowns.length === 0) {
    process.stdout.write(emptyState(
      "Clean shipping history — no drawdowns detected.",
      [
        "Lower the threshold to surface borderline streaks: --min-length 2",
      ],
    ));
    return 0;
  }

  process.stdout.write(section("◆ Worst streaks", "(top 10 by length)") + "\n\n");
  for (const d of drawdowns.slice(0, 10)) {
    process.stdout.write(
      `    ${tierBadge(d.tier)} ${kleur.gray(tierBlurb(d.tier))}\n`,
    );
    process.stdout.write(
      `        ${kleur.bold(d.startDate)} → ${kleur.bold(d.endDate)}  ${kleur.gray(`(${d.length} consecutive fix/revert commits over ${d.durationDays} day${d.durationDays === 1 ? "" : "s"})`)}\n`,
    );
    // Hot files — most-touched files in this streak. Answers "WHERE was
    // the firefighting?" — more actionable than the commit subjects alone.
    if (d.hotFiles && d.hotFiles.length > 0) {
      process.stdout.write(`        ${kleur.cyan("hot files (the area that kept breaking):")}\n`);
      for (const hf of d.hotFiles) {
        process.stdout.write(
          `          ${kleur.bold(String(hf.count).padStart(3))}× ${kleur.white(hf.path)}\n`,
        );
      }
    }
    if (d.sampleFixes.length > 0) {
      process.stdout.write(`        ${kleur.gray("sample fixes:")}\n`);
      for (const fix of d.sampleFixes) process.stdout.write(`          ${kleur.gray("·")} ${fix}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(nextSteps([
    {
      cmd: `mneme alpha-rank --top 10`,
      why: `Find the people who consistently SHIP value vs the firefighters.`,
    },
    {
      cmd: `mneme vix`,
      why: `Measure the volatility of recent shipping cadence.`,
    },
  ]) + "\n\n");
  return 0;
}

function tierBadge(tier: string): string {
  switch (tier) {
    case "critical":
      return pill("CRITICAL", "critical");
    case "severe":
      return pill("SEVERE  ", "warn");
    case "moderate":
      return pill("MODERATE", "low");
    default:
      return pill("MINOR   ", "info");
  }
}

function tierBlurb(tier: string): string {
  switch (tier) {
    case "critical":
      return "— outage-grade streak; your team probably remembers this week";
    case "severe":
      return "— a week or more of pure fixing; review what slipped through";
    case "moderate":
      return "— noticeable drag on shipping; worth a postmortem skim";
    default:
      return "— small bump in fixing cadence; informational";
  }
}

// ─── 2. alpha (Kelly criterion) ────────────────────────────────────────

export async function alphaCommand(opts: {
  cwd: string;
  itemsFile?: string;
  budgetDays?: number;
  multiplier?: number;
  json?: boolean;
}): Promise<number> {
  if (!opts.itemsFile) {
    ui.error("`mneme alpha` requires --items <file.json> describing your debt portfolio.");
    ui.dim("Each item: { id, name, edge (0..1), variance (0..1), effortDays }");
    return 1;
  }
  let items: quant.DebtItem[];
  try {
    items = JSON.parse(readFileSync(opts.itemsFile, "utf8"));
    if (!Array.isArray(items)) throw new Error("expected array");
  } catch (err) {
    ui.error(`Cannot parse ${opts.itemsFile}: ${(err as Error).message}`);
    return 1;
  }

  const result = quant.kellyAllocate(items, {
    budgetDays: opts.budgetDays ?? 25,
    multiplier: opts.multiplier ?? 0.25,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("💰", "Technical Debt Portfolio (Kelly-optimal)",
    `budget ${result.budgetDays}d · ${result.kellyMultiplier}× Kelly · reserve ${result.reserveDays}d`,
    "Allocate dev-days to debt items by edge × variance — math says: don't bet everything on one big refactor.") + "\n\n");

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  const kMult = result.kellyMultiplier;
  const kPctLabel = kMult === 0.25 ? "Quarter-Kelly" : kMult === 0.5 ? "Half-Kelly" : kMult === 1 ? "Full-Kelly" : `${kMult}× Kelly`;
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold(kPctLabel)} ${kleur.gray(`(${kMult}× multiplier) — full-Kelly is theoretically optimal but high-variance; running at ${kMult}× is the conservative real-world choice.`)}\n`);
  process.stdout.write(`    ${kleur.gray("• Columns:")}\n`);
  process.stdout.write(`        ${kleur.cyan("Edge")}    ${kleur.gray("— expected payoff (0–100%); how confident we are this debt item pays off")}\n`);
  process.stdout.write(`        ${kleur.cyan("Var")}     ${kleur.gray("— variance / uncertainty (0–100%); higher = riskier estimate")}\n`);
  process.stdout.write(`        ${kleur.cyan("Kelly%")}  ${kleur.gray("— recommended fraction of your dev-day budget to spend on this item")}\n`);
  process.stdout.write(`        ${kleur.cyan("Days")}    ${kleur.gray("— concrete dev-days that fraction maps to")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")} ${kleur.green("⭐ outsized")} ${kleur.gray("(big bet)  ·")} ${kleur.cyan("● core")} ${kleur.gray("(steady)  ·")} ${kleur.gray("◐ small (token)  ·  ⊘ skip (math says don't fund)")}\n\n`);

  process.stdout.write(`  ${kleur.gray("Item".padEnd(40) + "Edge".padStart(8) + " " + "Var".padStart(7) + " " + "Kelly%".padStart(8) + " " + "Days".padStart(7))}\n`);
  process.stdout.write(`  ${kleur.gray("─".repeat(72))}\n`);
  for (const a of result.items) {
    const tierIcon = a.tier === "outsized" ? kleur.green("⭐") : a.tier === "core" ? kleur.cyan("●") : a.tier === "small" ? kleur.gray("◐") : kleur.gray("⊘");
    const name = a.name.length > 36 ? a.name.slice(0, 35) + "…" : a.name;
    process.stdout.write(
      `  ${tierIcon} ${name.padEnd(38)}${kleur.cyan((a.edge * 100).toFixed(0) + "%").padStart(8)} ${kleur.gray((a.variance * 100).toFixed(1) + "%").padStart(7)} ${kleur.bold((a.kellyFraction * 100).toFixed(0) + "%").padStart(8)} ${kleur.bold(a.allocatedDays + "d").padStart(7)}\n`,
    );
  }
  process.stdout.write(`\n  ${kleur.gray("Total allocated:")} ${kleur.bold(result.totalAllocated + "d")} of ${result.budgetDays}d ${kleur.gray(`(reserve: ${result.reserveDays}d held back for surprises)`)}\n\n`);
  return 0;
}

// ─── 3. backtest ────────────────────────────────────────────────────────

export async function backtestCommand(opts: { cwd: string; samplesFile?: string; json?: boolean }): Promise<number> {
  if (!opts.samplesFile) {
    ui.error("`mneme backtest` requires --samples <file.json>: array of { id, predicted, actual }.");
    return 1;
  }
  let samples: quant.BacktestSample[];
  try {
    samples = JSON.parse(readFileSync(opts.samplesFile, "utf8"));
  } catch (err) {
    ui.error(`Cannot parse ${opts.samplesFile}: ${(err as Error).message}`);
    return 1;
  }
  const result = quant.backtest(samples);
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🔬", "Backtest report", "did the predictions match reality?",
    "Score how well a forecast (e.g. who'll review which PR) matched what actually happened. Validates your retrieval edge.") + "\n\n");
  process.stdout.write(`  ${section("✦ Verdict")}  ${verdictBadge(result.verdict)} ${kleur.gray(verdictBlurb(result.verdict))}\n\n`);
  process.stdout.write(`    ${result.conclusion}\n\n`);

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("precision")} ${kleur.gray("— of the things we predicted, what fraction were right?")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("recall")} ${kleur.gray("   — of the things that actually happened, what fraction did we catch?")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("F1")} ${kleur.gray("       — combined precision + recall (0–1); higher is better")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("lift")} ${kleur.gray("     — how many times better than random guessing? 1.0× = no edge, 2.0× = twice as good")}\n\n`);

  process.stdout.write(section("◆ Metrics") + "\n\n");
  process.stdout.write(`    n         = ${kleur.bold(String(result.n))} ${kleur.gray("(samples evaluated)")}\n`);
  process.stdout.write(`    precision = ${kleur.bold((result.precision * 100).toFixed(1) + "%")} ${kleur.gray(`(when we predicted, we were right ${(result.precision * 100).toFixed(0)}% of the time)`)}\n`);
  process.stdout.write(`    recall    = ${kleur.bold((result.recall * 100).toFixed(1) + "%")} ${kleur.gray(`(we caught ${(result.recall * 100).toFixed(0)}% of true cases)`)}\n`);
  process.stdout.write(`    F1        = ${kleur.bold(result.f1.toFixed(2))} ${kleur.gray(`(${(result.f1 * 100).toFixed(0)}% — combined precision + recall score)`)}\n`);
  process.stdout.write(`    base rate = ${kleur.gray((result.baseRate * 100).toFixed(1) + "%")} ${kleur.gray("(what random guessing would score)")}\n`);
  process.stdout.write(`    lift      = ${kleur.cyan(result.lift.toFixed(2) + "×")} ${kleur.gray(`(predictions are ${result.lift.toFixed(1)}× better than random)`)}\n\n`);
  return 0;
}

function verdictBadge(v: string): string {
  switch (v) {
    case "strong-edge":
      return kleur.green().bold("● STRONG EDGE");
    case "real-edge":
      return kleur.cyan().bold("● REAL EDGE");
    case "weak":
      return kleur.yellow().bold("● WEAK");
    default:
      return kleur.gray().bold("○ NO EDGE");
  }
}

function verdictBlurb(v: string): string {
  switch (v) {
    case "strong-edge":
      return "✓ Strong predictive edge — clearly beats random, ship with confidence";
    case "real-edge":
      return "✓ Real predictive edge — not random, the model is doing useful work";
    case "weak":
      return "~ Weak signal — barely better than random; tune before relying on it";
    default:
      return "✗ No edge — predictions are no better than coin flips";
  }
}

// ─── 4. black-swan ──────────────────────────────────────────────────────

export async function blackSwanCommand(opts: { cwd: string; topN?: number; json?: boolean }): Promise<number> {
  const candidates = await withStore(opts.cwd, (s) => quant.findBlackSwans(s, { topN: opts.topN ?? 10 }));
  if (typeof candidates === "number") return candidates;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ candidates }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🦢", "Black Swans — rare-but-catastrophic file patterns",
    "files that touch many incidents per change · prioritize for hardening",
    "Spot the few files that quietly cause most outages — touch them rarely but blow up production. Harden these first.") + "\n\n");

  if (candidates.length === 0) {
    process.stdout.write(emptyState(
      "No black-swan candidates detected.",
      [
        "Black swans need linked incident data to surface.",
        "Ingest incidents: `mneme correlate --source pager --org <your-org>`",
        "Or one-shot import: `mneme correlate --source manual --file incidents.json`",
      ],
    ));
    return 0;
  }

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• A")} ${kleur.bold("black swan")} ${kleur.gray("is a file touched rarely — but every time someone does, an incident follows.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")}\n`);
  process.stdout.write(`        ${kleur.red("DECEPTIVE-CALM")} ${kleur.gray("— quiet now but historically catastrophic; investigate before the next change")}\n`);
  process.stdout.write(`        ${kleur.yellow("ELEVATED")}       ${kleur.gray("— recent incidents; harden actively")}\n`);
  process.stdout.write(`        ${kleur.cyan("WATCH")}          ${kleur.gray("— pattern emerging; keep an eye on it")}\n`);
  process.stdout.write(`        ${kleur.gray("BACKGROUND")}     ${kleur.gray("— informational; low priority")}\n\n`);

  for (const c of candidates) {
    process.stdout.write(`  ${blackSwanBadge(c.tier)}  ${kleur.bold(c.filePath)}\n`);
    const sevBlurb = c.avgSeverity >= 4 ? "most severe" : c.avgSeverity >= 3 ? "high severity" : c.avgSeverity >= 2 ? "moderate" : "low severity";
    process.stdout.write(
      `      ${kleur.gray("touches:")} ${c.touchCount} ${kleur.gray(`(times the file changed)`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("incidents:")} ${c.incidentCount} ${kleur.gray(`(${c.touchCount > 0 ? Math.round((c.incidentCount / c.touchCount) * 100) : 0}% of touches caused an incident)`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("avg severity:")} ${c.avgSeverity}/5 ${kleur.gray(`(average incident severity ${c.avgSeverity} out of 5 — ${sevBlurb})`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("days since touch:")} ${c.daysSinceTouch}d ${kleur.gray(`(${c.daysSinceTouch} days since last touch — vulnerability window ${c.daysSinceTouch > 90 ? "growing" : "fresh"})`)}\n`,
    );
    process.stdout.write(`      ${kleur.gray("→ " + c.recommendation)}\n\n`);
  }
  return 0;
}

function blackSwanBadge(tier: string): string {
  switch (tier) {
    case "deceptive-calm":
      return kleur.red().bold("⚠ DECEPTIVE-CALM");
    case "elevated":
      return kleur.yellow().bold("⚠ ELEVATED      ");
    case "watch":
      return kleur.cyan().bold("● WATCH         ");
    default:
      return kleur.gray().bold("○ BACKGROUND    ");
  }
}

// ─── 5. insider-trading ─────────────────────────────────────────────────

export async function insiderTradingCommand(opts: { cwd: string; windowDays?: number; minPatterns?: number; json?: boolean }): Promise<number> {
  const profiles = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return quant.detectInsiderTrading(commits, { windowDays: opts.windowDays, minPatterns: opts.minPatterns });
  });
  if (typeof profiles === "number") return profiles;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ profiles }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🎯", "Insider trading — authors who fix their own bugs",
    "shipped → fix-by-same-author within window · proxy for missing review",
    "See who keeps shipping then fixing their own code — a quiet sign that PR review is being skipped.") + "\n\n");

  if (profiles.length === 0) {
    process.stdout.write(emptyState(
      "No insider patterns detected.",
      [
        "Bugs are caught by reviewers, not authored fixes — healthy.",
        "Lower window: --window-days 14 to surface tighter loops.",
      ],
    ));
    return 0;
  }

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• A")} ${kleur.bold("pattern")} ${kleur.gray("= a developer ships a commit, then fixes it themselves shortly after.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Could mean: (a) lack of code review, (b) flaky test catching it later, or (c) intentional iteration.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")} ${kleur.red("HIGH PATTERN")} ${kleur.gray("(strong signal — review process likely broken)  ·")} ${kleur.yellow("ELEVATED")} ${kleur.gray("(noticeable habit)  ·")} ${kleur.cyan("WATCH")} ${kleur.gray("(early signal)")}\n\n`);

  for (const p of profiles) {
    const tier = p.tier === "high-pattern" ? kleur.red().bold("HIGH PATTERN") : p.tier === "elevated" ? kleur.yellow().bold("ELEVATED    ") : kleur.cyan().bold("WATCH       ");
    process.stdout.write(`  ${tier}  ${kleur.bold(p.authorName)}  ${kleur.gray(`<${p.authorEmail}>`)}\n`);
    process.stdout.write(
      `      ${kleur.gray("patterns:")} ${kleur.bold(String(p.patternCount))} ${kleur.gray(`(${p.patternCount} case${p.patternCount === 1 ? "" : "s"} where author shipped → fixed their own commit within window)`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("affected files:")} ${p.affectedFiles.length} ${kleur.gray("(distinct files involved across these patterns)")}\n`,
    );
    if (p.pairSuggestion) {
      process.stdout.write(`      ${kleur.cyan("→")} Pair with ${kleur.bold(p.pairSuggestion)} — they touch the same files without insider patterns.\n`);
    }
    if (p.hotFiles && p.hotFiles.length > 0) {
      process.stdout.write(`      ${kleur.cyan("hot files (where the pattern keeps recurring):")}\n`);
      for (const hf of p.hotFiles) {
        process.stdout.write(
          `        ${kleur.bold(String(hf.count).padStart(3))}× ${kleur.white(hf.path)}\n`,
        );
      }
    }
    for (const s of p.samples) {
      process.stdout.write(
        `        ${kleur.gray("·")} ${kleur.cyan(s.shipped.shortHash)} → ${kleur.cyan(s.fixed.shortHash)} ${kleur.gray(`(self-fixed ${s.daysToFix}d later)`)}: ${s.fixed.subject}\n`,
      );
    }
    process.stdout.write("\n");
  }
  return 0;
}

// ─── 6. moneyball ──────────────────────────────────────────────────────

export async function moneyballCommand(opts: { cwd: string; topN?: number; json?: boolean }): Promise<number> {
  const scores = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return quant.moneyball(commits, { topN: opts.topN ?? 20 });
  });
  if (typeof scores === "number") return scores;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ scores }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("⚾", "Moneyball — undervalued contributors",
    "downstream reach × collaborator network × per-commit ROI",
    "Find quiet teammates whose small commits punch above their weight — great for promotion-time fairness checks.") + "\n\n");
  if (scores.length === 0) {
    process.stdout.write(emptyState(
      "No contributors yet.",
      ["Run `mneme index` after adding commits."],
    ));
    return 0;
  }

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Goal: spot teammates whose small commit count hides outsized impact.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")}\n`);
  process.stdout.write(`        ${kleur.green("⭐ MONEYBALL")} ${kleur.gray("— low commit count, high downstream impact (the bargain hire)")}\n`);
  process.stdout.write(`        ${kleur.cyan("● BALANCED")}  ${kleur.gray("— commit count and impact roughly match (steady contributor)")}\n`);
  process.stdout.write(`        ${kleur.yellow("◐ LOUD")}      ${kleur.gray("— many commits, modest impact (loud but not landing)")}\n`);
  process.stdout.write(`        ${kleur.gray("○ PASSIVE   — low activity overall (informational)")}\n\n`);

  for (const s of scores) {
    const tierLabel = s.tier === "moneyball" ? kleur.green().bold("⭐ MONEYBALL") : s.tier === "balanced" ? kleur.cyan().bold("●  BALANCED ") : s.tier === "loud" ? kleur.yellow().bold("◐  LOUD     ") : kleur.gray().bold("○  PASSIVE  ");
    process.stdout.write(`  ${tierLabel}  ${kleur.bold(s.authorName)}  ${kleur.gray(`<${s.authorEmail}>`)}\n`);
    const roiBlurb = s.perCommitROI >= 2 ? "punches above their weight" : s.perCommitROI >= 1 ? "carrying their weight" : "below-average impact per commit";
    process.stdout.write(
      `      ${kleur.gray("commits:")} ${s.commitCount} ${kleur.gray("(total commits authored)")}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("downstream reach:")} ${s.downstreamReach} ${kleur.gray(`(${s.downstreamReach} downstream consumer${s.downstreamReach === 1 ? "" : "s"} of their commits)`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("collaborators:")} ${s.collaborators} ${kleur.gray("(distinct teammates touching the same files)")}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("ROI:")} ${kleur.cyan(s.perCommitROI.toFixed(2))} ${kleur.gray(`(${s.perCommitROI.toFixed(1)}× return on commit effort — ${roiBlurb})`)}\n`,
    );
    if (s.hotFiles && s.hotFiles.length > 0) {
      process.stdout.write(`      ${kleur.cyan("hot files (their territory):")}\n`);
      for (const hf of s.hotFiles) {
        process.stdout.write(
          `        ${kleur.bold(String(hf.count).padStart(3))}× ${kleur.white(hf.path)}\n`,
        );
      }
    }
    process.stdout.write(`      ${kleur.gray("→ " + s.interpretation)}\n\n`);
  }
  return 0;
}

// ─── 7. greek ────────────────────────────────────────────────────────────

export async function greekCommand(opts: { cwd: string; json?: boolean }): Promise<number> {
  const report = await withStore(opts.cwd, (s) => quant.computeGreeks(s));
  if (typeof report === "number") return report;

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("📐", "Codebase Greeks (Δ Γ Θ)",
    "Delta · Gamma · Theta — risk derivatives of your codebase",
    "Know who you can't afford to lose, where the codebase is accelerating into chaos, and what's quietly rotting.") + "\n\n");

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("Three risk derivatives — borrowed from finance, applied to your codebase:")}\n`);
  process.stdout.write(`        ${kleur.magenta("Δ DELTA")} ${kleur.gray("— knowledge concentration: how much breaks if the top contributor leaves")}\n`);
  process.stdout.write(`        ${kleur.magenta("Γ GAMMA")} ${kleur.gray("— risk acceleration: is concentration getting worse over time?")}\n`);
  process.stdout.write(`        ${kleur.magenta("Θ THETA")} ${kleur.gray("— time decay: how fast does this knowledge become stale?")}\n\n`);

  // Δ Delta
  process.stdout.write(`  ${kleur.bold().magenta("Δ DELTA")}  ${kleur.gray("knowledge concentration — how much breaks if the top contributor leaves")}\n`);
  if (report.delta.length === 0) {
    process.stdout.write(`    ${kleur.gray("(no author dominates ≥ 75% of any file — knowledge is well-distributed)")}\n`);
  } else {
    for (const d of report.delta.slice(0, 3)) {
      process.stdout.write(`    ${kleur.bold(d.name)}  ${kleur.gray(`<${d.email}>`)}\n`);
      process.stdout.write(`      Owns ${kleur.cyan(d.ownedFiles.length + " files")} = ${kleur.cyan(d.knowledgeLossPct + "%")} ${kleur.gray(`knowledge loss if they leave (${d.knowledgeLossPct}% of repo expertise walks out the door)`)}\n`);
    }
  }
  process.stdout.write("\n");

  // Γ Gamma
  process.stdout.write(`  ${kleur.bold().magenta("Γ GAMMA")}  ${kleur.gray("risk acceleration — is concentration getting worse over time?")}\n`);
  process.stdout.write(`    ${report.gamma.interpretation}\n`);
  const slope = report.gamma.riskAcceleration;
  const slopePct = (slope * 100).toFixed(1);
  const slopeDir = slope > 0 ? "growing" : slope < 0 ? "shrinking" : "flat";
  process.stdout.write(`    ${kleur.gray(`slope: ${slope}  (${slopeDir} at ${Math.abs(Number(slopePct))}% per week, over ${report.gamma.weeks} weeks)`)}\n\n`);

  // Θ Theta
  process.stdout.write(`  ${kleur.bold().magenta("Θ THETA")}  ${kleur.gray("time decay — how fast does this knowledge become stale?")}\n`);
  process.stdout.write(`    ${report.theta.interpretation}\n\n`);

  return 0;
}

// ─── 8. correlation-matrix ──────────────────────────────────────────────

export async function correlationMatrixCommand(opts: { cwd: string; topN?: number; minLift?: number; json?: boolean }): Promise<number> {
  const pairs = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return quant.correlationMatrix(commits, { topN: opts.topN ?? 20, minLift: opts.minLift });
  });
  if (typeof pairs === "number") return pairs;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ pairs }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🔗", "Correlation matrix — hidden file coupling",
    "co-occurrence × jaccard × lift · find files that change together but shouldn't",
    "Find files that always change together — a sign of hidden coupling that's making refactors painful.") + "\n\n");
  if (pairs.length === 0) {
    process.stdout.write(emptyState(
      "No coupling above lift threshold.",
      [
        "Files may be well-decoupled — that's good.",
        "Lower threshold: --min-lift 1.5 to surface weaker patterns.",
      ],
    ));
    return 0;
  }

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("co-occur")} ${kleur.gray("— number of commits that touched both files together")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("jaccard")}  ${kleur.gray("— overlap ratio (0–1); fraction of commits touching either file that touched both")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.cyan("lift")}     ${kleur.gray("— how many times more often than random these files change together")}\n`);
  process.stdout.write(`    ${kleur.gray("• Tiers:")}\n`);
  process.stdout.write(`        ${kleur.red("TIGHT")}    ${kleur.gray("— change together almost always; refactor candidates")}\n`);
  process.stdout.write(`        ${kleur.yellow("STRONG")}   ${kleur.gray("— frequent coupling; review module boundaries")}\n`);
  process.stdout.write(`        ${kleur.cyan("MODERATE")} ${kleur.gray("— meaningful link; worth knowing")}\n`);
  process.stdout.write(`        ${kleur.gray("WEAK")}     ${kleur.gray("— faint signal; informational")}\n\n`);

  for (const p of pairs) {
    const tier = p.tier === "tight" ? kleur.red().bold("TIGHT   ") : p.tier === "strong" ? kleur.yellow().bold("STRONG  ") : p.tier === "moderate" ? kleur.cyan().bold("MODERATE") : kleur.gray().bold("WEAK    ");
    process.stdout.write(`  ${tier}  ${kleur.bold(p.fileA)}  ⇄  ${kleur.bold(p.fileB)}\n`);
    const jPct = (p.jaccard * 100).toFixed(0);
    const jBlurb = p.jaccard >= 0.6 ? "high" : p.jaccard >= 0.4 ? "moderate" : p.jaccard >= 0.2 ? "modest" : "low";
    process.stdout.write(
      `      ${kleur.gray("co-occur:")} ${p.coOccurrences} ${kleur.gray(`(changed together in ${p.coOccurrences} commit${p.coOccurrences === 1 ? "" : "s"})`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("jaccard:")} ${kleur.cyan(p.jaccard.toFixed(2))} ${kleur.gray(`(${jPct}% overlap — ${jBlurb})`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("lift:")} ${kleur.cyan(p.lift.toFixed(1) + "×")} ${kleur.gray(`(these files change together ${p.lift.toFixed(1)}× more often than random)`)}\n`,
    );
    process.stdout.write(`      ${kleur.gray("→ " + p.interpretation)}\n\n`);
  }
  return 0;
}

// ─── 9. implied-volatility ──────────────────────────────────────────────

export async function impliedVolatilityCommand(opts: { cwd: string; json?: boolean }): Promise<number> {
  const summary = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return quant.summarizeVolatility(commits);
  });
  if (typeof summary === "number") return summary;

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("📊", "Implied volatility — chaos from commit message tone",
    "infer 'how stressful is the codebase right now?' from word choice",
    "Read the team's stress level from commit messages — rising panic words mean burnout or a release going sideways.") + "\n\n");
  process.stdout.write(section("✦ Verdict") + "\n\n");
  const trendBlurb = summary.trend === "rising" ? "week-over-week stress is going UP" : summary.trend === "falling" ? "week-over-week stress is going DOWN" : "week-over-week stress is roughly flat";
  process.stdout.write(
    `    IV = ${kleur.bold(String(summary.latestIV))}/100 ${kleur.gray(`(${summary.latestIV} of 100 max — ${ivStressLabel(summary.latestIV)})`)}\n`,
  );
  process.stdout.write(
    `    trend: ${kleur.bold(summary.trend)} ${kleur.gray(`(${trendBlurb})`)}\n`,
  );
  process.stdout.write(
    `    ${meter(summary.latestIV / 100, { width: 16 })}  ${ivLabel(summary.latestIV)}\n`,
  );
  process.stdout.write(`    ${summary.interpretation}\n\n`);

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• IV is scored 0–100 from commit-message word choice (panic words, fixes, reverts).")}\n`);
  process.stdout.write(`    ${kleur.gray("• Bands:")} ${kleur.gray("0–29 calm  ·")} ${kleur.cyan("30–49 elevated")} ${kleur.gray(" ·")} ${kleur.yellow("50–69 high stress")} ${kleur.gray(" ·")} ${kleur.red("70+ crisis")}\n`);
  process.stdout.write(`    ${kleur.gray("• Rising trend = burnout signal or a release going sideways.")}\n\n`);

  if (summary.windows.length > 1) {
    const recent = summary.windows.slice(-12);
    process.stdout.write(section("◆ Weekly history", `(last ${recent.length} weeks)`) + "\n\n");
    process.stdout.write(`    ${kleur.gray("trend:")}  ${sparkline(recent.map((w) => w.iv))}  ${kleur.gray("(left = oldest week, right = most recent)")}\n\n`);
    for (const w of recent) {
      const ratio = Math.min(1, w.iv / 100);
      process.stdout.write(
        `    ${kleur.gray(w.week)}  ${meter(ratio, { width: 16 })}  ${kleur.bold(String(w.iv).padStart(3))}\n`,
      );
    }
    process.stdout.write("\n");
  }
  return 0;
}

function ivStressLabel(iv: number): string {
  if (iv >= 70) return "crisis";
  if (iv >= 50) return "high stress";
  if (iv >= 30) return "elevated";
  return "calm";
}

function ivLabel(iv: number): string {
  if (iv >= 70) return pill("CRISIS", "critical");
  if (iv >= 50) return pill("HIGH STRESS", "warn");
  if (iv >= 30) return pill("ELEVATED", "low");
  return pill("CALM", "ok");
}

// ─── 10. tax-loss-harvest ───────────────────────────────────────────────

export async function taxLossHarvestCommand(opts: { cwd: string; minStaleDays?: number; topN?: number; json?: boolean }): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const candidates = quant.findHarvestCandidates(s, { minStaleDays: opts.minStaleDays ?? 180, topN: opts.topN ?? 20 });
    return { candidates, summary: quant.summarizeHarvest(candidates) };
  });
  if (typeof result === "number") return result;
  const { candidates, summary } = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ candidates, summary }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🌾", "Tax-loss harvest — dead code candidates",
    "files / dirs nobody has touched in months · ripe for deletion",
    "Find code nobody has touched in months — safe to delete and shrink your maintenance surface area.") + "\n\n");
  process.stdout.write(section("✦ Summary") + "\n\n");
  process.stdout.write(`    ${summary.summary}\n\n`);

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Files / directories nobody has touched in months. Likely candidates for deletion.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.yellow().bold("NOTE")} ${kleur.gray("Mneme cannot tell if code is")} ${kleur.bold("REFERENCED")} ${kleur.gray("elsewhere — verify with grep / your build before deleting.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Risk tiers:")}\n`);
  process.stdout.write(`        ${kleur.green("SAFE")}      ${kleur.gray("— stale, no incidents, low blast radius; deletion is straightforward")}\n`);
  process.stdout.write(`        ${kleur.cyan("LOW-RISK")}  ${kleur.gray("— stale and quiet; quick verify then delete")}\n`);
  process.stdout.write(`        ${kleur.yellow("MODERATE")}  ${kleur.gray("— some signal here; check call sites carefully")}\n`);
  process.stdout.write(`        ${kleur.red("RISKY")}     ${kleur.gray("— stale but has history of incidents or many entities; tread carefully")}\n\n`);

  if (candidates.length === 0) return 0;

  process.stdout.write(`  ${kleur.bold().magenta("◆ Candidates")}\n\n`);
  for (const c of candidates) {
    const risk = c.risk === "risky" ? kleur.red().bold("RISKY    ") : c.risk === "moderate" ? kleur.yellow().bold("MODERATE ") : c.risk === "low-risk" ? kleur.cyan().bold("LOW-RISK ") : kleur.green().bold("SAFE     ");
    process.stdout.write(`  ${risk}  ${kleur.bold(c.filePath)}\n`);
    const deadBlurb = c.daysSinceTouch > 365 ? "likely dead" : c.daysSinceTouch > 180 ? "very stale" : "stale";
    process.stdout.write(
      `      ${kleur.gray("stale days:")} ${c.daysSinceTouch} ${kleur.gray(`(${c.daysSinceTouch} days untouched — ${deadBlurb})`)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray("commits:")} ${c.commitCount}  ${kleur.gray("entities:")} ${c.entityCount}  ${kleur.gray("incidents:")} ${c.incidentCount} ${kleur.gray(c.incidentCount > 0 ? "(has past incidents — verify carefully)" : "(no past incidents)")}\n`,
    );
    process.stdout.write(`      ${kleur.gray("→ " + c.recommendation)}\n\n`);
  }
  return 0;
}
