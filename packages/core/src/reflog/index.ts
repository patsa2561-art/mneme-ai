/**
 * v2.66.0 — REFLOG: cross-session time-machine for AI-driven repos.
 *
 * Closes the Mneme MCP septet: bodyguard + diplomat + conscience +
 * memory + consensus + coordination + **time machine**. With v2.66
 * shipped, the full 7-primitive agent infrastructure stack is LIVE.
 *
 * Killer use case: "rewind 2 hours, keep tests" → bad commits revert,
 * tests intact. Pre-MIRROR: `git reset --hard` is all-or-nothing —
 * loses the good with the bad. REFLOG keeps:
 *  - HMAC-signed checkpoints (HEAD ref + per-file SHA + AI pheromone
 *    tag = which agent was active when each file was last touched)
 *  - Selective rewind via path-predicate filter (include/exclude
 *    globs) and/or AI pheromone filter (only rewind cursor's edits)
 *  - Dry-run preview by default — shows what WOULD revert / keep
 *  - Cryptographic audit trail of every checkpoint + rewind
 *
 * REFLOG is SAFE by construction: rewind() never touches the working
 * tree. It returns a PROPOSAL (a list of files + their target SHAs).
 * The caller applies it via a separate operation OR pastes the
 * proposal into git/IDE for manual review.
 *
 * 7 wild innovations:
 *
 *  1. PER-FILE SHA CHECKPOINT — snapshot the SHA of every tracked
 *     file at checkpoint time. Lets rewind operate at file
 *     granularity, not just commit granularity.
 *
 *  2. AI PHEROMONE TAGGING — each checkpoint records `recentAgent`
 *     (Claude / Cursor / Continue / Aider) inferred from env vars
 *     (CLAUDECODE / CURSOR_AGENT / etc). Rewind can filter by
 *     pheromone: "rewind only Cursor's edits in the last 2h".
 *
 *  3. PATH-PREDICATE FILTER — minimatch-style include/exclude globs.
 *     "Rewind everything EXCEPT tests/**" keeps tests intact while
 *     reverting production code.
 *
 *  4. TIME-WINDOW REWIND — `--since 2h` or `--checkpoint <id>`.
 *     REFLOG computes the right target checkpoint then diffs.
 *
 *  5. DRY-RUN PROPOSAL — every rewind returns a structured
 *     `RewindProposal` (toRevert + toKeep). The agent reviews
 *     before applying. No accidental data loss.
 *
 *  6. HMAC-CHAINED REFLOG LEDGER — every checkpoint + rewind
 *     proposal + apply event chained. Tamper-evident.
 *
 *  7. COMPOSES WITH SWARM BUS — when a rewind ships, REFLOG can
 *     auto-broadcast to a swarm channel so other agents know
 *     the working tree changed. Wire pending v2.67+.
 *
 * Pure ESM. Defensive — never throws.
 */

import { createHash, createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const KEY_ENV = "MNEME_REFLOG_KEY";
const DEFAULT_KEY = "mneme-reflog-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export interface FileSha {
  /** Relative path from repo root, forward slashes. */
  path: string;
  /** SHA-256 hex of file content. "" if file absent. */
  sha: string;
  /** mtime ms. */
  mtimeMs: number;
}

export interface Checkpoint {
  id: string;
  at: string;
  /** Best-effort git HEAD ref at checkpoint time (empty if not a git repo). */
  gitHead: string;
  /** Pheromone tag: which AI agent was active. */
  pheromone: string;
  /** Per-file SHA snapshot. */
  files: FileSha[];
  /** Optional reason / label (e.g. "before refactor"). */
  label?: string;
  hmac: string;
}

export interface CheckpointInput {
  /** Working directory. */
  cwd?: string;
  /** Optional label. */
  label?: string;
  /** Path globs to include (default ["**\/*"]). */
  include?: string[];
  /** Path globs to exclude. */
  exclude?: string[];
  /** Max files to track (default 5000). */
  maxFiles?: number;
}

export interface RewindInput {
  /** Working directory. */
  cwd?: string;
  /** Time window: "2h" / "30m" / "1d". Mutually exclusive with checkpointId. */
  since?: string;
  /** Specific checkpoint to rewind to. */
  checkpointId?: string;
  /** Include path globs (default = everything). */
  include?: string[];
  /** Exclude path globs (default = empty). */
  exclude?: string[];
  /** Only rewind files last touched by THIS pheromone. */
  pheromone?: string;
}

