import { git, retrieve, store } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import kleur from "kleur";

export interface AskCommandOptions {
  cwd: string;
  question: string;
  topK?: number;
  json?: boolean;
}

export async function askCommand(opts: AskCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  const result = await retrieve.ask(opts.question, {
    store: s,
    embedder,
    repo: meta,
    topK: opts.topK ?? 8,
  });

  s.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  printAskResult(result);
  return 0;
}

function printAskResult(r: import("@mneme-ai/core").AskResult): void {
  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Q")} ${r.question}\n\n`);
  process.stdout.write(`${kleur.bold().magenta("Summary")}\n${r.summary}\n\n`);

  if (!r.searchResults.length) return;
  process.stdout.write(`${kleur.bold().magenta("Evidence")}\n`);
  for (const sr of r.searchResults.slice(0, 6)) {
    const c = sr.commit;
    const date = c.authorDate.slice(0, 10);
    const ref = c.prNumber ? `PR #${c.prNumber}` : c.shortHash;
    const score = sr.score.toFixed(3);
    process.stdout.write(
      `  ${kleur.green("●")} ${kleur.bold(ref)}  ${kleur.gray(`[${date} · ${c.authorName} · ${score}]`)}\n`,
    );
    process.stdout.write(`    ${kleur.white(c.subject)}\n`);
    if (c.body) {
      const firstLine = c.body.split("\n")[0]!.trim();
      if (firstLine) process.stdout.write(`    ${kleur.gray(truncate(firstLine, 120))}\n`);
    }
    if (c.files.length) {
      const files = c.files.slice(0, 3).join(", ");
      const more = c.files.length > 3 ? ` (+${c.files.length - 3})` : "";
      process.stdout.write(`    ${kleur.cyan("files:")} ${kleur.gray(files + more)}\n`);
    }
    process.stdout.write("\n");
  }

  if (r.citations.some((c) => c.url)) {
    process.stdout.write(`${kleur.bold().magenta("Citations")}\n`);
    for (const c of r.citations) {
      if (c.url) process.stdout.write(`  ${kleur.gray("→")} ${c.url}\n`);
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
