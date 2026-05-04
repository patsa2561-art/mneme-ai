/**
 * `mneme teach` — explain a folder or file in plain language.
 *
 * Inspiration: tools like Understand-Anything turn codebases into "knowledge
 * graphs" they then *teach*. Mneme already has the indexing primitives. The
 * remaining piece was a small command that synthesizes a short, honest
 * summary from the entities + git context — using the same LLM enricher
 * shipped for `mneme heal`.
 *
 * Three passes (a small "agent pipeline" without ceremony):
 *   1. CLASSIFY — assign each entity a layer (api / service / data / ui /
 *      utility / unknown) using path heuristics.
 *   2. AGGREGATE — count by layer + sample names.
 *   3. SUMMARIZE — let the LLM write 3-5 sentences of plain prose.
 *
 * For a single file: the LLM gets the file's source + a short list of its
 * entities and writes a paragraph. For a folder: the aggregate counts +
 * 10 representative entity names and writes the summary.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import kleur from "kleur";
import { git, store, type Entity } from "@mneme-ai/core";
import { resolveEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";
import { isNoLlm } from "../no-llm.js";

export interface TeachCommandOptions {
  cwd: string;
  target: string;
  provider?: "auto" | "ollama" | "openai";
  model?: string;
  json?: boolean;
  /** Skip the LLM summary step (prints classification only). */
  noLlm?: boolean;
}

type Layer = "api" | "service" | "data" | "ui" | "utility" | "test" | "config" | "unknown";

// Order matters: more specific rules come first.
// Tests checked first because `core/tests/foo.ts` is "first and foremost" a test,
// even though it lives under a service-like folder.
const LAYER_RULES: Array<{ layer: Layer; pattern: RegExp }> = [
  { layer: "test", pattern: /(^|\/)(tests?|__tests__|specs?)(\/|$)/ },
  { layer: "config", pattern: /(\.config\.|^config\/|\/config\/)/ },
  { layer: "api", pattern: /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|server)(\/|$)/ },
  { layer: "service", pattern: /(^|\/)(services?|business|domain|usecases?|core)(\/|$)/ },
  { layer: "data", pattern: /(^|\/)(repositor(y|ies)|store|stores|db|database|models?|data)(\/|$)/ },
  { layer: "ui", pattern: /(^|\/)(ui|components?|views?|pages?|screens?|app)(\/|$)/ },
  { layer: "utility", pattern: /(^|\/)(util|utils|helpers?|lib|common|shared)(\/|$)/ },
];

function classifyLayer(filePath: string): Layer {
  const p = filePath.toLowerCase();
  for (const r of LAYER_RULES) {
    if (r.pattern.test(p)) return r.layer;
  }
  if (/\.(test|spec)\./.test(p)) return "test";
  return "unknown";
}

export async function teachCommand(opts: TeachCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const targetPath = join(meta.rootPath, opts.target);
  if (!existsSync(targetPath)) {
    ui.error(`No such path: ${opts.target}`);
    return 1;
  }
  const isDir = statSync(targetPath).isDirectory();
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Teach")}  ${opts.target} ${kleur.gray(`(${isDir ? "folder" : "file"})`)}\n\n`);

  // 1. CLASSIFY — pull entities under this path and tag layers.
  const allEntities = loadEntitiesUnder(s, opts.target);
  const layered = allEntities.map((e) => ({ ...e, layer: classifyLayer(e.filePath) }));

  // 2. AGGREGATE
  const layerCounts = new Map<Layer, number>();
  for (const e of layered) {
    layerCounts.set(e.layer, (layerCounts.get(e.layer) ?? 0) + 1);
  }
  const sortedLayers = Array.from(layerCounts.entries()).sort((a, b) => b[1] - a[1]);

  process.stdout.write(`${kleur.bold().magenta("Layers")}\n`);
  if (sortedLayers.length === 0) {
    process.stdout.write(`  ${kleur.gray("(no entities indexed under this path — run `mneme entities`)")}\n`);
  }
  for (const [layer, n] of sortedLayers) {
    process.stdout.write(`  ${kleur.gray("·")} ${kleur.bold(layer.padEnd(8))}  ${n}\n`);
  }
  process.stdout.write("\n");

  // 3. SUMMARIZE — call the enricher (skipped under deterministic mode).
  const cfg = readConfig(meta.rootPath);
  if (isNoLlm(opts.noLlm, cfg)) {
    ui.dim("Deterministic mode — skipping LLM summary, printing classification only.");
    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          { target: opts.target, layers: Object.fromEntries(layerCounts), summary: null },
          null,
          2,
        ) + "\n",
      );
    }
    s.close();
    return 0;
  }

  let enricher;
  try {
    enricher = await resolveEnricher({
      provider: opts.provider ?? "auto",
      model: opts.model,
    });
  } catch (err) {
    ui.warn(`No enricher available: ${(err as Error).message}`);
    ui.dim("Install Ollama (recommended): https://ollama.com");
    ui.dim("Then pull a small chat model: ollama pull llama3.2:1b");
    if (opts.json) {
      process.stdout.write(JSON.stringify({ target: opts.target, layers: Object.fromEntries(layerCounts) }, null, 2) + "\n");
    }
    s.close();
    return 0;
  }

  const prompt = isDir
    ? buildFolderPrompt(opts.target, layered, sortedLayers)
    : buildFilePrompt(opts.target, targetPath, layered);

  ui.step("teaching", `${enricher.name} …`);
  let summary = "";
  try {
    const out = await enricher.enrich({
      system: TEACH_SYSTEM_PROMPT,
      user: prompt,
      temperature: 0.2,
      maxTokens: 280,
    });
    summary = out.text;
  } catch (err) {
    ui.warn(`Enricher failed: ${(err as Error).message}`);
    s.close();
    return 1;
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          target: opts.target,
          isDir,
          entityCount: layered.length,
          layers: Object.fromEntries(layerCounts),
          summary,
        },
        null,
        2,
      ) + "\n",
    );
    s.close();
    return 0;
  }

  process.stdout.write(`\n${kleur.bold().magenta("Summary")}\n`);
  for (const line of wrap(summary, 78).split("\n")) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        `  generated by ${enricher.name} · entities are layer-tagged via path heuristics`,
      ) +
      "\n",
  );

  s.close();
  return 0;
}

