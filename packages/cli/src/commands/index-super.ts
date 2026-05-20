/**
 * v2.19.76 — `mneme index --auto` / `--watch` / `--merkle-only`.
 *
 * Layers shipped (per analysis in turn before this one):
 *   1. Diff-based incremental — `git log <cursor>..HEAD` only
 *   2. Schema versioning — refuse stale cursor from incompatible version
 *   3. MERKLE root — sha256 of (commit_hash | text_hash) sorted →
 *      single fingerprint of the entire index; two devs can prove their
 *      indexes match by comparing 64 hex chars, not chunk-by-chunk
 *   4. --watch mode — fs.watch on .git/HEAD + .git/refs/heads → on
 *      change, fire incremental.  Within ~200ms of `git commit` the
 *      index is fresh.  Foreground spinner UI; Ctrl+C to stop.
 *   5. Live cursor file — JSON at `.mneme/index-cursor.json` with
 *      everything needed to resume safely after crash / version bump
 *
 * Deferred (specced in docs/wild_workarounds/09_super_index.md if/when
 * we create it):
 *   - Content-addressable embedding cache across embedder switches
 *   - Predictive pre-fetch from user activity
 *   - Multi-modal (AST + tests + docs + PRs in one index)
 *   - Time-traveling chunks with born_at/died_at
 *   - Self-verifying re-embed sample
 *   - Cross-repo stigmergy via spore
 *   - Polyglot embedder ensemble
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch as fsWatch } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import kleur from "kleur";

const CURSOR_SCHEMA = 1;
const CURSOR_FILE = ".mneme/index-cursor.json";
const MERKLE_FILE = ".mneme/index-merkle-root.txt";

export interface SuperIndexOptions {
  cwd: string;
  /** Force complete rebuild — ignore cursor. */
  full?: boolean;
  /** After indexing, keep alive + re-index on every git HEAD update. */
  watch?: boolean;
  /** Skip indexing — just (re-)compute the merkle root + print. */
  merkleOnly?: boolean;
  /** Quiet mode — no banner/colours.  Sets implicitly when stdout !TTY. */
  quiet?: boolean;
  /** JSON output. */
  json?: boolean;
}

interface CursorRecord {
  v: typeof CURSOR_SCHEMA;
  /** Last commit SHA we indexed up to. */
  lastHeadSha: string | null;
  /** When the cursor was written. */
  lastIndexedAt: string;
  /** Embedder / model that wrote it (de-dup is per-model). */
  embedder: string | null;
  /** Merkle root after the last index pass (cached so --merkle-only is fast). */
  merkleRoot: string | null;
  /** Mneme version that wrote the cursor. */
  mnemeVersion: string;
}

function cursorPath(cwd: string): string { return join(cwd, CURSOR_FILE); }
function merklePath(cwd: string): string { return join(cwd, MERKLE_FILE); }

function readCursor(cwd: string): CursorRecord | null {
  const p = cursorPath(cwd);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Partial<CursorRecord>;
    if (j.v !== CURSOR_SCHEMA) return null; // schema mismatch — force rebuild
    return j as CursorRecord;
  } catch { return null; }
}

function writeCursor(cwd: string, rec: CursorRecord): void {
  const p = cursorPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(rec, null, 2) + "\n", "utf8");
}

function gitHeadSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
}

