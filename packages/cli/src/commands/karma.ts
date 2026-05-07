/**
 * `mneme karma` — TODO/FIXME debt as an accumulating ledger.
 *
 * This is the rare metric every code-quality tool *almost* tracks but never
 * actually surfaces. Static analyzers count TODOs at HEAD ("you have 1,243
 * TODOs"). git blame can find who wrote a single TODO. Neither tracks the
 * *flow*: are we incurring debt faster than we settle it, and who personally
 * owns the oldest unkept promises?
 *
 * Mneme reads every commit's diff for `TODO|FIXME|XXX|HACK` markers, treats
 * each addition as a *debit* and each removal as a *credit*, and compounds
 * the open balance with age. A 6-month-old TODO weighs ~2.3× a 1-week-old
 * one (log10 1+age curve — sub-linear).
 *
 * Honest framing: this is a heuristic. Lines move, get edited, get reflowed.
 * The output renders 📘 How to read with explicit caveats.
 */

import kleur from "kleur";
import { git, karma as karmaCore } from "@mneme-ai/core";
import { ui, header, section, kv, divider, nextSteps, meter, emptyState } from "../ui.js";

export interface KarmaCommandOptions {
  cwd: string;
  /** Top-N authors in the leaderboard. */
  topN?: number;
  /** Filter to a specific author email. */
  authorEmail?: string;
  /** Restrict scan to a path prefix. */
  pathPrefix?: string;
  /** Cap commits scanned (most-recent N). */
  maxCommits?: number;
  /** ISO-8601 since-cutoff. */
  since?: string;
  json?: boolean;
}

export async function karmaCommand(opts: KarmaCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  if (!opts.json) ui.banner();

  let events;
  try {
    events = await karmaCore.scanKarma({
      cwd: opts.cwd,
      since: opts.since,
      pathPrefix: opts.pathPrefix,
      maxCommits: opts.maxCommits,
    });
  } catch (err) {
    ui.error(`Karma scan failed: ${(err as Error).message}`);
    return 1;
  }

  const report = karmaCore.buildReport(events);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(
    header(
      "⚖",
      "Karma",
      "TODO/FIXME debt as an accumulating ledger — compounds with age",
      "see who personally owes the most unkept promises across history",
    ) + "\n",
  );

  // Repo-wide totals
  process.stdout.write(
    "\n" +
      kv("events", `${report.totalEvents}  (${report.totalIncurred} incurred · ${report.totalSettled} settled)`) +
      "\n",
  );
  const openCount = report.authors.reduce((s, a) => s + a.netDebt, 0);
  const totalWeighted = report.authors.reduce((s, a) => s + a.weightedDebt, 0);
  process.stdout.write(
    kv("open debt", `${openCount} TODOs · weighted ${totalWeighted.toFixed(1)}`) + "\n\n",
  );

  if (events.length === 0) {
    process.stdout.write(
      emptyState(
        "No TODO/FIXME activity found in this history.",
        [
          "Try widening the window with --since '5 years ago' or --max-commits 0",
          "Or this repo just doesn't comment-mark debt — clean!",
        ],
      ) + "\n",
    );
    return 0;
  }

  // Author filter — drill-in mode
  if (opts.authorEmail) {
    const wanted = opts.authorEmail.toLowerCase();
    const a = report.authors.find((x) => x.email === wanted);
    if (!a) {
      ui.warn(`No karma activity for ${opts.authorEmail} in this window.`);
      return 0;
    }
    renderAuthorDetail(a);
    return 0;
  }

  // Leaderboard — top N most-indebted
  const top = report.authors.slice(0, opts.topN ?? 10);
  process.stdout.write(section("Most indebted (open TODOs, age-weighted)") + "\n\n");
  if (top.length === 0 || top[0]!.weightedDebt === 0) {
    process.stdout.write("  " + kleur.gray("(no open debt — every TODO has been settled)") + "\n\n");
  } else {
    const maxWeighted = Math.max(...top.map((a) => a.weightedDebt), 1);
    process.stdout.write(
      "  " +
        kleur.gray("AUTHOR".padEnd(34)) +
        kleur.gray("OPEN".padEnd(8)) +
        kleur.gray("WEIGHT".padEnd(10)) +
        kleur.gray("FLOW (in/out)".padEnd(16)) +
        "\n",
    );
    process.stdout.write("  " + kleur.gray("─".repeat(68)) + "\n");
    for (const a of top) {
      const who = (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email).slice(0, 33).padEnd(34);
      const open = String(a.netDebt).padEnd(8);
      const w = a.weightedDebt.toFixed(1).padEnd(10);
      const flow = `${a.totalIncurred}/${a.totalSettled}`.padEnd(16);
      const bar = meter(a.weightedDebt / maxWeighted, { width: 12 });
      process.stdout.write(`  ${who}${open}${w}${flow}${bar}\n`);
    }
    process.stdout.write("\n");
  }

  // Top files repo-wide
  if (report.topFiles.length > 0) {
    process.stdout.write(section("Files with the most open debt") + "\n\n");
    for (const f of report.topFiles.slice(0, 10)) {
      process.stdout.write(`  ${kleur.bold(String(f.debt).padStart(3))}  ${kleur.cyan(f.filePath)}\n`);
    }
    process.stdout.write("\n");
  }

  // Oldest debt across the whole repo (single most-aged)
  const oldest = top
    .map((a) => a.oldestUnpaid)
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.timestamp - b.timestamp)[0];
  if (oldest) {
    process.stdout.write(section("Oldest unpaid TODO in the codebase") + "\n");
    process.stdout.write(
      `  ${kleur.gray("●")} ${kleur.bold(oldest.commit.slice(0, 7))}  ${kleur.gray(`[${formatAge(oldest.ageDays)} old]`)}  ${kleur.cyan(oldest.filePath)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray(oldest.marker + ":")} ${kleur.white(oldest.content.slice(0, 80) || "(no description)")}\n\n`,
    );
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Each TODO/FIXME *added* in a commit is a debit; each one *removed* is a credit.\n" +
          "  Weight = log10(1 + ageDays) — older unkept TODOs weigh more, but sub-linearly.\n" +
          "  Flow = (added / removed) over the scanned window.\n" +
          "  HEURISTIC. Lines move, get reflowed, get partially edited — exact match required.\n" +
          "  Use for self-reflection + conversation starter, NEVER for performance review.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme karma --author <email>`, why: "drill into one engineer's debt + oldest unpaid line" },
      { cmd: `mneme promise`, why: "natural-language promise debt (broader: PRs + commit messages)" },
      { cmd: `mneme ghost`, why: "files that are alive in HEAD but nobody touched in months" },
    ]) + "\n",
  );

  return 0;
}

