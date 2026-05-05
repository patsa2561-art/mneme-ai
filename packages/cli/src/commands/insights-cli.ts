/**
 * `mneme who-knows <topic>` · `decisions` · `stack-trace` · `story <topic>`
 *
 * Wraps the pure functions in @mneme-ai/core/insights with CLI ergonomics:
 * argument parsing, store lifecycle, beautiful rendering, optional LLM narration.
 */

import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import kleur from "kleur";
import {
  git,
  store,
  insights,
  util,
  retrieve,
  type Commit,
} from "@mneme-ai/core";
import { resolveEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import { isNoLlm } from "../no-llm.js";

// ─── shared helpers ─────────────────────────────────────────────────────

async function withStore<T>(cwd: string, f: (s: store.MnemeStore, meta: any) => Promise<T> | T): Promise<T | number> {
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
    return await f(s, meta);
  } finally {
    s.close();
  }
}

// ─── who-knows ──────────────────────────────────────────────────────────

export interface WhoKnowsOptions {
  cwd: string;
  topic: string;
  topN?: number;
  json?: boolean;
}

export async function whoKnowsCommand(opts: WhoKnowsOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    return insights.whoKnows(s, { topic: opts.topic, topN: opts.topN ?? 5 });
  });
  if (typeof result === "number") return result;
  const candidates = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ topic: opts.topic, candidates }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("👤  Top experts on")}  ${kleur.bold(`"${opts.topic}"`)}\n\n`);

  if (candidates.length === 0) {
    process.stdout.write(`  ${kleur.gray(`No commits matched "${opts.topic}". Try a broader topic.`)}\n\n`);
    return 0;
  }

  for (const c of candidates) {
    const tier = renderTier(c.tier);
    const lastTouchAge = daysAgoFromIso(c.lastTouch);
    process.stdout.write(`  ${tier}  ${kleur.bold(c.name)}  ${kleur.gray(`<${c.email}>`)}\n`);
    process.stdout.write(
      `      ${kleur.gray(`${c.commitCount} commits · ${c.filesTouched} files · last touch ${lastTouchAge} ago · score ${c.score.toFixed(2)}`)}\n\n`,
    );
  }
  return 0;
}

function renderTier(tier: string): string {
  switch (tier) {
    case "definitive":
      return `${kleur.green("⭐")} ${kleur.green().bold("definitive")}`;
    case "active":
      return `${kleur.cyan("●")} ${kleur.cyan().bold("active    ")}`;
    case "stale":
      return `${kleur.yellow("◐")} ${kleur.yellow().bold("stale     ")}`;
    case "occasional":
    default:
      return `${kleur.gray("○")} ${kleur.gray().bold("occasional")}`;
  }
}

function daysAgoFromIso(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return "today";
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

// ─── decisions ──────────────────────────────────────────────────────────

export interface DecisionsOptions {
  cwd: string;
  format?: "table" | "markdown" | "json";
  out?: string;
  since?: string;
  minConfidence?: number;
}

export async function decisionsCommand(opts: DecisionsOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const filtered = opts.since
      ? allCommits.filter((c) => c.authorDate >= opts.since!)
      : allCommits;
    const minConf = opts.minConfidence ?? 0.6;
    const decisions = filtered
      .flatMap(insights.extractDecisions)
      .filter((d) => d.confidence >= minConf)
      .sort((a, b) => b.date.localeCompare(a.date));
    return decisions;
  });
  if (typeof result === "number") return result;
  const decisions = result;

  if (opts.format === "json") {
    const payload = JSON.stringify({ count: decisions.length, decisions }, null, 2);
    if (opts.out) writeFileSync(opts.out, payload);
    else process.stdout.write(payload + "\n");
    return 0;
  }

  if (opts.format === "markdown") {
    const md = insights.renderDecisionsAsMarkdown(decisions);
    if (opts.out) {
      writeFileSync(opts.out, md);
      ui.success(`Wrote ${decisions.length} decisions to ${opts.out}`);
    } else {
      process.stdout.write(md);
    }
    return 0;
  }

  // Default: pretty table
  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("📜  Architecture Decisions  ")}${kleur.gray(`(extracted from ${decisions.length} commits)`)}\n\n`);

  if (decisions.length === 0) {
    process.stdout.write(`  ${kleur.gray("No decisions extracted. Try richer commit messages — patterns are:")}\n`);
    process.stdout.write(`  ${kleur.gray('  "decided to X", "switched from A to B", "replaced X with Y", "deprecated Z"')}\n\n`);
    return 0;
  }

  for (const d of decisions.slice(0, 30)) {
    const conf = d.confidence >= 0.85 ? kleur.green("●") : kleur.yellow("●");
    process.stdout.write(`  ${conf} ${kleur.gray(d.date)}  ${kleur.cyan(d.author.padEnd(16))}  ${kleur.bold(d.summary)}\n`);
    if (d.rationale) process.stdout.write(`      ${kleur.gray("→ " + d.rationale)}\n`);
    process.stdout.write(`      ${kleur.gray(`[${d.kind}, conf=${d.confidence.toFixed(2)}, ${d.shortHash}]`)}\n\n`);
  }
  if (decisions.length > 30) {
    process.stdout.write(`  ${kleur.gray(`... and ${decisions.length - 30} more. Use --format markdown --out docs/ADR.md for the full list.`)}\n\n`);
  }
  return 0;
}

