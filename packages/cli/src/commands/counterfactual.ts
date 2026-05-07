/**
 * `mneme counterfactual <author-email>` — Bayesian what-if simulation.
 *
 * --json shape (stable):
 *   CounterfactualReport from @mneme-ai/core/counterfactual.
 */
import kleur from "kleur";
import { git, store as storeNs, counterfactual as cfNs } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, pill } from "../ui.js";
import { iris, type PyramidSection } from "../iris/index.js";

const { runCounterfactual } = cfNs;

export interface CounterfactualOptions {
  cwd: string;
  authorEmail: string;
  topFiles?: number;
  /** Disable telepathy for very large repos (cheaper run). Default on. */
  includeTelepathy?: boolean;
  json?: boolean;
}

export async function counterfactualCommand(
  opts: CounterfactualOptions,
): Promise<number> {
  if (!opts.authorEmail || !opts.authorEmail.includes("@")) {
    ui.error("counterfactual requires an author email — e.g. `mneme counterfactual alice@x.io`.");
    return 1;
  }
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new storeNs.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    s.close();
    ui.error("Memory is empty. Run `mneme index` first.");
    return 1;
  }

  let report;
  try {
    report = runCounterfactual(s, {
      authorEmail: opts.authorEmail,
      topN: opts.topFiles ?? 10,
    });
  } finally {
    s.close();
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  return renderTerminal(report);
}