function renderAuthorDetail(a: import("@mneme-ai/core").karma.KarmaAuthor): void {
  const who = a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email;
  process.stdout.write(section(`Karma — ${who}`) + "\n\n");
  process.stdout.write(kv("incurred", String(a.totalIncurred)) + "\n");
  process.stdout.write(kv("settled", String(a.totalSettled)) + "\n");
  process.stdout.write(kv("net open", String(a.netDebt)) + "\n");
  process.stdout.write(kv("weighted debt", a.weightedDebt.toFixed(2)) + "\n\n");

  if (a.oldestUnpaid) {
    process.stdout.write(section("Oldest unpaid TODO") + "\n");
    process.stdout.write(
      `  ${kleur.gray("●")} ${kleur.bold(a.oldestUnpaid.commit.slice(0, 7))}  ${kleur.gray(`[${formatAge(a.oldestUnpaid.ageDays)} old]`)}  ${kleur.cyan(a.oldestUnpaid.filePath)}\n`,
    );
    process.stdout.write(
      `      ${kleur.gray(a.oldestUnpaid.marker + ":")} ${kleur.white(a.oldestUnpaid.content.slice(0, 80) || "(no description)")}\n\n`,
    );
  }

  if (a.topFiles.length > 0) {
    process.stdout.write(section("Files with most debt by this author") + "\n\n");
    for (const f of a.topFiles) {
      process.stdout.write(`  ${kleur.bold(String(f.debt).padStart(3))}  ${kleur.cyan(f.filePath)}\n`);
    }
    process.stdout.write("\n");
  }
}

function formatAge(days: number): string {
  if (days < 1) return "today";
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
