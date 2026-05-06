import { existsSync, statSync } from "node:fs";
import { git, store } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import {
  ui,
  header,
  section,
  kv,
  pill,
  emptyState,
  nextSteps,
  meter,
} from "../ui.js";
import kleur from "kleur";

export async function statusCommand(opts: { cwd: string }): Promise<number> {
  ui.banner();

  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repository.");
    process.stdout.write(emptyState(
      "Mneme works inside a git repo.",
      [
        "Run `git init` first, then `mneme init`.",
        "Or `cd` into an existing repo and try again.",
      ],
    ));
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const path = dbPath(meta.rootPath);
  const cfg = readConfig(meta.rootPath);

  process.stdout.write(header("◉", "Mneme Status",
    "memory layer health · config · indexing freshness") + "\n\n");

  // ── Repo
  process.stdout.write(section("◆ Repo") + "\n");
  process.stdout.write(kv("path", meta.rootPath) + "\n");
  process.stdout.write(kv("branch", meta.defaultBranch ?? "(detached)") + "\n");
  if (meta.host) {
    process.stdout.write(kv("remote", `${meta.host}:${meta.owner}/${meta.repo}`) + "\n");
  } else {
    process.stdout.write(kv("remote", `${kleur.gray("(local-only)")}`) + "\n");
  }
  process.stdout.write("\n");

  // ── Memory
  process.stdout.write(section("◆ Memory") + "\n");
  if (!existsSync(path)) {
    process.stdout.write(`  ${pill("NOT INDEXED", "warn")}  ${kleur.gray("no Mneme database at " + path)}\n\n`);
    process.stdout.write(nextSteps([
      { cmd: "mneme index", why: "Build the memory layer for this repo." },
    ]) + "\n");
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
  const embedRatio = chunks > 0 ? embedded / chunks : 0;

  process.stdout.write(kv("db", `${path} ${kleur.gray(`(${sizeMb} MB)`)}`) + "\n");
  process.stdout.write(kv("commits", kleur.bold(String(commits))) + "\n");
  process.stdout.write(
    kv("chunks", `${kleur.bold(String(chunks))}  ${meter(embedRatio, { width: 10 })}  ${kleur.gray(`${embedded}/${chunks} embedded`)}`) + "\n",
  );
  if (embedderRaw) {
    process.stdout.write(kv("embedder", kleur.bold(embedderRaw)) + "\n");
  } else {
    process.stdout.write(
      kv("embedder", `${pill("STALE", "warn")}  ${kleur.gray("not recorded — re-run `mneme index`")}`) + "\n",
    );
  }
  if (indexedAt) {
    const age = freshnessHint(indexedAt);
    process.stdout.write(kv("indexed", `${indexedAt}  ${age}`) + "\n");
  } else {
    process.stdout.write(
      kv("indexed", `${pill("NEVER", "warn")}  ${kleur.gray("run `mneme index` to build the memory")}`) + "\n",
    );
  }
  process.stdout.write("\n");

  // ── Config
  process.stdout.write(section("◆ Config") + "\n");
  const providerLabel =
    cfg.embeddings.provider === "hash"
      ? `${kleur.bold(cfg.embeddings.provider)}  ${pill("FALLBACK", "info")}  ${kleur.gray("deterministic, zero-dep")}`
      : kleur.bold(cfg.embeddings.provider);
  process.stdout.write(kv("provider", providerLabel) + "\n");
  if (cfg.embeddings.model) {
    process.stdout.write(kv("model", kleur.bold(cfg.embeddings.model)) + "\n");
  } else if (cfg.embeddings.provider === "hash") {
    process.stdout.write(
      kv("model", `${kleur.gray("n/a")}  ${kleur.gray("— pull `nomic-embed-text` via Ollama for higher quality")}`) + "\n",
    );
  }
  process.stdout.write("\n");

  // ── Smart next steps
  const acts: Array<{ cmd: string; why: string }> = [];
  if (commits === 0) {
    acts.push({ cmd: "mneme index", why: "Index this repo's history." });
  } else if (embedRatio < 0.5 && chunks > 0) {
    acts.push({
      cmd: "mneme index",
      why: `Only ${Math.round(embedRatio * 100)}% of chunks are embedded — re-index to fully populate.`,
    });
  } else if (indexedAt && isStale(indexedAt, 7)) {
    acts.push({ cmd: "mneme index", why: "Index is >7 days old — refresh to catch new commits." });
  }
  if (commits > 0) {
    acts.push({ cmd: 'mneme ask "what changed recently?"', why: "See if memory + retrieval works for you." });
  }
  if (acts.length > 0) process.stdout.write(nextSteps(acts) + "\n");

  s.close();
  return 0;
}

function freshnessHint(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const ageMs = Date.now() - ts;
  const ageDays = ageMs / 86400000;
  if (ageDays < 1) return pill("FRESH", "ok");
  if (ageDays < 7) return pill(`${Math.round(ageDays)}d old`, "low");
  if (ageDays < 30) return pill(`${Math.round(ageDays)}d old`, "medium");
  return pill(`${Math.round(ageDays)}d old`, "warn");
}

function isStale(iso: string, days: number): boolean {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return (Date.now() - ts) > days * 86400000;
}
