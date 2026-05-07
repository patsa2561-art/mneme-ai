/**
 * `mneme repo-mri` — twenty-axis health diagnostic with z-scores.
 *
 * Like a real medical MRI: scan the whole body, highlight the *outliers*,
 * leave the rest as "within normal range." Each axis is computed from git
 * data alone (no LLM, no index) and z-scored against canned medians for a
 * typical OSS repo of similar size.
 *
 * The headline output is "your three most-unusual axes" — that's the
 * one-glance answer most users actually want. The full table is below for
 * detail. Caveat block at the bottom names the corpus + the limits.
 */

import kleur from "kleur";
import { git, mri as mriCore } from "@mneme-ai/core";
import { ui, header, section, divider, nextSteps, kv, meter } from "../ui.js";

export interface RepoMriOptions {
  cwd: string;
  /** Cap commits scanned (most-recent N). 0 = unlimited. */
  maxCommits?: number;
  json?: boolean;
}

export async function repoMriCommand(opts: RepoMriOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  if (!opts.json) ui.banner();

  let computed;
  try {
    computed = await mriCore.computeMri({
      cwd: opts.cwd,
      maxCommits: opts.maxCommits,
    });
  } catch (err) {
    ui.error(`MRI scan failed: ${(err as Error).message}`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(computed, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(
    header(
      "🩻",
      "Repo MRI",
      "20-axis diagnostic — z-scores vs typical OSS repo",
      "one-glance health snapshot for any repo, in under 10 seconds",
    ) + "\n",
  );

  // ── Headline: three most-unusual axes ────────────────────────────────
  const sorted = [...computed.results].sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  const topThree = sorted.slice(0, 3);
  process.stdout.write("\n  " + kleur.bold().magenta("Three most-unusual axes vs typical OSS:") + "\n\n");
  for (const r of topThree) {
    const arrow = r.zScore > 0 ? kleur.red("▲") : kleur.cyan("▼");
    const z = `${r.zScore >= 0 ? "+" : ""}${r.zScore.toFixed(1)}σ`;
    const verdict = verdictWord(r.zScore);
    process.stdout.write(
      `  ${arrow}  ${kleur.bold(r.axis.label.padEnd(28))} ${kleur.gray("│")} ${gradeColor(r.grade)(z.padEnd(8))} ${kleur.gray("│")} ${verdict}\n`,
    );
  }

  // Healthy summary
  const within1 = computed.results.filter((r) => Math.abs(r.zScore) < 1).length;
  const outliers = computed.results.filter((r) => r.grade === "outlier").length;
  process.stdout.write(
    "\n  " +
      kleur.gray(
        `Health summary: ${kleur.bold(`${within1}/${computed.results.length}`)} axes within 1σ` +
          (outliers > 0 ? `, ${kleur.red().bold(String(outliers))} outlier${outliers > 1 ? "s" : ""}` : ", no outliers"),
      ) +
      "\n\n",
  );

  // ── Per-group table ───────────────────────────────────────────────────
  for (const grp of ["people", "code", "process", "risk"] as const) {
    const rows = computed.results.filter((r) => r.axis.group === grp);
    if (rows.length === 0) continue;
    const labels: Record<typeof grp, string> = {
      people: "People",
      code: "Code",
      process: "Process",
      risk: "Risk",
    };
    process.stdout.write(section(labels[grp]) + "\n\n");
    process.stdout.write(
      "  " +
        kleur.gray("AXIS".padEnd(34)) +
        kleur.gray("VALUE".padEnd(14)) +
        kleur.gray("z-SCORE".padEnd(12)) +
        kleur.gray("GRADE") +
        "\n",
    );
    process.stdout.write("  " + kleur.gray("─".repeat(72)) + "\n");
    for (const r of rows) {
      const value = formatValue(r.value, r.axis.unit);
      const z = `${r.zScore >= 0 ? "+" : ""}${r.zScore.toFixed(1)}σ`;
      process.stdout.write(
        "  " +
          r.axis.label.padEnd(34) +
          value.padEnd(14) +
          gradeColor(r.grade)(z.padEnd(12)) +
          gradeBadge(r.grade) +
          "\n",
      );
    }
    process.stdout.write("\n");
  }

  // ── Repo-level descriptors ────────────────────────────────────────────
  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "z-score = (value − typical-OSS-median) / typical-OSS-stdev. Positive = worse for that axis's\n" +
          "  direction. The reference medians are HEURISTIC starting values, not a peer-reviewed corpus.\n" +
          "  Three most-unusual axes is the answer to 'what's weird about this repo'. The full table is\n" +
          "  for detail. Higher isn't always worse — read each caveat. Use for self-reflection + a\n" +
          "  starter conversation; never for performance review.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme repo-mri --json`, why: "machine-readable output for dashboards" },
      { cmd: `mneme karma`, why: "deep-dive on the open-debt axis" },
      { cmd: `mneme atrophy`, why: "deep-dive on the bus-factor axis (file-level)" },
      { cmd: `mneme nervous-system`, why: "the full people-analytics dossier" },
    ]) + "\n",
  );

  return 0;
}

function verdictWord(z: number): string {
  const a = Math.abs(z);
  if (a < 0.5) return kleur.gray("within normal range");
  if (a < 1) return kleur.gray("mildly unusual");
  if (a < 2) return kleur.yellow("notable — worth a look");
  return z > 0 ? kleur.red("outlier — likely the thing") : kleur.cyan("outlier — likely a strength");
}

function gradeColor(g: import("@mneme-ai/core").mri.AxisResult["grade"]): (s: string) => string {
  switch (g) {
    case "normal":
      return (s) => kleur.gray(s);
    case "mild":
      return (s) => kleur.cyan(s);
    case "notable":
      return (s) => kleur.yellow(s);
    case "outlier":
      return (s) => kleur.red().bold(s);
  }
}

function gradeBadge(g: import("@mneme-ai/core").mri.AxisResult["grade"]): string {
  switch (g) {
    case "normal":
      return kleur.gray("· normal");
    case "mild":
      return kleur.cyan("· mild");
    case "notable":
      return kleur.yellow("· notable");
    case "outlier":
      return kleur.red().bold("· outlier");
  }
}

function formatValue(v: number, unit: string): string {
  if (unit === "%") return `${v}%`;
  if (unit === "0..1") return v.toFixed(2);
  if (unit === "days") return `${Math.round(v)}d`;
  if (unit === "chars") return `${Math.round(v)}`;
  if (unit === "LOC" || unit === "count") {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  }
  return String(v);
}
