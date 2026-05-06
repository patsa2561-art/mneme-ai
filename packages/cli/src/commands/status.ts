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
  const embedderRaw = s.getMeta("embedder");
  const indexedAt = s.getMeta("indexed_at");

  const sizeBytes = statSync(path).size;
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);

  process.stdout.write(`  ${kleur.gray("db      ")} ${path} ${kleur.gray(`(${sizeMb} MB)`)}\n`);
  process.stdout.write(`  ${kleur.gray("commits ")} ${kleur.bold(String(commits))}\n`);
  process.stdout.write(
    `  ${kleur.gray("chunks  ")} ${kleur.bold(String(chunks))} ${kleur.gray(`(${embedded} with embeddings)`)}\n`,
  );
  if (embedderRaw) {
    process.stdout.write(`  ${kleur.gray("embedder")} ${kleur.bold(embedderRaw)}\n`);
  } else {
    process.stdout.write(
      `  ${kleur.gray("embedder")} ${kleur.yellow("not recorded")} ${kleur.gray("— re-run `mneme index` to populate")}\n`,
    );
  }
  if (indexedAt) {
    process.stdout.write(`  ${kleur.gray("indexed ")} ${indexedAt}\n`);
  } else {
    process.stdout.write(
      `  ${kleur.gray("indexed ")} ${kleur.yellow("never")} ${kleur.gray("— run `mneme index` to build the memory")}\n`,
    );
  }

  process.stdout.write(`\n${kleur.bold().magenta("Config")}\n`);
  const providerLabel =
    cfg.embeddings.provider === "hash"
      ? `${cfg.embeddings.provider} ${kleur.gray("(deterministic, dep-free fallback)")}`
      : cfg.embeddings.provider;
  process.stdout.write(`  ${kleur.gray("provider")} ${providerLabel}\n`);
  if (cfg.embeddings.model) {
    process.stdout.write(`  ${kleur.gray("model   ")} ${cfg.embeddings.model}\n`);
  } else if (cfg.embeddings.provider === "hash") {
    process.stdout.write(
      `  ${kleur.gray("model   ")} ${kleur.gray("n/a")}  ${kleur.gray("— hash embedder needs no model. Pull `nomic-embed-text` via Ollama for higher quality.")}\n`,
    );
  }

  s.close();
  return 0;
}