// ─── stack-trace ────────────────────────────────────────────────────────

export interface StackTraceOptions {
  cwd: string;
  /** Path to a file containing the stack trace. If omitted, reads stdin. */
  fromFile?: string;
  json?: boolean;
}

export async function stackTraceCommand(opts: StackTraceOptions): Promise<number> {
  // 1. Read the trace.
  let traceText = "";
  if (opts.fromFile) {
    try {
      traceText = readFileSync(opts.fromFile, "utf8");
    } catch (err) {
      ui.error(`Cannot read ${opts.fromFile}: ${(err as Error).message}`);
      return 1;
    }
  } else {
    traceText = await readStdin();
  }
  if (!traceText.trim()) {
    ui.error("No stack trace provided. Pipe via stdin or pass --from <file>.");
    return 1;
  }

  // 2. Parse frames.
  const frames = insights.parseStackTrace(traceText);
  const language = insights.detectLanguage(traceText);

  if (frames.length === 0) {
    ui.error("Could not parse any frames. Mneme supports JS/TS, Python, Go, Java traces.");
    return 1;
  }

  // 3. For each frame, look up history.
  const result = await withStore(opts.cwd, async (s, meta) => {
    type FrameAnalysis = {
      frame: typeof frames[number];
      lastCommits: Commit[];
      pastIncidents: number;
    };
    const analyses: FrameAnalysis[] = [];
    for (const frame of frames.slice(0, 5)) {
      const lastCommits = recentCommitsForFile(s, frame.file, 3);
      const pastIncidents = countIncidentsAffectingFile(s, frame.file);
      analyses.push({ frame, lastCommits, pastIncidents });
    }
    return { analyses, meta };
  });

  if (typeof result === "number") return result;
  const { analyses, meta } = result;

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ language, frames, analyses }, null, 2) + "\n",
    );
    return 0;
  }

  // 4. Render.
  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🎯  Stack analysis")}  ${kleur.gray(`(${language}, ${frames.length} frames)`)}\n\n`);

  analyses.forEach((a, i) => {
    process.stdout.write(`  ${kleur.bold(`Frame ${i + 1}:`)} ${kleur.cyan(a.frame.file)}:${kleur.bold(String(a.frame.line))}`);
    if (a.frame.function) process.stdout.write(` ${kleur.gray(`(${a.frame.function})`)}`);
    process.stdout.write("\n");

    if (a.lastCommits.length === 0) {
      process.stdout.write(`    ${kleur.gray("(no commits indexed for this file)")}\n\n`);
      return;
    }

    process.stdout.write(`    ${kleur.gray("Last commits:")}\n`);
    for (const c of a.lastCommits) {
      const date = c.authorDate.slice(0, 10);
      process.stdout.write(`      ${kleur.green("●")} ${kleur.bold(c.shortHash)} ${kleur.gray(`[${date} · ${c.authorName}]`)} ${c.subject}\n`);
    }
    if (a.pastIncidents > 0) {
      process.stdout.write(
        `    ${kleur.red("⚠")}  ${kleur.red().bold(`${a.pastIncidents} past incident(s)`)} affected this file.\n`,
      );
    }
    process.stdout.write("\n");
  });

  // 5. Hint.
  process.stdout.write(
    `  ${kleur.gray("Likely root cause: check the most recent commit at the top frame.")}\n`,
  );
  process.stdout.write(
    `  ${kleur.gray("For a deeper walk: ")}${kleur.bold("mneme palimpsest")} ${kleur.cyan(`${analyses[0]?.frame.file}:${analyses[0]?.frame.line}`)}\n\n`,
  );

  return 0;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      // No piped input — return empty so caller can show error.
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function recentCommitsForFile(s: store.MnemeStore, filePath: string, limit: number): Commit[] {
  // The file path in the trace may be absolute; the indexed paths are
  // relative to repo root. We match on suffix.
  const suffix = filePath.replace(/^.*?\/(?=[^/]+$)/, ""); // last path segment
  const rows = s.db
    .prepare(
      `SELECT DISTINCT c.* FROM commits c
       JOIN file_changes fc ON fc.commit_hash = c.hash
       WHERE fc.path = ? OR fc.path LIKE ?
       ORDER BY c.author_date DESC LIMIT ?`,
    )
    .all(filePath, `%${suffix}`, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => util.rowToCommit(r, s));
}