function renderTerminal(report: cfNs.CounterfactualReport): number {
  ui.banner();

  // Degenerate paths first.
  if (!report.authorWasPresent) {
    process.stdout.write(
      iris.render({
        headline: `🌀 Counterfactual: ${report.authorEmail} — author not found`,
        sections: [
          {
            tier: "lede",
            lines: [
              `  ${pill("HEADS UP", "warn")} ${kleur.gray(report.narrative)}`,
            ],
          },
          {
            tier: "sources",
            title: "→ Try next",
            lines: [
              `    ${kleur.cyan("$")} ${kleur.bold("mneme dna")} ${kleur.gray("(list known authors + their fingerprints)")}`,
            ],
          },
        ],
      }) + "\n",
    );
    return 0;
  }
  if (report.remainingContributors === 0) {
    process.stdout.write(
      iris.render({
        headline: `🌀 Counterfactual: without ${report.authorEmail} — solo-author repo`,
        sections: [
          {
            tier: "lede",
            lines: [
              `  ${pill("HEADS UP", "warn")} ${kleur.gray(report.narrative)}`,
              `  ${kleur.gray("commits that would remain:")} ${kleur.bold("0")}`,
            ],
          },
          {
            tier: "sources",
            title: "→ Try next",
            lines: [
              `    ${kleur.cyan("$")} ${kleur.bold("mneme passport " + report.authorEmail)} ${kleur.gray("(see what they actually own)")}`,
              `    ${kleur.gray("📘 This command is most useful on multi-author repos.")}`,
            ],
          },
        ],
      }) + "\n",
    );
    return 0;
  }

  // Happy path.
  const { atrophy, telepathy, meta } = report;
  const lostFiles = atrophy.filesLoseLastExpert;
  const tierShifts = atrophy.fileShifts.filter((s) => s.shift !== "no-impact");

  const headline =
    lostFiles.length > 0
      ? `🌀 Counterfactual: without ${report.authorEmail} — ${lostFiles.length} file${lostFiles.length === 1 ? "" : "s"} lose their last live expert`
      : `🌀 Counterfactual: without ${report.authorEmail} — no file is fully orphaned · ${tierShifts.length} shift safety tier`;

  const ledeLines: string[] = [
    `  ${kleur.gray("commits before:")}    ${kleur.bold(String(meta.commitsBefore))} ${kleur.gray(`→ after: ${meta.commitsAfter}`)}`,
    `  ${kleur.gray("authors before:")}    ${kleur.bold(String(meta.authorsBefore))} ${kleur.gray(`→ after: ${meta.authorsAfter}`)}`,
    `  ${kleur.gray("knowledge mass:")}    ${kleur.bold("-" + atrophy.knowledgeMassRemoved.toFixed(2))} ${kleur.gray("(sum of file freshness lost)")}`,
    `  ${kleur.gray("verdict:")}            ${kleur.gray(report.narrative)}`,
  ];

  const lostLines: string[] = [];
  for (const f of lostFiles.slice(0, 6)) {
    const top = f.allKnowers[0];
    const owner = top ? `${top.name || top.email} ${kleur.gray(`(${Math.round(top.knowledge * 100)}% fresh)`)}` : kleur.gray("(none)");
    lostLines.push(
      `    ${kleur.red().bold("ORPHAN")}  ${kleur.bold(f.filePath)}  ${kleur.gray(`${f.totalTouches} touches · former top expert: ${owner}`)}`,
    );
  }
  if (lostFiles.length > 6) {
    lostLines.push(`    ${kleur.gray(`… and ${lostFiles.length - 6} more`)}`);
  }

  const shiftLines: string[] = [];
  for (const s of tierShifts.slice(0, 6)) {
    const tag = labelForShift(s.shift);
    shiftLines.push(
      `    ${tag}  ${kleur.bold(s.filePath)}  ${kleur.gray(`${tierStr(s.tierBefore)} → ${tierStr(s.tierAfter)} · freshness ${Math.round(s.freshestBefore * 100)}% → ${Math.round(s.freshestAfter * 100)}%`)}`,
    );
  }

  const pairLines: string[] = [];
  for (const v of telepathy.vanishedPairs.slice(0, 5)) {
    pairLines.push(
      `    ${kleur.yellow("✦")} ${kleur.bold(v.authorA)} ${kleur.gray("⟷")} ${kleur.bold(v.authorB)}  ${kleur.gray(`vanishes (rank #${v.rankBefore} → none, score ${v.scoreBefore.toFixed(2)} → 0)`)}`,
    );
  }

  const sections: PyramidSection[] = [{ tier: "lede", title: "✦ What changes", lines: ledeLines }];

  if (lostLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: `⚠ Files that lose their last live expert (top ${Math.min(6, lostFiles.length)})`,
      lines: lostLines,
    });
  }
  if (shiftLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Tier shifts (top ${Math.min(6, tierShifts.length)})`,
      lines: shiftLines,
    });
  }
  if (pairLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Telepathic pairs that vanish (top ${Math.min(5, telepathy.vanishedPairs.length)})`,
      lines: pairLines,
    });
  }
  sections.push({
    tier: "sources",
    title: "→ Try next",
    lines: [
      `    ${kleur.cyan("$")} ${kleur.bold("mneme atrophy")} ${kleur.gray("(see the full live-expertise heatmap as it stands today)")}`,
      `    ${kleur.cyan("$")} ${kleur.bold("mneme passport " + report.authorEmail)} ${kleur.gray("(see what they own + originate)")}`,
      "",
      `    ${kleur.gray("📘 How to read:")} this is a ${kleur.italic("Bayesian what-if")}, not a prediction.`,
      `    ${kleur.gray("Use it as a heat-map of where to invest in pairing or documentation —")}`,
      `    ${kleur.gray("never as an evaluation of the person.")}`,
    ],
  });
  sections.push({
    tier: "details",
    title: "∎ Honest limits",
    lines: [
      `    ${kleur.gray("• Influence (cultural-alpha) is NOT re-simulated — it walks live git, not the indexed store.")}`,
      `    ${kleur.gray("• Real history would not have unfolded the same way without this person.")}`,
      `    ${kleur.gray("• A file with one live expert pre-removal may still be safe — the freshness tier can hide that.")}`,
    ],
  });

  process.stdout.write(iris.render({ headline, sections }) + "\n");
  return 0;
}

function tierStr(t: "safe" | "warn" | "at-risk"): string {
  switch (t) {
    case "safe":
      return kleur.green("safe");
    case "warn":
      return kleur.yellow("warn");
    case "at-risk":
      return kleur.red("at-risk");
  }
}

function labelForShift(s: "lost-only-expert" | "lost-top-expert" | "tier-degraded" | "no-impact"): string {
  switch (s) {
    case "lost-only-expert":
      return kleur.red().bold("ORPHAN  ");
    case "lost-top-expert":
      return kleur.yellow().bold("LOST-TOP");
    case "tier-degraded":
      return kleur.yellow().bold("DEGRADED");
    case "no-impact":
      return kleur.gray().bold("NO-OP   ");
  }
}
