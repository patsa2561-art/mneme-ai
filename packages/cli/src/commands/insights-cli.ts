/**
 * `mneme who-knows <topic>` · `decisions` · `stack-trace` · `story <topic>`
 *
 * Wraps the pure functions in @mneme-ai/core/insights with CLI ergonomics:
 * argument parsing, store lifecycle, beautiful rendering, optional LLM narration.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import kleur from "kleur";
import {
  git,
  store,
  insights,
  util,
  retrieve,
  wisdom,
  type Commit,
} from "@mneme-ai/core";
import { resolveEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import { isNoLlm } from "../no-llm.js";

// ─── shared helpers ─────────────────────────────────────────────────────

/** Write a vault (array of {path, content}) to disk under `vaultRoot`. */
function writeVault(vaultRoot: string, files: Array<{ path: string; content: string }>): void {
  for (const f of files) {
    const full = join(vaultRoot, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
}

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
  const verdict = insights.whoKnowsVerdict(candidates);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ topic: opts.topic, verdict, candidates }, null, 2) + "\n");
    return 0;
  }

  // ─── Header ────────────────────────────────────────────────────────────
  process.stdout.write(`\n  ${kleur.bold().cyan("👤  Who knows about")}  ${kleur.bold(`"${opts.topic}"`)}\n`);
  process.stdout.write(`  ${kleur.gray("══════════════════════════════════════════════════════════")}\n\n`);

  if (candidates.length === 0 || !verdict.topExpert) {
    process.stdout.write(`  ${kleur.gray(`No commits matched "${opts.topic}". Try a broader topic.`)}\n\n`);
    return 0;
  }

  // ─── VERDICT (the answer the user is here for) ─────────────────────────
  const top = verdict.topExpert;
  process.stdout.write(`  ${kleur.bold().magenta("✦ Verdict")}\n\n`);
  process.stdout.write(
    `    ${kleur.bold(top.name)}  ${kleur.gray(`<${top.email}>`)}\n`,
  );
  process.stdout.write(
    `    ${kleur.cyan(verdict.confidencePct + "%")} confidence — ${top.commitCount} of ${verdict.totalCommits} relevant commits\n`,
  );
  process.stdout.write(
    `    last touch ${kleur.bold(daysAgoFromIso(top.lastTouch))} ago · ${top.filesTouched} files · ${renderTier(top.tier)}\n`,
  );
  if (verdict.risk) {
    process.stdout.write(`\n    ${kleur.yellow("⚠ ")}${kleur.yellow(verdict.risk)}\n`);
  }
  if (verdict.backup) {
    process.stdout.write(
      `\n    ${kleur.gray("backup:")} ${kleur.bold(verdict.backup.name)} ${kleur.gray(`(${verdict.backup.commitCount} commits, last touch ${daysAgoFromIso(verdict.backup.lastTouch)} ago)`)}\n`,
    );
  }

  // ─── All candidates ───────────────────────────────────────────────────
  if (candidates.length > 1) {
    process.stdout.write(`\n  ${kleur.bold().magenta("◆ All candidates")}  ${kleur.gray(`(${candidates.length})`)}\n\n`);
    for (const c of candidates) {
      const tier = renderTier(c.tier);
      process.stdout.write(`    ${tier}  ${kleur.bold(c.name)}  ${kleur.gray(`<${c.email}>`)}\n`);
      process.stdout.write(
        `        ${kleur.gray(`${c.commitCount} commits · ${c.filesTouched} files · last touch ${daysAgoFromIso(c.lastTouch)} ago · score ${c.score.toFixed(2)}`)}\n`,
      );
    }
  }
  process.stdout.write("\n");
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
  format?: "table" | "markdown" | "json" | "obsidian";
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

  if (opts.format === "obsidian") {
    const vaultPath = opts.out ?? "./mneme-vault";
    const files = insights.decisionsToVault(decisions);
    writeVault(vaultPath, files);
    ui.success(
      `Wrote Obsidian vault to ${vaultPath} — ${files.length} notes (${decisions.length} decisions)`,
    );
    ui.dim(`    open in Obsidian:  File → Open vault as folder → ${vaultPath}`);
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
  /** When set, write the story to an Obsidian vault folder instead of stdout. */
  obsidianOut?: string;
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

  // Obsidian vault export — write a single .md note instead of terminal render.
  if (opts.obsidianOut) {
    // Optional: pass LLM summaries when LLM is available + we have content.
    const cfg = readConfig(opts.cwd);
    let summaries: Map<number, string> | undefined;
    if (!isNoLlm(opts.noLlm, cfg) && story.totalCommits >= 2) {
      try {
        const enricher = await resolveEnricher({
          provider: cfg.embeddings.provider === "openai" ? "openai" : "ollama",
          model: cfg.embeddings.model,
        });
        summaries = new Map();
        for (let i = 0; i < story.acts.length; i++) {
          try {
            const s = await narrateAct(enricher, opts.topic, story.acts[i]!.commits);
            if (s) summaries.set(i, s);
          } catch {
            /* skip act */
          }
        }
      } catch {
        summaries = undefined;
      }
    }
    const files = insights.storyToVault(story, summaries);
    writeVault(opts.obsidianOut, files);
    ui.success(
      `Wrote story "${opts.topic}" to ${opts.obsidianOut} — ${files.length} note(s)`,
    );
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

// ─── dream ──────────────────────────────────────────────────────────────

export interface DreamOptions {
  cwd: string;
  count?: number;
  json?: boolean;
  noLlm?: boolean;
}

export async function dreamCommand(opts: DreamOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const signals = insights.gatherRepoSignals(s);
    return signals;
  });
  if (typeof result === "number") return result;
  const signals = result;

  const n = opts.count ?? 5;
  const cfg = readConfig(opts.cwd);
  const useLlm = !isNoLlm(opts.noLlm, cfg);

  let ideas = insights.heuristicDream(signals, n);
  let source: "llm" | "heuristic" = "heuristic";

  if (useLlm) {
    try {
      const enricher = await resolveEnricher({
        provider: cfg.embeddings.provider === "openai" ? "openai" : "ollama",
        model: cfg.embeddings.model,
      });
      const prompt = insights.buildDreamPrompt(signals, n);
      const out = await enricher.enrich({
        system: "You are a senior staff engineer brainstorming small, high-leverage features that would fit an existing codebase's style. Output JSON only.",
        user: prompt,
        temperature: 0.6,
        maxTokens: 800,
      });
      const parsed = insights.parseDreamIdeas(out.text);
      if (parsed.length > 0) {
        ideas = parsed.slice(0, n);
        source = "llm";
      }
    } catch {
      // fall through to heuristics
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ source, signals, ideas }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🔮  Speculative ideas based on your codebase patterns")}  ${kleur.gray(`(source: ${source})`)}\n\n`);
  process.stdout.write(`  ${kleur.gray(`Signals: ${signals.totalCommits} commits · ${signals.totalEntities} entities · ${signals.languages.length} languages`)}\n\n`);

  if (ideas.length === 0) {
    process.stdout.write(`  ${kleur.gray("No ideas generated. Index more commits + entities first.")}\n\n`);
    return 0;
  }

  ideas.forEach((idea, i) => {
    process.stdout.write(`  ${kleur.bold().magenta(`${i + 1}. ${idea.title}`)}  ${effortRiskTag(idea.effort, idea.risk)}\n`);
    for (const line of wrap(idea.pitch, 88, "    ")) process.stdout.write(`${line}\n`);
    if (idea.precedents.length > 0) {
      process.stdout.write(
        `    ${kleur.gray("Precedents:")} ${kleur.cyan(idea.precedents.join(", "))}\n`,
      );
    }
    process.stdout.write("\n");
  });

  return 0;
}

function effortRiskTag(effort: string, risk: string): string {
  const e = effort === "small" ? kleur.green("small") : effort === "large" ? kleur.red("large") : kleur.yellow("medium");
  const r = risk === "low" ? kleur.green("low") : risk === "high" ? kleur.red("high") : kleur.yellow("medium");
  return `${kleur.gray("[effort:")} ${e} ${kleur.gray("· risk:")} ${r}${kleur.gray("]")}`;
}

// ─── chat ───────────────────────────────────────────────────────────────

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { renderAnswer } from "../render-answer.js";

export interface ChatOptions {
  cwd: string;
  noLlm?: boolean;
}

export async function chatCommand(opts: ChatOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("💬  Mneme chat")}  ${kleur.gray("(multi-turn over your repo's history)")}\n`);
  process.stdout.write(`  ${kleur.gray("type your question · /exit to quit · /clear to wipe history · /save <file>")}\n\n`);

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  let enricher: retrieve.SynthesisEnricher | undefined;
  if (!isNoLlm(opts.noLlm, cfg)) {
    try {
      enricher = await resolveEnricher({
        provider: cfg.embeddings.provider === "openai" ? "openai" : "ollama",
        model: cfg.embeddings.model,
      });
    } catch {
      enricher = undefined;
    }
  }

  const transcript: Array<{ q: string; a: string }> = [];
  const rl = createInterface({ input, output });

  try {
    while (true) {
      let line: string;
      try {
        line = (await rl.question(`${kleur.cyan("›")} `)).trim();
      } catch {
        break; // Ctrl-D / Ctrl-C
      }
      if (!line) continue;

      // Slash commands.
      if (line === "/exit" || line === "/quit") break;
      if (line === "/clear") {
        transcript.length = 0;
        process.stdout.write(`  ${kleur.gray("(history cleared)")}\n`);
        continue;
      }
      if (line.startsWith("/save ")) {
        const path = line.slice(6).trim();
        try {
          writeFileSync(
            path,
            transcript.map((t, i) => `### Turn ${i + 1}\n\n**Q:** ${t.q}\n\n**A:** ${t.a}`).join("\n\n"),
          );
          process.stdout.write(`  ${kleur.green("✓")} saved transcript to ${path}\n`);
        } catch (err) {
          process.stdout.write(`  ${kleur.red("✗")} ${(err as Error).message}\n`);
        }
        continue;
      }
      if (line === "/history") {
        if (transcript.length === 0) process.stdout.write(`  ${kleur.gray("(empty)")}\n`);
        for (let i = 0; i < transcript.length; i++) {
          const t = transcript[i]!;
          process.stdout.write(`  ${kleur.gray(`#${i + 1}`)} ${kleur.cyan(t.q)} → ${t.a.slice(0, 80)}…\n`);
        }
        continue;
      }

      // Real query — classify, retrieve, synthesize.
      const intent = retrieve.classifyIntent(line);
      if (intent.intent === "vague") {
        process.stdout.write(`  ${kleur.yellow("⚠")} ${intent.reason}\n`);
        process.stdout.write(`  ${kleur.gray("Try a more specific question.")}\n\n`);
        continue;
      }

      // Augment query with last turn's context (helpful for follow-ups).
      const augmented = transcript.length > 0
        ? `${transcript[transcript.length - 1]!.q} → ${line}`
        : line;

      const calib = wisdom.readCalibration(s);
      const results = await retrieve.search(augmented, {
        store: s,
        embedder,
        repo: meta,
        topK: 8,
        semanticWeight: calib.semanticWeight,
      });
      const confidence = retrieve.classifyConfidence(results);
      const synth = await retrieve.synthesize(line, results, confidence, enricher);

      let feedbackId: string | undefined;
      try {
        feedbackId = wisdom.recordQuery(s, {
          query: line,
          resultHashes: results.map((r) => r.commit.hash),
          topScore: results[0]?.score,
          semanticWeight: calib.semanticWeight,
          minSemCosine: calib.minSemCosine,
          rrfK: calib.rrfK,
        });
      } catch {
        /* ignore */
      }

      process.stdout.write(
        renderAnswer({ question: line, synthesized: synth, results, repo: meta, feedbackId }),
      );

      transcript.push({ q: line, a: synth.answer });
    }
  } finally {
    rl.close();
    s.close();
  }

  process.stdout.write(`\n  ${kleur.gray(`bye — ${transcript.length} turn(s) recorded`)}\n\n`);
  return 0;
}

