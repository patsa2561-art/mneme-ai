/**
 * `mneme nervous-system` — repo-level neural map.
 *
 * Composes Wave-1 modules (telepathy, atrophy, influence, promise) +
 * Wave-2 passports into the single PDF a CTO prints and pins on the wall.
 *
 *   - default       → Iris terminal output (alphas / pairs / atrophy / surprises)
 *   - --html PATH   → write a self-contained HTML report
 *   - --pdf PATH    → write a PDF (requires puppeteer-core; gracefully degrades)
 *
 * --json shape mirrors `NervousSystemData` from `@mneme-ai/core/people`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import kleur from "kleur";
import { git, store, people } from "@mneme-ai/core";
import { dbPath, mnemeDir } from "../paths.js";
import { ui, header, emptyState, pill } from "../ui.js";
import {
  iris,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  type PyramidSection,
} from "../iris/index.js";
import { explain, type ExplainRequest } from "../utils/explain.js";

const COMMAND_ID = "nervous-system";

export interface NervousSystemCommandOptions {
  cwd: string;
  topPeople?: number;
  topFiles?: number;
  /** Path to write self-contained HTML to. */
  html?: string;
  /** Path to write PDF to. */
  pdf?: string;
  json?: boolean;
  /** When set: prepend a plain-English narrative summary (LLM-generated). */
  explain?: boolean;
  /** Test seam: inject an enricher factory so unit tests don't hit the network. */
  explainEnricherFactory?: ExplainRequest["enricherFactory"];
}

