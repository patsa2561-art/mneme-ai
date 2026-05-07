/**
 * `mneme atrophy [author]` — knowledge half-life clock.
 *
 * Three modes:
 *   1. (no args)             → repo-wide heatmap (top authors + at-risk files)
 *   2. <author email>        → that author's knowledge map across files
 *   3. --file <path>         → who still remembers this file?
 *
 * --json shape (stable):
 *
 * Mode 1 (repo-wide):
 *   {
 *     "mode": "repo",
 *     "authors": Array<{
 *       "name": string, "email": string,
 *       "knowledgeMass": number,    // sum of knowledge_score across all files
 *       "filesKnown": number,
 *       "filesStillFresh": number,
 *       "lastActiveAt": string
 *     }>,
 *     "atRiskFiles": Array<{
 *       "filePath": string, "totalTouches": number,
 *       "tier": "safe" | "warn" | "at-risk",
 *       "freshestKnowledge": number,
 *       "liveExperts": Array<{ name, email, knowledge, lastTouchDaysAgo, touchCount }>,
 *       "allKnowers": Array<{ name, email, knowledge, lastTouchDaysAgo, touchCount }>
 *     }>,
 *     "stats": {
 *       "halfLifeDays": number, "asOf": string,
 *       "authorCount": number, "fileCount": number, "totalCommits": number,
 *       "filesWithLiveExpert": number, "ghostedFiles": number
 *     }
 *   }
 *
 * Mode 2 (per author):
 *   { "mode": "author", "author": AuthorKnowledge,
 *     "topFiles": Array<{ filePath, knowledge, lastTouchDaysAgo, touchCount, band }> }
 *
 * Mode 3 (per file):
 *   { "mode": "file", "file": FileKnowledge }
 */

import kleur from "kleur";
import { git, store, people } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, header, emptyState, pill } from "../ui.js";
import {
  iris,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  type PyramidSection,
} from "../iris/index.js";
import { explain, type ExplainRequest } from "../utils/explain.js";

const COMMAND_ID = "atrophy";

export interface AtrophyOptions {
  cwd: string;
  /** Optional positional — author email to focus on. */
  author?: string;
  /** Optional --file flag — show "who knows this file?" view. */
  file?: string;
  halfLifeDays?: number;
  topN?: number;
  json?: boolean;
  /** When set: prepend a plain-English narrative summary (LLM-generated). */
  explain?: boolean;
  /** Test seam: inject an enricher factory so unit tests don't hit the network. */
  explainEnricherFactory?: ExplainRequest["enricherFactory"];
}

export async function atrophyCommand(opts: AtrophyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    s.close();
    ui.error("Memory is empty. Run `mneme index` first.");
    return 1;
  }

  try {
    if (opts.file) return runFileMode(s, opts, meta.rootPath);
    if (opts.author) return runAuthorMode(s, opts, meta.rootPath);
    return await runRepoMode(s, opts, meta.rootPath);
  } finally {
    s.close();
  }
}

// ─── Mode 1 — repo-wide ───────────────────────────────────────────────