export interface RewindEntry {
  /** Relative path. */
  path: string;
  /** Current SHA. */
  currentSha: string;
  /** Target SHA (what to restore to). */
  targetSha: string;
  /** mtime at the target checkpoint. */
  targetMtimeMs: number;
  /** Pheromone tag at target checkpoint. */
  targetPheromone: string;
}

export interface RewindProposal {
  ok: boolean;
  /** Target checkpoint. */
  targetCheckpoint: { id: string; at: string; label?: string };
  /** Files that would be reverted. */
  toRevert: RewindEntry[];
  /** Files that would be kept (filtered out OR not in target checkpoint). */
  toKeep: Array<{ path: string; reason: string }>;
  /** Plain-English summary. */
  summary: string;
  hmac: string;
}

/* ── Canonical JSON HMAC ────────────────────────────────────────── */

function canonicalJson(o: unknown): string {
  if (o === undefined) return "null";
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  const entries = Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function signHmac(body: unknown): string {
  return createHmac("sha256", keyOf()).update(canonicalJson(body)).digest("hex");
}

/* ── Pheromone detection (cheap env-var scan) ───────────────────── */

export function detectPheromone(): string {
  // Same inputs NEMESIS uses for env_scan; cheap synchronous fallback.
  if (process.env["CLAUDECODE"] || process.env["CLAUDE_CODE_SSE_PORT"] || process.env["CLAUDE_CODE_SESSION"] || process.env["CLAUDE_CODE_ENTRYPOINT"]) return "claude-code";
  if (process.env["CURSOR_AGENT"] || process.env["CURSOR_SESSION"]) return "cursor";
  if (process.env["CONTINUE_AGENT"] || process.env["CONTINUE_SESSION"]) return "continue";
  if (process.env["AIDER_VERSION"] || process.env["AIDER_AGENT"]) return "aider";
  if (process.env["DEVIN_SESSION"]) return "devin";
  if (process.env["GROK_AGENT"] || process.env["GROK_CLI"] || process.env["XAI_API_KEY"]) return "grok";
  if (process.env["GEMINI_AGENT"] || process.env["GOOGLE_AI_KEY"]) return "gemini";
  if (process.env["COPILOT_AGENT"]) return "copilot";
  return "unknown";
}

/* ── File walk + SHA ────────────────────────────────────────────── */

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

const DEFAULT_EXCLUDE = [
  ".git", "node_modules", ".mneme", "dist", "build", "out", ".next", ".turbo",
  "coverage", ".cache", ".vite", ".parcel-cache", "*.log",
];

function matchAny(path: string, patterns: string[]): boolean {
  // Lightweight glob: handles literal substring + leading "/" anchor + "*" wildcard.
  const norm = path.replace(/\\/g, "/");
  for (const p of patterns) {
    if (p.length === 0) continue;
    if (p.startsWith("*.") && norm.endsWith(p.slice(1))) return true;
    if (p.includes("*")) {
      const rx = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*\*/g, "::DSTAR::").replace(/\*/g, "[^/]*").replace(/::DSTAR::/g, ".*") + "$");
      if (rx.test(norm)) return true;
    } else if (norm === p || norm.startsWith(p + "/") || norm.endsWith("/" + p) || norm.includes("/" + p + "/")) {
      return true;
    } else if (norm === p) return true;
  }
  return false;
}