function countIncidentsAffectingFile(s: store.MnemeStore, filePath: string): number {
  const suffix = filePath.replace(/^.*?\/(?=[^/]+$)/, "");
  try {
    const row = s.db
      .prepare(
        `SELECT COUNT(*) AS n FROM incidents
         WHERE affected_files LIKE ? OR affected_files LIKE ?`,
      )
      .get(`%${filePath}%`, `%${suffix}%`) as { n: number };
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ─── story ──────────────────────────────────────────────────────────────

export interface StoryOptions {
  cwd: string;
  topic: string;
  json?: boolean;
  noLlm?: boolean;
}

export async function storyCommand(opts: StoryOptions): Promise<number> {
  const result = await withStore(opts.cwd, async (s) => {
    const ftsHits = s.ftsSearch(opts.topic, 200);
    const hashes = new Set(ftsHits.map((h) => h.commitHash));
    const commits: Commit[] = [];
    for (const hash of hashes) {
      const c = s.getCommit(hash);
      if (c) commits.push(c);
    }
    return commits;
  });
  if (typeof result === "number") return result;
  const commits = result;

  const story = insights.buildStory(opts.topic, commits);

  if (opts.json) {
    process.stdout.write(JSON.stringify(story, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("📖  The")} ${kleur.bold(opts.topic)} ${kleur.bold().cyan("Story")}  `);
  process.stdout.write(
    `${kleur.gray(`(${story.acts.length} acts, ${story.totalCommits} commits, ${story.spanDays} days)`)}\n\n`,
  );

  if (story.acts.length === 0) {
    process.stdout.write(
      `  ${kleur.gray(`No commits matched "${opts.topic}". Try a broader topic or check that you've indexed the repo.`)}\n\n`,
    );
    return 0;
  }

  // Optional LLM act-summary.
  const cfg = readConfig(opts.cwd);
  let enricher: retrieve.SynthesisEnricher | undefined;
  if (!isNoLlm(opts.noLlm, cfg) && story.totalCommits >= 2) {
    try {
      enricher = await resolveEnricher({
        provider: cfg.embeddings.provider === "openai" ? "openai" : "ollama",
        model: cfg.embeddings.model,
      });
    } catch {
      enricher = undefined;
    }
  }

  for (const act of story.acts) {
    process.stdout.write(`  ${kleur.bold().magenta(act.title)}  ${kleur.gray(`(${act.fromDate} → ${act.toDate})`)}\n`);

    if (enricher) {
      // Brief LLM-narrated summary of the act.
      try {
        const summary = await narrateAct(enricher, opts.topic, act.commits);
        if (summary) {
          for (const line of wrap(summary, 90, "    ")) process.stdout.write(`${line}\n`);
        }
      } catch {
        // Fall through to commit list
      }
    }

    for (const c of act.commits.slice(0, 5)) {
      process.stdout.write(`    ${kleur.green("●")} ${kleur.bold(c.shortHash)} ${kleur.gray(c.authorDate.slice(0, 10))}  ${c.subject}\n`);
    }
    if (act.commits.length > 5) {
      process.stdout.write(`    ${kleur.gray(`... and ${act.commits.length - 5} more`)}\n`);
    }
    process.stdout.write("\n");
  }

  return 0;
}

async function narrateAct(
  enricher: retrieve.SynthesisEnricher,
  topic: string,
  commits: Commit[],
): Promise<string> {
  if (commits.length === 0) return "";
  const prompt = [
    `Topic: ${topic}`,
    "Commits in this act (chronological):",
    ...commits.slice(0, 8).map(
      (c) =>
        `  • ${c.authorDate.slice(0, 10)} ${c.shortHash} (${c.authorName}): ${c.subject}`,
    ),
    "",
    "Write 1-2 sentences narrating what happened in this act. No commit hashes, no headers, just prose.",
  ].join("\n");
  const out = await enricher.enrich({
    system: "You are a technical writer summarizing the evolution of a codebase. Be terse and concrete.",
    user: prompt,
    temperature: 0.3,
    maxTokens: 100,
  });
  return out.text.trim().replace(/^["']|["']$/g, "");
}

function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = indent;
  for (const w of words) {
    if (line.length + w.length + 1 > width && line.trim().length > 0) {
      out.push(line);
      line = indent + w;
    } else {
      line = line === indent ? line + w : `${line} ${w}`;
    }
  }
  if (line.trim()) out.push(line);
  return out;
}
