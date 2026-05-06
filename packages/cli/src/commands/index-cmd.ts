import { git, indexer, store, util } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { ui, formatProgress } from "../ui.js";
import { isNoLlm } from "../no-llm.js";
import kleur from "kleur";

export interface IndexCommandOptions {
  cwd: string;
  since?: string;
  maxCount?: number;
  embedder?: "auto" | "ollama" | "openai" | "hash";
  model?: string;
  /** Disable secret redaction (default: ON). */
  noRedact?: boolean;
  /** Enable lower-confidence patterns (generic password=, hex blobs). */
  aggressiveRedact?: boolean;
  /** Force hash embedder; refuse Ollama/OpenAI even if requested. */
  noLlm?: boolean;
  /** Skip indexing — just analyze the existing index quality. */
  analyze?: boolean;
  /** JSON output (only with --analyze). */
  json?: boolean;
}

export async function indexCommand(opts: IndexCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);

  // ── --analyze: don't re-index. Inspect what we already have. ──────────
  if (opts.analyze) {
    const s = new store.MnemeStore(dbPath(meta.rootPath));
    const commits = util.loadAllCommits(s);
    const chunks: import("@mneme-ai/core").CommitChunk[] = (
      s.db
        .prepare(
          "SELECT id, commit_hash, text, kind, embedding FROM chunks",
        )
        .all() as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      commitHash: String(r.commit_hash),
      text: String(r.text ?? ""),
      kind: r.kind as
        | "subject"
        | "body"
        | "pr_title"
        | "pr_body"
        | "diff_hunk"
        | "synthesized",
      embedding:
        r.embedding instanceof Buffer && r.embedding.length > 0
          ? new Float32Array(
              r.embedding.buffer,
              r.embedding.byteOffset,
              r.embedding.byteLength / 4,
            )
          : undefined,
    }));
    const report = indexer.analyzeIndexQuality(commits, chunks);
    s.close();

    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return 0;
    }

    ui.banner();
    process.stdout.write(`\n  ${kleur.bold().cyan("📊  Index Quality — health check")}\n`);
    process.stdout.write(`  ${kleur.gray("─".repeat(64))}\n\n`);
    process.stdout.write(`  ${kleur.bold(String(report.indexedCommits))} commits  ·  ${kleur.bold(String(report.indexedChunks))} chunks  ·  ${kleur.bold(String(report.embeddedChunks))} embedded\n\n`);

    const grade = report.grade;
    const gradeColor =
      grade === "A" ? kleur.green : grade === "B" ? kleur.cyan : grade === "C" ? kleur.yellow : kleur.red;
    process.stdout.write(`  ${kleur.bold().magenta("✦ Overall grade")}\n`);
    process.stdout.write(
      `    ${gradeColor().bold(grade)}  ${kleur.gray(`(${(report.overallScore * 100).toFixed(0)}/100)`)}\n\n`,
    );

    process.stdout.write(`  ${kleur.bold().magenta("◆ Per-metric breakdown")}\n\n`);
    const rows: Array<[string, number]> = [
      ["chunk density", report.metrics.chunkDensity],
      ["embedding ratio", report.metrics.embedRatio],
      ["subject quality", report.metrics.subjectQuality],
      ["body ratio", report.metrics.bodyRatio],
      ["PR ratio", report.metrics.prRatio],
      ["issue ref ratio", report.metrics.issueRatio],
      ["duplicate ratio", report.metrics.duplicateRatio],
      ["tokenizer health", report.metrics.tokenizerHealth],
    ];
    for (const [label, value] of rows) {
      const meter = qualityMeter(value, label === "duplicate ratio");
      const pct = `${Math.round(value * 100)}%`;
      process.stdout.write(`    ${meter}  ${pct.padStart(4)}  ${label}\n`);
    }
    process.stdout.write("\n");

    if (report.recommendations.length > 0) {
      process.stdout.write(`  ${kleur.bold().magenta("✦ Recommendations")}\n\n`);
      for (const rec of report.recommendations) {
        process.stdout.write(`    ${kleur.gray("•")} ${rec}\n`);
      }
      process.stdout.write("\n");
    }
    return 0;
  }

  ui.banner();

  // Deterministic mode forces the hash embedder regardless of what was asked.
  // Honest "no LLM, no remote" beats failing because Ollama isn't reachable.
  const noLlm = isNoLlm(opts.noLlm, cfg);
  if (noLlm && (opts.embedder === "ollama" || opts.embedder === "openai")) {
    ui.warn(`Deterministic mode — ignoring --embedder ${opts.embedder} and using hash fallback.`);
  }

  const embedder = await resolveEmbedder({
    provider: noLlm ? "hash" : (opts.embedder ?? cfg.embeddings.provider),
    model: noLlm ? undefined : (opts.model ?? cfg.embeddings.model),
    baseUrl: cfg.embeddings.baseUrl,
  });

  ui.step("embedder", `${kleur.bold(embedder.name)} ${kleur.gray(`(${embedder.dimensions} dims)`)}`);
  if (embedder.name.startsWith("hash:")) {
    ui.warn("Using hash-trick fallback. For real semantic quality install Ollama:");
    ui.dim("    ollama pull nomic-embed-text  &&  ollama serve");
  }

  // Pre-flight: catch Ollama / model issues in seconds, BEFORE the long
  // git read + redaction pass. Prevents the "hung at 0% for minutes" trap.
  if (typeof (embedder as { verify?: unknown }).verify === "function") {
    ui.step("verify", "checking Ollama + model is ready");
    const ver = await (embedder as unknown as {
      verify: () => Promise<{ ok: true } | { ok: false; reason: string; remedy: string }>;
    }).verify();
    if (!ver.ok) {
      process.stdout.write("\n");
      ui.error(`Embedder not ready: ${ver.reason}`);
      process.stdout.write(`  ${kleur.yellow().bold("👉 Fix:")}  ${kleur.bold().white(ver.remedy)}\n`);
      process.stdout.write(`  ${kleur.gray("Once fixed, re-run:  mneme index")}\n\n`);
      return 1;
    }
  }

  const s = new store.MnemeStore(dbPath(meta.rootPath));
  s.setMeta("repo_root", meta.rootPath);
  s.setMeta("embedder", embedder.name);

  const redactConfig = opts.noRedact
    ? false
    : opts.aggressiveRedact
      ? { aggressive: true }
      : true;

  let last = 0;
  const idx = new indexer.Indexer({
    cwd: meta.rootPath,
    store: s,
    embedder,
    since: opts.since ?? cfg.index.since,
    maxCount: opts.maxCount ?? cfg.index.maxCount,
    redact: redactConfig,
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

  const totalRedacted = Object.values(result.redactionHits).reduce((a, b) => a + b, 0);
  if (totalRedacted > 0) {
    ui.warn(`Redacted ${totalRedacted} secret(s) before indexing:`);
    for (const [rule, count] of Object.entries(result.redactionHits)) {
      ui.dim(`    ${rule.padEnd(28)} ${count}`);
    }
    ui.dim("    (pass --no-redact to disable; see docs/SECURITY.md)");
  } else if (opts.noRedact) {
    ui.dim("Redaction: disabled (--no-redact)");
  }

  s.close();
  return 0;
}

function qualityMeter(value: number, invert: boolean = false): string {
  const v = invert ? 1 - value : value;
  const blocks = Math.round(v * 10);
  const filled = "█".repeat(blocks);
  const empty = "░".repeat(10 - blocks);
  if (v >= 0.85) return kleur.green(filled) + kleur.gray(empty);
  if (v >= 0.7) return kleur.cyan(filled) + kleur.gray(empty);
  if (v >= 0.5) return kleur.yellow(filled) + kleur.gray(empty);
  return kleur.red(filled) + kleur.gray(empty);
}