async function runRepoMode(
  s: store.MnemeStore,
  opts: AtrophyOptions,
  repoRoot: string,
): Promise<number> {
  const report = people.atrophy(s, {
    halfLifeDays: opts.halfLifeDays,
    topN: opts.topN ?? 10,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: "repo", ...report }, null, 2) + "\n");
    return 0;
  }

  // Optional --explain narrative — runs in parallel with the table render
  // to keep wall-clock latency low. If the LLM call fails we just skip it.
  let explainSection: PyramidSection | null = null;
  let explainHeadsUp: string | null = null;
  if (opts.explain) {
    const result = await explain({
      enabled: true,
      enricherFactory: opts.explainEnricherFactory,
      system:
        "You are a staff engineer briefing a team lead on knowledge-decay risk. " +
        "Given a JSON snapshot of authors and at-risk files (Ebbinghaus half-life model), " +
        "write 3-4 sentences in plain English: " +
        "(1) the headline knowledge-risk story, " +
        "(2) the 1-2 specific files most worth refreshing first and why, " +
        "(3) one concrete recommendation. " +
        "Be honest about uncertainty when commit count is low. No emoji.",
      user: atrophyToExplainPrompt(report),
      maxTokens: 240,
    });
    explainSection = result.section;
    explainHeadsUp = result.headsUp;
  }

  const showGuide = readShouldShowGuide(repoRoot);

  // ─── Headline ────────────────────────────────────────────────────────
  // We frame the headline around DEEP-knowledge ghosting (≥2 touches lost)
  // because single-touch files were never deeply known. This matches what
  // a manager actually wants to see ("real expertise is gone here").
  const ghostedDeep = report.stats.ghostedDeepFiles;
  const ghostedAll = report.stats.ghostedFiles;
  const headline =
    ghostedDeep > 0
      ? `⚠ ${ghostedDeep} deep-history file${ghostedDeep === 1 ? "" : "s"} lost their last expert — ghost code risk`
      : ghostedAll > 0
        ? `✦ Repo knowledge heatmap — ${report.authors.length} active expert${report.authors.length === 1 ? "" : "s"} · ${ghostedAll} shallow files (1 touch only)`
        : `✦ Repo knowledge heatmap — ${report.authors.length} active expert${report.authors.length === 1 ? "" : "s"}, all files well-remembered`;

  const dataPills: string[] = [];
  if (report.stats.authorCount < 2) {
    dataPills.push(pill("HEADS UP", "warn") + " " + kleur.gray("only 1 author in repo — atrophy still works but the per-author ranking is trivial."));
  } else if (report.stats.totalCommits < 30) {
    dataPills.push(pill("HEADS UP", "warn") + " " + kleur.gray(`only ${report.stats.totalCommits} commits — knowledge math gets steadier with 50+ commits.`));
  }

  // ─── Lede — headline numbers in plain English ───────────────────────
  const livePct =
    report.stats.fileCount > 0
      ? Math.round((report.stats.filesWithLiveExpert / report.stats.fileCount) * 100)
      : 0;
  const ledeLines: string[] = [
    `  ${kleur.gray("half-life:")} ${kleur.bold(report.stats.halfLifeDays + " days")} ${kleur.gray("(after this many days, knowledge decays to ~50%)")}`,
    `  ${kleur.gray("files with a live expert:")} ${kleur.bold(report.stats.filesWithLiveExpert + " / " + report.stats.fileCount)} ${kleur.gray(`(${livePct}% — someone still remembers these)`)}`,
    `  ${kleur.gray("ghost code (deep history lost):")} ${ghostedDeep > 0 ? kleur.red().bold(String(ghostedDeep)) : kleur.green("0")} ${kleur.gray("(≥2 historical touches, now no live expert — real re-onboarding)")}`,
    `  ${kleur.gray("shallow files (1 touch, never deep):")} ${kleur.gray().bold(String(report.stats.shallowFiles))} ${kleur.gray("(read fresh next time — never expected expertise here)")}`,
  ];

  // ─── Top experts ────────────────────────────────────────────────────
  const expertLines: string[] = [];
  if (report.authors.length > 0) {
    const maxMass = report.authors[0]!.knowledgeMass || 1;
    for (let i = 0; i < report.authors.length; i++) {
      const a = report.authors[i]!;
      const ratio = a.knowledgeMass / maxMass;
      const meter = bar(ratio, 12);
      const freshPct =
        a.filesKnown > 0
          ? Math.round((a.filesStillFresh / a.filesKnown) * 100)
          : 0;
      expertLines.push(
        `    ${kleur.cyan(meter)}  ${kleur.bold(a.name.padEnd(22))}  ${kleur.gray("mass")} ${kleur.bold(a.knowledgeMass.toFixed(1))}  ${kleur.gray(`(${a.filesStillFresh}/${a.filesKnown} files still fresh — ${freshPct}%)`)}`,
      );
    }
  }

  // ─── At-risk files ──────────────────────────────────────────────────
  const riskLines: string[] = [];
  for (const f of report.atRiskFiles) {
    const tag = renderTier(f.tier);
    const pctFresh = Math.round(f.freshestKnowledge * 100);
    const expert = f.allKnowers[0];
    // Honest cause: shallow vs faded.
    //   shallow → only one or two touches; never deep. Read it cold.
    //   faded   → had history but it's old. Re-read.
    const cause =
      f.totalTouches <= 1
        ? "shallow knowledge — only 1 touch, not yet deep"
        : f.freshestKnowledge < 0.1
          ? "ghost code — re-onboarding required"
          : "knowledge faded — needs review before next change";
    const expertStr = expert
      ? `${kleur.bold(expert.name)} ${kleur.gray(`(touched ${expert.touchCount}× · last ${humanDays(expert.lastTouchDaysAgo)})`)}`
      : kleur.gray("(no knowers)");
    riskLines.push(
      `    ${tag}  ${kleur.bold(f.filePath)}  ${kleur.gray(`(top knower ${pctFresh}% fresh — ${cause})`)}`,
    );
    riskLines.push(
      `        ${kleur.gray("freshest knower:")} ${expertStr}  ${kleur.gray("·")} ${kleur.gray(f.totalTouches + " total touches")}`,
    );
  }

  // ─── Sources ────────────────────────────────────────────────────────
  const sourceLines: string[] = [];
  if (report.atRiskFiles.length > 0) {
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme atrophy --file ${report.atRiskFiles[0]!.filePath}`)} ${kleur.gray("(every author who ever knew this file)")}`,
    );
  }
  if (report.authors.length > 0) {
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme atrophy ${report.authors[0]!.email}`)} ${kleur.gray("(this author's full knowledge map)")}`,
    );
  }
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold("mneme bus-factor")} ${kleur.gray("(complementary view — files where one person owns ≥75%)")}`,
  );

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} ${kleur.bold("knowledge_score")} ${kleur.gray("= exp(-days/half_life) × familiarity-from-touches. Range 0..1.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("•")} ${kleur.green("safe")} ${kleur.gray("≥ 0.7  ·  ")}${kleur.yellow("warn")} ${kleur.gray("0.3–0.7  ·  ")}${kleur.red("at-risk")} ${kleur.gray("< 0.3 (no live expert)")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("•")} ${kleur.bold("knowledge mass")} ${kleur.gray("= the sum of every file score that author still owns. Higher = broader living memory.")}`,
    );
  }

  // ─── Compose ────────────────────────────────────────────────────────
  const sections: PyramidSection[] = [];
  if (explainSection) sections.push(explainSection);
  if (explainHeadsUp) {
    sections.push({ tier: "lede", lines: [`  ${explainHeadsUp}`] });
  }
  if (dataPills.length > 0) {
    sections.push({ tier: "lede", lines: dataPills.map((l) => `  ${l}`) });
  }
  sections.push({ tier: "lede", title: "✦ Repo-wide", lines: ledeLines });
  if (expertLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: `◆ Top experts by living knowledge (top ${report.authors.length})`,
      lines: expertLines,
    });
  }
  if (riskLines.length > 0) {
    sections.push({
      tier: "body",
      title: `⚠ Knowledge-risk files (top ${report.atRiskFiles.length})`,
      lines: riskLines,
    });
  }
  if (sourceLines.length > 0) {
    sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });
  }

  ui.banner();
  if (report.stats.fileCount === 0) {
    process.stdout.write(
      header(
        "⏳",
        "Atrophy — knowledge half-life clock",
        "no indexed files",
        "Knowledge decays. This command shows who still remembers what.",
      ) + "\n\n",
    );
    process.stdout.write(
      emptyState("No files in the index — nothing to score.", [
        "Run `mneme index` to populate the memory.",
      ]),
    );
    return 0;
  }
  process.stdout.write(iris.render({ headline, sections }) + "\n");
  try {
    recordCommandRun(repoRoot, COMMAND_ID);
  } catch {
    /* best effort */
  }
  return 0;
}

