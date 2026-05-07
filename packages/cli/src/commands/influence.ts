/**
 * `mneme influence` — code-pattern PageRank rendered Iris-style.
 *
 * Surfaces the "cultural alphas" of a codebase — the people whose patterns
 * everyone else copies. Volume-independent: a 5-commit pattern-setter
 * outranks a 500-commit copy-paster.
 *
 * --json shape: see {@link InfluenceReport} in
 * `packages/core/src/people/influence.ts`.
 */
import kleur from "kleur";
import { git, people } from "@mneme-ai/core";
import { ui } from "../ui.js";
import { iris, type PyramidSection } from "../iris/index.js";

type AuthorRanking = people.AuthorRanking;
type InfluenceReport = people.InfluenceReport;

export interface InfluenceCommandOptions {
  cwd: string;
  topN?: number;
  patternMinUses?: number;
  authorEmail?: string;
  json?: boolean;
}

export async function influenceCommand(opts: InfluenceCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repository. Run `git init`, then `mneme init`.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  let report: InfluenceReport;
  try {
    report = await people.buildInfluenceReport({
      cwd: meta.rootPath,
      topN: opts.topN,
      patternMinUses: opts.patternMinUses,
      authorEmail: opts.authorEmail,
    });
  } catch (err) {
    ui.error(`Influence build failed: ${(err as Error).message}`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  return renderInfluence(report, opts);
}

function renderInfluence(report: InfluenceReport, opts: InfluenceCommandOptions): number {
  const topN = Math.max(1, opts.topN ?? 10);
  const limited = report.rankings.slice(0, topN);

  // Author-mode short-circuit ─ render their pattern detail page.
  if (opts.authorEmail) {
    return renderAuthorDetail(report, opts.authorEmail, opts);
  }

  const top = limited[0];
  const headline = (() => {
    if (!top || top.adoptionsByOthers === 0) {
      return "👑 Cultural alpha · no clear adoption signal yet";
    }
    const adoptCount = top.adoptionsByOthers;
    const distinct = top.uniqueAdopters;
    const name = top.author.name || top.author.email;
    return `👑 Cultural alpha — ${name}: ${adoptCount} adoption${adoptCount === 1 ? "" : "s"} of ${pluralPossessive(name)} patterns by ${distinct} other${distinct === 1 ? "" : "s"}`;
  })();

  const ledeLines: string[] = [
    `  ${kleur.gray("authors ranked:")}    ${kleur.bold(String(report.rankings.length))}`,
    `  ${kleur.gray("shapes analyzed:")}   ${kleur.bold(String(report.totalShapesAnalyzed))}  ${kleur.gray(`(${report.shapesWithAdoption} with ≥1 adoption)`)}`,
    `  ${kleur.gray("min adoption floor:")} ${kleur.bold(String(opts.patternMinUses ?? 3))}  ${kleur.gray("(only patterns adopted this many times count)")}`,
  ];
  if (report.headsUp) {
    ledeLines.push(`  ${kleur.yellow("⚠ HEADS UP")}  ${kleur.yellow(report.headsUp)}`);
  }

  const tableLines: string[] = [];
  if (limited.length === 0) {
    tableLines.push(`    ${kleur.gray("(no rankings — repo is too small or no shape patterns reused)")}`);
  } else {
    // Header
    tableLines.push(
      `    ${kleur.gray("rank".padEnd(4))} ${kleur.gray("PR".padEnd(7))} ${kleur.gray("adopt".padEnd(7))} ${kleur.gray("uniq".padEnd(5))} ${kleur.gray("origin".padEnd(7))} ${kleur.gray("author")}`,
    );
    for (const r of limited) {
      tableLines.push(
        `    ${kleur.bold(("#" + r.rank).padEnd(4))} ${kleur.cyan(r.pageRank.toFixed(3).padEnd(7))} ${kleur.green(String(r.adoptionsByOthers).padEnd(7))} ${kleur.yellow(String(r.uniqueAdopters).padEnd(5))} ${kleur.magenta(String(r.originatedShapesAdopted).padEnd(7))} ${kleur.bold(r.author.name)} ${kleur.gray(`<${r.author.email}>`)}`,
      );
      // Plain-English row.
      tableLines.push(
        `         ${kleur.gray("→ " + plainEnglishRow(r))}`,
      );
    }
  }

  // Top alpha's signature patterns + adopters.
  const detailLines: string[] = [];
  if (top) {
    const detail = report.perAuthor[top.author.email];
    if (detail && detail.topShapes.length > 0) {
      detailLines.push(
        `    ${kleur.bold(top.author.name)} ${kleur.gray("— top patterns adopted by others:")}`,
      );
      for (const s of detail.topShapes) {
        const arity = s.shape.arity === 1 ? "1 arg" : `${s.shape.arity} args`;
        detailLines.push(
          `        ${kleur.cyan("●")} ${kleur.bold(s.shape.name)}${kleur.gray("(" + arity + ")")}  ${kleur.gray("·")} ${kleur.green(`${s.adoptions}× adoption`)}${s.adoptions === 1 ? "" : "s"}`,
        );
        const sample = s.adopters.slice(0, 3);
        for (const ad of sample) {
          detailLines.push(
            `            ${kleur.gray("↳")} ${kleur.gray(ad.name || ad.email)} ${kleur.gray("·")} ${kleur.gray(ad.file)}`,
          );
        }
        if (s.adopters.length > sample.length) {
          detailLines.push(`            ${kleur.gray("…")} ${kleur.gray(`and ${s.adopters.length - sample.length} more`)}`);
        }
      }
    } else if (top.adoptionsByOthers === 0) {
      detailLines.push(
        `    ${kleur.gray("Top author has no adopted patterns above the --pattern-min-uses floor.")}`,
      );
      detailLines.push(
        `    ${kleur.gray("Try lowering the floor:")} ${kleur.cyan("$")} ${kleur.bold("mneme influence --pattern-min-uses 1")}`,
      );
    }
  }

  const howToRead: string[] = [
    `    ${kleur.gray("•")} ${kleur.bold("PR")} ${kleur.gray("(PageRank) is volume-independent — a 5-commit pattern-setter outranks a 500-commit copy-paster. It's the share of cultural credit each person owns.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("adopt")} ${kleur.gray("= total times someone else copied this person's shape (function name + arity).")}`,
    `    ${kleur.gray("•")} ${kleur.bold("uniq")} ${kleur.gray("= distinct adopters. 8 unique adopters means a real cultural pattern, not one fan.")}`,
    `    ${kleur.gray("•")} ${kleur.bold("origin")} ${kleur.gray("= patterns this person originated that ≥3 (or your --pattern-min-uses) others adopted.")}`,
    `    ${kleur.gray("•")} ${kleur.gray("Languages walked: TypeScript / JavaScript (full-fidelity AST), Python / Go (regex shape extractor — multi-line signatures may be missed). Other languages are not analyzed yet.")}`,
    `    ${kleur.gray("•")} ${kleur.gray("This is")} ${kleur.bold("not")} ${kleur.gray("a productivity ranking. It's a cultural-influence ranking — who shapes how the team writes code.")}`,
  ];

  const tryNext: string[] = [
    `    ${kleur.cyan("$")} ${kleur.bold("mneme influence --top 25")} ${kleur.gray("(see further down the rank)")}`,
    `    ${kleur.cyan("$")} ${kleur.bold("mneme influence --pattern-min-uses 1")} ${kleur.gray("(loosen the floor; useful on small repos)")}`,
  ];
  if (top) {
    tryNext.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme influence --author ${top.author.email}`)} ${kleur.gray("(deep-dive on the cultural alpha)")}`,
    );
  }
  tryNext.push(
    `    ${kleur.cyan("$")} ${kleur.bold("mneme influence --json | jq")} ${kleur.gray("(structured for scripts)")}`,
  );

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Cultural alphas — who shapes how this team writes code", lines: ledeLines },
    { tier: "key-facts", title: "◆ Ranked by PageRank (volume-independent)", lines: tableLines },
  ];
  if (detailLines.length > 0) {
    sections.push({ tier: "body", title: "◆ Top alpha's signature patterns", lines: detailLines });
  }
  sections.push({ tier: "details", title: "📘 How to read this report", lines: howToRead });
  sections.push({ tier: "sources", title: "→ Try next", lines: tryNext });

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
  return 0;
}

