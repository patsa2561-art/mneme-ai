import { git, indexer, store, util, security } from "@mneme-ai/core";
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

  // v1.11.1 — lazy auto-bootstrap for users upgrading from v1.10.0 who
  // never re-ran `mneme init`. Idempotent + best-effort.
  if (process.env["MNEME_NO_AUTO_SECURITY"] !== "1") {
    try {
      const boot = security.autoBootstrap(meta.rootPath);
      if (boot.auditLogAutoEnabled) {
        ui.dim("");
        ui.success(`Security on by default · audit log auto-enabled (HMAC-SHA-256${boot.fipsActive ? " · FIPS-validated" : ""})`);
        ui.dim("  See `mneme security status` · disable with `mneme security off`.");
      }
    } catch { /* best-effort */ }
  }

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
        // node:sqlite returns BLOBs as Uint8Array; Buffer also extends
        // Uint8Array, so this single check covers both store implementations.
        r.embedding instanceof Uint8Array && r.embedding.byteLength > 0
          ? (() => {
              const blob = r.embedding as Uint8Array;
              const copy = new Uint8Array(blob.byteLength);
              copy.set(blob);
              return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
            })()
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

  // Bundled-model download progress hook — keeps the user informed during
  // the one-time ~25MB ONNX fetch on first run.
  let lastDl = 0;
  // v1.11.1 — TOFU manifest path is per-repo so different projects can pin
  // different models independently. Auto-on unless user opts out.
  const tofuManifestPath = process.env["MNEME_NO_AUTO_SECURITY"] === "1"
    ? undefined
    : `${meta.rootPath}/.mneme/model-checksums.json`;
  const embedder = await resolveEmbedder({
    provider: noLlm ? "hash" : (opts.embedder ?? cfg.embeddings.provider),
    model: noLlm ? undefined : (opts.model ?? cfg.embeddings.model),
    baseUrl: cfg.embeddings.baseUrl,
    tofuManifestPath,
    onBundledProgress: (info) => {
      const now = Date.now();
      if (now - lastDl < 250 && info.status !== "done") return;
      lastDl = now;
      const file = info.file ? ` ${info.file}` : "";
      if (info.status === "progress" && info.loaded != null && info.total != null && info.total > 0) {
        const pct = Math.round((info.loaded / info.total) * 100);
        const mb = (info.loaded / 1024 / 1024).toFixed(1);
        const tot = (info.total / 1024 / 1024).toFixed(1);
        ui.raw(`\r${kleur.gray("›")} ${kleur.bold("downloading".padEnd(10))} ${pct}% ${kleur.gray(`(${mb}/${tot} MB${file})`)}     `);
      } else if (info.status === "done" || info.status === "ready") {
        ui.raw(`\r${kleur.gray("›")} ${kleur.bold("downloading".padEnd(10))} ${kleur.green("done")}${file ? kleur.gray(` (${file})`) : ""}     \n`);
      }
    },
  });

  let activeEmbedder = embedder;
  ui.step("embedder", `${kleur.bold(activeEmbedder.name)} ${kleur.gray(`(${activeEmbedder.dimensions} dims)`)}`);
  if (activeEmbedder.name.startsWith("hash:")) {
    ui.warn("Using hash-trick fallback. For real semantic quality install Ollama:");
    ui.dim("    ollama pull nomic-embed-text  &&  ollama serve");
  }

  // Pre-flight verify. If the chosen embedder is unhealthy, AUTO-FALL-BACK
  // to the bundled WASM model — never block the user with a hard error.
  // Hard errors only happen if user EXPLICITLY chose `--embedder ollama`.
  const userPickedExplicit = !!opts.embedder && opts.embedder !== "auto";
  if (typeof (activeEmbedder as { verify?: unknown }).verify === "function") {
    ui.step("verify", `${activeEmbedder.name} is ready?`);
    const ver = await (activeEmbedder as unknown as {
      verify: () => Promise<{ ok: true } | { ok: false; reason: string; remedy: string }>;
    }).verify();
    if (!ver.ok) {
      if (userPickedExplicit) {
        // User asked for this provider specifically — show error and exit.
        process.stdout.write("\n");
        ui.error(`Embedder not ready: ${ver.reason}`);
        process.stdout.write(`  ${kleur.yellow().bold("👉 Fix:")}  ${kleur.bold().white(ver.remedy)}\n`);
        process.stdout.write(`  ${kleur.gray("Or use auto-fallback:  mneme index --embedder bundled")}\n\n`);
        return 1;
      }
      // Auto mode — degrade silently to bundled WASM.
      process.stdout.write("\n");
      ui.warn(`${activeEmbedder.name} is unhealthy: ${ver.reason}`);
      ui.dim(`  → falling back to bundled WASM model (no setup needed).`);
      const { BundledEmbedder } = await import("@mneme-ai/embeddings");
      activeEmbedder = new BundledEmbedder({
        tofuManifestPath,
        onProgress: (info: { status: string; loaded?: number; total?: number; file?: string }) => {
          const fileLabel = info.file ? ` ${info.file}` : "";
          if (info.status === "progress" && info.loaded != null && info.total != null && info.total > 0) {
            const pct = Math.round((info.loaded / info.total) * 100);
            const mb = (info.loaded / 1024 / 1024).toFixed(1);
            const tot = (info.total / 1024 / 1024).toFixed(1);
            ui.raw(`\r${kleur.gray("›")} ${kleur.bold("downloading".padEnd(10))} ${pct}% ${kleur.gray(`(${mb}/${tot} MB${fileLabel})`)}     `);
          } else if (info.status === "done" || info.status === "ready") {
            ui.raw(`\r${kleur.gray("›")} ${kleur.bold("downloading".padEnd(10))} ${kleur.green("done")}${fileLabel ? kleur.gray(` (${fileLabel})`) : ""}     \n`);
          }
        },
      });
      ui.step("embedder", `${kleur.bold(activeEmbedder.name)} ${kleur.gray(`(${activeEmbedder.dimensions} dims, fallback)`)}`);
      const ver2 = await (activeEmbedder as unknown as {
        verify: () => Promise<{ ok: true } | { ok: false; reason: string; remedy: string }>;
      }).verify();
      if (!ver2.ok) {
        // Even bundled failed (e.g., offline, no cached model) — fall to hash.
        ui.warn(`Bundled WASM also unhealthy: ${ver2.reason}`);
        ui.dim(`  → falling back to hash embedder (★★ deterministic, always works).`);
        const { HashEmbedder } = await import("@mneme-ai/embeddings");
        activeEmbedder = new HashEmbedder();
      }
    }
  }

  const s = new store.MnemeStore(dbPath(meta.rootPath));
  s.setMeta("repo_root", meta.rootPath);
  s.setMeta("embedder", activeEmbedder.name);
  // v1.45.0 (#3 fix) -- surface FTS5 absence honestly + early. Indexer
  // continues with the LIKE + n-gram fallback (TRIPLE-INDEX WAR mode);
  // user gets a banner instead of a silent crash mid-migration.
  if (!s.fts5Available) {
    ui.dim("");
    ui.error(s.fts5RemedyMessage);
    ui.dim("");
  }

  const redactConfig = opts.noRedact
    ? false
    : opts.aggressiveRedact
      ? { aggressive: true }
      : true;

  let last = 0;
  // Wisdom theater — emit progressive discoveries while indexing runs.
  // Strategic intent: turn the 90s indexing wait into value-creation theatre.
  const { WisdomTheater } = await import("./wisdom-theater.js");
  const theater = new WisdomTheater({ store: s });
  const idx = new indexer.Indexer({
    cwd: meta.rootPath,
    store: s,
    embedder: activeEmbedder,
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
      // Wisdom theater — surface a discovery as data flows in. Best-effort.
      const wisdom = theater.maybeEmit({ phase: p.phase, current: p.current, total: p.total });
      if (wisdom) ui.raw(`\n  ${wisdom}\n`);
    },
  });

  const t0 = Date.now();
  const result = await idx.run();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  s.setMeta("indexed_at", new Date().toISOString());

  // Pin the resolved embedder into config so subsequent `ask` uses the same
  // vector space (otherwise auto-detect could pick a different provider whose
  // embeddings are incompatible with what's stored).
  const resolvedKind: "ollama" | "openai" | "bundled" | "hash" = activeEmbedder.name.startsWith("ollama:")
    ? "ollama"
    : activeEmbedder.name.startsWith("openai:")
      ? "openai"
      : activeEmbedder.name.startsWith("bundled:")
        ? "bundled"
        : "hash";
  // v1.30.0 HOTFIX (Bug #3) -- only persist model name for tiers where it's
  // actually a HuggingFace / vendor model id (ollama, openai). Pre-fix we
  // persisted "fnv-256" (hash embedder's internal name) into
  // cfg.embeddings.model, which the NEXT index run then passed to the
  // bundled embedder as a HuggingFace repo id -- producing the infamous
  // `huggingface.co/fnv-256/resolve/main/...` 404 the user reported.
  const resolvedModel = (resolvedKind === "ollama" || resolvedKind === "openai") && activeEmbedder.name.includes(":")
    ? activeEmbedder.name.split(":").slice(1).join(":")
    : undefined;
  // v1.30.0 -- if the persisted model already looks like a hash-tier leak
  // (e.g. "fnv-256", "fnv", anything without a slash), WIPE it so the next
  // run uses the bundled DEFAULT_MODEL ("Xenova/all-MiniLM-L6-v2").
  const looksLikeHashLeak = cfg.embeddings.model && !cfg.embeddings.model.includes("/") && /^(fnv|hash|sha)/i.test(cfg.embeddings.model);
  if (looksLikeHashLeak) {
    delete cfg.embeddings.model;
  }
  if (
    cfg.embeddings.provider !== resolvedKind ||
    (resolvedModel && cfg.embeddings.model !== resolvedModel) ||
    looksLikeHashLeak
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