// ─── divider helper — used across all insights output ─────────────────

const DIV_WIDTH = 64;
function divider(label = ""): string {
  if (!label) return kleur.gray("═".repeat(DIV_WIDTH));
  const padded = `═══ ${label} `;
  const tail = "═".repeat(Math.max(4, DIV_WIDTH - padded.length));
  return kleur.gray(padded + tail);
}

// ─── regret ─────────────────────────────────────────────────────────────

export interface RegretOptions {
  cwd: string;
  windowDays?: number;
  json?: boolean;
}

export async function regretCommand(opts: RegretOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const regrets = insights.detectRegrets(commits, { windowDays: opts.windowDays ?? 7 });
    const summary = insights.summarizeRegrets(commits, regrets);
    return { regrets, summary };
  });
  if (typeof result === "number") return result;
  const { regrets, summary } = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ regrets, summary }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("😬  Regrets — what we shipped and immediately fixed")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);

  // Verdict
  process.stdout.write(`  ${kleur.bold().magenta("✦ Summary")}\n\n`);
  process.stdout.write(
    `    ${kleur.bold(String(summary.totalRegrets))} regrets across ${kleur.bold(String(summary.totalShipped))} shipped commits  ${kleur.gray(`(rate: ${(summary.regretRate * 100).toFixed(1)}%)`)}\n`,
  );
  if (summary.totalRegrets > 0) {
    process.stdout.write(`    average days-to-fix: ${kleur.bold(summary.averageDaysToFix.toFixed(1))}\n`);
    const breakdown = Object.entries(summary.byKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(" · ");
    if (breakdown) process.stdout.write(`    ${kleur.gray("breakdown: " + breakdown)}\n`);
  }

  if (regrets.length === 0) {
    process.stdout.write(`\n  ${kleur.green("✓")} No regrets detected — clean shipping history.\n\n`);
    return 0;
  }

  // Listing
  process.stdout.write(`\n  ${kleur.bold().magenta("◆ Recent regrets")}  ${kleur.gray(`(showing ${Math.min(20, regrets.length)} of ${regrets.length})`)}\n\n`);
  for (const r of regrets.slice(0, 20)) {
    const kindBadge = renderRegretKind(r.kind);
    const shippedHash = r.shipped.shortHash || r.shipped.hash.slice(0, 7);
    const followupHash = r.followup.shortHash || r.followup.hash.slice(0, 7);
    process.stdout.write(`    ${kindBadge}  shipped ${kleur.bold(r.shipped.authorDate.slice(0, 10))}  ${kleur.gray("→ fixed in " + r.daysToFix + "d")}\n`);
    process.stdout.write(`        ${kleur.cyan(shippedHash)}  ${kleur.bold(r.shipped.subject)}\n`);
    process.stdout.write(`        ${kleur.gray("↳ " + followupHash + "  " + r.followup.subject)}\n`);
    if (r.lesson) process.stdout.write(`        ${kleur.gray("lesson: " + r.lesson)}\n`);
    process.stdout.write("\n");
  }
  return 0;
}

