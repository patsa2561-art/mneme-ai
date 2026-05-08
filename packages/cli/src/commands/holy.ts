/**
 * `mneme heartbeat`, `mneme rewind <ref>`, `mneme dna-fold` — the three
 * v0.43 Holy Grails that the Element/Atom/Molecule architecture made
 * feasible.
 */

import kleur from "kleur";
import { git, holy } from "@mneme-ai/core";
import { ui, header, section, kv, divider, nextSteps } from "../ui.js";

/* ───────────  heartbeat  ────────────────────────────────────────────── */

export interface HeartbeatOptions {
  cwd: string;
  json?: boolean;
  quiet?: boolean;
}

export async function heartbeatCommand(opts: HeartbeatOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  let result;
  try {
    result = await holy.tick({ cwd: meta.rootPath });
  } catch (err) {
    ui.error(`Heartbeat tick failed: ${(err as Error).message}`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.alarming ? 1 : 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "💓",
      "Heartbeat — codebase pulse",
      "20-axis snapshot vs the rolling 7-day baseline; anomalies above 2σ flagged",
      "Treat the repo as a patient under continuous observation. Cron this to detect health drift.",
    ) + "\n\n",
  );

  const verdictTag =
    result.verdict === "all-quiet"
      ? kleur.green("[ ALL QUIET ]")
      : result.verdict === "watching"
      ? kleur.yellow("[ WATCHING ]")
      : kleur.red().bold("[ ALARMING ]");
  process.stdout.write(
    kv("verdict", verdictTag) +
      "\n" +
      kv("baseline pulses", String(result.baselineSize)) +
      "\n" +
      kv("anomalies", String(result.anomalies.length)) +
      "\n\n",
  );

  if (result.baselineSize < 3) {
    process.stdout.write(
      `  ${kleur.gray("○ warming up — need ≥ 3 prior pulses before z-scores stabilise. Run `mneme heartbeat` daily for a week to populate the baseline.")}\n\n`,
    );
    return 0;
  }

  if (result.anomalies.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} Every axis within 1σ of its rolling mean.\n\n`);
  } else {
    process.stdout.write(section("Anomalies vs rolling baseline") + "\n\n");
    for (const a of result.anomalies) {
      const arrow = a.worse ? kleur.red("▲") : kleur.cyan("▼");
      const sev =
        a.severity === "outlier"
          ? kleur.red().bold(`${a.zScore >= 0 ? "+" : ""}${a.zScore}σ`)
          : kleur.yellow(`${a.zScore >= 0 ? "+" : ""}${a.zScore}σ`);
      process.stdout.write(
        `  ${arrow}  ${kleur.bold(a.axisLabel.padEnd(30))} ${kleur.gray("│")} ${sev.padEnd(12)} ${kleur.gray("│")} ${kleur.gray(`now ${a.value} · baseline ${a.baselineMean.toFixed(1)} ± ${a.baselineStdev.toFixed(1)}`)}\n`,
      );
    }
    process.stdout.write("\n");
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Each tick takes a 20-axis MRI snapshot, compares it to your rolling baseline, flags any\n" +
          "  axis ≥ 1σ from its rolling mean (notable) or ≥ 2σ (outlier — the verdict goes alarming).\n" +
          "  ▲ = worse than baseline, ▼ = better. Cron `mneme heartbeat` daily; `mneme heartbeat --json`\n" +
          "  feeds Slack/email/PR comments.  Snapshots persist at .mneme/heartbeat.json (capped at 90).",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme heartbeat --json`, why: "machine-readable for Slack / email / dashboards" },
      { cmd: `mneme repo-mri`, why: "the static MRI heartbeat is built on" },
    ]) + "\n",
  );
  return result.alarming ? 1 : 0;
}

/* ───────────  rewind  ──────────────────────────────────────────────── */

export interface RewindCommandOptions {
  cwd: string;
  ref: string;
  json?: boolean;
  quiet?: boolean;
  windowSize?: number;
}

