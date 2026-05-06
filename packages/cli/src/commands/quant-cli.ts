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
import { ui } from "../ui.js";

const DIV = "═".repeat(64);

function divider(label = ""): string {
  if (!label) return kleur.gray(DIV);
  const padded = `═══ ${label} `;
  return kleur.gray(padded + "═".repeat(Math.max(4, 64 - padded.length)));
}

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
  process.stdout.write(`\n  ${kleur.bold().cyan("📉  Drawdowns — periods of pure firefighting")}\n  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold().magenta("✦ Summary")}\n\n`);
  process.stdout.write(
    `    ${kleur.bold(String(summary.total))} drawdowns · longest streak: ${kleur.bold(String(summary.longestStreak))} commits · ${kleur.bold(summary.totalFixingDays + "d")} total firefighting\n`,
  );
  process.stdout.write(
    `    Drawdown fraction of repo lifespan: ${kleur.cyan((summary.drawdownFraction * 100).toFixed(1) + "%")}\n\n`,
  );

  if (drawdowns.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} Clean shipping history — no drawdowns detected.\n\n`);
    return 0;
  }

  process.stdout.write(`  ${kleur.bold().magenta("◆ Worst streaks")}\n\n`);
  for (const d of drawdowns.slice(0, 10)) {
    process.stdout.write(
      `    ${tierBadge(d.tier)}  ${kleur.bold(d.startDate)} → ${kleur.bold(d.endDate)}  ${kleur.gray(`(${d.length} commits, ${d.durationDays}d)`)}\n`,
    );
    for (const fix of d.sampleFixes) process.stdout.write(`        ${kleur.gray("·")} ${fix}\n`);
    process.stdout.write("\n");
  }
  return 0;
}

function tierBadge(tier: string): string {
  switch (tier) {
    case "critical":
      return kleur.red().bold("CRITICAL");
    case "severe":
      return kleur.yellow().bold("SEVERE  ");
    case "moderate":
      return kleur.cyan().bold("MODERATE");
    default:
      return kleur.gray().bold("MINOR   ");
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
  process.stdout.write(`\n  ${kleur.bold().cyan("💰  Technical Debt Portfolio (Kelly-optimal)")}\n  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold("Budget:")} ${result.budgetDays} dev-days  ${kleur.gray(`(multiplier: ${result.kellyMultiplier}× Kelly, reserve: ${result.reserveDays}d)`)}\n\n`);
  process.stdout.write(`  ${kleur.gray("Item".padEnd(40) + "Edge".padStart(8) + " " + "Var".padStart(7) + " " + "Kelly%".padStart(8) + " " + "Days".padStart(7))}\n`);
  process.stdout.write(`  ${kleur.gray("─".repeat(72))}\n`);
  for (const a of result.items) {
    const tierIcon = a.tier === "outsized" ? kleur.green("⭐") : a.tier === "core" ? kleur.cyan("●") : a.tier === "small" ? kleur.gray("◐") : kleur.gray("⊘");
    const name = a.name.length > 36 ? a.name.slice(0, 35) + "…" : a.name;
    process.stdout.write(
      `  ${tierIcon} ${name.padEnd(38)}${kleur.cyan((a.edge * 100).toFixed(0) + "%").padStart(8)} ${kleur.gray((a.variance * 100).toFixed(1) + "%").padStart(7)} ${kleur.bold((a.kellyFraction * 100).toFixed(0) + "%").padStart(8)} ${kleur.bold(a.allocatedDays + "d").padStart(7)}\n`,
    );
  }
  process.stdout.write(`\n  ${kleur.gray("Total allocated:")} ${kleur.bold(result.totalAllocated + "d")} of ${result.budgetDays}d\n\n`);
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
  process.stdout.write(`\n  ${kleur.bold().cyan("🔬  Backtest report")}\n  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold().magenta("✦ Verdict")}  ${verdictBadge(result.verdict)}\n\n`);
  process.stdout.write(`    ${result.conclusion}\n\n`);
  process.stdout.write(`  ${kleur.bold().magenta("◆ Metrics")}\n\n`);
  process.stdout.write(`    n         = ${kleur.bold(String(result.n))}\n`);
  process.stdout.write(`    precision = ${kleur.bold((result.precision * 100).toFixed(1) + "%")}\n`);
  process.stdout.write(`    recall    = ${kleur.bold((result.recall * 100).toFixed(1) + "%")}\n`);
  process.stdout.write(`    F1        = ${kleur.bold(result.f1.toFixed(2))}\n`);
  process.stdout.write(`    base rate = ${kleur.gray((result.baseRate * 100).toFixed(1) + "%")}\n`);
  process.stdout.write(`    lift      = ${kleur.cyan(result.lift.toFixed(2) + "×")}\n\n`);
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

// ─── 4. black-swan ──────────────────────────────────────────────────────

export async function blackSwanCommand(opts: { cwd: string; topN?: number; json?: boolean }): Promise<number> {
  const candidates = await withStore(opts.cwd, (s) => quant.findBlackSwans(s, { topN: opts.topN ?? 10 }));
  if (typeof candidates === "number") return candidates;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ candidates }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🦢  Black Swans — rare-but-catastrophic file patterns")}\n  ${divider()}\n\n`);

  if (candidates.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No black-swan candidates detected.\n\n`);
    process.stdout.write(`  ${kleur.gray("Black swans need linked incident data to surface.")}\n`);
    process.stdout.write(`  ${kleur.gray("Run ")} ${kleur.cyan("mneme correlate --source pager --org <your-org>")} ${kleur.gray("to ingest incidents")}\n`);
    process.stdout.write(`  ${kleur.gray("or ")} ${kleur.cyan("mneme correlate --source manual --file incidents.json")} ${kleur.gray("for a one-shot import.")}\n\n`);
    return 0;
  }

  for (const c of candidates) {
    process.stdout.write(`  ${blackSwanBadge(c.tier)}  ${kleur.bold(c.filePath)}\n`);
    process.stdout.write(
      `      ${kleur.gray("touches:")} ${c.touchCount}  ${kleur.gray("incidents:")} ${c.incidentCount}  ${kleur.gray("avg severity:")} ${c.avgSeverity}/5  ${kleur.gray("days since:")} ${c.daysSinceTouch}\n`,
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
  process.stdout.write(`\n  ${kleur.bold().cyan("🎯  Insider trading — authors who fix their own bugs")}\n  ${divider()}\n\n`);

  if (profiles.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No insider patterns detected — bugs are caught by reviewers, not by their authors.\n\n`);
    return 0;
  }

  for (const p of profiles) {
    const tier = p.tier === "high-pattern" ? kleur.red().bold("HIGH PATTERN") : p.tier === "elevated" ? kleur.yellow().bold("ELEVATED    ") : kleur.cyan().bold("WATCH       ");
    process.stdout.write(`  ${tier}  ${kleur.bold(p.authorName)}  ${kleur.gray(`<${p.authorEmail}>`)}\n`);
    process.stdout.write(`      ${kleur.gray("patterns:")} ${kleur.bold(String(p.patternCount))}  ${kleur.gray("affected files:")} ${p.affectedFiles.length}\n`);
    if (p.pairSuggestion) {
      process.stdout.write(`      ${kleur.cyan("→")} Pair with ${kleur.bold(p.pairSuggestion)} — they touch the same files without insider patterns.\n`);
    }
    for (const s of p.samples) {
      process.stdout.write(
        `        ${kleur.gray("·")} ${kleur.cyan(s.shipped.shortHash)} → ${kleur.cyan(s.fixed.shortHash)} ${kleur.gray(`(${s.daysToFix}d)`)}: ${s.fixed.subject}\n`,
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
  process.stdout.write(`\n  ${kleur.bold().cyan("⚾  Moneyball — undervalued contributors")}\n  ${divider()}\n\n`);
  if (scores.length === 0) {
    process.stdout.write(`  ${kleur.gray("No contributors yet.")}\n\n`);
    return 0;
  }
  for (const s of scores) {
    const tierLabel = s.tier === "moneyball" ? kleur.green().bold("⭐ MONEYBALL") : s.tier === "balanced" ? kleur.cyan().bold("●  BALANCED ") : s.tier === "loud" ? kleur.yellow().bold("◐  LOUD     ") : kleur.gray().bold("○  PASSIVE  ");
    process.stdout.write(`  ${tierLabel}  ${kleur.bold(s.authorName)}  ${kleur.gray(`<${s.authorEmail}>`)}\n`);
    process.stdout.write(
      `      ${kleur.gray("commits:")} ${s.commitCount}  ${kleur.gray("downstream:")} ${s.downstreamReach}  ${kleur.gray("collaborators:")} ${s.collaborators}  ${kleur.gray("ROI:")} ${kleur.cyan(s.perCommitROI.toFixed(2))}\n`,
    );
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
  process.stdout.write(`\n  ${kleur.bold().cyan("📐  Codebase Greeks (Δ Γ Θ)")}\n  ${divider()}\n\n`);

  // Δ Delta
  process.stdout.write(`  ${kleur.bold().magenta("Δ DELTA")}  sensitivity to top contributor\n`);
  if (report.delta.length === 0) {
    process.stdout.write(`    ${kleur.gray("(no author dominates ≥ 75% of any file)")}\n`);
  } else {
    for (const d of report.delta.slice(0, 3)) {
      process.stdout.write(`    ${kleur.bold(d.name)}  ${kleur.gray(`<${d.email}>`)}\n`);
      process.stdout.write(`      Owns ${kleur.cyan(d.ownedFiles.length + " files")} = ${kleur.cyan(d.knowledgeLossPct + "%")} knowledge loss if they leave\n`);
    }
  }
  process.stdout.write("\n");

  // Γ Gamma
  process.stdout.write(`  ${kleur.bold().magenta("Γ GAMMA")}  acceleration of risk\n`);
  process.stdout.write(`    ${report.gamma.interpretation}\n`);
  process.stdout.write(`    ${kleur.gray("slope: " + report.gamma.riskAcceleration + "  ·  weeks: " + report.gamma.weeks)}\n\n`);

  // Θ Theta
  process.stdout.write(`  ${kleur.bold().magenta("Θ THETA")}  time decay\n`);
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
  process.stdout.write(`\n  ${kleur.bold().cyan("🔗  Correlation matrix — hidden file coupling")}\n  ${divider()}\n\n`);
  if (pairs.length === 0) {
    process.stdout.write(`  ${kleur.gray("No coupling above lift threshold. Either files are well-decoupled, or commits don't touch enough files together to detect patterns.")}\n\n`);
    return 0;
  }
  for (const p of pairs) {
    const tier = p.tier === "tight" ? kleur.red().bold("TIGHT   ") : p.tier === "strong" ? kleur.yellow().bold("STRONG  ") : p.tier === "moderate" ? kleur.cyan().bold("MODERATE") : kleur.gray().bold("WEAK    ");
    process.stdout.write(`  ${tier}  ${kleur.bold(p.fileA)}  ⇄  ${kleur.bold(p.fileB)}\n`);
    process.stdout.write(
      `      ${kleur.gray("co-occur:")} ${p.coOccurrences}  ${kleur.gray("jaccard:")} ${kleur.cyan(p.jaccard.toFixed(2))}  ${kleur.gray("lift:")} ${kleur.cyan(p.lift.toFixed(1) + "×")}\n`,
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
  process.stdout.write(`\n  ${kleur.bold().cyan("📊  Implied volatility — chaos predicted from commit message tone")}\n  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold().magenta("✦ Verdict")}\n\n`);
  process.stdout.write(`    IV = ${kleur.bold(String(summary.latestIV))}/100  ${kleur.gray(`(trend: ${summary.trend})`)}\n`);
  process.stdout.write(`    ${summary.interpretation}\n\n`);

  if (summary.windows.length > 1) {
    process.stdout.write(`  ${kleur.bold().magenta("◆ Weekly history")}  ${kleur.gray(`(last ${Math.min(12, summary.windows.length)} weeks)`)}\n\n`);
    const recent = summary.windows.slice(-12);
    for (const w of recent) {
      const bar = "█".repeat(Math.max(1, Math.round(w.iv / 5)));
      const color = w.iv >= 50 ? kleur.red : w.iv >= 25 ? kleur.yellow : kleur.green;
      process.stdout.write(`    ${kleur.gray(w.week)}  ${color(bar.padEnd(20))} ${kleur.bold(String(w.iv).padStart(3))}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
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
  process.stdout.write(`\n  ${kleur.bold().cyan("🌾  Tax-loss harvest — dead code candidates")}\n  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold().magenta("✦ Summary")}\n\n`);
  process.stdout.write(`    ${summary.summary}\n\n`);

  if (candidates.length === 0) return 0;

  process.stdout.write(`  ${kleur.bold().magenta("◆ Candidates")}\n\n`);
  for (const c of candidates) {
    const risk = c.risk === "risky" ? kleur.red().bold("RISKY    ") : c.risk === "moderate" ? kleur.yellow().bold("MODERATE ") : c.risk === "low-risk" ? kleur.cyan().bold("LOW-RISK ") : kleur.green().bold("SAFE     ");
    process.stdout.write(`  ${risk}  ${kleur.bold(c.filePath)}\n`);
    process.stdout.write(
      `      ${kleur.gray("days since:")} ${c.daysSinceTouch}  ${kleur.gray("commits:")} ${c.commitCount}  ${kleur.gray("entities:")} ${c.entityCount}  ${kleur.gray("incidents:")} ${c.incidentCount}\n`,
    );
    process.stdout.write(`      ${kleur.gray("→ " + c.recommendation)}\n\n`);
  }
  return 0;
}
