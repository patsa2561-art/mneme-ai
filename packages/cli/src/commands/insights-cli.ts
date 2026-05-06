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
import {
  ui,
  header,
  section,
  citation,
  emptyState,
  nextSteps,
  pill,
  meter,
  kv,
} from "../ui.js";
import { isNoLlm } from "../no-llm.js";
import { getVersion } from "../version.js";

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
  process.stdout.write(header("👤", `Who knows about "${opts.topic}"?`,
    `Ranked by recency × frequency × file footprint  (more recent + more touches + more files = higher rank)`,
    `Find the person to ask — and the bus-factor risk if they leave. Use before assigning code reviews or scoping a refactor.`) + "\n\n");

  if (candidates.length === 0 || !verdict.topExpert) {
    process.stdout.write(emptyState(
      `No commits matched "${opts.topic}".`,
      [
        "Try a broader topic ('auth' instead of 'auth-token-rotation').",
        "Check spelling — Mneme matches via full-text search, not fuzzy.",
        "Run `mneme index` if you've added relevant commits since the last index.",
      ],
    ));
    return 0;
  }

  // ─── VERDICT (the answer the user is here for) ─────────────────────────
  const top = verdict.topExpert;
  process.stdout.write(section("✦ Verdict") + "\n\n");
  process.stdout.write(
    `    ${kleur.bold(top.name)}  ${kleur.gray(`<${top.email}>`)}  ${renderTier(top.tier)}\n`,
  );
  const confLabel = verdict.confidencePct >= 80 ? "high" : verdict.confidencePct >= 50 ? "medium" : "low";
  process.stdout.write(
    `    ${meter(verdict.confidencePct / 100, { width: 12 })}  ${kleur.cyan(verdict.confidencePct + "%")} confidence ${kleur.gray("(" + confLabel + ")")}  ${kleur.gray(`— this person owns ${top.commitCount} of ${verdict.totalCommits} matching commits`)}\n`,
  );
  process.stdout.write(
    `    ${kleur.gray(`last touch ${daysAgoFromIso(top.lastTouch)} ago · ${top.filesTouched} files in their footprint`)}\n`,
  );
  if (top.topFiles && top.topFiles.length > 0) {
    process.stdout.write(`    ${kleur.cyan("their territory:")} ${kleur.gray(top.topFiles.join(", "))}\n`);
  }
  if (verdict.risk) {
    process.stdout.write(`\n    ${pill("RISK", "warn")}  ${kleur.yellow(verdict.risk)}\n`);
  }
  if (verdict.backup) {
    process.stdout.write(
      `\n    ${kleur.gray("backup:")} ${kleur.bold(verdict.backup.name)} ${kleur.gray(`(${verdict.backup.commitCount} commits, last touch ${daysAgoFromIso(verdict.backup.lastTouch)} ago)`)}\n`,
    );
  }
  process.stdout.write("\n");

  // ─── Plain-English reading guide ─────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("tier")} ${kleur.gray("ranks expertise:")} ${kleur.green("⭐ definitive")} ${kleur.gray("(top 5% — clear owner) ›")} ${kleur.cyan("● active")} ${kleur.gray("(currently working) ›")} ${kleur.yellow("◐ stale")} ${kleur.gray("(knows it, hasn't touched recently) ›")} ${kleur.gray("○ occasional")} ${kleur.gray("(touched a few times)")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("confidence")} ${kleur.gray("= how dominant the top person is vs the rest. 80%+ means a clear single owner; <50% means the work is spread out.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Always sanity-check with")} ${kleur.cyan("mneme story \"" + opts.topic + "\"")} ${kleur.gray("before reassigning work.")}\n\n`);

  // ─── All candidates ───────────────────────────────────────────────────
  if (candidates.length > 1) {
    process.stdout.write(section("◆ All candidates", `(${candidates.length} total)`) + "\n\n");
    const maxCount = Math.max(...candidates.map((c) => c.commitCount));
    for (const c of candidates) {
      const tier = renderTier(c.tier);
      process.stdout.write(
        `    ${tier}  ${kleur.bold(c.name.padEnd(22))}  ${meter(c.commitCount / Math.max(1, maxCount), { width: 8 })}  ${kleur.gray(`${c.commitCount} commits · ${c.filesTouched} files · ${daysAgoFromIso(c.lastTouch)}`)}\n`,
      );
      if (c.topFiles && c.topFiles.length > 0) {
        process.stdout.write(`        ${kleur.gray("↳ " + c.topFiles.slice(0, 3).join(", "))}\n`);
      }
    }
    process.stdout.write("\n");
  }

  process.stdout.write(nextSteps([
    {
      cmd: `mneme story "${opts.topic}"`,
      why: `Read the full narrative of how "${opts.topic}" evolved.`,
    },
    {
      cmd: `mneme dna ${top.email}`,
      why: `Inspect the top expert's coding fingerprint.`,
    },
  ]) + "\n\n");
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
  process.stdout.write(header("📜", "Architecture Decisions",
    `${decisions.length} decision(s) extracted via regex + heuristics — minimum confidence ${(opts.minConfidence ?? 0.6).toFixed(2)}`,
    `Auto-generate ADR drafts from your commit history — every "decided to X", "switched from A to B", "deprecated Y" surfaced and exportable to Markdown / Obsidian.`) + "\n\n");

  if (decisions.length === 0) {
    process.stdout.write(emptyState(
      "No decisions extracted from commit history.",
      [
        `Decisions are matched by patterns like "decided to X", "switched from A to B", "replaced X with Y", "deprecated Z".`,
        `Encourage richer commit messages, then re-run \`mneme index\`.`,
        `Lower the bar with --min-confidence 0.4 to surface borderline matches.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each row is one architecture decision auto-extracted from a commit message.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("kind")} ${kleur.gray("tells you the decision type (added, removed, switched, deprecated, replaced).")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("confidence")} ${kleur.gray("= how sure the regex is this is a decision: 0.85+ strong · 0.70+ likely · <0.70 borderline.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Treat this as a")} ${kleur.bold("draft")} ${kleur.gray("— always review before committing the export.")}\n\n`);

  // Decision-kind tally
  const byKind = new Map<string, number>();
  for (const d of decisions) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
  if (byKind.size > 0) {
    process.stdout.write(section("◇ By kind") + "\n");
    const maxK = Math.max(...byKind.values());
    for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`    ${kleur.cyan(k.padEnd(14))} ${meter(n / maxK, { width: 12 })}  ${kleur.bold(String(n).padStart(3))}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(section("◆ Latest decisions", "(top 30 by date)") + "\n\n");
  for (const d of decisions.slice(0, 30)) {
    const lvl = d.confidence >= 0.85 ? "ok" : d.confidence >= 0.7 ? "low" : "medium";
    const confLabel = d.confidence >= 0.85 ? "strong" : d.confidence >= 0.7 ? "likely" : "borderline";
    process.stdout.write(
      `    ${pill(d.kind, lvl)}  ${kleur.gray(d.date)}  ${kleur.cyan(d.author.padEnd(16))}  ${kleur.bold(d.summary)}\n`,
    );
    if (d.rationale) process.stdout.write(`        ${kleur.gray("→ " + d.rationale)}\n`);
    if (d.filesAffected && d.filesAffected.length > 0) {
      process.stdout.write(`        ${kleur.gray("files: " + d.filesAffected.join(", "))}\n`);
    }
    process.stdout.write(`        ${kleur.gray(`confidence ${(d.confidence * 100).toFixed(0)}% (${confLabel}) · ${d.shortHash}`)}\n\n`);
  }
  if (decisions.length > 30) {
    process.stdout.write(`  ${kleur.gray(`...and ${decisions.length - 30} more.`)}\n\n`);
    process.stdout.write(nextSteps([
      {
        cmd: `mneme decisions --format markdown --out docs/ADR.md`,
        why: `Export the full ADR list as committable Markdown.`,
      },
      {
        cmd: `mneme decisions --format obsidian --out ./mneme-vault`,
        why: `Open the decision graph in Obsidian as a knowledge vault.`,
      },
    ]) + "\n");
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
  process.stdout.write(header("🎯", "Stack analysis",
    `${language} · ${frames.length} frame(s) parsed · history-aware root-cause hints`,
    `Pipe a stack trace in — get the most-likely commit that broke it + which files have a history of incidents.`) + "\n\n");

  // Smart top-line: most-incident-prone frame
  const hottest = [...analyses].sort((a, b) => b.pastIncidents - a.pastIncidents)[0];
  if (hottest && hottest.pastIncidents > 0) {
    process.stdout.write(
      `  ${kleur.red("⚠")}  ${kleur.bold(hottest.frame.file)} has ${kleur.red().bold(`${hottest.pastIncidents} past incident(s)`)} — start there.\n\n`,
    );
  } else {
    process.stdout.write(
      `  ${kleur.green("✓")}  No file in this trace has a known incident history — likely a fresh bug.\n\n`,
    );
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Frames are listed top-down (innermost first) — the first frame is usually the bug.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("recent commits")} ${kleur.gray("= the last 3 commits that touched this file. The newest one is the prime suspect.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("INCIDENTS")} ${kleur.gray("= past failures recorded against this file (regrets, hotfixes, reverts) — high count means a fragile area.")}\n\n`);

  analyses.forEach((a, i) => {
    const frameLabel = `Frame ${i + 1}`;
    process.stdout.write(
      `  ${kleur.bold(frameLabel)}  ${kleur.cyan(a.frame.file)}:${kleur.bold(String(a.frame.line))}`,
    );
    if (a.frame.function) process.stdout.write(`  ${kleur.gray(`(${a.frame.function})`)}`);
    process.stdout.write("\n");

    if (a.lastCommits.length === 0) {
      process.stdout.write(`    ${kleur.gray("(no commits indexed for this file — may be a generated or vendored file)")}\n\n`);
      return;
    }

    process.stdout.write(`    ${kleur.gray("recent commits touching this file (newest first — prime suspect on top):")}\n`);
    for (const c of a.lastCommits) {
      const date = c.authorDate.slice(0, 10);
      process.stdout.write(
        `      ${kleur.green("●")} ${kleur.bold(c.shortHash)}  ${kleur.gray(`[${date} · ${c.authorName}]`)}  ${c.subject}\n`,
      );
    }
    if (a.pastIncidents > 0) {
      const verdict = a.pastIncidents >= 5 ? "fragile area — consider a refactor" : a.pastIncidents >= 2 ? "repeat offender" : "has been broken before";
      process.stdout.write(
        `    ${pill("INCIDENTS", "warn")}  ${kleur.yellow(`${a.pastIncidents} past incident(s) affected this file — ${verdict}`)}\n`,
      );
    }
    process.stdout.write("\n");
  });

  process.stdout.write(nextSteps([
    {
      cmd: `mneme palimpsest ${analyses[0]?.frame.file}:${analyses[0]?.frame.line}`,
      why: `Walk the layered edit history of the top frame.`,
    },
    {
      cmd: `mneme why ${analyses[0]?.frame.file}:${analyses[0]?.frame.line}`,
      why: `Get the originating commits + semantically related work.`,
    },
  ]) + "\n\n");

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
  process.stdout.write(header("📖", `The "${opts.topic}" Story`,
    `${story.acts.length} act(s) · ${story.totalCommits} commit(s) · ${story.spanDays} day(s)`,
    `See how a feature evolved — chaptered narrative across all relevant commits. Great for onboarding or post-mortems.`) + "\n\n");

  if (story.acts.length === 0) {
    process.stdout.write(emptyState(
      `No commits matched "${opts.topic}".`,
      [
        "Try a broader topic ('auth' instead of 'auth-token-rotation').",
        "Run `mneme index` if you've added relevant commits since the last index.",
        `Cross-check with: mneme who-knows "${opts.topic}" — the search uses the same matcher.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• An")} ${kleur.bold("act")} ${kleur.gray("is a contiguous burst of work — gaps longer than a few weeks split the story into a new act.")}\n`);
  process.stdout.write(`    ${kleur.gray("• The activity sparkline below shows commit volume per act — peaks reveal where the real work happened.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Each act lists up to 5 representative commits; rerun with --obsidian-out for the full archive.")}\n\n`);

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

  // Sparkline of commit volume across acts
  if (story.acts.length >= 3) {
    const counts = story.acts.map((a) => a.commits.length);
    const { sparkline } = await import("../ui.js");
    process.stdout.write(`  ${kleur.gray("activity:")} ${sparkline(counts)}  ${kleur.gray(`(min ${Math.min(...counts)} · max ${Math.max(...counts)} commits per act)`)}\n\n`);
  }

  for (const act of story.acts) {
    process.stdout.write(section(act.title, `(${act.fromDate} → ${act.toDate} · ${act.commits.length} commits)`) + "\n");

    if (enricher) {
      // Brief LLM-narrated summary of the act.
      try {
        const summary = await narrateAct(enricher, opts.topic, act.commits);
        if (summary) {
          for (const line of wrap(summary, 90, "      ")) process.stdout.write(`${line}\n`);
          process.stdout.write("\n");
        }
      } catch {
        // Fall through to commit list
      }
    }

    for (const c of act.commits.slice(0, 5)) {
      process.stdout.write(
        `    ${kleur.green("●")} ${kleur.bold(c.shortHash)}  ${kleur.gray(c.authorDate.slice(0, 10))}  ${c.subject}\n`,
      );
    }
    if (act.commits.length > 5) {
      process.stdout.write(`    ${kleur.gray(`...and ${act.commits.length - 5} more`)}\n`);
    }
    if (act.hotFiles && act.hotFiles.length > 0) {
      process.stdout.write(`    ${kleur.cyan("hot files (where this act took place):")}\n`);
      for (const hf of act.hotFiles) {
        process.stdout.write(
          `        ${kleur.bold(String(hf.count).padStart(3))}× ${kleur.white(hf.path)}\n`,
        );
      }
    }
    process.stdout.write("\n");
  }

  process.stdout.write(nextSteps([
    {
      cmd: `mneme story "${opts.topic}" --obsidian-out ./mneme-vault`,
      why: `Export the full story as a navigable Obsidian vault.`,
    },
    {
      cmd: `mneme who-knows "${opts.topic}"`,
      why: `Find the bus-factor author for this topic.`,
    },
  ]) + "\n\n");

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
  const sourceLabel = source === "llm" ? "LLM-narrated (creative)" : "heuristic (deterministic)";
  process.stdout.write(header("🔮", `Speculative ideas based on YOUR codebase patterns`,
    `source: ${sourceLabel} · ${signals.totalCommits} commits · ${signals.totalEntities} entities · ${signals.languages.length} languages`,
    `Brainstorm small, high-leverage features that would fit your codebase's actual style — not generic best-practices.`) + "\n\n");

  if (ideas.length === 0) {
    process.stdout.write(emptyState(
      "No ideas generated.",
      [
        "Index more commits and entities first: `mneme index`.",
        "Then re-run `mneme dream` (or try --no-llm for the deterministic heuristic).",
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• These are")} ${kleur.bold("speculative")} ${kleur.gray("— not validated. Treat each idea as a brainstorm seed, not a roadmap entry.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("(small effort, low risk)")} ${kleur.gray("= a weekend project; ")}${kleur.bold("(large effort, high risk)")} ${kleur.gray("= a quarter+ with unknowns.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("Precedents")} ${kleur.gray("are existing files/modules in YOUR repo that the idea would extend.")}\n\n`);

  ideas.forEach((idea, i) => {
    process.stdout.write(`  ${kleur.bold().magenta(`${i + 1}. ${idea.title}`)}  ${effortRiskTag(idea.effort, idea.risk)}\n`);
    for (const line of wrap(idea.pitch, 88, "      ")) process.stdout.write(`${line}\n`);
    if (idea.precedents.length > 0) {
      process.stdout.write(
        `      ${kleur.gray("Precedents:")} ${kleur.cyan(idea.precedents.join(", "))}\n`,
      );
    }
    process.stdout.write("\n");
  });

  return 0;
}

function effortRiskTag(effort: string, risk: string): string {
  const e = effort === "small" ? kleur.green("small effort") : effort === "large" ? kleur.red("large effort") : kleur.yellow("medium effort");
  const r = risk === "low" ? kleur.green("low risk") : risk === "high" ? kleur.red("high risk") : kleur.yellow("medium risk");
  return `${kleur.gray("(")}${e}${kleur.gray(", ")}${r}${kleur.gray(")")}`;
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
  process.stdout.write(`\n  ${kleur.bold().cyan("💬  Mneme chat")}  ${kleur.gray("— multi-turn Q&A over your repo's history")}\n`);
  process.stdout.write(`  ${kleur.gray("Each answer cites the commits it pulled from; vague questions are flagged before searching.")}\n`);
  process.stdout.write(`  ${kleur.gray("Slash commands:")} ${kleur.cyan("/exit")} ${kleur.gray("quit ·")} ${kleur.cyan("/clear")} ${kleur.gray("wipe history ·")} ${kleur.cyan("/save <file>")} ${kleur.gray("dump transcript ·")} ${kleur.cyan("/history")} ${kleur.gray("show turns")}\n\n`);

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
  process.stdout.write(header("😬", "Regrets — what we shipped and immediately fixed",
    `paired commits within ${opts.windowDays ?? 7} days · revert + hotfix + fix patterns`,
    `Find work that was rushed: shipped, then immediately reverted/hotfixed/fixed. Use to identify fragile workflows or inadequate review.`) + "\n\n");

  // Verdict
  const ratePct = summary.regretRate * 100;
  const rateLabel = ratePct >= 20 ? "high — process gap likely" : ratePct >= 10 ? "elevated" : ratePct >= 5 ? "normal" : "very clean";
  process.stdout.write(section("✦ Summary") + "\n\n");
  process.stdout.write(
    `    ${kleur.bold(String(summary.totalRegrets))} regrets across ${kleur.bold(String(summary.totalShipped))} shipped commits  ${kleur.gray(`(rate: ${ratePct.toFixed(1)}% — ${rateLabel})`)}\n`,
  );
  if (summary.totalRegrets > 0) {
    process.stdout.write(`    average days-to-fix: ${kleur.bold(summary.averageDaysToFix.toFixed(1))} ${kleur.gray("(lower = caught quickly)")}\n`);
    const breakdown = Object.entries(summary.byKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(" · ");
    if (breakdown) process.stdout.write(`    ${kleur.gray("breakdown: " + breakdown)}\n`);
  }

  if (regrets.length === 0) {
    process.stdout.write(emptyState(
      "Clean shipping history — no rushed work detected.",
      [
        `Loosen the window with --window-days 30 to catch slower-burning regrets.`,
        `Re-run after the next release to track over time.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write("\n" + section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("REVERT")} ${kleur.gray("= explicit `git revert`. ")}${kleur.bold("HOTFIX")} ${kleur.gray("= rapid follow-up touching the same files. ")}${kleur.bold("FIX")} ${kleur.gray("= conventional commit `fix:` shortly after the original.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("rate")} ${kleur.gray("under 5% is healthy; 10%+ suggests review or testing gaps; 20%+ is a process problem.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("days-to-fix")} ${kleur.gray("close to 0 means caught immediately — that's good. Multi-day gaps mean the bug shipped to users.")}\n`);

  // Listing
  process.stdout.write(`\n  ${kleur.bold().magenta("◆ Recent regrets")}  ${kleur.gray(`(showing ${Math.min(20, regrets.length)} of ${regrets.length})`)}\n\n`);
  for (const r of regrets.slice(0, 20)) {
    const kindBadge = renderRegretKind(r.kind);
    const shippedHash = r.shipped.shortHash || r.shipped.hash.slice(0, 7);
    const followupHash = r.followup.shortHash || r.followup.hash.slice(0, 7);
    process.stdout.write(`    ${kindBadge}  shipped ${kleur.bold(r.shipped.authorDate.slice(0, 10))}  ${kleur.gray("→ fixed in " + r.daysToFix + "d")}\n`);
    process.stdout.write(`        ${kleur.cyan(shippedHash)}  ${kleur.bold(r.shipped.subject)}\n`);
    process.stdout.write(`        ${kleur.gray("↳ " + followupHash + "  " + r.followup.subject)}\n`);
    if (r.affectedFiles && r.affectedFiles.length > 0) {
      process.stdout.write(`        ${kleur.cyan("files affected:")} ${kleur.gray(r.affectedFiles.join(", "))}\n`);
    }
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
  process.stdout.write(header("🚨", "Bus-factor risks — knowledge fragility",
    `top ${opts.topN ?? 20} files · ownership ≥ ${opts.minTouches ?? 3} touches`,
    `Spot files that depend on a single person — if they leave or take leave, this is what stalls. Use before vacations, reorgs, or hiring decisions.`) + "\n\n");

  if (risks.length === 0) {
    process.stdout.write(emptyState(
      "Knowledge is well distributed — no bus-factor hotspots.",
      [
        `Lower the floor with --min-touches 1 to surface borderline files.`,
        `Run after the next big change to track ownership drift over time.`,
      ],
    ));
    return 0;
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of risks) counts[r.tier] += 1;
  process.stdout.write(section("✦ Summary") + "\n\n");
  process.stdout.write(
    `    ${kleur.red().bold(String(counts.critical))} critical  ·  ${kleur.yellow().bold(String(counts.high))} high  ·  ${kleur.cyan().bold(String(counts.medium))} medium  ·  ${kleur.gray(counts.low + " low")}\n\n`,
  );

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("share %")} ${kleur.gray("= what fraction of commits to that file came from one person. 80%+ = single owner; 50–80% = primary owner.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("CRITICAL")} ${kleur.gray("= one person owns nearly everything AND no backup exists. Pair-program before they take leave.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("backup")} ${kleur.gray("= second-most-active contributor. Empty = nobody else has touched it.")}\n\n`);

  process.stdout.write(`  ${kleur.bold().magenta("◆ Files at risk")}  ${kleur.gray(`(top ${risks.length} — most fragile first)`)}\n\n`);
  for (const r of risks) {
    const tier = renderBusFactorTier(r.tier);
    const dominanceLabel = r.topOwner.sharePct >= 80 ? "sole owner" : r.topOwner.sharePct >= 50 ? "primary owner" : "lead contributor";
    process.stdout.write(`    ${tier}  ${kleur.bold(r.filePath)}\n`);
    process.stdout.write(
      `        ${kleur.bold(r.topOwner.name)} ${kleur.gray(`<${r.topOwner.email}>`)}  ${kleur.cyan(r.topOwner.sharePct + "%")} ${kleur.gray("(" + dominanceLabel + ")")}  ${kleur.gray(`— ${r.topOwner.touches} of ${r.totalTouches} commits`)}\n`,
    );
    if (r.backup) {
      process.stdout.write(`        ${kleur.gray(`backup: ${r.backup.name} (${r.backup.touches} commits — needs more reps to be a true second)`)}\n`);
    } else {
      process.stdout.write(`        ${kleur.red("⚠ no backup contributor — single point of failure")}\n`);
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
  process.stdout.write(header("🌀", "Paradoxes — architectural flip-flops",
    `topics where the team adopted, abandoned, then re-adopted (or vice versa) the same approach`,
    `Surface decisions the team has reversed. Useful for retros — "why did we keep going back and forth on X?"`) + "\n\n");

  if (flipFlops.length === 0) {
    process.stdout.write(emptyState(
      "No flip-flops detected.",
      [
        `Either the team is consistent — or commit messages are too thin to extract decisions.`,
        `Run \`mneme decisions --min-confidence 0.4\` first to see what the extractor found.`,
      ],
    ));
    return 0;
  }

  process.stdout.write(section("✦ Summary") + "\n\n");
  process.stdout.write(`    ${kleur.bold(String(flipFlops.length))} topic(s) flip-flopped over time\n\n`);

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• A")} ${kleur.bold("paradox")} ${kleur.gray("is a topic where the team adopted approach A, switched to B, and later flipped back to A (or any A→B→A→…  pattern).")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("reversals")} ${kleur.gray("= the number of direction changes in the chain. 1 = adopted then abandoned. 2+ = real flip-flop.")}\n`);
  process.stdout.write(`    ${kleur.gray("• The")} ${kleur.yellow("→ question")} ${kleur.gray("is a starter prompt for the retro: ask it to whoever was around for the chain.")}\n\n`);

  for (const f of flipFlops) {
    process.stdout.write(`  ${divider("topic: " + f.topic)}\n`);
    process.stdout.write(
      `    ${kleur.bold(String(f.flips))} reversal${f.flips === 1 ? "" : "s"}  ${kleur.gray(`over ${f.spanMonths} months · ${f.chain.length} decisions`)}\n\n`,
    );
    for (const d of f.chain) {
      process.stdout.write(
        `    ${kleur.gray("●")} ${kleur.bold(d.date)}  ${kleur.cyan(d.shortHash)}  ${d.summary}  ${kleur.gray(`(${d.author})`)}\n`,
      );
      if (d.filesAffected && d.filesAffected.length > 0) {
        process.stdout.write(`        ${kleur.gray("↳ files: " + d.filesAffected.join(", "))}\n`);
      }
    }
    if (f.hotFiles && f.hotFiles.length > 0) {
      process.stdout.write(`\n    ${kleur.cyan("hot files (where the flip-flop happened):")}\n`);
      for (const hf of f.hotFiles) {
        process.stdout.write(
          `        ${kleur.bold(String(hf.count).padStart(3))}× ${kleur.white(hf.path)}\n`,
        );
      }
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
  process.stdout.write(header("🪶", "Commit coach — pre-commit review",
    `${advice.diff.files.length} file(s) · +${advice.diff.added}/-${advice.diff.removed} · shape: ${advice.diff.shape}`,
    `Run before \`git commit\` — get a suggested message, reviewer suggestions, and warnings if these files have a regret history.`) + "\n\n");

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("shape")} ${kleur.gray("describes the diff geometry: ")}${kleur.cyan("focused")} ${kleur.gray("(few files, tight) ›")} ${kleur.cyan("scattered")} ${kleur.gray("(many modules at once — split it).")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("Reviewers")} ${kleur.gray("are sorted by ownership % — the people most likely to spot issues in the touched files.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("Past warnings")} ${kleur.gray("come from the regrets database — files in this diff that broke before.")}\n\n`);

  // Diff section
  process.stdout.write(section("✦ Diff") + "\n\n");
  process.stdout.write(
    `    ${kleur.bold(String(advice.diff.files.length))} file(s)  ·  ${kleur.green("+" + advice.diff.added)} ${kleur.red("-" + advice.diff.removed)}  ·  shape: ${kleur.cyan(advice.diff.shape)}\n`,
  );
  for (const m of advice.diff.modules.slice(0, 5)) process.stdout.write(`    ${kleur.gray("·")} ${m}\n`);
  process.stdout.write("\n");

  // Suggested message
  process.stdout.write(section("✦ Suggested commit message") + "\n\n");
  process.stdout.write(`    ${kleur.bold(advice.suggestedSubject)}\n\n`);

  // Reviewers
  if (advice.reviewers.length > 0) {
    process.stdout.write(section("◆ Reviewers", "(top experts on touched files — % = file-ownership share)") + "\n\n");
    for (const r of advice.reviewers) {
      const ownLabel = r.ownership >= 60 ? "primary owner" : r.ownership >= 30 ? "frequent contributor" : "occasional contributor";
      process.stdout.write(
        `    ${kleur.cyan("●")} ${kleur.bold(r.name)} ${kleur.gray(`<${r.email}>`)}  ${kleur.cyan(r.ownership + "%")} ${kleur.gray("(" + ownLabel + ")")}  ${kleur.gray(`— ${r.ownedFiles.length} owned files`)}\n`,
      );
      if (r.topFiles && r.topFiles.length > 0) {
        process.stdout.write(
          `        ${kleur.gray("territory: " + r.topFiles.map((tf) => tf.path).join(", "))}\n`,
        );
      }
    }
    process.stdout.write("\n");
  }

  // Scope
  process.stdout.write(section("◆ Scope") + "\n\n");
  process.stdout.write(`    ${advice.scopeOK ? kleur.green("✓") : kleur.yellow("⚠")} ${advice.scopeMessage}\n\n`);

  // Warnings
  if (advice.warnings.length > 0) {
    process.stdout.write(section("⚠ Past warnings", "(these files were involved in past regrets — read before merging)") + "\n\n");
    for (const w of advice.warnings) {
      process.stdout.write(`    ${kleur.yellow("⚠ ")}${kleur.yellow(w.pattern)}\n`);
      process.stdout.write(`        ${kleur.gray(`${w.pastDate} · ${w.pastCommitHash} · outcome: ${w.outcome}`)}\n\n`);
    }
  } else {
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.gray("No past-regret warnings for these files — they have a clean track record.")}\n\n`);
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
  process.stdout.write(header("🔮", "Crystal ball — CI / follow-up failure prediction",
    `compares your staged diff against ${p.similarN} similar past changes (window ${opts.windowDays ?? 14} days)`,
    `Run before pushing — get an outcome prediction based on what happened to similar diffs in the past.`) + "\n\n");

  // ─── How to read ─────────────────────────────────────────────────────
  if (p.similarN > 0) {
    process.stdout.write(section("📘 How to read this report") + "\n");
    process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("clean rate")} ${kleur.gray("= fraction of past, similar diffs that did NOT trigger a follow-up regret within ${" + (opts.windowDays ?? 14) + "} days.")}\n`);
    const reliability = p.similarN >= 20 ? "high — broad evidence base" : p.similarN >= 5 ? "medium — directional only" : "LOW — too few similar past changes, treat as a hint not a verdict";
    process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("reliability:")} ${kleur.gray(reliability + " (" + p.similarN + " neighbors)")}\n`);
    process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("verdicts:")} ${kleur.green("CLEAR")} ${kleur.gray("≥80% clean ›")} ${kleur.yellow("MODERATE")} ${kleur.gray("50–80% ›")} ${kleur.red("RISKY")} ${kleur.gray("<50%.")}\n\n`);
  }

  // Verdict
  const cleanPct = p.pClean * 100;
  process.stdout.write(section("✦ Verdict") + "\n\n");
  process.stdout.write(`    ${renderCrystalBallVerdict(p.verdict)}  ${kleur.cyan(cleanPct.toFixed(0) + "%")} clean rate  ${kleur.gray(`(${p.cleanN} of ${p.similarN} similar past changes shipped without follow-up)`)}\n\n`);

  // Fingerprint
  process.stdout.write(section("◆ Diff fingerprint", "(what your staged diff looks like to the matcher)") + "\n\n");
  process.stdout.write(`    modules:    ${p.fingerprint.modules.join(", ") || kleur.gray("(none)")}\n`);
  process.stdout.write(`    extensions: ${p.fingerprint.extensions.join(", ") || kleur.gray("(none)")}\n`);
  process.stdout.write(`    shape:      ${kleur.cyan(p.fingerprint.shape)} · ${p.fingerprint.size} · tests ${p.fingerprint.hasTests ? kleur.green("yes") : kleur.yellow("no")}\n\n`);

  // Most-similar
  if (p.mostSimilar) {
    const outcome = p.mostSimilar.outcome === "clean" ? kleur.green("clean (no follow-up needed)") : kleur.red("trouble (regret/hotfix followed)");
    process.stdout.write(section("◆ Most similar past change", "(your closest historical analogue)") + "\n\n");
    process.stdout.write(`    ${kleur.bold(p.mostSimilar.hash)}  ${kleur.gray(p.mostSimilar.date)}  ${p.mostSimilar.subject}\n`);
    process.stdout.write(`    outcome: ${outcome}\n\n`);
  }

  process.stdout.write(section("→ Recommendation") + "\n\n");
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

// ─── time-machine ───────────────────────────────────────────────────────

export interface TimeMachineOptions {
  cwd: string;
  filePath: string;
  plateauDays?: number;
  json?: boolean;
}

export async function timeMachineCommand(opts: TimeMachineOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    // Filter to commits that touched the target file
    const target = opts.filePath;
    const filtered = allCommits.filter((c) => c.files.includes(target));
    const fileChanges = util.loadFileChangesForPath(s, target);
    const changeMap = new Map<string, (typeof fileChanges)[number]>();
    for (const ch of fileChanges) changeMap.set(ch.commitHash, ch);
    return insights.buildTimeMachine(target, filtered, changeMap, {
      plateauDays: opts.plateauDays ?? 60,
    });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🕰", "Time Machine — life of a file",
    `${opts.filePath}`,
    `Walk through a file's history split into eras (birth, evolution, firefighting, polish, plateau, twilight). Useful before refactoring legacy code.`) + "\n\n");

  if (result.totalCommits === 0) {
    process.stdout.write(emptyState(
      "No commits found for this path.",
      [
        `Check the file exists in git history (was it renamed?).`,
        `Run \`mneme index\` if you've added recent commits.`,
        `Try a parent directory, or use \`mneme story\` for topic-based history.`,
      ],
    ));
    return 0;
  }
  process.stdout.write(
    `  ${kleur.gray(String(result.totalCommits) + " commits across " + result.totalSpanDays + " days")}\n\n`,
  );

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each")} ${kleur.bold("era")} ${kleur.gray("is a contiguous chapter of the file's life — labels: ")}${kleur.green("BIRTH")}${kleur.gray(", ")}${kleur.cyan("EVOLVE")}${kleur.gray(", ")}${kleur.magenta("REWRITE")}${kleur.gray(", ")}${kleur.red("FIREFIGHT")}${kleur.gray(", ")}${kleur.blue("POLISH")}${kleur.gray(", ")}${kleur.gray("PLATEAU/TWILIGHT")}${kleur.gray(".")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("rewrite %")} ${kleur.gray("high = unstable. ")}${kleur.bold("firefight %")} ${kleur.gray("high = bug-prone. ")}${kleur.bold("polish/plateau %")} ${kleur.gray("high = mature.")}\n`);
  process.stdout.write(`    ${kleur.gray("• A healthy mature file: low rewrite, low firefight, high polish/plateau. The opposite = candidate for rewrite.")}\n\n`);

  // Health line
  const h = result.health;
  const pct = (n: number) => Math.round(n * 100);
  const verdict = h.firefightRatio >= 0.3 ? kleur.red("bug-prone — consider a rewrite") : h.rewriteRatio >= 0.3 ? kleur.yellow("still in flux — design hasn't settled") : h.polishRatio >= 0.5 ? kleur.green("mature & stable") : kleur.cyan("active development");
  process.stdout.write(section("✦ Health") + "\n\n");
  process.stdout.write(
    `    rewrite ${kleur.bold(pct(h.rewriteRatio) + "%")}  ·  firefight ${kleur.bold(pct(h.firefightRatio) + "%")}  ·  polish/plateau ${kleur.bold(pct(h.polishRatio) + "%")}\n`,
  );
  process.stdout.write(`    ${kleur.gray("verdict:")} ${verdict}\n\n`);

  // Eras timeline
  process.stdout.write(section("◆ Eras", "(chronological — newest at the bottom)") + "\n\n");
  for (const e of result.epochs) {
    const badge = renderEpochKind(e.kind);
    const range = e.fromDate === e.toDate ? e.fromDate : `${e.fromDate} → ${e.toDate}`;
    process.stdout.write(`    ${badge}  ${kleur.gray(range)}  ${kleur.gray(`(${e.spanDays}d)`)}\n`);
    process.stdout.write(`        ${e.label}\n`);
    if (e.commits.length > 0) {
      const churn = e.insertions + e.deletions;
      process.stdout.write(
        `        ${kleur.gray(`${e.commits.length} commits · +${e.insertions}/-${e.deletions} (${churn} lines of churn)`)}\n`,
      );
    }
    process.stdout.write("\n");
  }
  return 0;
}

function renderEpochKind(kind: string): string {
  switch (kind) {
    case "birth":
      return kleur.green().bold("BIRTH    ");
    case "rewrite":
      return kleur.magenta().bold("REWRITE  ");
    case "evolution":
      return kleur.cyan().bold("EVOLVE   ");
    case "firefight":
      return kleur.red().bold("FIREFIGHT");
    case "polish":
      return kleur.blue().bold("POLISH   ");
    case "plateau":
      return kleur.gray().bold("PLATEAU  ");
    case "twilight":
      return kleur.gray().bold("TWILIGHT ");
    default:
      return kleur.gray().bold(kind.padEnd(9));
  }
}

// ─── premortem ──────────────────────────────────────────────────────────

export interface PremortemOptions {
  cwd: string;
  intent: string;
  similarityFloor?: number;
  windowDays?: number;
  json?: boolean;
}

export async function premortemCommand(opts: PremortemOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildPremortem(opts.intent, commits, {
      similarityFloor: opts.similarityFloor ?? 0.25,
      windowDays: opts.windowDays ?? 14,
    });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🔮", "Pre-mortem — what your repo's history says about this",
    `intent: ${opts.intent}`,
    `Before you start: surface past attempts at similar work, what went wrong, and the historical regret rate.`) + "\n\n");

  const verdictColor = (() => {
    switch (result.verdict) {
      case "very_high": return kleur.red().bold;
      case "high": return kleur.yellow().bold;
      case "medium": return kleur.cyan().bold;
      case "low": return kleur.green().bold;
    }
  })();

  // ─── How to read ─────────────────────────────────────────────────────
  const sampleN = result.pastAttempts.length;
  const reliability = sampleN >= 10 ? "strong evidence" : sampleN >= 3 ? "directional only" : "very weak — consider this a hint, not a verdict";
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("P(regret)")} ${kleur.gray("= the historical fraction of similar past attempts that led to a regret/hotfix/revert within ${" + (opts.windowDays ?? 14) + "} days.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("evidence base:")} ${kleur.gray(sampleN + " similar past attempts (" + reliability + ").")}\n`);
  process.stdout.write(`    ${kleur.gray("• Top risks come from past failures matching this intent — read the cited commits before deciding.")}\n\n`);

  process.stdout.write(section("✦ Verdict") + "\n\n");
  const pct = (result.regretProbability * 100).toFixed(0);
  process.stdout.write(`    risk: ${verdictColor(result.verdict.toUpperCase().replace("_", " "))}  ${kleur.gray(`(${pct}% of similar past attempts led to a regret)`)}\n\n`);
  for (const line of wrap(result.summary, 76, "    ")) {
    process.stdout.write(line + "\n");
  }

  if (result.topRisks.length > 0) {
    process.stdout.write("\n" + section("◆ Top risks", "(patterns from past failures — click through to the cited commits)") + "\n\n");
    for (const r of result.topRisks) {
      process.stdout.write(`    ${kleur.bold("•")} ${r.label}\n`);
      for (const ev of r.evidence.slice(0, 3)) {
        const hash = ev.shortHash || ev.hash.slice(0, 7);
        process.stdout.write(`      ${kleur.gray(hash + "  " + ev.subject)}\n`);
      }
    }
  }

  if (result.pastAttempts.length > 0) {
    const sample = result.pastAttempts.slice(0, 5);
    process.stdout.write("\n" + section("◇ Similar past attempts", `(${result.pastAttempts.length} found · status = what happened within ${opts.windowDays ?? 14} days)`) + "\n\n");
    for (const a of sample) {
      const hash = a.attempt.shortHash || a.attempt.hash.slice(0, 7);
      const status =
        a.riskKind === "none"
          ? kleur.green("ok — no follow-up")
          : kleur.red(a.riskKind + " followed");
      process.stdout.write(`    ${kleur.gray(a.attempt.authorDate.slice(0, 10))}  ${kleur.cyan(hash)}  [${status}]  ${a.attempt.subject}\n`);
    }
  } else {
    process.stdout.write("\n" + emptyState(
      "No similar past attempts in the index.",
      [
        `Lower the matching bar: --similarity-floor 0.15`,
        `Verdict above is heuristic-only — treat as low confidence.`,
      ],
    ));
  }
  process.stdout.write("\n");
  return 0;
}

// ─── ghost ──────────────────────────────────────────────────────────────

export interface GhostOptions {
  cwd: string;
  topN?: number;
  staleDays?: number;
  json?: boolean;
}

export async function ghostCommand(opts: GhostOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const changes = util.loadAllFileChanges(s);
    return insights.buildGhostReport(commits, changes, {
      staleDays: opts.staleDays ?? 180,
      minGhostliness: 0.4,
    });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("👻", "Files that changed silently (no commit explanation)",
    `${result.totalFiles} files analyzed · ${result.ghostFiles.length} ghosts · avg ghostliness ${(result.averageGhostliness * 100).toFixed(0)}%`,
    `Spot files that changed without leaving a trace — terse commit messages, ignored TODOs, mystery edits. Useful before audits or onboarding.`) + "\n\n");

  if (result.ghostFiles.length === 0) {
    process.stdout.write(emptyState(
      "Repo looks active and well-documented — no ghost code detected.",
      [
        `Loosen the threshold to surface borderline files.`,
        `Re-run after the next sprint to catch slow-decaying areas early.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("ghostliness %")} ${kleur.gray("= how poorly explained recent changes are. 70%+ is silent; 40–70% is borderline.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("days quiet")} ${kleur.gray("= time since the last commit touched this file. Ghosts often show 180+ days.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("Stale TODOs")} ${kleur.gray("= comment markers that have been ignored across N subsequent edits.")}\n\n`);

  process.stdout.write(section("◆ Ghost files", `(top ${Math.min(opts.topN ?? 10, result.ghostFiles.length)} — most haunted first)`) + "\n\n");
  for (const g of result.ghostFiles.slice(0, opts.topN ?? 10)) {
    const score = (g.ghostliness * 100).toFixed(0) + "%";
    const meter = renderMeter(g.ghostliness);
    const ghostLabel = g.ghostliness >= 0.7 ? "silent" : g.ghostliness >= 0.4 ? "thinly explained" : "lightly opaque";
    process.stdout.write(`    ${kleur.bold(g.path)}\n`);
    process.stdout.write(`      ${meter}  ${kleur.bold(score)} ${kleur.gray("(" + ghostLabel + ")")}  ${kleur.gray(g.reason)}\n`);
    process.stdout.write(`      ${kleur.gray(`${g.totalCommits} commits · ${g.daysSinceLastTouch}d quiet · last: "${truncateOneLine(g.lastCommitSubject, 60)}"`)}\n\n`);
  }

  if (result.staleTodos.length > 0) {
    process.stdout.write(section("◇ Stale TODOs", `(${result.staleTodos.length} markers ignored across subsequent edits)`) + "\n\n");
    for (const t of result.staleTodos.slice(0, 5)) {
      process.stdout.write(`    ${kleur.bold(t.filePath)}\n`);
      process.stdout.write(`      ${kleur.gray(`${t.ageDays}d old · ignored ${t.ignoredCount}× since (${t.ignoredCount === 1 ? "once" : "repeatedly"} edited around without addressing)`)}\n`);
      process.stdout.write(`      ${kleur.gray("↳ " + truncateOneLine(t.hint, 70))}\n\n`);
    }
  }
  return 0;
}

function renderMeter(value: number): string {
  const blocks = Math.round(value * 10);
  const filled = "█".repeat(blocks);
  const empty = "░".repeat(10 - blocks);
  if (value >= 0.7) return kleur.red(filled) + kleur.gray(empty);
  if (value >= 0.4) return kleur.yellow(filled) + kleur.gray(empty);
  return kleur.green(filled) + kleur.gray(empty);
}

function truncateOneLine(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1).trimEnd() + "…";
}

// ─── v0.12 KING OF GIT — DNA / Drift / Chronicle / Oracle / Constellation ─

function pctV12(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function topAuthorOf(commits: Commit[]): string | null {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const k = c.authorEmail || c.authorName;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

// dna ────────────────────────────────────────────────────────────────────
export interface DnaOptions {
  cwd: string;
  author?: string;
  compare?: string;
  output?: string;
  json?: boolean;
}

export async function dnaCommand(opts: DnaOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const author = opts.author ?? topAuthorOf(commits);
    if (!author) return null;
    const dna = insights.extractDna(commits, author);
    let comparison: ReturnType<typeof insights.compareDna> | null = null;
    if (opts.compare) {
      const other = insights.extractDna(commits, opts.compare);
      comparison = insights.compareDna(dna, other);
    }
    return { author, dna, comparison };
  });
  if (typeof result === "number") return result;
  if (!result) {
    ui.error("No commits found in this repo. Run `mneme index` first.");
    return 1;
  }
  const { author, dna, comparison } = result;

  if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(dna, null, 2));
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ dna, comparison }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🧬", "Codebase DNA — " + author,
    `${dna.commitCount} commits · ${dna.fromDate} → ${dna.toDate} · fingerprint ${dna.hash}`,
    `Extract this author's coding fingerprint — message style, working hours, file affinity. Useful for onboarding, succession planning, or comparing two engineers.`) + "\n\n");

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each percentage is")} ${kleur.bold("this author's behaviour")}${kleur.gray(" — not a benchmark. Compare across people with --compare to find compatibility.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("conventional commits %")} ${kleur.gray("near 100 = strict feat:/fix: prefixes; near 0 = freeform.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("imperative ratio")} ${kleur.gray("near 100 = \"add\", \"fix\", \"refactor\"; low = past-tense or noun-style messages.")}\n\n`);

  process.stdout.write(section("✦ Style genome", "(how this author shapes commits)") + "\n");
  process.stdout.write(`    files/commit ........ ${kleur.bold(String(dna.style.filesPerCommit))} ${kleur.gray("(lower = more focused diffs)")}\n`);
  process.stdout.write(`    test ratio .......... ${kleur.bold(pctV12(dna.style.testRatio))} ${kleur.gray("(commits that touch test files)")}\n`);
  process.stdout.write(`    issue refs .......... ${kleur.bold(pctV12(dna.style.issueRefRatio))} ${kleur.gray("(commits citing #123 / JIRA-456)")}\n`);
  process.stdout.write(`    conventional commits  ${kleur.bold(pctV12(dna.style.conventionalRatio))} ${kleur.gray("(feat:/fix:/chore: prefix usage)")}\n\n`);

  process.stdout.write(section("✦ Message DNA", "(how this author writes commits)") + "\n");
  process.stdout.write(`    avg subject length .. ${kleur.bold(String(dna.message.avgSubjectLength))} chars ${kleur.gray("(target ≤ 72 — terse is good)")}\n`);
  process.stdout.write(`    imperative ratio .... ${kleur.bold(pctV12(dna.message.imperativeRatio))} ${kleur.gray("(\"add X\" vs \"added X\")")}\n`);
  process.stdout.write(`    body provided ....... ${kleur.bold(pctV12(dna.message.bodyRatio))} ${kleur.gray("(% of commits with explanatory body, not just subject)")}\n`);
  if (dna.message.topVerbs.length > 0) {
    process.stdout.write(`    top verbs ........... ${dna.message.topVerbs.map((v) => kleur.cyan(v.verb) + kleur.gray("×" + v.count)).join("  ")}\n`);
  }
  process.stdout.write("\n");

  // Decode the peakWindow ("HH:00–HH:00") into a friendly label
  const wkPct = Math.round(dna.hours.weekendRatio * 100);
  const weekendLabel = wkPct === 0 ? "weekdays only" : wkPct >= 30 ? "frequent weekend work" : wkPct >= 15 ? "some weekend work" : "occasional weekend work";
  process.stdout.write(section("✦ Working hours", "(when this author commits — all times UTC)") + "\n");
  process.stdout.write(`    most active ......... ${kleur.bold(dna.hours.peakWindow)} UTC ${kleur.gray("(4-hour band — convert to local time for context)")}\n`);
  process.stdout.write(`    weekend ratio ....... ${kleur.bold(pctV12(dna.hours.weekendRatio))} ${kleur.gray("(" + wkPct + "% of commits land Sat/Sun — " + weekendLabel + ")")}\n\n`);

  process.stdout.write(section("✦ File affinity", "(top directories by commit share)") + "\n");
  for (const d of dna.files.topDirs.slice(0, 3)) {
    process.stdout.write(`    ${kleur.gray(pctV12(d.share).padStart(5))}  ${d.dir}\n`);
  }
  process.stdout.write("\n");

  if (comparison) {
    const overallPct = Math.round(comparison.similarity * 100);
    const compatLabel = overallPct >= 80 ? "very similar styles" : overallPct >= 60 ? "broadly compatible" : overallPct >= 40 ? "partial overlap" : "very different styles";
    process.stdout.write(section("✦ Compatibility vs " + (opts.compare || "?"), "(higher = more similar coding personalities)") + "\n");
    process.stdout.write(`    overall ............. ${kleur.bold(pctV12(comparison.similarity))} ${kleur.gray("(" + compatLabel + ")")}\n`);
    for (const a of comparison.axes) {
      process.stdout.write(`    ${a.axis.padEnd(18, ".")} ${kleur.gray(pctV12(a.similarity))}\n`);
    }
    process.stdout.write("\n");
  }
  if (opts.output) {
    process.stdout.write(`  ${kleur.green("✓")} DNA strand written to ${kleur.cyan(opts.output)}\n\n`);
  }
  return 0;
}

// drift ──────────────────────────────────────────────────────────────────
export interface DriftOptions {
  cwd: string;
  granularity?: "quarter" | "month";
  json?: boolean;
}

export async function driftCommand(opts: DriftOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildDrift(commits, { granularity: opts.granularity ?? "quarter" });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("📈", "Commit Drift — topical evolution",
    `bucketed by ${result.granularity} · ${result.buckets.length} bucket(s)`,
    `See how the dominant kind of work shifted over time — feature-heavy quarters vs. firefight quarters vs. polish phases.`) + "\n\n");

  if (result.buckets.length === 0) {
    process.stdout.write(emptyState(
      "No commits to analyze.",
      [
        `Run \`mneme index\` first.`,
        `If small repo, try --granularity month for finer buckets.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each row is a")} ${kleur.bold(result.granularity)}${kleur.gray(". The colored bar shows the mix of work types in that period.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.green("FEATURE")} ${kleur.gray("= adds ›")} ${kleur.magenta("REFACTOR")} ${kleur.gray("= rework ›")} ${kleur.red("FIREFIGHT")} ${kleur.gray("= bugs/hotfixes ›")} ${kleur.blue("POLISH")} ${kleur.gray("= cleanup ›")} ${kleur.cyan("DOCS")} ${kleur.gray(".")}\n`);
  process.stdout.write(`    ${kleur.gray("• A healthy repo cycles through phases. All-firefight or all-refactor for many buckets in a row is a smell.")}\n\n`);

  process.stdout.write(section("◆ Trajectory", `(per ${result.granularity})`) + "\n\n");
  for (const b of result.buckets) {
    const dom = renderDriftKind(b.dominant);
    const meter = renderDriftMeter(b);
    process.stdout.write(`    ${kleur.gray(b.label.padEnd(8))}  ${meter}  ${kleur.bold(String(b.total).padStart(3))} commits  ${dom}\n`);
  }
  process.stdout.write("\n");

  if (result.insights.length > 0) {
    process.stdout.write(section("✦ Notable shifts", "(transitions worth talking about)") + "\n");
    for (const ins of result.insights) {
      process.stdout.write(`    ${kleur.bold("•")} ${kleur.gray(ins.fromBucket + " → " + ins.toBucket)}  ${ins.description}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

function renderDriftKind(kind: string): string {
  switch (kind) {
    case "feature": return kleur.green("FEATURE  ");
    case "refactor": return kleur.magenta("REFACTOR ");
    case "firefight": return kleur.red("FIREFIGHT");
    case "polish": return kleur.blue("POLISH   ");
    case "docs": return kleur.cyan("DOCS     ");
    default: return kleur.gray("OTHER    ");
  }
}

function renderDriftMeter(b: { byKind: Record<string, number>; total: number }): string {
  const w = 10;
  const order = ["feature", "refactor", "firefight", "polish", "docs", "other"];
  const colors: Record<string, (s: string) => string> = {
    feature: kleur.green,
    refactor: kleur.magenta,
    firefight: kleur.red,
    polish: kleur.blue,
    docs: kleur.cyan,
    other: kleur.gray,
  };
  let out = "";
  let visible = 0;
  for (const k of order) {
    const n = b.byKind[k] ?? 0;
    const blocks = Math.round((n / Math.max(1, b.total)) * w);
    if (blocks > 0) {
      out += colors[k]!("█".repeat(blocks));
      visible += blocks;
    }
  }
  out += "░".repeat(Math.max(0, w - visible));
  return out;
}

// chronicle ──────────────────────────────────────────────────────────────
export interface ChronicleOptions {
  cwd: string;
  output?: string;
  gapDays?: number;
  json?: boolean;
}

export async function chronicleCommand(opts: ChronicleOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildChronicle(commits, { gapDays: opts.gapDays ?? 30 });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  if (opts.output) {
    const md = insights.renderChronicle(result);
    writeFileSync(opts.output, md);
  }

  ui.banner();
  process.stdout.write(header("📖", "Chronicles of Your Codebase",
    `${result.totalCommits} commits · ${result.totalDays} days · ${result.chapters.length} chapters`,
    `Tell the story of your repo as a book — chapters split where work paused for ${opts.gapDays ?? 30}+ days. Great for retros, all-hands, or release notes.`) + "\n\n");

  if (result.chapters.length === 0) {
    process.stdout.write(emptyState(
      "No chapters could be formed.",
      [
        `Try a smaller --gap-days (e.g. 14) on short-lived repos.`,
        `Run \`mneme index\` if you've added recent commits.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each")} ${kleur.bold("chapter")} ${kleur.gray("is a contiguous era — gaps of ${" + (opts.gapDays ?? 30) + "} days or more start a new chapter.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("protagonist")} ${kleur.gray("= the author with the most commits in that chapter.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Use --output chronicle.md to export as Markdown for sharing.")}\n\n`);

  for (const ch of result.chapters) {
    process.stdout.write(`  ${kleur.bold().magenta("Chapter " + ch.number + " · " + ch.title)}\n`);
    process.stdout.write(`    ${kleur.gray(ch.fromDate + " → " + ch.toDate)}  ${kleur.gray("(" + ch.spanDays + "d, " + ch.commits.length + " commits)")}  protagonist: ${kleur.cyan("@" + ch.protagonist)}\n`);
    process.stdout.write(`    ${kleur.gray("subtitle:")} ${ch.subtitle}\n\n`);
  }
  if (opts.output) {
    process.stdout.write(`  ${kleur.green("✓")} Markdown chronicle written to ${kleur.cyan(opts.output)}\n\n`);
  }
  return 0;
}

// oracle ─────────────────────────────────────────────────────────────────
export interface OracleOptions {
  cwd: string;
  windowDays?: number;
  topN?: number;
  json?: boolean;
}

export async function oracleCommand(opts: OracleOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildOracle(commits, { windowDays: opts.windowDays ?? 90 });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🔮", "Oracle — predicted next-window co-edits",
    `${result.windowCommits} commits analyzed (last ${opts.windowDays ?? 90}d) · projects who's likely to touch what next`,
    `Predict near-term collisions before they happen. Use to plan code-freeze coordination, branch ownership, or pairing assignments.`) + "\n\n");

  if (result.windowCommits === 0) {
    process.stdout.write(emptyState(
      "No commits in the analysis window.",
      [
        `Widen the window: --window-days 180.`,
        `Run \`mneme index\` if you've added recent commits.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  const reliability = result.windowCommits >= 100 ? "strong evidence base" : result.windowCommits >= 30 ? "directional only — small sample" : "low confidence — too few commits in window";
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("joint P")} ${kleur.gray("= probability that BOTH authors touch the file in the next window. 60%+ likely · 30–60% possible · <30% noisy.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("per-author %")} ${kleur.gray("= relative likelihood each candidate is the next to edit that file.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("evidence:")} ${kleur.gray(result.windowCommits + " commits in window — " + reliability + ".")}\n\n`);

  if (result.collisions.length > 0) {
    process.stdout.write(section("⚠ Predicted collisions", "(two authors likely to edit the same file simultaneously)") + "\n\n");
    for (const c of result.collisions.slice(0, opts.topN ?? 5)) {
      const jointPct = Math.round(c.jointProbability * 100);
      const jointLabel = jointPct >= 60 ? "likely conflict" : jointPct >= 30 ? "possible conflict" : "low chance";
      process.stdout.write(`    ${kleur.bold(c.filePath)}\n`);
      process.stdout.write(`      ${kleur.cyan(c.authorA)} ⨯ ${kleur.cyan(c.authorB)}  joint P = ${kleur.bold(pctV12(c.jointProbability))} ${kleur.gray("(" + jointLabel + ")")}\n`);
      if (c.daysSinceLastJointTouch >= 0) {
        process.stdout.write(`      ${kleur.gray("last joint touch: " + c.daysSinceLastJointTouch + "d ago")}\n`);
      }
      process.stdout.write("\n");
    }
  } else {
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.gray("No high-probability author collisions detected in the window.")}\n\n`);
  }

  process.stdout.write(section("◆ Top file predictions", "(who's most likely to touch each file next)") + "\n\n");
  for (const p of result.predictions.slice(0, opts.topN ?? 8)) {
    process.stdout.write(`    ${kleur.bold(p.filePath)}\n`);
    for (const cand of p.candidates) {
      const pct = Math.round(cand.probability * 100);
      const tag = pct >= 50 ? kleur.green("likely") : pct >= 25 ? kleur.cyan("possible") : kleur.gray("long-shot");
      process.stdout.write(`      ${kleur.cyan(cand.author.padEnd(20))}  ${pctV12(cand.probability)}  ${tag}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

// constellation ──────────────────────────────────────────────────────────
export interface ConstellationOptions {
  cwd: string;
  output?: string;
  json?: boolean;
}

export async function constellationCommand(opts: ConstellationOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildConstellation(commits);
  });
  if (typeof result === "number") return result;

  if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(result, null, 2));
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🌌", "Codebase Constellation — graph view of your repo",
    `file-stars sized by activity · edges = files commonly edited together`,
    `Visualize your repo as a star map — large stars are heavily-edited files, edges show coupling. Useful for architecture reviews.`) + "\n\n");

  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("star size")} ${kleur.gray("= commit volume on that file. Bigger = more active.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("edges")} ${kleur.gray("connect files that get edited together — strong edges = tight coupling.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Use --output graph.json to feed the data into a graph visualizer (D3, Gephi, Cytoscape).")}\n\n`);

  process.stdout.write(insights.renderConstellationAscii(result) + "\n");
  if (opts.output) {
    process.stdout.write(`\n  ${kleur.green("✓")} Graph JSON written to ${kleur.cyan(opts.output)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

// ─── v0.13 BLACK SHEEP — cluster / network / manage / export ─────────────

// cluster ────────────────────────────────────────────────────────────────
export interface ClusterOptions {
  cwd: string;
  similarity?: number;
  minSize?: number;
  json?: boolean;
}

export async function clusterCommand(opts: ClusterOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildClusters(commits, {
      similarityFloor: opts.similarity ?? 0.15,
      minClusterSize: opts.minSize ?? 3,
    });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🧠", "Semantic Commit Clusters",
    `${result.totalCommits} commits · ${result.clusters.length} clusters · ${result.outliers.length} outliers`,
    `Group commits by shared vocabulary — surface the recurring themes in your codebase. Useful for retrospectives and roadmap reviews.`) + "\n\n");

  if (result.clusters.length === 0) {
    if (result.totalCommits < 30) {
      process.stdout.write(emptyState(
        `Too few commits (${result.totalCommits}) to form meaningful clusters.`,
        [
          `Clusters emerge once a repo has ~30+ commits with shared vocabulary.`,
          `Surface tight pairs anyway: --similarity 0.05 --min-size 2`,
        ],
      ));
    } else {
      process.stdout.write(emptyState(
        "No clusters above the similarity floor.",
        [
          `Lower the threshold: --similarity 0.10 --min-size 2`,
          `If commit messages are short/generic, the matcher has little to grip — encourage richer subjects.`,
        ],
      ));
    }
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("cohesion %")} ${kleur.gray("= how tightly the commits in a cluster share vocabulary. 80%+ very tight · 50–80% loose theme · <50% noisy.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("terms")} ${kleur.gray("are the top distinguishing words for the cluster — gives the theme away.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("outliers")} ${kleur.gray("(${" + result.outliers.length + "}) are commits that didn't fit any cluster — often unique or generic messages.")}\n\n`);

  for (const c of result.clusters.slice(0, 10)) {
    const cohPct = Math.round(c.cohesion * 100);
    const cohLabel = cohPct >= 80 ? "very tight" : cohPct >= 50 ? "loose theme" : "noisy";
    process.stdout.write(`  ${kleur.bold().magenta("◆ Cluster " + c.id)}  ${kleur.gray(c.size + " commits · cohesion " + pctV12(c.cohesion) + " (" + cohLabel + ")")}\n`);
    process.stdout.write(`    ${kleur.gray("terms:")} ${c.topTerms.map((t) => kleur.cyan(t)).join("  ")}\n`);
    process.stdout.write(`    ${kleur.gray("range:")} ${c.fromDate} → ${c.toDate}\n`);
    for (const sample of c.samples.slice(0, 2)) {
      const hash = sample.shortHash || sample.hash.slice(0, 7);
      process.stdout.write(`    ${kleur.gray("↳ " + hash + "  " + sample.subject)}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

// network ────────────────────────────────────────────────────────────────
export interface NetworkOptions {
  cwd: string;
  windowDays?: number;
  json?: boolean;
}

export async function networkCommand(opts: NetworkOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildNetwork(commits, {
      coTimeWindowDays: opts.windowDays ?? 7,
    });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("🕸", "Author Network — collaboration graph",
    `${result.windowCommits} commits · ${result.nodes.length} authors · ${result.edges.length} edges · ${result.silos.length} silos · ${result.bridges.length} bridges`,
    `Map who collaborates with whom on what — surfaces silos (groups that don't share work) and bridges (people who connect them).`) + "\n\n");

  if (result.nodes.length <= 1) {
    process.stdout.write(emptyState(
      "Solo-author repository — no collaboration network to map.",
      [
        `This command shines on team repos with 2+ active contributors.`,
        `Try \`mneme dna\` to extract this author's coding fingerprint instead.`,
      ],
    ));
    return 0;
  }

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("centrality")} ${kleur.gray("= how connected an author is. High = touches many areas with many people. Low = focused on one corner.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("edge weight %")} ${kleur.gray("= overall collaboration strength, blending three axes: co-edit (same files), co-time (same week), co-topic (same vocabulary).")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("silos")} ${kleur.gray("are author groups with no cross-edges. ")}${kleur.bold("bridges")} ${kleur.gray("are individuals connecting them — losing a bridge fragments the team.")}\n\n`);

  process.stdout.write(section("◆ Top collaborators", "(ranked by centrality — most connected first)") + "\n\n");
  for (const n of result.nodes.slice(0, 8)) {
    const meter = "█".repeat(Math.round(n.centrality * 8)) + "░".repeat(8 - Math.round(n.centrality * 8));
    const centPct = Math.round(n.centrality * 100);
    const centLabel = centPct >= 70 ? "hub" : centPct >= 40 ? "well-connected" : centPct >= 15 ? "peripheral" : "isolated";
    process.stdout.write(`    ${kleur.cyan(meter)}  ${kleur.bold(n.author.padEnd(28))}  ${kleur.gray(n.commits + " commits · " + n.collaborators + " edges (" + centLabel + ")")}\n`);
  }

  if (result.edges.length > 0) {
    process.stdout.write("\n" + section("◇ Strongest collaboration edges", "(weight % blends co-edit + co-time + co-topic)") + "\n\n");
    for (const e of result.edges.slice(0, 6)) {
      const terms = e.sharedTerms.slice(0, 3).map((t) => kleur.cyan(t)).join(", ");
      const wPct = Math.round(e.weight * 100);
      const wLabel = wPct >= 60 ? "tight pair" : wPct >= 30 ? "regular collaborators" : "occasional overlap";
      process.stdout.write(`    ${kleur.bold(pctV12(e.weight))} ${kleur.gray("(" + wLabel + ")")}  ${e.authorA} ⟷ ${e.authorB}\n`);
      process.stdout.write(`         ${kleur.gray("co-edit " + pctV12(e.axes.coEdit) + " (same files) · co-time " + pctV12(e.axes.coTime) + " (same week) · co-topic " + pctV12(e.axes.coTopic) + " (same vocabulary)")}\n`);
      if (terms) process.stdout.write(`         ${kleur.gray("shared topics: ")}${terms}\n`);
      process.stdout.write("\n");
    }
  }

  if (result.bridges.length > 0) {
    process.stdout.write(section("⚡ Bridges", "(authors connecting otherwise-disjoint silos — high bus-factor cost if they leave)") + "\n");
    for (const b of result.bridges) {
      process.stdout.write(`    ${kleur.cyan(b)}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

// manage ─────────────────────────────────────────────────────────────────
export interface ManageOptions {
  cwd: string;
  windowDays?: number;
  json?: boolean;
}

export async function manageCommand(opts: ManageOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    return insights.buildManage(commits, { windowDays: opts.windowDays ?? 90 });
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(header("👑", "Manage — engineering management dashboard",
    `${result.health.windowCommits} commits in last ${opts.windowDays ?? 90}d · team health, succession plan, predicted collisions`,
    `One-shot manager view: how is the team doing, who's at risk of being a single point of failure, and what's coming next.`) + "\n\n");

  if (result.health.windowCommits === 0) {
    process.stdout.write(emptyState(
      "No commits in the analysis window.",
      [
        `Widen the window: --window-days 180.`,
        `Run \`mneme index\` if you've added recent commits.`,
      ],
    ));
    return 0;
  }

  const overall = result.health.overall;
  const overallColor = overall > 0.6 ? kleur.green : overall > 0.4 ? kleur.yellow : kleur.red;
  const overallLabel = overall > 0.6 ? "healthy" : overall > 0.4 ? "watch" : "concerning";

  // ─── How to read ─────────────────────────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("overall health %")} ${kleur.gray("blends trajectory, succession risk, and collision pressure. >60% healthy · 40–60% watch · <40% concerning.")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("succession risk %")} ${kleur.gray("per area = how exposed the team is if the primary owner leaves. >60% = critical (no real backup).")}\n`);
  process.stdout.write(`    ${kleur.gray("•")} ${kleur.bold("understudy confidence %")} ${kleur.gray("= how good a fit the second-place contributor is. <50% means they need ramp-up time.")}\n\n`);

  process.stdout.write(section("✦ Team Health") + "\n");
  process.stdout.write(`    overall ............. ${overallColor().bold(pctV12(overall))} ${kleur.gray("(" + overallLabel + ")")}\n`);
  process.stdout.write(`    trajectory .......... ${kleur.bold(result.health.trajectory.dominant)} ${kleur.gray("(" + result.health.trajectory.label + ")")}\n`);
  process.stdout.write(`    predicted collisions  ${kleur.bold(String(result.health.predictedCollisions))} ${kleur.gray("(author×file pairs likely to clash next window)")}\n`);
  process.stdout.write(`    max succession risk . ${kleur.bold(pctV12(result.health.maxSuccessionRisk))} ${kleur.gray("(worst-case area — see plan below)")}\n`);
  process.stdout.write(`    window commits ...... ${kleur.bold(String(result.health.windowCommits))}\n\n`);

  if (result.health.notes.length > 0) {
    process.stdout.write(section("✦ Notes") + "\n");
    for (const note of result.health.notes) {
      process.stdout.write(`    ${kleur.gray("•")} ${note}\n`);
    }
    process.stdout.write("\n");
  }

  if (result.succession.length > 0) {
    process.stdout.write(section("◆ Succession plan", "(highest risk first — pair-program these areas before vacations)") + "\n\n");
    for (const sp of result.succession.slice(0, 8)) {
      const riskColor = sp.risk > 0.6 ? kleur.red : sp.risk > 0.3 ? kleur.yellow : kleur.green;
      const riskLabel = sp.risk > 0.6 ? "critical" : sp.risk > 0.3 ? "watch" : "ok";
      process.stdout.write(`    ${riskColor().bold(pctV12(sp.risk).padStart(4))} ${kleur.gray("(" + riskLabel + ")")}  ${kleur.bold(sp.area.padEnd(30))}  primary: ${kleur.cyan("@" + sp.primary)}\n`);
      if (sp.understudy) {
        const confPct = Math.round(sp.confidence * 100);
        const confLabel = confPct >= 70 ? "strong fit" : confPct >= 50 ? "viable" : "needs ramp-up";
        process.stdout.write(`              ${kleur.gray("understudy: @" + sp.understudy + " — confidence " + pctV12(sp.confidence) + " (" + confLabel + ")")}\n`);
      } else {
        process.stdout.write(`              ${kleur.red("⚠ no understudy detected — single point of failure")}\n`);
      }
      process.stdout.write("\n");
    }
  }
  return 0;
}

// export ─────────────────────────────────────────────────────────────────
export interface ExportBundleOptions {
  cwd: string;
  output?: string;
  format?: "json" | "markdown" | "both";
  topAuthors?: number;
}

export async function exportBundleCommand(opts: ExportBundleOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const commits = util.loadAllCommits(s);
    const fileChanges = util.loadAllFileChanges(s);
    return insights.buildExportBundle(commits, {
      version: getVersion(),
      topAuthors: opts.topAuthors ?? 5,
      fileChanges,
    });
  });
  if (typeof result === "number") return result;

  const format = opts.format ?? "both";
  const outputBase = opts.output ?? "mneme-bundle";

  if (format === "json" || format === "both") {
    writeFileSync(outputBase + ".json", JSON.stringify(result, null, 2));
  }
  if (format === "markdown" || format === "both") {
    const md = insights.renderExportMarkdown(result);
    writeFileSync(outputBase + ".md", md);
  }

  ui.banner();
  process.stdout.write(header("📦", "Export Bundle — universal codebase artifact",
    `Mneme ${result.version} · ${result.repo.totalCommits} commits · ${result.repo.totalAuthors} authors · ${result.repo.fromDate} → ${result.repo.toDate}`,
    `One file containing every insight (DNA, drift, chronicle, oracle, constellation, clusters, network, team health, ghosts). Hand to LLMs, share with new hires, or archive.`) + "\n\n");

  process.stdout.write(kv("Generated", kleur.gray(result.generatedAt)) + "\n");
  process.stdout.write(kv("Range", kleur.gray(result.repo.fromDate + " → " + result.repo.toDate)) + "\n\n");

  process.stdout.write(section("✦ Sections included") + "\n");
  process.stdout.write(`    🧬  ${kleur.bold(String(result.topAuthorsDna.length))} top-author DNA strands ${kleur.gray("(coding fingerprints)")}\n`);
  process.stdout.write(`    📈  drift trajectory across ${kleur.bold(String(result.drift.buckets.length))} buckets ${kleur.gray("(work-type evolution)")}\n`);
  process.stdout.write(`    📖  chronicle with ${kleur.bold(String(result.chronicle.chapters.length))} chapters ${kleur.gray("(history as a book)")}\n`);
  process.stdout.write(`    🔮  oracle: ${kleur.bold(String(result.oracle.collisions.length))} predicted collisions, ${kleur.bold(String(result.oracle.predictions.length))} file predictions\n`);
  process.stdout.write(`    🌌  constellation: ${kleur.bold(String(result.constellation.fileStars.length))} file-stars, ${kleur.bold(String(result.constellation.fileEdges.length))} co-edit edges\n`);
  process.stdout.write(`    🧠  ${kleur.bold(String(result.clusters.clusters.length))} semantic clusters ${kleur.gray("(recurring themes)")}\n`);
  process.stdout.write(`    🕸  network: ${kleur.bold(String(result.network.nodes.length))} authors, ${kleur.bold(String(result.network.edges.length))} collaboration edges\n`);
  process.stdout.write(`    👑  team health: ${kleur.bold(pctV12(result.manage.health.overall))} ${kleur.gray("(>60% healthy · 40-60% watch · <40% concerning)")}\n`);
  process.stdout.write(`    👻  ${kleur.bold(String(result.ghost.ghostFiles.length))} ghost files ${kleur.gray("(silently changed)")}\n\n`);

  if (format === "json" || format === "both") {
    process.stdout.write(`  ${kleur.green("✓")} JSON written to ${kleur.cyan(outputBase + ".json")}\n`);
  }
  if (format === "markdown" || format === "both") {
    process.stdout.write(`  ${kleur.green("✓")} Markdown written to ${kleur.cyan(outputBase + ".md")}\n`);
  }
  process.stdout.write("\n");
  return 0;
}
