/**
 * v2.45.0 — RETROACTIVE CLEANSE (closes caveat #2).
 *
 * The bug: "ถ้า repo ลูกค้าเคย commit ไฟล์เหล่านี้ก่อนติด Mneme,
 * .gitignore ใหม่ จะ block ของใหม่ — แต่ของเก่าใน history ยังอยู่".
 *
 * AI-fingerprint files (CLAUDE.md / AGENTS.md / .cursorrules /
 * .windsurfrules / .mneme/) committed BEFORE Mneme install stay in git
 * history forever. The user shouldn't have to remember `git filter-repo`.
 *
 * Fix: a single MCP tool the AI agent can invoke on the user's behalf.
 * Three modes (DRY-RUN default):
 *
 *   scan         — read-only; lists AI-fingerprint files seen in git history
 *   uncommit     — runs `git rm --cached <file>` (SAFE: keeps disk copy,
 *                  history stays; future commits won't track)
 *   filter-repo  — destructive history rewrite via `git filter-repo`
 *                  (requires confirm:true; emits HMAC receipt)
 *
 * Pure-defensive: never throws; returns structured envelope every time.
 */

import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HMAC_KEY = process.env["MNEME_CLEANSE_KEY"] ?? "MNEME-RETROACTIVE-CLEANSE-DEFAULT-KEY-v2.45";

// What we scrub.
const FINGERPRINTS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
  "GEMINI.md",
  ".continuerc",
  ".aider.conf.yml",
  ".aider.chat.history.md",
  ".aider.input.history",
  ".mneme",
  ".cursor",
  ".windsurf",
];

export type CleanseMode = "scan" | "uncommit" | "filter-repo";

export interface CleanseFinding {
  path: string;
  /** First commit (oldest) where this file appears. */
  firstCommit?: string;
  /** Most recent commit touching it. */
  lastCommit?: string;
  /** Number of commits that touched it. */
  commitCount: number;
  /** Whether file is also in current working tree. */
  inWorkingTree: boolean;
}

export interface CleanseAction {
  path: string;
  command: string;
  executed: boolean;
  ok?: boolean;
  stderr?: string;
}

export interface CleanseResult {
  ok: boolean;
  mode: CleanseMode;
  dryRun: boolean;
  /** Files matched by scan. */
  findings: CleanseFinding[];
  /** Planned commands (always populated; in dryRun NONE executed). */
  plan: string[];
  /** Executed commands (empty when dryRun=true). */
  actions: CleanseAction[];
  /** Why ok=false. */
  reason?: string;
  /** HMAC over (mode + repoRoot + findings + actions) for audit trail. */
  hmac?: string;
  /** Wall ms. */
  dtMs: number;
}

function git(cwd: string, args: string[], timeoutMs = 20_000): { status: number; stdout: string; stderr: string } {
  try {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (e) {
    return { status: -1, stdout: "", stderr: (e as Error).message };
  }
}

function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

function scanHistory(cwd: string): CleanseFinding[] {
  const out: CleanseFinding[] = [];
  // List all distinct paths in history.
  const r = git(cwd, ["log", "--all", "--name-only", "--pretty=format:%H"]);
  if (r.status !== 0) return out;
  const lines = r.stdout.split("\n");
  // Build: path → { commits[] }
  const perPath = new Map<string, { commits: string[]; first?: string; last?: string }>();
  let currentCommit = "";
  for (const ln of lines) {
    if (!ln.trim()) continue;
    if (/^[0-9a-f]{40}$/.test(ln.trim())) { currentCommit = ln.trim(); continue; }
    // ln is a path. Check fingerprint match.
    const p = ln.trim();
    const matched = FINGERPRINTS.some((f) => p === f || p.startsWith(f + "/") || p.endsWith("/" + f));
    if (!matched) continue;
    const entry = perPath.get(p) ?? { commits: [] };
    entry.commits.push(currentCommit);
    if (!entry.first) entry.first = currentCommit;
    entry.last = currentCommit;
    perPath.set(p, entry);
  }
  for (const [path, e] of perPath) {
    out.push({
      path,
      firstCommit: e.last,    // oldest = last seen (git log is newest-first)
      lastCommit: e.first,    // newest = first seen
      commitCount: e.commits.length,
      inWorkingTree: existsSync(join(cwd, path)),
    });
  }
  return out;
}

function appendReceipt(repoRoot: string, body: object): string {
  const sig = createHmac("sha256", HMAC_KEY).update(JSON.stringify(body)).digest("hex").slice(0, 32);
  try {
    const dir = join(repoRoot, ".mneme", "auto_init");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "cleanse-receipts.jsonl");
    appendFileSync(path, JSON.stringify({ ...body, hmac: sig, at: new Date().toISOString(), id: randomBytes(6).toString("hex") }) + "\n");
  } catch { /* best-effort */ }
  return sig;
}

