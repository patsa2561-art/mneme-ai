import { git, retrieve, store } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import kleur from "kleur";

/**
 * `mneme why <file>[:<line>[-<line>]]`
 *
 * Combines blame + RAG to answer: "why does this code exist?"
 */
export interface WhyOptions {
  cwd: string;
  target: string;
  topK?: number;
}

export async function whyCommand(opts: WhyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const { file, startLine, endLine } = parseTarget(opts.target);
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Why")} ${file}` + (startLine ? `:${startLine}${endLine ? `-${endLine}` : ""}` : "") + "\n\n");

  const blamed = await git.blame(meta.rootPath, file, startLine, endLine);
  if (!blamed.length) {
    ui.warn("No blame data (file may be untracked or path wrong).");
    return 1;
  }

  const tally = new Map<string, { count: number; sample: string }>();
  for (const b of blamed) {
    const cur = tally.get(b.commitHash);
    if (cur) cur.count++;
    else tally.set(b.commitHash, { count: 1, sample: b.content });
  }
  const ranked = Array.from(tally.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  process.stdout.write(`${kleur.bold().magenta("Originating commits")}\n`);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  for (const [hash, { count }] of ranked) {
    const c = s.getCommit(hash);
    if (!c) {
      process.stdout.write(`  ${kleur.gray("●")} ${hash.slice(0, 8)}  ${kleur.gray("(not indexed)")}\n`);
      continue;
    }
    const date = c.authorDate.slice(0, 10);
    process.stdout.write(
      `  ${kleur.green("●")} ${kleur.bold(c.shortHash)} ${kleur.gray(`[${date} · ${c.authorName} · ${count} lines]`)}\n`,
    );
    process.stdout.write(`    ${c.subject}\n`);
  }

  if (s.countChunks() > 0) {
    const embedder = await resolveEmbedder({
      provider: cfg.embeddings.provider,
      model: cfg.embeddings.model,
      baseUrl: cfg.embeddings.baseUrl,
    });
    const seedQuery = ranked
      .map(([h]) => s.getCommit(h)?.subject)
      .filter(Boolean)
      .join("\n");
    if (seedQuery.trim()) {
      const related = await retrieve.search(seedQuery, {
        store: s,
        embedder,
        repo: meta,
        topK: opts.topK ?? 5,
      });
      const filtered = related.filter((r) => !tally.has(r.commit.hash));
      if (filtered.length) {
        process.stdout.write(`\n${kleur.bold().magenta("Semantically related")}\n`);
        for (const r of filtered.slice(0, 5)) {
          const c = r.commit;
          process.stdout.write(
            `  ${kleur.cyan("◆")} ${kleur.bold(c.shortHash)} ${kleur.gray(`[${c.authorDate.slice(0, 10)}]`)}  ${c.subject}\n`,
          );
        }
      }
    }
  }

  s.close();
  return 0;
}

function parseTarget(s: string): { file: string; startLine?: number; endLine?: number } {
  const m = s.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return { file: s };
  return {
    file: m[1]!,
    startLine: m[2] ? Number(m[2]) : undefined,
    endLine: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined,
  };
}
