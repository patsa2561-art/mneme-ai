/**
 * `mneme passport [author]` — engineer dossier.
 *
 * Composes Wave-1 modules (telepathy, atrophy, influence, promise, +DNA) into
 * a single 2–3-page report — terminal-renderable, HTML-renderable, PDF-renderable.
 *
 * Three modes of "where does the report go":
 *   - default       → Iris terminal output
 *   - --html PATH   → write a self-contained HTML dossier
 *   - --pdf PATH    → write a PDF (requires puppeteer-core; gracefully degrades)
 *
 * --json shape mirrors `PassportData` from `@mneme-ai/core/people`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

const COMMAND_ID = "passport";

export interface PassportCommandOptions {
  cwd: string;
  /** Author email (positional). Auto-picks top contributor when absent. */
  author?: string;
  /** Path to write self-contained HTML to. */
  html?: string;
  /** Path to write PDF to. (Requires puppeteer-core.) */
  pdf?: string;
  /** Include opt-in nemesis section. */
  includeFriction?: boolean;
  topFiles?: number;
  json?: boolean;
}

export async function passportCommand(opts: PassportCommandOptions): Promise<number> {
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

  let data: people.PassportData | null;
  try {
    data = await people.buildPassport(s, {
      cwd: meta.rootPath,
      author: opts.author,
      topFiles: opts.topFiles,
      includeFriction: opts.includeFriction,
      repoName: deriveRepoName(meta.rootPath),
    });
  } finally {
    s.close();
  }

  if (!data) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ passport: null }, null, 2) + "\n");
      return 0;
    }
    ui.error(
      opts.author
        ? `No commits found for author <${opts.author}>.`
        : "No author commits in the index. Run `mneme index` first.",
    );
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }

  // Optional artifacts. We always render the terminal report regardless.
  const artifactNotes: string[] = [];
  if (opts.html) {
    try {
      const html = people.renderPassportHtml(data);
      writeReportFile(opts.html, html);
      artifactNotes.push(
        `${kleur.green("✓")} HTML dossier  ${kleur.bold(opts.html)} ${kleur.gray(`(${humanBytes(html.length)})`)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      artifactNotes.push(`${kleur.red("✗")} HTML write failed: ${msg}`);
    }
  }
  if (opts.pdf) {
    // Always emit an HTML alongside the PDF (puppeteer reads it).
    const htmlPath = opts.html ?? opts.pdf.replace(/\.pdf$/i, "") + ".html";
    if (!opts.html) {
      try {
        const html = people.renderPassportHtml(data);
        writeReportFile(htmlPath, html);
        artifactNotes.push(
          `${kleur.green("✓")} HTML dossier  ${kleur.bold(htmlPath)} ${kleur.gray(`(${humanBytes(html.length)})`)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        artifactNotes.push(`${kleur.red("✗")} HTML write failed: ${msg}`);
      }
    }
    try {
      await people.htmlToPdf(htmlPath, opts.pdf);
      artifactNotes.push(`${kleur.green("✓")} PDF dossier   ${kleur.bold(opts.pdf)}`);
    } catch (err) {
      if (err instanceof people.PdfDependencyMissingError) {
        artifactNotes.push(
          `${kleur.yellow("ℹ")} PDF skipped — puppeteer-core not available; HTML still written.`,
        );
        // Print the friendly install instructions, but never fail the run.
        process.stdout.write("\n" + kleur.gray(err.message) + "\n");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        artifactNotes.push(`${kleur.red("✗")} PDF write failed: ${msg}`);
      }
    }
  }

  return renderTerminal(data, artifactNotes, meta.rootPath);
}

// ─── Terminal rendering ───────────────────────────────────────────────