// ─── Mode 2 — per author ──────────────────────────────────────────────

function runAuthorMode(
  s: store.MnemeStore,
  opts: AtrophyOptions,
  repoRoot: string,
): number {
  const detail = people.atrophyForAuthor(s, opts.author!, {
    halfLifeDays: opts.halfLifeDays,
    topN: opts.topN ?? 20,
  });
  if (!detail) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ mode: "author", author: null }, null, 2) + "\n");
      return 0;
    }
    ui.error(`No commits found for author <${opts.author}>.`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: "author", ...detail }, null, 2) + "\n");
    return 0;
  }

  const a = detail.author;
  const lastDays = a.lastActiveAt ? Math.round((Date.now() - Date.parse(a.lastActiveAt)) / 86_400_000) : null;

  const headline = `⏳ ${a.name} — ${a.filesKnown} files known · ${a.filesStillFresh} still fresh`;
  const showGuide = readShouldShowGuide(repoRoot);

  const ledeLines: string[] = [
    `  ${kleur.gray("knowledge mass:")} ${kleur.bold(a.knowledgeMass.toFixed(1))} ${kleur.gray("(sum of every file score they still own)")}`,
    `  ${kleur.gray("last active:")} ${kleur.bold(formatDate(a.lastActiveAt))}${lastDays != null ? kleur.gray(`  (${humanDays(lastDays)})`) : ""}`,
    `  ${kleur.gray("files still fresh:")} ${kleur.bold(String(a.filesStillFresh))} ${kleur.gray("of")} ${kleur.bold(String(a.filesKnown))} ${kleur.gray("(knowledge ≥ 0.3)")}`,
  ];

  const fileLines: string[] = [];
  for (const f of detail.topFiles) {
    const band = renderBand(f.band);
    const pctFresh = Math.round(f.knowledge * 100);
    const explain = people.explainKnowledge(f.knowledge);
    fileLines.push(
      `    ${band}  ${kleur.bold(f.filePath)}  ${kleur.gray(`(${pctFresh}% fresh — ${explain})`)}`,
    );
    fileLines.push(
      `        ${kleur.gray("touched")} ${kleur.bold(String(f.touchCount))} ${kleur.gray("times · last touch")} ${humanDays(f.lastTouchDaysAgo)}`,
    );
  }

  const sourceLines: string[] = [];
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold("mneme atrophy")} ${kleur.gray("(repo-wide heatmap of all authors)")}`,
  );
  if (detail.topFiles.length > 0) {
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme atrophy --file ${detail.topFiles[0]!.filePath}`)} ${kleur.gray("(everyone who ever knew this file)")}`,
    );
  }

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} ${kleur.gray("each row = one file. ")}${kleur.green("fresh")} ${kleur.gray("≥ 70% · ")}${kleur.yellow("warm")} ${kleur.gray("30–70% · ")}${kleur.gray("fading 10–30% · ghosted < 10%.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("• A 50% file means ~30 minutes of refresh; 30% needs ~2 hours; <10% is full re-onboarding.")}`,
    );
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Author knowledge profile", lines: ledeLines },
  ];
  if (fileLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Top files known (top ${detail.topFiles.length})`,
      lines: fileLines,
    });
  } else {
    sections.push({
      tier: "body",
      title: "◆ Files known",
      lines: [`    ${kleur.gray("(none above noise threshold)")}`],
    });
  }
  if (sourceLines.length > 0) {
    sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });
  }

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }) + "\n");
  try {
    recordCommandRun(repoRoot, COMMAND_ID);
  } catch {
    /* best effort */
  }
  return 0;
}

// ─── Mode 3 — per file ────────────────────────────────────────────────

function runFileMode(
  s: store.MnemeStore,
  opts: AtrophyOptions,
  repoRoot: string,
): number {
  const file = people.atrophyForFile(s, opts.file!, {
    halfLifeDays: opts.halfLifeDays,
  });
  if (!file) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ mode: "file", file: null }, null, 2) + "\n");
      return 0;
    }
    ui.error(`No commits found that touched ${opts.file}.`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: "file", file }, null, 2) + "\n");
    return 0;
  }

  const tier = renderTier(file.tier);
  const headline =
    file.tier === "at-risk"
      ? `⚠ ${file.filePath} — no live expert (${Math.round((1 - file.freshestKnowledge) * 100)}% decayed)`
      : file.tier === "warn"
        ? `✦ ${file.filePath} — knowledge fading (top expert ${Math.round(file.freshestKnowledge * 100)}% fresh)`
        : `✦ ${file.filePath} — well-remembered (top expert ${Math.round(file.freshestKnowledge * 100)}% fresh)`;
  const showGuide = readShouldShowGuide(repoRoot);

  const ledeLines: string[] = [
    `  ${kleur.gray("tier:")} ${tier}  ${kleur.gray("·")}  ${kleur.gray("total touches:")} ${kleur.bold(String(file.totalTouches))}  ${kleur.gray("·")}  ${kleur.gray("live experts:")} ${kleur.bold(String(file.liveExperts.length))}`,
  ];

  const expertLines: string[] = [];
  for (const e of file.allKnowers) {
    const pct = Math.round(e.knowledge * 100);
    const band = bandForScore(e.knowledge);
    const bandTag = renderBand(band);
    const explain = people.explainKnowledge(e.knowledge);
    expertLines.push(
      `    ${bandTag}  ${kleur.bold(e.name.padEnd(22))} ${kleur.gray("<" + e.email + ">")}`,
    );
    expertLines.push(
      `        ${kleur.gray("knowledge")} ${kleur.bold(pct + "%")} ${kleur.gray(`(${explain})`)}  ${kleur.gray("· last touch")} ${humanDays(e.lastTouchDaysAgo)} ${kleur.gray("· touched")} ${kleur.bold(String(e.touchCount))} ${kleur.gray("times")}`,
    );
  }

  const sourceLines: string[] = [
    `    ${kleur.cyan("$")} ${kleur.bold(`mneme atrophy ${file.allKnowers[0]?.email ?? ""}`)} ${kleur.gray("(this person's full knowledge profile)")}`,
    `    ${kleur.cyan("$")} ${kleur.bold("mneme bus-factor")} ${kleur.gray("(broader: every file with single-owner risk)")}`,
  ];

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} ${kleur.gray("each row is an author who ever touched the file. Rows are sorted by current knowledge — freshest first.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("• A 'live expert' is anyone with ≥30% knowledge — pair them with someone fading to transfer context.")}`,
    );
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ File knowledge profile", lines: ledeLines },
    {
      tier: "body",
      title: `◆ Who still knows ${file.filePath}`,
      lines: expertLines.length > 0 ? expertLines : [`    ${kleur.gray("(no knowers above noise threshold)")}`],
    },
    { tier: "sources", title: "→ Try next", lines: sourceLines },
  ];

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }) + "\n");
  try {
    recordCommandRun(repoRoot, COMMAND_ID);
  } catch {
    /* best effort */
  }
  return 0;
}