function renderAuthorDetail(
  report: InfluenceReport,
  email: string,
  opts: InfluenceCommandOptions,
): number {
  const ranking = report.rankings.find((r) => r.author.email === email);
  const detail = report.perAuthor[email];

  const headline = ranking
    ? `👁  ${ranking.author.name} — rank #${ranking.rank} · ${ranking.adoptionsByOthers} adoption${ranking.adoptionsByOthers === 1 ? "" : "s"} of ${pluralPossessive(ranking.author.name)} patterns`
    : `👁  ${email} — no patterns above the floor (try --pattern-min-uses 1)`;

  const ledeLines: string[] = ranking
    ? [
        `  ${kleur.gray("PageRank:")}        ${kleur.bold(ranking.pageRank.toFixed(3))}  ${kleur.gray("(higher = more cultural pull)")}`,
        `  ${kleur.gray("originated:")}      ${kleur.bold(String(ranking.originatedShapesTotal))}  ${kleur.gray(`shape${ranking.originatedShapesTotal === 1 ? "" : "s"} total`)}`,
        `  ${kleur.gray("of which adopted:")} ${kleur.bold(String(ranking.originatedShapesAdopted))}  ${kleur.gray(`(at the ≥${opts.patternMinUses ?? 3}-uses floor)`)}`,
        `  ${kleur.gray("adoptions:")}       ${kleur.bold(String(ranking.adoptionsByOthers))}  ${kleur.gray(`from ${ranking.uniqueAdopters} unique adopter${ranking.uniqueAdopters === 1 ? "" : "s"}`)}`,
        `  ${kleur.gray("they adopted:")}    ${kleur.bold(String(ranking.adoptionsByThisAuthor))}  ${kleur.gray(`pattern${ranking.adoptionsByThisAuthor === 1 ? "" : "s"} from others`)}`,
      ]
    : [`  ${kleur.gray("No record of this email in the originator graph.")}`];

  const patternLines: string[] = [];
  if (detail && detail.topShapes.length > 0) {
    for (const s of detail.topShapes) {
      const arity = s.shape.arity === 1 ? "1 arg" : `${s.shape.arity} args`;
      patternLines.push(
        `    ${kleur.cyan("●")} ${kleur.bold(s.shape.name)}${kleur.gray("(" + arity + ")")}  ${kleur.gray("·")} ${kleur.green(`${s.adoptions}× adoption${s.adoptions === 1 ? "" : "s"}`)}`,
      );
      for (const ad of s.adopters) {
        patternLines.push(
          `        ${kleur.gray("↳")} ${kleur.gray(ad.name || ad.email)} ${kleur.gray("·")} ${kleur.gray(ad.file)}`,
        );
      }
    }
  } else {
    patternLines.push(
      `    ${kleur.gray("No patterns above the floor. Try --pattern-min-uses 1 to see all originated shapes.")}`,
    );
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Author detail", lines: ledeLines },
    { tier: "body", title: "◆ Originated patterns adopted by others", lines: patternLines },
    {
      tier: "sources",
      title: "→ Try next",
      lines: [
        `    ${kleur.cyan("$")} ${kleur.bold("mneme influence")} ${kleur.gray("(see the team-wide ranking)")}`,
        `    ${kleur.cyan("$")} ${kleur.bold("mneme dna " + email)} ${kleur.gray("(this author's coding fingerprint)")}`,
      ],
    },
  ];
  if (report.headsUp) {
    sections[0]!.lines.push(`  ${kleur.yellow("⚠ HEADS UP")}  ${kleur.yellow(report.headsUp)}`);
  }

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
  return 0;
}