function renderTerminal(
  data: people.PassportData,
  artifactNotes: string[],
  repoRoot: string,
): number {
  const showGuide = readShouldShowGuide(repoRoot);

  const id = data.identity;
  const ex = data.expertise;
  const inf = data.influenceSlot;
  const promise = data.promiseSlot;
  const tele = data.telepathySlot;

  // ─── Headline ──────────────────────────────────────────────────────────
  const sharePct = (id.repoCommitShare * 100).toFixed(1);
  let headlineRoles: string[] = [];
  if (inf && inf.adoptionsByOthers > 0) {
    headlineRoles.push(`cultural alpha #${inf.rank}/${inf.rankedOf}`);
  }
  if (tele.pairs.length > 0) {
    headlineRoles.push(`${tele.pairs.length} latent collaborator${tele.pairs.length === 1 ? "" : "s"}`);
  }
  if (ex.filesStillFresh > 0) {
    headlineRoles.push(`${ex.filesStillFresh} fresh files`);
  }
  if (promise.stale > 0) {
    headlineRoles.push(`${promise.stale} stale promise${promise.stale === 1 ? "" : "s"}`);
  }
  const headline = `🛂 ${id.name || id.email} — ${headlineRoles.join(" · ") || `${id.commitCount} commits, ${sharePct}% of repo`}`;

  // ─── Heads-up pills ───────────────────────────────────────────────────
  const dataPills: string[] = [];
  if (id.commitCount < 30) {
    dataPills.push(
      pill("HEADS UP", "warn") +
        " " +
        kleur.gray(`only ${id.commitCount} commits — read directionally; numbers stabilize past ~50.`),
    );
  }
  if (data.meta.repoAuthorCount < 2) {
    dataPills.push(
      pill("SOLO REPO", "warn") +
        " " +
        kleur.gray("only 1 author indexed — telepathy + influence are placeholders."),
    );
  }

  // ─── Lede — identity card ─────────────────────────────────────────────
  const ledeLines: string[] = [
    `  ${kleur.gray("email:")} ${kleur.bold(id.email)}`,
    `  ${kleur.gray("DNA fingerprint:")} ${kleur.bold(id.dnaHash)} ${kleur.gray("(stable hash of style + voice + cadence)")}`,
    `  ${kleur.gray("active range:")} ${kleur.bold(id.fromDate)} → ${kleur.bold(id.toDate)} ${kleur.gray(`(${id.activeDays} active days)`)}`,
    `  ${kleur.gray("repo share:")} ${kleur.bold(`${id.commitCount} commits`)} ${kleur.gray(`(${sharePct}% of ${data.meta.totalCommits})`)}`,
    `  ${kleur.gray("knowledge mass:")} ${kleur.bold(ex.knowledgeMass.toFixed(1))} ${kleur.gray(`(${ex.filesStillFresh}/${ex.filesKnown} files still fresh)`)}`,
  ];

  // ─── Key facts — top expertise + influence + promises ─────────────────
  const keyLines: string[] = [];
  if (ex.topFiles.length > 0) {
    const topF = ex.topFiles[0]!;
    const pctFresh = Math.round(topF.knowledge * 100);
    keyLines.push(
      `  ${kleur.gray("strongest area:")} ${kleur.bold(topF.filePath)} ${kleur.gray(`(${pctFresh}% fresh, ${topF.touchCount} touches, last ${humanDays(topF.lastTouchDaysAgo)})`)}`,
    );
  }
  if (inf) {
    keyLines.push(
      `  ${kleur.gray("cultural footprint:")} ${kleur.bold(`#${inf.rank}/${inf.rankedOf}`)} ${kleur.gray("PageRank")} ${kleur.bold(inf.pageRank.toFixed(4))} ${kleur.gray(`· ${inf.adoptionsByOthers} adoptions by ${inf.uniqueAdopters} engineers`)}`,
    );
  } else {
    keyLines.push(
      `  ${kleur.gray("cultural footprint:")} ${kleur.gray("(no influence ranking — no reused TS/JS shapes)")}`,
    );
  }
  if (tele.pairs.length > 0) {
    const top = tele.pairs[0]!;
    const me = id.email.toLowerCase();
    const other = top.authorA.email.toLowerCase() === me ? top.authorB : top.authorA;
    keyLines.push(
      `  ${kleur.gray("top latent collaborator:")} ${kleur.bold(other.name || other.email)} ${kleur.gray(`(score ${top.score.toFixed(2)} · ${top.events} events · topic ${top.topTopic.topic})`)}`,
    );
  }
  if (promise.kept + promise.stale > 0) {
    const ratePct = Math.round(promise.keepRate * 100);
    const baseline = promise.teamBaseline;
    const baseRate =
      baseline.kept + baseline.stale === 0
        ? null
        : Math.round(baseline.keepRate * 100);
    const baseStr =
      baseRate === null
        ? ""
        : kleur.gray(` · vs team ${baseRate}% (Δ ${ratePct - baseRate >= 0 ? "+" : ""}${ratePct - baseRate} pp)`);
    keyLines.push(
      `  ${kleur.gray("promise keep-rate:")} ${kleur.bold(`${ratePct}%`)} ${kleur.gray(`(${promise.kept} kept · ${promise.stale} stale · ${promise.open} open)`)}${baseStr}`,
    );
  }

  // ─── Body — ranked file expertise ─────────────────────────────────────
  const bodyLines: string[] = [];
  for (let i = 0; i < ex.topFiles.slice(0, 8).length; i++) {
    const f = ex.topFiles[i]!;
    const band = bandTag(f.band);
    const pctFresh = Math.round(f.knowledge * 100);
    bodyLines.push(
      `    ${band}  ${kleur.bold(f.filePath)}  ${kleur.gray(`${pctFresh}% fresh · ${f.touchCount} touches · last ${humanDays(f.lastTouchDaysAgo)} · ${f.refreshHint}`)}`,
    );
  }

  // ─── Voice fingerprint ────────────────────────────────────────────────
  const voiceLines: string[] = [];
  if (data.voice.length > 0) {
    const phrases = data.voice
      .slice(0, 8)
      .map((v) => `${kleur.cyan(v.phrase)}${kleur.gray("×" + v.count)}`)
      .join(kleur.gray(" · "));
    voiceLines.push(`  ${kleur.gray("voice fingerprint:")} ${phrases}`);
  }

  // ─── Fading domains (atrophy clock) ───────────────────────────────────
  const fadingLines: string[] = [];
  for (const fd of data.fadingDomains.slice(0, 5)) {
    const pctFresh = Math.round(fd.currentKnowledge * 100);
    fadingLines.push(
      `    ${kleur.red().bold("FADING ")}  ${kleur.bold(fd.filePath)}  ${kleur.gray(`(was ${fd.peakTouches} touches; now ${pctFresh}% fresh; idle ${humanDays(fd.daysIdle)})`)}`,
    );
  }

  // ─── Sources / try-next ───────────────────────────────────────────────
  const sourceLines: string[] = [];
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold(`mneme nervous-system`)} ${kleur.gray("(repo-level neural map across all engineers)")}`,
  );
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold(`mneme atrophy ${id.email}`)} ${kleur.gray("(full knowledge map for this engineer)")}`,
  );
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold(`mneme passport --html ./passport.html`)} ${kleur.gray("(printable HTML dossier)")}`,
  );

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} a passport composes 7 lenses — DNA, expertise, telepathy, influence, promise ledger, atrophy clock, voice.`,
    );
    sourceLines.push(
      `    ${kleur.gray("• ")}${kleur.green("FRESH")}${kleur.gray(" ≥ 70%  ·  ")}${kleur.cyan("WARM")}${kleur.gray(" 30–70%  ·  ")}${kleur.yellow("FADING")}${kleur.gray(" 10–30%  ·  ")}${kleur.red("GHOSTED")}${kleur.gray(" < 10%")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("• Behavioural fingerprint, not a performance review. Patterns describe past commits — never the value of a person.")}`,
    );
  }

  // ─── Honest limits panel ──────────────────────────────────────────────
  const limitsLines = data.limits.slice(0, 5).map((l) => `    ${kleur.gray("• " + l)}`);

  // ─── Compose Iris pyramid ─────────────────────────────────────────────
  const sections: PyramidSection[] = [];
  if (dataPills.length > 0) {
    sections.push({ tier: "lede", lines: dataPills.map((l) => `  ${l}`) });
  }
  sections.push({ tier: "lede", title: "✦ Identity", lines: ledeLines });
  if (keyLines.length > 0) {
    sections.push({ tier: "key-facts", title: "◆ Headline facts", lines: keyLines });
  }
  if (bodyLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Top expertise (top ${Math.min(8, ex.topFiles.length)})`,
      lines: bodyLines,
    });
  }
  if (voiceLines.length > 0) {
    sections.push({ tier: "body", title: "◆ Voice fingerprint", lines: voiceLines });
  }
  if (fadingLines.length > 0) {
    sections.push({
      tier: "body",
      title: `⏳ Knowledge atrophy clock (top ${fadingLines.length})`,
      lines: fadingLines,
    });
  }
  if (artifactNotes.length > 0) {
    sections.push({ tier: "sources", title: "◆ Artifacts", lines: artifactNotes.map((l) => `    ${l}`) });
  }
  sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });
  if (limitsLines.length > 0) {
    sections.push({ tier: "details", title: "∎ Honest limits", lines: limitsLines });
  }

  ui.banner();
  if (id.commitCount === 0) {
    process.stdout.write(
      header(
        "🛂",
        "Passport — engineer dossier",
        "no data for this author",
        "Pass an author email (or run with no args to auto-pick the top contributor).",
      ) + "\n\n",
    );
    process.stdout.write(
      emptyState("No commits indexed for this email.", [
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

// ─── helpers ───────────────────────────────────────────────────────────

function readShouldShowGuide(repoRoot: string): boolean {
  try {
    const state = readIrisState(repoRoot);
    return shouldShowVerboseGuide(state, COMMAND_ID);
  } catch {
    return true;
  }
}

function bandTag(band: "fresh" | "warm" | "fading" | "ghosted"): string {
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

function humanDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "1 day ago";
  if (days < 14) return `${Math.round(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function deriveRepoName(rootPath: string): string {
  const parts = rootPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "this repository";
}

function writeReportFile(path: string, contents: string): void {
  const dir = dirname(path);
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  writeFileSync(path, contents, "utf8");
}