function renderRegretKind(kind: string): string {
  switch (kind) {
    case "revert":
      return kleur.red().bold("REVERT  ");
    case "hotfix":
      return kleur.yellow().bold("HOTFIX  ");
    case "fix":
      return kleur.cyan().bold("FIX     ");
    default:
      return kleur.gray().bold("similar ");
  }
}

// ─── bus-factor ─────────────────────────────────────────────────────────

export interface BusFactorOptions {
  cwd: string;
  topN?: number;
  minTouches?: number;
  json?: boolean;
}

export async function busFactorCommand(opts: BusFactorOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    return insights.busFactor(s, { topN: opts.topN ?? 20, minTouches: opts.minTouches ?? 3 });
  });
  if (typeof result === "number") return result;
  const risks = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ risks }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🚨  Bus-factor risks — knowledge fragility")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);

  if (risks.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No high-risk files detected — knowledge is well distributed.\n\n`);
    return 0;
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of risks) counts[r.tier] += 1;
  process.stdout.write(`  ${kleur.bold().magenta("✦ Summary")}\n\n`);
  process.stdout.write(
    `    ${kleur.red().bold(String(counts.critical))} critical  ·  ${kleur.yellow().bold(String(counts.high))} high  ·  ${kleur.cyan().bold(String(counts.medium))} medium  ·  ${kleur.gray(counts.low + " low")}\n\n`,
  );

  process.stdout.write(`  ${kleur.bold().magenta("◆ Files at risk")}  ${kleur.gray(`(top ${risks.length})`)}\n\n`);
  for (const r of risks) {
    const tier = renderBusFactorTier(r.tier);
    process.stdout.write(`    ${tier}  ${kleur.bold(r.filePath)}\n`);
    process.stdout.write(
      `        ${kleur.bold(r.topOwner.name)} ${kleur.gray(`<${r.topOwner.email}>`)}  ${kleur.cyan(r.topOwner.sharePct + "%")}  ${kleur.gray(`(${r.topOwner.touches} of ${r.totalTouches} commits)`)}\n`,
    );
    if (r.backup) {
      process.stdout.write(`        ${kleur.gray(`backup: ${r.backup.name} (${r.backup.touches} commits)`)}\n`);
    }
    process.stdout.write(`        ${kleur.gray("→ " + r.recommendation)}\n\n`);
  }
  return 0;
}

function renderBusFactorTier(tier: string): string {
  switch (tier) {
    case "critical":
      return kleur.red().bold("CRITICAL");
    case "high":
      return kleur.yellow().bold("HIGH    ");
    case "medium":
      return kleur.cyan().bold("MEDIUM  ");
    default:
      return kleur.gray().bold("LOW     ");
  }
}

// ─── paradox ────────────────────────────────────────────────────────────

export interface ParadoxOptions {
  cwd: string;
  json?: boolean;
}

export async function paradoxCommand(opts: ParadoxOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const decisions = commits.flatMap(insights.extractDecisions);
    return insights.detectParadoxes(decisions);
  });
  if (typeof result === "number") return result;
  const flipFlops = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ flipFlops }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🌀  Paradoxes — architectural flip-flops")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);

  if (flipFlops.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No flip-flops detected. Either the team is consistent, or commit messages are too thin to extract decisions.\n\n`);
    return 0;
  }

  process.stdout.write(`  ${kleur.bold().magenta("✦ Summary")}\n\n`);
  process.stdout.write(`    ${kleur.bold(String(flipFlops.length))} topic(s) flip-flopped over time\n\n`);

  for (const f of flipFlops) {
    process.stdout.write(`  ${divider("topic: " + f.topic)}\n`);
    process.stdout.write(
      `    ${kleur.bold(String(f.flips))} reversal${f.flips === 1 ? "" : "s"}  ${kleur.gray(`over ${f.spanMonths} months · ${f.chain.length} decisions`)}\n\n`,
    );
    for (const d of f.chain) {
      process.stdout.write(
        `    ${kleur.gray("●")} ${kleur.bold(d.date)}  ${kleur.cyan(d.shortHash)}  ${d.summary}  ${kleur.gray(`(${d.author})`)}\n`,
      );
    }
    process.stdout.write(`\n    ${kleur.yellow("→ ")}${kleur.yellow(f.question)}\n\n`);
  }
  return 0;
}