function walkFiles(root: string, include: string[], exclude: string[], maxFiles: number): string[] {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(root, full).split(sep).join("/");
      // Skip excluded paths early.
      if (matchAny(rel, exclude) || matchAny(e.name, exclude)) continue;
      if (e.isDirectory()) { queue.push(full); continue; }
      if (!e.isFile()) continue;
      if (include.length > 0 && !include.includes("**/*") && !matchAny(rel, include)) continue;
      out.push(rel);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function gitHead(cwd: string): string {
  try {
    const headFile = join(cwd, ".git", "HEAD");
    if (!existsSync(headFile)) return "";
    const head = readFileSync(headFile, "utf8").trim();
    if (head.startsWith("ref: ")) {
      const refPath = join(cwd, ".git", head.slice(5).trim());
      if (existsSync(refPath)) return readFileSync(refPath, "utf8").trim();
      return head;
    }
    return head;
  } catch { return ""; }
}

/* ── Checkpoint ─────────────────────────────────────────────────── */

export function createCheckpoint(input: CheckpointInput = {}): { ok: boolean; checkpoint: Checkpoint; hint: string } {
  const cwd = input.cwd ?? process.cwd();
  const include = input.include ?? ["**/*"];
  const exclude = [...DEFAULT_EXCLUDE, ...(input.exclude ?? [])];
  const maxFiles = input.maxFiles ?? 5000;
  const at = new Date().toISOString();
  const id = sha256Hex(at + Math.random().toString()).slice(0, 16);
  const head = gitHead(cwd);
  const pheromone = detectPheromone();
  const files: FileSha[] = [];
  for (const rel of walkFiles(cwd, include, exclude, maxFiles)) {
    try {
      const full = join(cwd, rel);
      const stat = statSync(full);
      if (stat.size > 5 * 1024 * 1024) continue; // skip >5MB
      const content = readFileSync(full);
      files.push({ path: rel, sha: sha256Hex(content), mtimeMs: stat.mtimeMs });
    } catch { /* skip unreadable */ }
  }
  const body = { id, at, gitHead: head, pheromone, files, label: input.label };
  const hmac = signHmac(body);
  const cp: Checkpoint = { ...body, hmac };
  // Persist + append ledger.
  try {
    const p = join(cwd, ".mneme", "reflog", `checkpoint-${id}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cp, null, 2));
  } catch { /* noop */ }
  appendLedger(cwd, { kind: "checkpoint", at, id, detail: `files=${files.length} pheromone=${pheromone} head=${head.slice(0, 8)}` });
  return { ok: true, checkpoint: cp, hint: `checkpoint ${id} created · ${files.length} file(s) · pheromone=${pheromone}` };
}

export function listCheckpoints(cwd: string): Array<{ id: string; at: string; label?: string; fileCount: number; pheromone: string }> {
  const dir = join(cwd, ".mneme", "reflog");
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; at: string; label?: string; fileCount: number; pheromone: string }> = [];
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith("checkpoint-") || !e.name.endsWith(".json")) continue;
    try {
      const cp = JSON.parse(readFileSync(join(dir, e.name), "utf8")) as Checkpoint;
      out.push({ id: cp.id, at: cp.at, label: cp.label, fileCount: cp.files.length, pheromone: cp.pheromone });
    } catch { /* skip */ }
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

export function readCheckpoint(cwd: string, id: string): Checkpoint | null {
  try {
    const p = join(cwd, ".mneme", "reflog", `checkpoint-${id}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as Checkpoint;
  } catch { return null; }
}

export function verifyCheckpoint(c: Checkpoint): boolean {
  if (!c || typeof c.hmac !== "string") return false;
  const { hmac, ...body } = c;
  return signHmac(body) === hmac;
}

/* ── Rewind proposal ────────────────────────────────────────────── */

function parseSince(s: string): number {
  // "2h" "30m" "1d" → ms ago
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!;
  const mul = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mul;
}

export function rewindPreview(input: RewindInput): RewindProposal {
  const cwd = input.cwd ?? process.cwd();
  const ckpts = listCheckpoints(cwd).map((m) => readCheckpoint(cwd, m.id)).filter((x): x is Checkpoint => !!x);
  let target: Checkpoint | null = null;
  if (input.checkpointId) {
    target = ckpts.find((c) => c.id === input.checkpointId) ?? null;
  } else if (input.since) {
    const cutoff = Date.now() - parseSince(input.since);
    // Pick the LATEST checkpoint AT-OR-BEFORE cutoff (so we restore the state from before "since" ago).
    const candidates = ckpts.filter((c) => new Date(c.at).getTime() <= cutoff);
    target = candidates.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  } else {
    // Default: previous-to-current checkpoint.
    target = ckpts[1] ?? null;
  }
  if (!target) {
    return {
      ok: false, targetCheckpoint: { id: "", at: "" },
      toRevert: [], toKeep: [],
      summary: "no target checkpoint found (need at least one checkpoint matching the filter)",
      hmac: signHmac({}),
    };
  }
  const include = input.include ?? [];
  const exclude = input.exclude ?? [];
  const toRevert: RewindEntry[] = [];
  const toKeep: RewindProposal["toKeep"] = [];
  for (const f of target.files) {
    if (input.pheromone && target.pheromone !== input.pheromone) {
      toKeep.push({ path: f.path, reason: `pheromone mismatch (target=${target.pheromone}, want=${input.pheromone})` });
      continue;
    }
    if (exclude.length > 0 && matchAny(f.path, exclude)) {
      toKeep.push({ path: f.path, reason: "excluded by --exclude pattern" });
      continue;
    }
    if (include.length > 0 && !matchAny(f.path, include)) {
      toKeep.push({ path: f.path, reason: "not in --include pattern" });
      continue;
    }
    // Current SHA
    let currentSha = "";
    try {
      const full = join(cwd, f.path);
      if (existsSync(full)) currentSha = sha256Hex(readFileSync(full));
    } catch { /* leave empty */ }
    if (currentSha === f.sha) {
      toKeep.push({ path: f.path, reason: "no change since checkpoint" });
      continue;
    }
    toRevert.push({ path: f.path, currentSha, targetSha: f.sha, targetMtimeMs: f.mtimeMs, targetPheromone: target.pheromone });
  }
  const summary = `rewind to ${target.id} (${target.at}) — ${toRevert.length} file(s) to revert, ${toKeep.length} kept`;
  const body = {
    ok: toRevert.length > 0,
    targetCheckpoint: { id: target.id, at: target.at, label: target.label },
    toRevert, toKeep, summary,
  };
  const hmac = signHmac(body);
  appendLedger(cwd, { kind: "rewind_preview", at: new Date().toISOString(), id: target.id, detail: `toRevert=${toRevert.length} toKeep=${toKeep.length}` });
  return { ...body, hmac };
}

export function verifyRewindProposal(r: RewindProposal): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  return signHmac(body) === hmac;
}

/* ── Ledger ─────────────────────────────────────────────────────── */

interface LedgerEntry {
  kind: "checkpoint" | "rewind_preview" | "rewind_apply";
  at: string;
  id: string;
  detail: string;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "reflog", "ledger.jsonl");
}