export interface CleanseInput {
  repoRoot: string;
  mode: CleanseMode;
  /** Default TRUE for safety. Pass false to actually mutate. */
  dryRun?: boolean;
  /** Required true when mode='filter-repo' (destructive history rewrite). */
  confirm?: boolean;
}

export function cleanse(input: CleanseInput): CleanseResult {
  const t0 = Date.now();
  const dryRun = input.dryRun !== false; // default TRUE
  const empty: CleanseResult = {
    ok: false, mode: input.mode, dryRun, findings: [], plan: [], actions: [], dtMs: 0,
  };
  if (!input.repoRoot) return { ...empty, reason: "empty repoRoot", dtMs: Date.now() - t0 };
  if (!existsSync(input.repoRoot)) return { ...empty, reason: "repoRoot not found", dtMs: Date.now() - t0 };
  if (!isGitRepo(input.repoRoot)) return { ...empty, reason: "not a git repo", dtMs: Date.now() - t0 };

  const findings = scanHistory(input.repoRoot);
  if (input.mode === "scan") {
    const hmac = appendReceipt(input.repoRoot, { mode: "scan", findings });
    return { ok: true, mode: "scan", dryRun: true, findings, plan: [], actions: [], hmac, dtMs: Date.now() - t0 };
  }
  // v2.45.0 SAFETY: filter-repo requires explicit confirm BEFORE any
  // early returns (even no-findings) — protect users from accidentally
  // invoking the destructive mode without realizing.
  if (input.mode === "filter-repo" && !input.confirm) {
    return {
      ok: false,
      mode: "filter-repo",
      dryRun,
      findings,
      plan: findings.map((f) => `git filter-repo --invert-paths --path "${f.path}"`),
      actions: [],
      reason: "filter-repo is destructive — pass confirm:true after reviewing the plan (this check fires even with 0 findings as a safety guard)",
      dtMs: Date.now() - t0,
    };
  }
  if (findings.length === 0) {
    return { ok: true, mode: input.mode, dryRun, findings: [], plan: [], actions: [], dtMs: Date.now() - t0 };
  }
  if (input.mode === "uncommit") {
    const plan = findings.map((f) => `git rm --cached -r --ignore-unmatch -- "${f.path}"`);
    if (dryRun) return { ok: true, mode: "uncommit", dryRun: true, findings, plan, actions: [], dtMs: Date.now() - t0 };
    const actions: CleanseAction[] = [];
    for (const f of findings) {
      const args = ["rm", "--cached", "-r", "--ignore-unmatch", "--", f.path];
      const r = git(input.repoRoot, args);
      actions.push({
        path: f.path,
        command: "git " + args.join(" "),
        executed: true,
        ok: r.status === 0,
        stderr: r.status === 0 ? undefined : r.stderr.slice(0, 200),
      });
    }
    const hmac = appendReceipt(input.repoRoot, { mode: "uncommit", findings, actions });
    return { ok: true, mode: "uncommit", dryRun: false, findings, plan, actions, hmac, dtMs: Date.now() - t0 };
  }
  // filter-repo mode (destructive history rewrite — confirm pre-checked above)
  if (input.mode === "filter-repo") {
    const plan = findings.map((f) => `git filter-repo --invert-paths --path "${f.path}"`);
    if (dryRun) {
      return { ok: true, mode: "filter-repo", dryRun: true, findings, plan, actions: [], dtMs: Date.now() - t0 };
    }
    // Detect git-filter-repo availability.
    const detect = git(input.repoRoot, ["filter-repo", "--version"]);
    if (detect.status !== 0) {
      return {
        ok: false,
        mode: "filter-repo",
        dryRun: false,
        findings,
        plan,
        actions: [],
        reason: "git-filter-repo not installed. Install via `pip install git-filter-repo`. Falling back to uncommit mode is recommended.",
        dtMs: Date.now() - t0,
      };
    }
    const actions: CleanseAction[] = [];
    for (const f of findings) {
      const args = ["filter-repo", "--invert-paths", "--path", f.path, "--force"];
      const r = git(input.repoRoot, args, 60_000);
      actions.push({
        path: f.path,
        command: "git " + args.join(" "),
        executed: true,
        ok: r.status === 0,
        stderr: r.status === 0 ? undefined : r.stderr.slice(0, 200),
      });
    }
    const hmac = appendReceipt(input.repoRoot, { mode: "filter-repo", findings, actions });
    return { ok: true, mode: "filter-repo", dryRun: false, findings, plan, actions, hmac, dtMs: Date.now() - t0 };
  }
  return { ...empty, reason: `unknown mode: ${input.mode}`, dtMs: Date.now() - t0 };
}