// ─── commit-coach ───────────────────────────────────────────────────────

export interface CommitCoachOptions {
  cwd: string;
  diffFile?: string;
  fromStdin?: boolean;
  json?: boolean;
  noLlm?: boolean;
}

export async function commitCoachCommand(opts: CommitCoachOptions): Promise<number> {
  // Read the diff: from file, stdin, or `git diff --staged`.
  let diffText = "";
  if (opts.diffFile) {
    try {
      diffText = readFileSync(opts.diffFile, "utf8");
    } catch (err) {
      ui.error(`Cannot read ${opts.diffFile}: ${(err as Error).message}`);
      return 1;
    }
  } else if (opts.fromStdin) {
    diffText = await readStdin();
  } else {
    // Default: shell out to git diff --staged
    try {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("git", ["diff", "--staged"], { cwd: opts.cwd, encoding: "utf8" });
      if (r.status === 0) diffText = r.stdout;
    } catch {
      // git not available — let user know
    }
  }
  if (!diffText.trim()) {
    ui.error("No staged diff. Pass --from <file>, --stdin, or `git add` something first.");
    return 1;
  }

  const result = await withStore(opts.cwd, (s) => insights.coach(s, diffText));
  if (typeof result === "number") return result;
  const advice = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(advice, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🪶  Commit coach — pre-commit review")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);

  // Diff section
  process.stdout.write(`  ${kleur.bold().magenta("✦ Diff")}\n\n`);
  process.stdout.write(
    `    ${kleur.bold(String(advice.diff.files.length))} file(s)  ·  ${kleur.green("+" + advice.diff.added)} ${kleur.red("-" + advice.diff.removed)}  ·  shape: ${kleur.cyan(advice.diff.shape)}\n`,
  );
  for (const m of advice.diff.modules.slice(0, 5)) process.stdout.write(`    ${kleur.gray("·")} ${m}\n`);
  process.stdout.write("\n");

  // Suggested message
  process.stdout.write(`  ${kleur.bold().magenta("✦ Suggested commit message")}\n\n`);
  process.stdout.write(`    ${kleur.bold(advice.suggestedSubject)}\n\n`);

  // Reviewers
  if (advice.reviewers.length > 0) {
    process.stdout.write(`  ${kleur.bold().magenta("◆ Reviewers")}  ${kleur.gray("(top experts on touched files)")}\n\n`);
    for (const r of advice.reviewers) {
      process.stdout.write(
        `    ${kleur.cyan("●")} ${kleur.bold(r.name)} ${kleur.gray(`<${r.email}>`)}  ${kleur.cyan(r.ownership + "%")}  ${kleur.gray(`(${r.ownedFiles.length} owned files)`)}\n`,
      );
    }
    process.stdout.write("\n");
  }

  // Scope
  process.stdout.write(`  ${kleur.bold().magenta("◆ Scope")}\n\n`);
  process.stdout.write(`    ${advice.scopeOK ? kleur.green("✓") : kleur.yellow("⚠")} ${advice.scopeMessage}\n\n`);

  // Warnings
  if (advice.warnings.length > 0) {
    process.stdout.write(`  ${kleur.bold().magenta("⚠ Past warnings")}\n\n`);
    for (const w of advice.warnings) {
      process.stdout.write(`    ${kleur.yellow("⚠ ")}${kleur.yellow(w.pattern)}\n`);
      process.stdout.write(`        ${kleur.gray(`${w.pastDate} · ${w.pastCommitHash} · ${w.outcome}`)}\n\n`);
    }
  } else {
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.gray("No past-regret warnings for these files.")}\n\n`);
  }
  return 0;
}

// ─── crystal-ball ───────────────────────────────────────────────────────

export interface CrystalBallOptions {
  cwd: string;
  diffFile?: string;
  fromStdin?: boolean;
  windowDays?: number;
  json?: boolean;
}

export async function crystalBallCommand(opts: CrystalBallOptions): Promise<number> {
  // Same diff-acquisition pattern as commit-coach.
  let diffText = "";
  if (opts.diffFile) {
    try {
      diffText = readFileSync(opts.diffFile, "utf8");
    } catch (err) {
      ui.error(`Cannot read ${opts.diffFile}: ${(err as Error).message}`);
      return 1;
    }
  } else if (opts.fromStdin) {
    diffText = await readStdin();
  } else {
    try {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("git", ["diff", "--staged"], { cwd: opts.cwd, encoding: "utf8" });
      if (r.status === 0) diffText = r.stdout;
    } catch {
      /* ignore */
    }
  }
  if (!diffText.trim()) {
    ui.error("No staged diff. Pass --from <file>, --stdin, or `git add` something first.");
    return 1;
  }

  const result = await withStore(opts.cwd, (s) =>
    insights.predict(s, diffText, opts.windowDays ?? 14),
  );
  if (typeof result === "number") return result;
  const p = result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(p, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🔮  Crystal ball — CI / follow-up failure prediction")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);

  // Verdict
  process.stdout.write(`  ${kleur.bold().magenta("✦ Verdict")}\n\n`);
  process.stdout.write(`    ${renderCrystalBallVerdict(p.verdict)}  ${kleur.cyan((p.pClean * 100).toFixed(0) + "%")} clean rate  ${kleur.gray(`(${p.cleanN}/${p.similarN} similar past changes)`)}\n\n`);

  // Fingerprint
  process.stdout.write(`  ${kleur.bold().magenta("◆ Diff fingerprint")}\n\n`);
  process.stdout.write(`    modules:  ${p.fingerprint.modules.join(", ") || kleur.gray("(none)")}\n`);
  process.stdout.write(`    extensions: ${p.fingerprint.extensions.join(", ") || kleur.gray("(none)")}\n`);
  process.stdout.write(`    shape:    ${kleur.cyan(p.fingerprint.shape)} · ${p.fingerprint.size} · tests ${p.fingerprint.hasTests ? "yes" : "no"}\n\n`);

  // Most-similar
  if (p.mostSimilar) {
    const outcome = p.mostSimilar.outcome === "clean" ? kleur.green("clean") : kleur.red("trouble");
    process.stdout.write(`  ${kleur.bold().magenta("◆ Most similar past change")}\n\n`);
    process.stdout.write(`    ${kleur.bold(p.mostSimilar.hash)}  ${kleur.gray(p.mostSimilar.date)}  ${p.mostSimilar.subject}\n`);
    process.stdout.write(`    outcome: ${outcome}\n\n`);
  }

  process.stdout.write(`  ${kleur.bold().magenta("→ Recommendation")}\n\n`);
  process.stdout.write(`    ${p.recommendation}\n\n`);
  return 0;
}

function renderCrystalBallVerdict(v: string): string {
  switch (v) {
    case "clear":
      return kleur.green().bold("● CLEAR    ");
    case "moderate":
      return kleur.yellow().bold("● MODERATE ");
    case "risky":
      return kleur.red().bold("● RISKY    ");
    default:
      return kleur.gray().bold("○ UNKNOWN  ");
  }
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