const TEACH_SYSTEM_PROMPT = `You are explaining a folder or file from a codebase to a new contributor.
Write 3-5 sentences in plain prose. No bullet lists. No markdown.

Rules:
1. Refer ONLY to entities and signatures that the user provided. Do not invent names.
2. Open with what the unit DOES (its purpose), not what it IS.
3. Mention the dominant layer (api / service / data / ui / utility) if obvious.
4. If you don't know enough to answer, say "Cannot determine purpose from the listed entities alone."
5. Avoid filler ("This file...", "Here we have..."). Open with the inferred purpose.

Output ONLY the summary. No preamble.`;

function loadEntitiesUnder(s: store.MnemeStore, target: string): Entity[] {
  const norm = target.replace(/\\/g, "/").replace(/^\.\//, "");
  // Use both equality and prefix match for files vs dirs.
  const rows = s.db
    .prepare(
      `SELECT id, kind, name, file_path, start_line, end_line, signature, language
       FROM entities
       WHERE file_path = ? OR file_path LIKE ?
       ORDER BY file_path ASC, start_line ASC`,
    )
    .all(norm, norm.endsWith("/") ? norm + "%" : norm + "/%") as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as Entity["kind"],
    name: String(r.name),
    filePath: String(r.file_path),
    startLine: Number(r.start_line),
    endLine: Number(r.end_line),
    signature: r.signature ? String(r.signature) : undefined,
    language: String(r.language),
  }));
}

function buildFolderPrompt(
  target: string,
  layered: Array<Entity & { layer: Layer }>,
  layerCounts: Array<[Layer, number]>,
): string {
  const lines: string[] = [];
  lines.push(`Folder: ${target}`);
  lines.push(`Total entities: ${layered.length}`);
  lines.push(`Layers: ${layerCounts.map(([l, n]) => `${l}=${n}`).join(", ")}`);
  lines.push("");
  lines.push("Sample entities (top 12 by alphabet):");
  for (const e of layered.slice(0, 12)) {
    const sig = e.signature ? ` — ${e.signature.slice(0, 80)}` : "";
    lines.push(`  - [${e.kind}] ${e.name} (${e.filePath}:${e.startLine})${sig}`);
  }
  return lines.join("\n");
}

function buildFilePrompt(
  target: string,
  absPath: string,
  layered: Array<Entity & { layer: Layer }>,
): string {
  const lines: string[] = [];
  lines.push(`File: ${target}`);
  let source = "";
  try {
    source = readFileSync(absPath, "utf8");
  } catch {
    // ignore
  }
  if (source.length > 0 && source.length < 4000) {
    lines.push("");
    lines.push("Source:");
    lines.push(source);
  } else if (source.length >= 4000) {
    lines.push("");
    lines.push("Source (first 4000 chars):");
    lines.push(source.slice(0, 4000));
    lines.push("…(truncated)");
  }
  if (layered.length) {
    lines.push("");
    lines.push("Indexed entities:");
    for (const e of layered) {
      const sig = e.signature ? ` — ${e.signature.slice(0, 80)}` : "";
      lines.push(`  - [${e.kind}] ${e.name} (line ${e.startLine})${sig}`);
    }
  }
  return lines.join("\n");
}

function wrap(s: string, width: number): string {
  const out: string[] = [];
  for (const para of s.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > width && line) {
        out.push(line);
        line = word;
      } else {
        line += (line ? " " : "") + word;
      }
    }
    if (line.trim()) out.push(line);
    out.push("");
  }
  return out.join("\n").trim();
}

/**
 * Exported for testing — pure helper, no I/O.
 */
export const _classifyLayer = classifyLayer;
