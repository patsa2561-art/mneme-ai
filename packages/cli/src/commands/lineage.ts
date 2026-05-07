/**
 * `mneme lineage <target>` — philosophical inheritance of code.
 *
 * Says whose interpretation of whose intent currently lives in this code —
 * not who wrote line N (that's `git blame`).
 *
 * --json shape: see {@link LineageReport} in
 * `packages/core/src/people/lineage.ts`.
 */
import kleur from "kleur";
import { git, store, people } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";
import { iris, type PyramidSection } from "../iris/index.js";

export interface LineageCommandOptions {
  cwd: string;
  target: string;
  depth?: number;
  json?: boolean;
}

export async function lineageCommand(opts: LineageCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repository. Run `git init`, then `mneme init`.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    s.close();
    ui.error("Memory is empty. Run `mneme index` first.");
    return 1;
  }

  let report: people.LineageReport;
  try {
    report = people.buildLineageReport(s, {
      cwd: meta.rootPath,
      target: opts.target,
      depth: opts.depth,
    });
  } catch (err) {
    s.close();
    ui.error(`Lineage build failed: ${(err as Error).message}`);
    return 1;
  } finally {
    s.close();
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  return renderLineage(report);
}

function renderLineage(report: people.LineageReport): number {
  // Empty state — no commits indexed for this path.
  if (report.totalCommits === 0) {
    ui.banner();
    process.stdout.write(
      iris.render({
        headline: `🌳 No lineage — "${report.resolvedFilePath}" not in the index`,
        sections: [
          {
            tier: "lede",
            title: "✦ What we found",
            lines: [
              `  ${kleur.gray("path:")} ${kleur.bold(report.resolvedFilePath)}`,
              `  ${kleur.gray("commits indexed for this path:")} ${kleur.bold("0")}`,
            ],
          },
          {
            tier: "sources",
            title: "→ Try next",
            lines: [
              `    ${kleur.cyan("$")} ${kleur.bold("mneme index")} ${kleur.gray("(populate the memory layer first)")}`,
              `    ${kleur.cyan("$")} ${kleur.bold("mneme lineage <other-file>")} ${kleur.gray("(double-check the path is correct + tracked)")}`,
            ],
          },
        ],
      }),
    );
    process.stdout.write("\n");
    return 0;
  }

  // Headline — top 3 owners with role labels.
  const headline = (() => {
    if (report.ownership.length === 0) return `🌳 ${labelTarget(report)} — no ownership data`;
    const tops = report.ownership.slice(0, 3);
    const pieces = tops.map(
      (o) => `${o.percent.toFixed(0)}% ${shortName(o.name || o.author)} (${o.role})`,
    );
    return `🌳 ${labelTarget(report)} — ${pieces.join(" + ")}`;
  })();

  const ledeLines: string[] = [
    `  ${kleur.gray("target:")}        ${kleur.bold(report.resolvedFilePath)}${report.functionFilter ? kleur.gray(":" + report.functionFilter) : ""}`,
    `  ${kleur.gray("commits walked:")} ${kleur.bold(String(report.timeline.length))}${report.timeline.length < report.totalCommits ? kleur.gray(` of ${report.totalCommits} total (most recent first)`) : ""}`,
    `  ${kleur.gray("narrative:")}     ${kleur.cyan(report.narrative)}`,
  ];
  if (report.headsUp) {
    ledeLines.push(`  ${kleur.yellow("⚠ HEADS UP")}  ${kleur.yellow(report.headsUp)}`);
  }

  const ownershipLines: string[] = [];
  if (report.ownership.length === 0) {
    ownershipLines.push(`    ${kleur.gray("(no owner above 1% — file is fragmentary)")}`);
  } else {
    for (const o of report.ownership) {
      const bar = ownershipBar(o.percent);
      ownershipLines.push(
        `    ${bar}  ${kleur.bold((o.percent.toFixed(1) + "%").padStart(6))}  ${kleur.bold(o.name || o.author)}  ${kleur.gray(`<${o.author}>`)}  ${kleur.cyan("[" + o.role + "]")}`,
      );
    }
  }

  const timelineLines: string[] = [];
  if (report.timeline.length === 0) {
    timelineLines.push(`    ${kleur.gray("(empty)")}`);
  } else {
    for (const t of report.timeline) {
      const dateShort = t.date.slice(0, 10);
      const subj = (t.subject || "(no subject)").slice(0, 60);
      const cont = t.intentContinuity;
      const contLabel =
        cont >= 0.85
          ? kleur.green("preserved")
          : cont >= 0.5
            ? kleur.cyan("evolved")
            : cont >= 0.2
              ? kleur.yellow("shifted")
              : kleur.red("rewrote");
      const top = t.ownershipAfter[0];
      const ownAfter = top ? `${top.percent.toFixed(0)}% ${shortName(top.email)}` : "—";
      timelineLines.push(
        `    ${kleur.gray("●")} ${kleur.bold(t.shortHash)} ${kleur.gray(dateShort)} ${kleur.bold(shortName(t.authorName || t.author))}  ${contLabel} ${kleur.gray(`(intent ${cont.toFixed(2)})`)}  ${kleur.gray("· diff " + t.diffSize + " · ↓ " + ownAfter)}`,
      );
      timelineLines.push(`        ${kleur.gray(subj)}`);
    }
  }

  const howToRead: string[] = [
    `    ${kleur.gray("•")} ${kleur.bold("This is semantic ownership, not legal authorship.")} ${kleur.gray("git blame says who typed line N. mneme lineage says whose INTENT lives here today.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("intent")} ${kleur.gray("= similarity between this commit's stated purpose and the prior commit's. 1.00 = preserved, 0.00 = different topic.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("A 5-line refactor that changes the entire model")} ${kleur.gray("owns more semantically than a 500-line stylistic pass — that's the point.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("design")} ${kleur.gray("= first author with ≥40% ·")} ${kleur.bold("refactor")} ${kleur.gray("= big-diff later commit ·")} ${kleur.bold("extension")} ${kleur.gray("= incremental ·")} ${kleur.bold("polish")} ${kleur.gray("= small touch.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("Use cases:")} ${kleur.gray("review assignment (find the spiritual owner) · onboarding (see whose interpretations stack up) · NOT performance review.")}`,
  ];

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Lineage — semantic ownership", lines: ledeLines },
    { tier: "key-facts", title: "◆ Current ownership (after the last commit)", lines: ownershipLines },
    { tier: "body", title: "◆ Timeline — how lineage shifted", lines: timelineLines },
    { tier: "details", title: "📘 How to read this report", lines: howToRead },
    {
      tier: "sources",
      title: "→ Try next",
      lines: [
        `    ${kleur.cyan("$")} ${kleur.bold("mneme lineage " + report.resolvedFilePath + " --depth 50")} ${kleur.gray("(walk further back)")}`,
        `    ${kleur.cyan("$")} ${kleur.bold("mneme why " + report.resolvedFilePath)} ${kleur.gray("(retrieve commits about this file)")}`,
        `    ${kleur.cyan("$")} ${kleur.bold("mneme htc-build")} ${kleur.gray("(deeper intent signal — fuses HTC abstracts into continuity)")}`,
      ],
    },
  ];

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
  return 0;
}

function labelTarget(report: people.LineageReport): string {
  if (report.functionFilter) {
    return `${baseName(report.resolvedFilePath)}:${report.functionFilter}()`;
  }
  return baseName(report.resolvedFilePath);
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

function shortName(name: string): string {
  if (!name) return "(unknown)";
  if (name.includes("@")) return name.split("@")[0] ?? name;
  return name;
}

function ownershipBar(percent: number): string {
  // 12-cell bar matching the percentage.
  const cells = 12;
  const filled = Math.round((percent / 100) * cells);
  const empty = Math.max(0, cells - filled);
  const bar = "█".repeat(filled);
  const rest = "░".repeat(empty);
  let paint: (s: string) => string;
  if (percent >= 60) paint = (s) => kleur.green().bold(s);
  else if (percent >= 30) paint = (s) => kleur.cyan(s);
  else if (percent >= 10) paint = (s) => kleur.yellow(s);
  else paint = (s) => kleur.gray(s);
  return paint(bar) + kleur.gray(rest);
}