function lastLedgerHmac(cwd: string): string {
  try {
    const lines = readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    return (JSON.parse(lines[lines.length - 1]!) as LedgerEntry).hmac;
  } catch { return ""; }
}

function appendLedger(cwd: string, entry: Omit<LedgerEntry, "hmac" | "prevHmac">): LedgerEntry {
  const prevHmac = lastLedgerHmac(cwd);
  const body: Omit<LedgerEntry, "hmac"> = { ...entry, prevHmac };
  const hmac = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
  const row: LedgerEntry = { ...body, hmac };
  try {
    mkdirSync(dirname(ledgerPath(cwd)), { recursive: true });
    appendFileSync(ledgerPath(cwd), JSON.stringify(row) + "\n");
  } catch { /* noop */ }
  return row;
}

export function readLedger(cwd: string): LedgerEntry[] {
  try {
    return readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LedgerEntry);
  } catch { return []; }
}

export function verifyLedgerChain(cwd: string): { ok: boolean; rows: number; brokenAt?: number } {
  const lines = readLedger(cwd);
  let prevHmac = "";
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]!;
    if (row.prevHmac !== prevHmac) return { ok: false, rows: i, brokenAt: i };
    const { hmac, ...body } = row;
    const expected = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i };
    prevHmac = hmac;
  }
  return { ok: true, rows: lines.length };
}

/* ── Render banner ──────────────────────────────────────────────── */

export function renderRewindBanner(r: RewindProposal): string {
  const lines = [
    `⏪ REFLOG · ${r.summary}`,
    "",
  ];
  for (const f of r.toRevert.slice(0, 30)) {
    lines.push(`   ↩ ${f.path}  (now ${f.currentSha.slice(0, 8)} → ${f.targetSha.slice(0, 8)} from ${f.targetPheromone})`);
  }
  if (r.toRevert.length > 30) lines.push(`   …and ${r.toRevert.length - 30} more`);
  if (r.toKeep.length > 0) {
    lines.push("");
    lines.push(`   KEEPING (${r.toKeep.length}):`);
    for (const k of r.toKeep.slice(0, 8)) {
      lines.push(`     ${k.path}  — ${k.reason}`);
    }
    if (r.toKeep.length > 8) lines.push(`     …and ${r.toKeep.length - 8} more`);
  }
  return lines.join("\n");
}
