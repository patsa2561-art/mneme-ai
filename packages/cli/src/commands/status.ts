import { existsSync, statSync } from "node:fs";
import { git, store } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import kleur from "kleur";

export async function statusCommand(opts: { cwd: string }): Promise<number> {
  ui.banner();

  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repository.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const path = dbPath(meta.rootPath);
  const cfg = readConfig(meta.rootPath);

  process.stdout.write(`${kleur.bold().magenta("Repo")}\n`);
  process.stdout.write(`  ${kleur.gray("path    ")} ${meta.rootPath}\n`);
  process.stdout.write(`  ${kleur.gray("branch  ")} ${meta.defaultBranch}\n`);
  if (meta.host) {
    process.stdout.write(
      `  ${kleur.gray("remote  ")} ${meta.host}:${meta.owner}/${meta.repo}\n`,
    );
  }

  process.stdout.write(`\n${kleur.bold().magenta("Memory")}\n`);
  if (!existsSync(path)) {
    ui.warn("Not yet indexed.");
    ui.dim("Run: mneme index");
    return 0;
  }

  const s = new store.MnemeStore(path);
  const commits = s.countCommits();
  const chunks = s.countChunks();
  const embedded = s.countChunksWithEmbedding();
  const embedder = s.getMeta("embedder") ?? "(unknown)";
  const indexedAt = s.getMeta("indexed_at");

  const sizeBytes = statSync(path).size;
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);

  process.stdout.write(`  ${kleur.gray("db      ")} ${path} ${kleur.gray(`(${sizeMb} MB)`)}\n`);
  process.stdout.write(`  ${kleur.gray("commits ")} ${kleur.bold(String(commits))}\n`);
  process.stdout.write(
    `  ${kleur.gray("chunks  ")} ${kleur.bold(String(chunks))} ${kleur.gray(`(${embedded} with embeddings)`)}\n`,
  );
  process.stdout.write(`  ${kleur.gray("embedder")} ${embedder}\n`);
  if (indexedAt) process.stdout.write(`  ${kleur.gray("indexed ")} ${indexedAt}\n`);

  process.stdout.write(`\n${kleur.bold().magenta("Config")}\n`);
  process.stdout.write(`  ${kleur.gray("provider")} ${cfg.embeddings.provider}\n`);
  if (cfg.embeddings.model)
    process.stdout.write(`  ${kleur.gray("model   ")} ${cfg.embeddings.model}\n`);

  s.close();
  return 0;
}