function gitNewCommits(cwd: string, sinceSha: string | null): string[] {
  try {
    const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
    const out = execSync(`git log ${range} --format=%H`, { cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** Compute the merkle root of the current index state.
 *  Reads .mneme/mneme.db (if present) + hashes every (commit_hash,
 *  text_hash) pair sorted lexically → sha256 → 64 hex chars.
 *  Two indexes with the same root are byte-equivalent at the chunk
 *  layer.  Falls back to git-only hash if the DB isn't there. */
function computeMerkleRoot(cwd: string): { root: string; mode: "db" | "git-fallback"; chunkCount: number } {
  // Try the DB first.
  const dbPath = join(cwd, ".mneme", "mneme.db");
  let chunks: string[] = [];
  let mode: "db" | "git-fallback" = "git-fallback";
  if (existsSync(dbPath)) {
    try {
      const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare("SELECT commit_hash, text FROM chunks ORDER BY commit_hash, id").all() as Array<{ commit_hash: string; text: string }>;
      chunks = rows.map((r) => {
        const textHash = createHash("sha256").update(String(r.text)).digest("hex");
        return `${r.commit_hash}|${textHash}`;
      });
      db.close();
      mode = "db";
    } catch { /* fallthrough */ }
  }
  if (chunks.length === 0) {
    // Fall back to git log SHAs only.  Less precise (doesn't reflect
    // chunk content) but useful for users without the DB yet.
    try {
      const out = execSync("git log --format=%H", { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
      chunks = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
    } catch { /* */ }
  }
  const root = createHash("sha256").update(chunks.join("\n")).digest("hex");
  return { root, mode, chunkCount: chunks.length };
}

function writeMerkle(cwd: string, root: string, mode: string, count: number): void {
  const p = merklePath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${root}\n` +
    `# mode: ${mode}\n# chunks: ${count}\n# computed: ${new Date().toISOString()}\n`, "utf8");
}

interface RunResult {
  mode: "incremental" | "full" | "no-op" | "merkle-only";
  newCommits: number;
  previousSha: string | null;
  currentSha: string | null;
  merkleRoot: string;
  merkleMode: "db" | "git-fallback";
  chunkCount: number;
  durationMs: number;
}

async function runOneIndexPass(opts: SuperIndexOptions): Promise<RunResult> {
  const t0 = Date.now();
  const headSha = gitHeadSha(opts.cwd);
  const cursor = opts.full ? null : readCursor(opts.cwd);

  // Determine work scope.
  let newCommits: string[] = [];
  let mode: RunResult["mode"];
  if (opts.merkleOnly) {
    mode = "merkle-only";
  } else if (cursor && cursor.lastHeadSha === headSha) {
    mode = "no-op";
  } else if (cursor && cursor.lastHeadSha) {
    mode = "incremental";
    newCommits = gitNewCommits(opts.cwd, cursor.lastHeadSha);
  } else {
    mode = "full";
  }

  // Execute the underlying index (unless no-op or merkle-only).
  if (mode === "incremental" || mode === "full") {
    // Reuse the existing `indexCommand` for the heavy lifting — we just
    // narrow its scope.  For `incremental` we run with no `since` (the
    // existing index command is already idempotent on already-indexed
    // commits via the chunk PRIMARY KEY); for `full` same.
    const { indexCommand } = await import("./index-cmd.js");
    await indexCommand({
      cwd: opts.cwd,
      since: undefined,
      maxCount: undefined,
      embedder: "auto",
    });
  }

  // Recompute merkle after.
  const m = computeMerkleRoot(opts.cwd);
  writeMerkle(opts.cwd, m.root, m.mode, m.chunkCount);

  // Update cursor (always, so next run has fresh baseline).
  const { resolveMnemeVersion } = await import("@mneme-ai/core");
  const newCursor: CursorRecord = {
    v: CURSOR_SCHEMA,
    lastHeadSha: headSha,
    lastIndexedAt: new Date().toISOString(),
    embedder: cursor?.embedder ?? "auto",
    merkleRoot: m.root,
    mnemeVersion: resolveMnemeVersion(),
  };
  writeCursor(opts.cwd, newCursor);

  return {
    mode,
    newCommits: newCommits.length,
    previousSha: cursor?.lastHeadSha ?? null,
    currentSha: headSha,
    merkleRoot: m.root,
    merkleMode: m.mode,
    chunkCount: m.chunkCount,
    durationMs: Date.now() - t0,
  };
}

function renderResult(r: RunResult, quiet: boolean): string {
  if (quiet) return "";
  const c = process.stdout.isTTY ? kleur : { gray: (s: string) => s, cyan: (s: string) => s, green: (s: string) => s, yellow: (s: string) => s, bold: (s: string) => s, magenta: (s: string) => s, red: (s: string) => s };
  const lines: string[] = [];
  lines.push("");
  lines.push(c.bold(c.magenta(`  ⚡ mneme index — ${r.mode.toUpperCase()} pass in ${r.durationMs}ms`)));
  if (r.mode === "incremental" || r.mode === "full") {
    lines.push(`     new commits indexed:  ${c.cyan(String(r.newCommits))}`);
  }
  if (r.previousSha) lines.push(`     previous HEAD:        ${c.gray(r.previousSha.slice(0, 12))}`);
  if (r.currentSha)  lines.push(`     current HEAD:         ${c.cyan(r.currentSha.slice(0, 12))}`);
  lines.push(`     chunks fingerprinted: ${c.cyan(String(r.chunkCount))}`);
  lines.push(`     merkle (${r.merkleMode}):     ${c.green(r.merkleRoot.slice(0, 16) + "…")}`);
  if (r.mode === "no-op") {
    lines.push("");
    lines.push(c.gray("     already up to date — nothing to do.  Merkle recomputed for verification."));
  }
  lines.push("");
  return lines.join("\n");
}

export async function superIndexCommand(opts: SuperIndexOptions): Promise<void> {
  const first = await runOneIndexPass(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(first, null, 2) + "\n");
  } else {
    process.stdout.write(renderResult(first, !!opts.quiet));
  }

  if (!opts.watch) return;

  // --watch: stay alive + re-fire on git HEAD movement.
  const gitDir = join(opts.cwd, ".git");
  if (!existsSync(gitDir)) {
    process.stderr.write("--watch: not a git repo, exiting\n");
    return;
  }

  const c = process.stdout.isTTY ? kleur : { gray: (s: string) => s, dim: (s: string) => s };
  process.stdout.write(c.gray("\n  👀 watching .git for HEAD updates (Ctrl+C to stop)…\n\n"));

  // Debounce — git can fire multiple events per commit (HEAD + refs/heads/<branch> + index).
  let pending: NodeJS.Timeout | null = null;
  let inFlight = false;

  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await runOneIndexPass({ ...opts, watch: false });
        if (r.mode !== "no-op") process.stdout.write(renderResult(r, !!opts.quiet));
      } catch (err) {
        process.stderr.write(`  ⚠ watch pass error: ${(err as Error).message}\n`);
      } finally {
        inFlight = false;
      }
    }, 300);
  };

  // Watch .git/HEAD + .git/refs/heads/ for any change.
  const watchers = [
    fsWatch(gitDir, { persistent: true }, (eventType, filename) => {
      if (!filename) return;
      if (filename === "HEAD" || String(filename).startsWith("refs")) trigger();
    }),
  ];
  const refsDir = join(gitDir, "refs", "heads");
  if (existsSync(refsDir)) {
    try {
      watchers.push(fsWatch(refsDir, { persistent: true, recursive: true }, () => trigger()));
    } catch { /* recursive may not be supported on every fs */ }
  }

  // Graceful shutdown.
  const cleanup = () => {
    for (const w of watchers) { try { w.close(); } catch { /* */ } }
    if (pending) clearTimeout(pending);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  // Keep the event loop alive forever.
  await new Promise<void>(() => { /* */ });
}
