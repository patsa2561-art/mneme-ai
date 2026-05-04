import kleur from "kleur";
import { git, store, enrich, type Commit } from "@mneme-ai/core";
import { resolveEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui, formatProgress } from "../ui.js";
import { isNoLlm, refuseLlm } from "../no-llm.js";

export interface HealCommandOptions {
  cwd: string;
  max?: number;
  /** Subject length below which a commit is considered for healing. */
  subjectMinLen?: number;
  /** Skip writing — just preview which commits would be healed. */
  dryRun?: boolean;
  provider?: "auto" | "ollama" | "openai";
  model?: string;
  /** Re-heal commits that already have a synthesized note. */
  force?: boolean;
  /** Refuse to run if any LLM would be called. */
  noLlm?: boolean;
}

/**
 * `mneme heal` — for each commit whose message gives no real signal,
 * read the diff and ask an LLM to synthesize a 2-4 sentence WHY note.
 *
 * The original commit is never modified. The synthesized note lives in
 * `synthesized_notes` and is searched as kind='synthesized' so users can
 * always tell synthesized text from original text.
 */
export async function healCommand(opts: HealCommandOptions): Promise<number> {
  ui.banner();
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  if (isNoLlm(opts.noLlm, cfg)) {
    return refuseLlm(
      "heal",
      "ship better commit messages, or `mneme ask` works on existing text alone",
      ui,
    );
  }

  const s = new store.MnemeStore(dbPath(meta.rootPath));

  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  // 1. Find candidate commits (poor message, missing body).
  const all = loadAllCommits(s);
  const subjectMinLen = opts.subjectMinLen ?? 20;
  let candidates = all.filter((c) => enrich.needsHealing(c, subjectMinLen));

  // Skip already-healed unless --force.
  if (!opts.force) {
    candidates = candidates.filter((c) => !s.getSynthesizedNote(c.hash));
  }

  // Cap.
  const max = opts.max ?? 100;
  if (candidates.length > max) candidates = candidates.slice(0, max);

  ui.step(
    "candidates",
    `${candidates.length} commits with poor messages ${kleur.gray(`(of ${all.length} total)`)}`,
  );

  if (candidates.length === 0) {
    ui.success("Nothing to heal — every commit already has either a real message or a synthesized note.");
    s.close();
    return 0;
  }

  if (opts.dryRun) {
    process.stdout.write("\n" + kleur.bold().magenta("Would heal:") + "\n");
    for (const c of candidates.slice(0, 10)) {
      process.stdout.write(`  ${kleur.green("●")} ${c.shortHash}  ${kleur.gray(c.authorDate.slice(0, 10))}  ${kleur.white(c.subject || "(empty)")}\n`);
    }
    if (candidates.length > 10) {
      process.stdout.write(kleur.gray(`  …and ${candidates.length - 10} more\n`));
    }
    process.stdout.write(kleur.gray("\nRun without --dry-run to synthesize notes.\n"));
    s.close();
    return 0;
  }

  // 2. Resolve enricher (Ollama by default, free + local).
  ui.step("enricher", "resolving …");
  let enricher;
  try {
    enricher = await resolveEnricher({
      provider: opts.provider ?? "auto",
      model: opts.model,
    });
  } catch (err) {
    ui.error((err as Error).message);
    ui.dim("Install Ollama (recommended): https://ollama.com");
    ui.dim("Then pull a small chat model: ollama pull llama3.2:1b");
    s.close();
    return 1;
  }
  ui.dim(`           using ${enricher.name}`);

  // 3. For each candidate, fetch diff + neighbors + synthesize.
  let synthesized = 0;
  let skippedUncertain = 0;
  let lastTick = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const now = Date.now();
    if (now - lastTick > 80 || i === candidates.length - 1) {
      lastTick = now;
      const bar = formatProgress(i + 1, candidates.length);
      ui.raw(`\r${kleur.gray("›")} healing  ${bar}  ${kleur.gray(c.shortHash)}     `);
    }

    const diff = await fetchDiff(meta.rootPath, c.hash);
    if (diff.length < 20) continue; // empty/binary-only commit

    const neighborSubjects = neighborsOf(all, c, 3);
    const prompt = enrich.buildSynthesisPrompt({ commit: c, diff, neighborSubjects });

    try {
      const result = await enricher.enrich({
        system: enrich.SYNTHESIZE_SYSTEM_PROMPT,
        user: prompt,
        temperature: 0.2,
        maxTokens: 220,
      });
      if (enrich.isUncertain(result.text)) {
        skippedUncertain++;
        continue;
      }
      s.upsertSynthesizedNote(c.hash, result.text, result.source, diff.length);
      synthesized++;
    } catch (err) {
      // Network/model error — keep going, don't crash whole batch.
      ui.raw("\n");
      ui.warn(`heal failed for ${c.shortHash}: ${(err as Error).message}`);
    }
  }
  ui.raw("\n");

  // 4. Report.
  ui.success(
    `Synthesized ${synthesized} notes  ${kleur.gray(`· ${skippedUncertain} skipped as uncertain · ${candidates.length - synthesized - skippedUncertain} errored`)}`,
  );
  ui.dim(`Total notes in store: ${s.countSynthesizedNotes()}`);
  ui.dim(`Notes are searched as kind='synthesized' alongside original chunks. Originals never modified.`);

  s.close();
  return 0;
}

function loadAllCommits(s: store.MnemeStore): Commit[] {
  const rows = s.db
    .prepare("SELECT * FROM commits ORDER BY author_date ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    hash: String(r.hash),
    shortHash: String(r.short_hash),
    authorName: String(r.author_name),
    authorEmail: String(r.author_email),
    authorDate: String(r.author_date),
    committerDate: String(r.committer_date),
    subject: String(r.subject),
    body: String(r.body),
    parents: String(r.parents).split(/\s+/).filter(Boolean),
    files: s.filesForCommit(String(r.hash)),
    prNumber: typeof r.pr_number === "number" ? r.pr_number : undefined,
    prTitle: r.pr_title ? String(r.pr_title) : undefined,
    prBody: r.pr_body ? String(r.pr_body) : undefined,
    issueRefs: r.issue_refs ? JSON.parse(String(r.issue_refs)) : undefined,
  }));
}

async function fetchDiff(cwd: string, commitHash: string): Promise<string> {
  const r = await git.execGit(["show", "--format=", "--no-color", commitHash], { cwd });
  if (r.code !== 0) return "";
  return r.stdout;
}

/** Pick subjects of N commits before + after the target by date. */
function neighborsOf(all: Commit[], target: Commit, n: number): string[] {
  const idx = all.findIndex((c) => c.hash === target.hash);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = Math.max(0, idx - n); i < Math.min(all.length, idx + n + 1); i++) {
    if (i === idx) continue;
    if (all[i]!.subject) out.push(all[i]!.subject);
  }
  return out;
}
