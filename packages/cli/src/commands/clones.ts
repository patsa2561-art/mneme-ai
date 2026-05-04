import { entities, git, store, type Entity } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import kleur from "kleur";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui, formatProgress } from "../ui.js";

export interface IndexEntitiesOptions {
  cwd: string;
  embedBatchSize?: number;
}

/**
 * `mneme entities` — parse repo, embed, persist.
 */
export async function entitiesCommand(opts: IndexEntitiesOptions): Promise<number> {
  ui.banner();
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  ui.step("parser", "TypeScript / JavaScript (compiler API)");
  const parser = new entities.TypeScriptParser();
  try {
    await parser.preload();
  } catch (err) {
    ui.error((err as Error).message);
    s.close();
    return 1;
  }

  ui.step("embedder", "resolving …");
  const embedder = await resolveEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    baseUrl: cfg.embeddings.baseUrl,
  });
  ui.dim(`            using ${embedder.name} (${embedder.dimensions} dims)`);

  ui.step("walking", "tracked .ts / .tsx / .js / .jsx files");
  const collected: Entity[] = [];
  let filesParsed = 0;
  for await (const e of parser.parseRepo({
    cwd: meta.rootPath,
    onProgress: (n) => {
      filesParsed = n;
      if (n % 25 === 0) ui.raw(`\r${kleur.gray("›")} parsed ${n} files     `);
    },
  })) {
    collected.push(e);
  }
  ui.raw("\n");
  ui.success(`Parsed ${filesParsed} files → ${collected.length} entities`);

  if (collected.length === 0) {
    ui.warn("No entities extracted. Either no TS/JS files are tracked, or all are .d.ts/test files.");
    s.close();
    return 0;
  }

  // Embed in batches.
  const batchSize = opts.embedBatchSize ?? 32;
  for (let i = 0; i < collected.length; i += batchSize) {
    const batch = collected.slice(i, i + batchSize);
    const texts = batch.map((e) => entities.entityEmbeddingText(e));
    const vecs = await embedder.embed(texts);
    for (let j = 0; j < batch.length; j++) batch[j]!.embedding = vecs[j];
    const bar = formatProgress(Math.min(i + batchSize, collected.length), collected.length);
    ui.raw(`\r${kleur.gray("›")} embedding  ${bar}     `);
  }
  ui.raw("\n");

  s.upsertEntities(collected, embedder.name);

  ui.success(`Indexed ${collected.length} entities (${embedder.name})`);

  // Quick summary by language + kind.
  const byLang = s.countEntitiesByLanguage();
  process.stdout.write("\n  By language:\n");
  for (const row of byLang) {
    process.stdout.write(`    ${row.language.padEnd(12)} ${row.n}\n`);
  }

  s.close();
  return 0;
}

export interface ClonesCommandOptions {
  cwd: string;
  threshold?: number;
  topN?: number;
  json?: boolean;
}

/**
 * `mneme clones` — detect semantic clones from indexed entities.
 */
export async function clonesCommand(opts: ClonesCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  if (s.countEntitiesWithEmbedding() < 2) {
    ui.error(
      "Not enough indexed entities. Run `mneme entities` first to parse and embed your codebase.",
    );
    s.close();
    return 1;
  }

  const all = Array.from(s.iterEmbeddedEntities());
  s.close();

  const detector = new entities.CosineCloneDetector();
  const clusters = await detector.detect({
    entities: all,
    threshold: opts.threshold,
    maxClusterSize: 12,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(clusters.slice(0, opts.topN ?? 20), null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(
    kleur.bold().magenta("Clone clusters") +
      kleur.gray(
        `  (threshold ${opts.threshold ?? entities.DEFAULT_CLONE_THRESHOLD}  ·  ${all.length} entities  ·  ${clusters.length} clusters)`,
      ) +
      "\n\n",
  );

  if (clusters.length === 0) {
    ui.warn("No clusters above threshold. Try lowering with --threshold 0.7.");
    return 0;
  }

  for (const c of clusters.slice(0, opts.topN ?? 20)) {
    process.stdout.write(
      `  ${kleur.bold().cyan("●")} ${kleur.bold(c.id)}  ` +
        kleur.gray(`cohesion ${c.cohesion.toFixed(3)}  ·  ${c.members.length} members`) +
        "\n",
    );
    for (const m of c.members) {
      process.stdout.write(
        `      ${kleur.gray(m.kind.padEnd(8))} ${kleur.white(m.name)} ${kleur.gray(`(${m.filePath}:${m.startLine})`)}\n`,
      );
    }
    process.stdout.write("\n");
  }
  return 0;
}