// ─── helpers ──────────────────────────────────────────────────────────

function readShouldShowGuide(repoRoot: string): boolean {
  try {
    const state = readIrisState(repoRoot);
    return shouldShowVerboseGuide(state, COMMAND_ID);
  } catch {
    return true;
  }
}

function renderTier(tier: "safe" | "warn" | "at-risk"): string {
  switch (tier) {
    case "safe":
      return kleur.green().bold("SAFE   ");
    case "warn":
      return kleur.yellow().bold("WARN   ");
    case "at-risk":
      return kleur.red().bold("AT-RISK");
  }
}

function renderBand(band: "fresh" | "warm" | "fading" | "ghosted"): string {
  switch (band) {
    case "fresh":
      return kleur.green().bold("FRESH  ");
    case "warm":
      return kleur.cyan().bold("WARM   ");
    case "fading":
      return kleur.yellow().bold("FADING ");
    case "ghosted":
      return kleur.red().bold("GHOSTED");
  }
}

function bandForScore(score: number): "fresh" | "warm" | "fading" | "ghosted" {
  if (score >= 0.7) return "fresh";
  if (score >= 0.3) return "warm";
  if (score >= 0.1) return "fading";
  return "ghosted";
}

function bar(ratio: number, width: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function humanDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Trim the atrophy report down to the bits a narrative LLM actually needs.
 * Keeps prompt cost predictable: top-5 authors + top-8 at-risk files, stats.
 */
function atrophyToExplainPrompt(report: ReturnType<typeof people.atrophy>): string {
  const compact = {
    stats: report.stats,
    topAuthors: report.authors.slice(0, 5).map((a) => ({
      name: a.name,
      knowledgeMass: Number(a.knowledgeMass.toFixed(2)),
      filesKnown: a.filesKnown,
      filesStillFresh: a.filesStillFresh,
    })),
    atRiskFiles: report.atRiskFiles.slice(0, 8).map((f) => ({
      path: f.filePath,
      tier: f.tier,
      freshestKnowledgePct: Math.round(f.freshestKnowledge * 100),
      totalTouches: f.totalTouches,
      topKnower: f.allKnowers[0]
        ? { name: f.allKnowers[0].name, lastTouchDaysAgo: f.allKnowers[0].lastTouchDaysAgo }
        : null,
    })),
  };
  return JSON.stringify(compact, null, 2);
}