export async function rewindCommand(opts: RewindCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  let report;
  try {
    report = await holy.rewind({ cwd: meta.rootPath, ref: opts.ref, windowSize: opts.windowSize });
  } catch (err) {
    ui.error(`Rewind failed: ${(err as Error).message}`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "⏮",
      `Rewind — ${report.commit.shortHash}`,
      `"${report.commit.subject.slice(0, 80)}"`,
      "Time-travel debug. Reconstructs the working context of a single commit from git history + author voice. ✱ lines are speculative inferences.",
    ) + "\n\n",
  );

  process.stdout.write(section("Commit") + "\n");
  process.stdout.write(kv("hash", report.commit.hash) + "\n");
  process.stdout.write(kv("author", `${report.commit.authorName} <${report.commit.authorEmail}>`) + "\n");
  const tzStr = formatTzOffset(report.commit.authorTzOffsetMinutes);
  process.stdout.write(kv("when", `${report.commit.authorDateUtc} (UTC) · author tz ${tzStr}`) + "\n");
  process.stdout.write(kv("size", `${report.commit.filesChanged} files · +${report.commit.insertions} / -${report.commit.deletions}`) + "\n");
  process.stdout.write("\n");

  if (report.commit.body.trim()) {
    process.stdout.write(section("Body") + "\n");
    for (const line of report.commit.body.trim().split("\n").slice(0, 8)) {
      process.stdout.write(`  ${kleur.gray(line)}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(section("Author context window") + "\n");
  if (report.context.before.length === 0 && report.context.after.length === 0) {
    process.stdout.write(`  ${kleur.gray("(no other commits by this author in the window)")}\n\n`);
  } else {
    for (const c of report.context.before) {
      process.stdout.write(
        `  ${kleur.gray("●")} ${kleur.bold(c.shortHash)} ${kleur.gray(`[${c.deltaMinutes >= 0 ? "+" : ""}${c.deltaMinutes}m]`)}  ${kleur.white(c.subject.slice(0, 70))}\n`,
      );
    }
    process.stdout.write(`  ${kleur.cyan("●")} ${kleur.cyan().bold(report.commit.shortHash)} ${kleur.cyan("[ this commit ]")}\n`);
    for (const c of report.context.after) {
      process.stdout.write(
        `  ${kleur.gray("●")} ${kleur.bold(c.shortHash)} ${kleur.gray(`[+${c.deltaMinutes}m]`)}  ${kleur.white(c.subject.slice(0, 70))}\n`,
      );
    }
    process.stdout.write("\n");
  }

  process.stdout.write(section("Inferences", "✱ speculative — outside-observer reading, not the author's actual thought") + "\n");
  for (const inf of report.inferences) {
    process.stdout.write(`  ${kleur.yellow(inf)}\n`);
  }
  process.stdout.write("\n");

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Every fact (commit metadata, surrounding commits, sandwich-mode markers, tz offset) is\n" +
          "  GROUND TRUTH from git. Inferences (✱ lines) are speculative — they're what an outside\n" +
          "  observer would reasonably read into the working context. Use as a conversation\n" +
          "  starter; never as a substitute for asking the author.",
      ) +
      "\n\n",
  );
  return 0;
}

function formatTzOffset(min: number): string {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad(h)}:${pad(m)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/* ───────────  dna-fold  ────────────────────────────────────────────── */

export interface DnaFoldOptions {
  cwd: string;
  emails?: string[];
  topN?: number;
  json?: boolean;
  quiet?: boolean;
}

export async function dnaFoldCommand(opts: DnaFoldOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  let report;
  try {
    report = await holy.dnaFold({
      cwd: meta.rootPath,
      emails: opts.emails,
      topN: opts.topN,
    });
  } catch (err) {
    ui.error(`DNA fold failed: ${(err as Error).message}`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "🧬",
      "DNA Fold — team-DNA emerges",
      `${report.voices.length} author DNA${report.voices.length === 1 ? "" : "s"} folded into a team profile`,
      "Per-person DNA already exists; this aggregates them. Surfaces consensus, polarisation, and outliers across the team.",
    ) + "\n\n",
  );

  if (report.voices.length === 0) {
    process.stdout.write(`  ${kleur.yellow("!")} No profiled authors. Pass --email <email> ... or check the repo has commits.\n\n`);
    return 1;
  }

  process.stdout.write(section("Highlights") + "\n");
  for (const h of report.highlights) {
    process.stdout.write(`  ${kleur.yellow(h)}\n`);
  }
  process.stdout.write("\n");

  process.stdout.write(section("Per-feature breakdown") + "\n\n");
  process.stdout.write(
    "  " +
      kleur.gray("FEATURE".padEnd(34)) +
      kleur.gray("MEAN".padEnd(10)) +
      kleur.gray("STDEV".padEnd(10)) +
      kleur.gray("CV".padEnd(8)) +
      kleur.gray("VERDICT") +
      "\n",
  );
  process.stdout.write("  " + kleur.gray("─".repeat(72)) + "\n");
  for (const f of report.features) {
    const verdictTag =
      f.verdict === "consensus" ? kleur.green("· consensus") : f.verdict === "polarised" ? kleur.red("· polarised") : kleur.yellow("· outliered");
    process.stdout.write(
      "  " +
        f.label.padEnd(34) +
        String(f.mean).padEnd(10) +
        String(f.stdev).padEnd(10) +
        String(f.cv).padEnd(8) +
        verdictTag +
        "\n",
    );
  }
  process.stdout.write("\n");

  if (report.missingEmails.length > 0) {
    process.stdout.write(section("Missing") + "\n");
    for (const e of report.missingEmails) {
      process.stdout.write(`  ${kleur.gray("·")} ${kleur.gray(e + " (no commits in scope)")}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Consensus  = team aligned (low coefficient of variation).\n" +
          "  Polarised  = the team has split into camps (CV ≥ 0.6 with no single outlier).\n" +
          "  Outliered  = one person diverges by ≥ 2σ from the rest. Diversification, not necessarily a defect.\n" +
          "  Use for onboarding, hiring fit, retros — never for performance review.",
      ) +
      "\n\n",
  );
  return 0;
}