export async function nervousSystemCommand(
  opts: NervousSystemCommandOptions,
): Promise<number> {
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

  let data: people.NervousSystemData | null;
  try {
    data = await people.buildNervousSystem(s, {
      cwd: meta.rootPath,
      topPeople: opts.topPeople,
      topFiles: opts.topFiles,
      repoName: deriveRepoName(meta.rootPath),
    });
  } finally {
    s.close();
  }

  if (!data) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ nervousSystem: null }, null, 2) + "\n");
      return 0;
    }
    ui.error("No commits in the index. Run `mneme index` first.");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }

  // ─── Resolve artifact paths.  Default --html when neither given ───────
  // is too aggressive; only auto-default when --pdf is set (so puppeteer has
  // something to read).  When neither is set, terminal-only.
  let htmlPath = opts.html;
  if (!htmlPath && opts.pdf) {
    // Stash next to .mneme/ so we don't pollute the repo root.
    htmlPath = join(mnemeDir(meta.rootPath), defaultHtmlName());
  }

  const artifactNotes: string[] = [];
  if (htmlPath) {
    try {
      const html = people.renderNervousSystemHtml(data);
      writeReportFile(htmlPath, html);
      artifactNotes.push(
        `${kleur.green("✓")} HTML report  ${kleur.bold(htmlPath)} ${kleur.gray(`(${humanBytes(html.length)})`)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      artifactNotes.push(`${kleur.red("✗")} HTML write failed: ${msg}`);
    }
  }
  if (opts.pdf) {
    if (!htmlPath) {
      // Should be unreachable — auto-default above guarantees htmlPath when --pdf is set.
      artifactNotes.push(`${kleur.red("✗")} PDF requires HTML — pass --html as well.`);
    } else {
      try {
        await people.htmlToPdf(htmlPath, opts.pdf);
        artifactNotes.push(`${kleur.green("✓")} PDF report   ${kleur.bold(opts.pdf)}`);
      } catch (err) {
        if (err instanceof people.PdfDependencyMissingError) {
          artifactNotes.push(
            `${kleur.yellow("ℹ")} PDF skipped — puppeteer-core not available; HTML still written.`,
          );
          process.stdout.write("\n" + kleur.gray(err.message) + "\n");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          artifactNotes.push(`${kleur.red("✗")} PDF write failed: ${msg}`);
        }
      }
    }
  }

  // Optional --explain narrative — fetch BEFORE we render so the prose lives
  // at the top of the inverted-pyramid output (lede tier).
  let explainSection: PyramidSection | null = null;
  let explainHeadsUp: string | null = null;
  if (opts.explain) {
    const result = await explain({
      enabled: true,
      enricherFactory: opts.explainEnricherFactory,
      system:
        "You are a CTO briefing the founders on the engineering org's neural map. " +
        "Given a JSON snapshot of cultural alphas, latent pairs, atrophy, and brain lobes, " +
        "write 3-4 sentences in plain English: " +
        "(1) who's the alpha and why, " +
        "(2) where atrophy is concentrated, " +
        "(3) the one most surprising finding. " +
        "Be honest about uncertainty when commit count or author count is low. No emoji.",
      user: nervousSystemToExplainPrompt(data),
      maxTokens: 240,
    });
    explainSection = result.section;
    explainHeadsUp = result.headsUp;
  }

  return renderTerminal(data, artifactNotes, meta.rootPath, explainSection, explainHeadsUp);
}

/** Trim the data down to the bits a narrative LLM actually needs. */
function nervousSystemToExplainPrompt(data: people.NervousSystemData): string {
  const compact = {
    repo: data.meta.repoName,
    totalCommits: data.meta.totalCommits,
    totalAuthors: data.meta.totalAuthors,
    halfLifeDays: data.meta.halfLifeDays,
    hero: data.hero.headline,
    topAlphas: data.alphas.slice(0, 5).map((a) => ({
      name: a.name || a.email,
      pageRank: Number(a.pageRank.toFixed(4)),
      adoptionsByOthers: a.adoptionsByOthers,
      uniqueAdopters: a.uniqueAdopters,
    })),
    latentPairs: data.telepathy.pairs.slice(0, 3).map((p) => ({
      a: p.authorA.name || p.authorA.email,
      b: p.authorB.name || p.authorB.email,
      score: Number(p.score.toFixed(2)),
      events: p.events,
      topic: p.topTopic.topic,
    })),
    atrophy: {
      filesWithLiveExpert: data.atrophy.filesWithLiveExpert,
      fileCount: data.atrophy.fileCount,
      ghostedDeepFiles: data.atrophy.ghostedDeepFiles,
      criticalFiles: data.atrophy.criticalFiles.slice(0, 5).map((f) => ({
        path: f.filePath,
        tier: f.tier,
        freshestKnowledgePct: Math.round(f.freshestKnowledge * 100),
      })),
    },
    lobes: data.lobes.slice(0, 5).map((l) => ({
      lobe: l.lobe,
      fileCount: l.fileCount,
      topOwner: l.topOwner?.name ?? null,
    })),
    surprising: data.surprising.slice(0, 5),
    promises: data.promises,
  };
  return JSON.stringify(compact, null, 2);
}

// ─── Terminal rendering ───────────────────────────────────────────────

function renderTerminal(
  data: people.NervousSystemData,
  artifactNotes: string[],
  repoRoot: string,
  explainSection: PyramidSection | null = null,
  explainHeadsUp: string | null = null,
): number {
  const showGuide = readShouldShowGuide(repoRoot);

  // ─── Headline ────────────────────────────────────────────────────────
  const headline = `🧠 The nervous system of ${data.meta.repoName} — ${data.hero.headline}`;

  // ─── Heads-up pills ──────────────────────────────────────────────────
  const dataPills: string[] = [];
  if (data.meta.totalCommits < 50) {
    dataPills.push(
      pill("HEADS UP", "warn") +
        " " +
        kleur.gray(`only ${data.meta.totalCommits} commits — every percentage is fragile under 50.`),
    );
  }
  if (data.meta.totalAuthors < 3) {
    dataPills.push(
      pill("SMALL TEAM", "warn") +
        " " +
        kleur.gray(`${data.meta.totalAuthors} active author${data.meta.totalAuthors === 1 ? "" : "s"} — pair + influence are placeholders below 3.`),
    );
  }

  // ─── Lede — hero numbers ────────────────────────────────────────────
  const ledeLines: string[] = [
    `  ${kleur.gray("commits indexed:")} ${kleur.bold(String(data.meta.totalCommits))} ${kleur.gray(`across ${data.meta.totalAuthors} active authors`)}`,
    `  ${kleur.gray("knowledge half-life:")} ${kleur.bold(data.meta.halfLifeDays + " days")} ${kleur.gray("(after this, knowledge ≈ 50%)")}`,
    `  ${kleur.gray("files with live expert:")} ${kleur.bold(`${data.atrophy.filesWithLiveExpert} / ${data.atrophy.fileCount}`)} ${kleur.gray(`(${data.atrophy.fileCount > 0 ? Math.round((data.atrophy.filesWithLiveExpert / data.atrophy.fileCount) * 100) : 0}%)`)}`,
    `  ${kleur.gray("ghost code (deep history lost):")} ${data.atrophy.ghostedDeepFiles > 0 ? kleur.red().bold(String(data.atrophy.ghostedDeepFiles)) : kleur.green("0")} ${kleur.gray("(≥2 historical touches, no live expert)")}`,
  ];

  // ─── Top alphas (cultural alphas) ───────────────────────────────────
  const alphaLines: string[] = [];
  for (let i = 0; i < Math.min(5, data.alphas.length); i++) {
    const a = data.alphas[i]!;
    const top = a.topShape;
    const topStr = top
      ? kleur.gray(`top pattern ${kleur.cyan(top.name + "/" + top.arity)} — ${top.adoptions} adoption${top.adoptions === 1 ? "" : "s"}`)
      : kleur.gray("(no specific pattern reached the floor)");
    alphaLines.push(
      `    ${kleur.gray("#" + a.rank.toString().padStart(2, " ") + ".")}  ${kleur.bold(a.name || a.email)}  ${kleur.gray("PR")} ${kleur.bold(a.pageRank.toFixed(4))}  ${kleur.gray(`· ${a.adoptionsByOthers} adoption${a.adoptionsByOthers === 1 ? "" : "s"} by ${a.uniqueAdopters} engineer${a.uniqueAdopters === 1 ? "" : "s"}`)}`,
    );
    alphaLines.push(`        ${topStr}`);
  }

  // ─── Latent pairs (telepathy) ───────────────────────────────────────
  const pairLines: string[] = [];
  const pairs = data.telepathy.pairs.slice(0, 5);
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    pairLines.push(
      `    ${kleur.gray((i + 1).toString().padStart(2, " ") + ".")}  ${kleur.bold(p.authorA.name || p.authorA.email)} ${kleur.gray("⟷")} ${kleur.bold(p.authorB.name || p.authorB.email)}  ${kleur.gray(`score ${p.score.toFixed(2)} · ${p.events} events · topic ${p.topTopic.topic}`)}`,
    );
  }

  // ─── Atrophy critical files ─────────────────────────────────────────
  const riskLines: string[] = [];
  for (const f of data.atrophy.criticalFiles.slice(0, 6)) {
    const tag = renderTier(f.tier);
    const pctFresh = Math.round(f.freshestKnowledge * 100);
    const cause =
      f.totalTouches <= 1
        ? "shallow knowledge — only 1 touch ever"
        : f.freshestKnowledge < 0.1
          ? "ghost code — re-onboarding required"
          : "knowledge faded — review before next change";
    riskLines.push(
      `    ${tag}  ${kleur.bold(f.filePath)}  ${kleur.gray(`${pctFresh}% fresh · ${f.totalTouches} touches · ${cause}`)}`,
    );
  }

  // ─── Brain lobes ────────────────────────────────────────────────────
  const lobeLines: string[] = [];
  for (const l of data.lobes.slice(0, 5)) {
    const top = l.topOwner ? `${kleur.bold(l.topOwner.name)} ${kleur.gray(`(${l.topOwner.touches}×)`)}` : kleur.gray("(no owner)");
    lobeLines.push(
      `    ${kleur.cyan(l.lobe.padEnd(28))}  ${kleur.gray(`${l.fileCount} files, ${l.totalTouches} touches`)}  ${kleur.gray("→ owner:")} ${top}`,
    );
  }

  // ─── Surprises ──────────────────────────────────────────────────────
  const surpriseLines: string[] = data.surprising.map((s) => `    ${kleur.yellow("✦")} ${s}`);

  // ─── Promise debt ───────────────────────────────────────────────────
  const promiseLine =
    data.promises.kept + data.promises.stale === 0
      ? kleur.gray("(no promises detected in commit messages)")
      : `${kleur.bold(`${Math.round(data.promises.keepRate * 100)}%`)} ${kleur.gray(`keep-rate · ${data.promises.kept} kept · ${data.promises.stale} stale · ${data.promises.open} open`)}`;

  // ─── Sources / try-next ─────────────────────────────────────────────
  const sourceLines: string[] = [];
  if (data.passports.length > 0) {
    const top = data.passports[0]!;
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme passport ${top.identity.email}`)} ${kleur.gray("(deep dive on the top contributor)")}`,
    );
  }
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold("mneme nervous-system --html ./nervous.html")} ${kleur.gray("(printable HTML — open in browser, save as PDF)")}`,
  );
  sourceLines.push(
    `    ${kleur.cyan("$")} ${kleur.bold("mneme atrophy")} ${kleur.gray("(focused atrophy heatmap)")}`,
  );
  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} this report composes 6 lenses — alphas, latent pairs, atrophy, lobes, promise debt, surprises.`,
    );
    sourceLines.push(
      `    ${kleur.gray("• ")}${kleur.bold("PageRank")} ${kleur.gray("ranks pattern setters; volume-independent. ")}${kleur.bold("telepathy")} ${kleur.gray("rhymes within a 48h window.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("• Patterns describe past commits — never the value of a person. Use for pairing + onboarding, not reviews.")}`,
    );
  }

  // ─── Honest limits panel ────────────────────────────────────────────
  const limitsLines = data.limits.slice(0, 6).map((l) => `    ${kleur.gray("• " + l)}`);

  // ─── Compose Iris pyramid ───────────────────────────────────────────
  const sections: PyramidSection[] = [];
  if (explainSection) sections.push(explainSection);
  if (explainHeadsUp) {
    sections.push({ tier: "lede", lines: [`  ${explainHeadsUp}`] });
  }
  if (dataPills.length > 0) {
    sections.push({ tier: "lede", lines: dataPills.map((l) => `  ${l}`) });
  }
  sections.push({ tier: "lede", title: "✦ Repo-level neural map", lines: ledeLines });
  if (alphaLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: `◆ Cultural alphas (top ${Math.min(5, data.alphas.length)})`,
      lines: alphaLines,
    });
  }
  if (pairLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: `◆ Latent pairs — invisible teams (top ${pairLines.length})`,
      lines: pairLines,
    });
  }
  if (riskLines.length > 0) {
    sections.push({
      tier: "body",
      title: `⚠ Atrophy critical list (top ${riskLines.length})`,
      lines: riskLines,
    });
  }
  if (lobeLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Brain lobes — repo neuroanatomy (top ${lobeLines.length})`,
      lines: lobeLines,
    });
  }
  sections.push({
    tier: "body",
    title: "◆ Promise debt",
    lines: [`  ${promiseLine}`],
  });
  if (surpriseLines.length > 0) {
    sections.push({ tier: "body", title: "◆ What's surprising", lines: surpriseLines });
  }
  if (artifactNotes.length > 0) {
    sections.push({ tier: "sources", title: "◆ Artifacts", lines: artifactNotes.map((l) => `    ${l}`) });
  }
  sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });
  if (limitsLines.length > 0) {
    sections.push({ tier: "details", title: "∎ Honest limits", lines: limitsLines });
  }

  ui.banner();
  if (data.atrophy.fileCount === 0) {
    process.stdout.write(
      header(
        "🧠",
        "Nervous System — repo-level neural map",
        "no indexed files",
        "Run `mneme index` to populate the file-change history.",
      ) + "\n\n",
    );
    process.stdout.write(
      emptyState("No file-change history.", ["Run `mneme index` first."]),
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

function defaultHtmlName(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `nervous-system-${yyyy}-${mm}-${dd}.html`;
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