function plainEnglishRow(r: AuthorRanking): string {
  if (r.adoptionsByOthers === 0 && r.originatedShapesTotal === 0) {
    // NEVER call anyone "a copy-paster" — that's a personal-quality
    // judgement from a heuristic that only walks TS/JS/Python/Go AST
    // shapes; it is blind to docs, infra, configs, design work.
    return "no team-adopted patterns above the floor yet (metric is blind to non-code work — configs, docs, infra)";
  }
  if (r.adoptionsByOthers === 0) {
    return `originated ${r.originatedShapesTotal} pattern${r.originatedShapesTotal === 1 ? "" : "s"} but none crossed the adoption floor yet`;
  }
  if (r.adoptionsByThisAuthor > r.adoptionsByOthers * 2) {
    return `mostly adopts others' patterns (${r.adoptionsByThisAuthor} adopted vs ${r.adoptionsByOthers} adopted-from-them) — not a cultural setter`;
  }
  return `${r.originatedShapesAdopted} pattern${r.originatedShapesAdopted === 1 ? "" : "s"} they shipped became team idiom (${r.adoptionsByOthers} adoption${r.adoptionsByOthers === 1 ? "" : "s"} by ${r.uniqueAdopters} other${r.uniqueAdopters === 1 ? "" : "s"})`;
}

function pluralPossessive(name: string): string {
  if (!name) return "their";
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}
