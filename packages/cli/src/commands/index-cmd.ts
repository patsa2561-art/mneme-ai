import { git, indexer, store } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { ui, formatProgress } from "../ui.js";
import kleur from "kleur";

export interface IndexCommandOptions {
  cwd: string;
  since?: string;
  maxCount?: number;
  embedder?: "auto" | "ollama" | "openai" | "hash";
  model?: string;
}

export async function indexCommand(opts: IndexCommandOptions): Promise<number> {
  ui.banner();

  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  const embedder = await resolveEmbedder({
    provider: opts.embedder ?? cfg.embeddings.provider,
    model: opts.model ?? cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });

  ui.step("embedder", `${kleur.bold(embedder.name)} ${kleur.gray(`(${embedder.dimensions} dims)`)}`);
  if (embedder.name.startsWith("hash:")) {
    ui.warn("Using hash-trick fallback. For real semantic quality install Ollama:");
    ui.dim("    ollama pull nomic-embed-text  &&  ollama serve");
  }

  const s = new store.MnemeStore(dbPath(meta.rootPath));
  s.setMeta("repo_root", meta.rootPath);
  s.setMeta("embedder", embedder.name);

  let last = 0;
  const idx = new indexer.Indexer({
    cwd: meta.rootPath,
    store: s,
    embedder,
    since: opts.since ?? cfg.index.since,
    maxCount: opts.maxCount ?? cfg.index.maxCount,
    onProgress: (p) => {
      const now = Date.now();
      if (now - last < 80 && p.phase !== "done") return;
      last = now;
      const bar = p.total > 0 ? formatProgress(p.current, p.total) : "";
      ui.raw(`\r${kleur.gray("›")} ${kleur.bold(p.phase.padEnd(10))} ${bar}  ${kleur.gray(p.message ?? "")}     `);
      if (p.phase === "done") ui.raw("\n");
    },
  });

  const t0 = Date.now();
  const result = await idx.run();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  s.setMeta("indexed_at", new Date().toISOString());

  // Pin the resolved embedder into config so subsequent `ask` uses the same
  // vector space (otherwise auto-detect could pick a different provider whose
  // embeddings are incompatible with what's stored).
  const resolvedKind: "ollama" | "openai" | "hash" = embedder.name.startsWith("ollama:")
    ? "ollama"
    : embedder.name.startsWith("openai:")
      ? "openai"
      : "hash";
  const resolvedModel = embedder.name.includes(":")
    ? embedder.name.split(":").slice(1).join(":")
    : undefined;
  if (
    cfg.embeddings.provider !== resolvedKind ||
    (resolvedModel && cfg.embeddings.model !== resolvedModel)
  ) {
    cfg.embeddings.provider = resolvedKind;
    if (resolvedModel) cfg.embeddings.model = resolvedModel;
    writeConfig(meta.rootPath, cfg);
  }

  ui.dim("");
  ui.success(`Indexed ${result.commits} commits → ${result.chunks} chunks in ${elapsed}s`);
  ui.dim(`DB: ${dbPath(meta.rootPath)}`);
  s.close();
  return 0;
}
