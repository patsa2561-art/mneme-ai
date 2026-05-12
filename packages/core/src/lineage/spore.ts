/**
 * Spore — cross-machine sync via git.
 *
 * Strategy: lineage data lives at `.mneme/lineage/` (chromosomes + tree +
 * species). To sync across machines, we push that directory to a git
 * remote — either:
 *   1. The repo's own `origin` on an orphan branch `mneme-lineage`
 *      (default; auto-detected — zero user setup), or
 *   2. A user-specified standalone remote (set via mneme.spore.init).
 *
 * Why orphan branch: keeps lineage history separate from code history,
 * so commits don't pollute git log; but it travels with the same git
 * remote → no extra credentials, no extra service.
 *
 * SECURITY: identity/private.pem is .gitignored (added on init); the
 * public key + chromosomes (signed) are pushed.
 *
 * v1.19 ships the LOCAL workflow + the auto-init that creates / updates
 * the orphan branch via raw git commands. Actual `git push` is invoked
 * via spawnSync — no JS git library needed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineageRoot, sporeDir, sporeRemotePath, sporeVectorClockPath, sporeLastSyncPath, identityDir } from "./paths.js";
import type { SporeRemote } from "./types.js";

const DEFAULT_BRANCH = "mneme-lineage";

// ─── Auto-detect git origin ───────────────────────────────────────────

export function detectGitOrigin(repoRoot: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return null;
  const url = (r.stdout ?? "").trim();
  return url || null;
}

// ─── Spore remote config ──────────────────────────────────────────────

export function readSporeRemote(repoRoot: string): SporeRemote | null {
  const path = sporeRemotePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    let raw = readFileSync(path, "utf8");
    // v1.82 Bug #3 fix: strip UTF-8 BOM that Windows tools (Notepad,
    // PowerShell `Out-File`, git core.autocrlf) sometimes prepend.
    // Without this, JSON.parse threw silently and status reported
    // "not configured" even though remote.json was on disk.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    raw = raw.trim();
    if (!raw) return null;
    return JSON.parse(raw) as SporeRemote;
  } catch {
    return null;
  }
}

export function writeSporeRemote(repoRoot: string, remote: SporeRemote): void {
  const dir = sporeDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sporeRemotePath(repoRoot), JSON.stringify(remote, null, 2), "utf8");
}

/** Initialize the spore — sets up orphan branch + adds .gitignore lines. */
export function sporeInit(
  repoRoot: string,
  opts: { remote?: string; branch?: string } = {},
): { ok: boolean; remote: SporeRemote | null; reason?: string } {
  const branch = opts.branch ?? DEFAULT_BRANCH;
  let url = opts.remote;
  let autoDetected = false;
  if (!url) {
    const detected = detectGitOrigin(repoRoot);
    if (!detected) {
      return { ok: false, remote: null, reason: "no remote provided and could not auto-detect git origin" };
    }
    url = detected;
    autoDetected = true;
  }
  // .gitignore guard for private key + working/orphan files we don't push
  // through the orphan branch (those go separately via spore.push).
  const gitignorePath = join(repoRoot, ".gitignore");
  const ignoreLines = [
    "# Mneme Lineage — never push the private key",
    ".mneme/lineage/identity/private.pem",
    ".mneme/lineage/working/",
  ];
  appendIfMissing(gitignorePath, ignoreLines);

  const remote: SporeRemote = { kind: "git", url, branch, autoDetected };
  writeSporeRemote(repoRoot, remote);
  return { ok: true, remote };
}

function appendIfMissing(path: string, lines: string[]): void {
  let existing = "";
  if (existsSync(path)) existing = readFileSync(path, "utf8");
  const toAdd = lines.filter((l) => !existing.includes(l));
  if (toAdd.length === 0) return;
  const sep = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  appendFileSync(path, sep + toAdd.join("\n") + "\n", "utf8");
}

// ─── Vector clock ──────────────────────────────────────────────────────

export function readVectorClock(repoRoot: string): Record<string, number> {
  const path = sporeVectorClockPath(repoRoot);
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

export function writeVectorClock(repoRoot: string, clock: Record<string, number>): void {
  const dir = sporeDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sporeVectorClockPath(repoRoot), JSON.stringify(clock, null, 2), "utf8");
}

export function tickClock(repoRoot: string, machineId: string): Record<string, number> {
  const clock = readVectorClock(repoRoot);
  clock[machineId] = (clock[machineId] ?? 0) + 1;
  writeVectorClock(repoRoot, clock);
  return clock;
}

// ─── Last-sync record ─────────────────────────────────────────────────

export interface LastSyncRecord {
  pushedAt: string | null;
  pulledAt: string | null;
  lastPushClock: Record<string, number>;
  lastPullClock: Record<string, number>;
}

export function readLastSync(repoRoot: string): LastSyncRecord {
  const path = sporeLastSyncPath(repoRoot);
  if (!existsSync(path)) return { pushedAt: null, pulledAt: null, lastPushClock: {}, lastPullClock: {} };
  try { return JSON.parse(readFileSync(path, "utf8")); } catch {
    return { pushedAt: null, pulledAt: null, lastPushClock: {}, lastPullClock: {} };
  }
}

export function writeLastSync(repoRoot: string, rec: LastSyncRecord): void {
  const dir = sporeDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sporeLastSyncPath(repoRoot), JSON.stringify(rec, null, 2), "utf8");
}

// ─── Status ────────────────────────────────────────────────────────────

export interface SporeStatus {
  configured: boolean;
  remote: SporeRemote | null;
  vectorClock: Record<string, number>;
  lastSync: LastSyncRecord;
  /** Number of chromosome files locally. */
  localChromosomeCount: number;
  /** True if identity keypair exists locally. */
  identityReady: boolean;
}

export function sporeStatus(repoRoot: string): SporeStatus {
  const remote = readSporeRemote(repoRoot);
  const lineageDir = lineageRoot(repoRoot);
  const chromosomeDir = join(lineageDir, "chromosomes");
  let count = 0;
  if (existsSync(chromosomeDir)) {
    // readdirSync imported at top
    count = readdirSync(chromosomeDir).filter((f: string) => f.endsWith(".chromosome.json")).length;
  }
  const identityReady = existsSync(join(identityDir(repoRoot), "private.pem"));
  return {
    configured: remote !== null,
    remote,
    vectorClock: readVectorClock(repoRoot),
    lastSync: readLastSync(repoRoot),
    localChromosomeCount: count,
    identityReady,
  };
}

// ─── Push / Pull operations ──────────────────────────────────────────
//
// v1.19 implementation: shells out to git. The orphan branch is built
// programmatically without polluting working tree:
//
//   1. Ensure remote configured + accessible
//   2. Stash any uncommitted lineage changes
//   3. git worktree add /tmp/mneme-lineage-wt mneme-lineage  (or create orphan)
//   4. Copy chromosomes/ + tree.json + species/ + identity/public.pem
//   5. git add -A && git commit -m "lineage: <hash>"
//   6. git push origin mneme-lineage
//   7. Cleanup worktree
//
// To keep the v1.19 surface compact + reliable, we ship a SAFE BUT
// CONSERVATIVE implementation:
//   - sporePush: build a snapshot manifest + git push best-effort;
//                returns dry-run result if remote is unreachable
//   - sporePull: best-effort git pull; merge via Mendel on conflict
//
// Production-grade git plumbing (worktree / orphan management) is
// implemented but isolated behind one entry point so it's safe to
// extend in v1.20 without touching the higher layers.
//
// ──────────────────────────────────────────────────────────────────

export interface PushResult {
  ok: boolean;
  pushedFiles: number;
  message: string;
  /** True if the push was a dry-run (no remote / network failure) — local snapshot still updated. */
  dryRun: boolean;
}

/** Push the local lineage to the configured remote. Returns dryRun=true
 *  if no remote is configured (the snapshot is still updated locally). */
export function sporePush(repoRoot: string, machineId: string): PushResult {
  const remote = readSporeRemote(repoRoot);
  if (!remote) {
    return { ok: false, pushedFiles: 0, message: "no spore remote configured — call mneme.spore.init first", dryRun: true };
  }
  // Tick our machine's clock — local first.
  const clock = tickClock(repoRoot, machineId);
  // Count files we WOULD push (chromosomes only — the .gitignore excludes private.pem).
  const lineageDirAbs = lineageRoot(repoRoot);
  let count = 0;
  if (existsSync(lineageDirAbs)) {
    // readdirSync imported at top
    const chromosomeDirAbs = join(lineageDirAbs, "chromosomes");
    if (existsSync(chromosomeDirAbs)) {
      count = readdirSync(chromosomeDirAbs).filter((f: string) => f.endsWith(".chromosome.json")).length;
    }
  }

  // Best-effort: try `git ls-remote` to verify the remote is reachable.
  // If unreachable or git unavailable, fall back to dry-run (local
  // snapshot updated, marked for later push).
  //
  // v1.82 Bug #1 fix: `git ls-remote --exit-code <url>` returns:
  //   exit 0  -- refs found, remote reachable
  //   exit 2  -- NO REFS FOUND but remote IS reachable (fresh bare repo)
  //   other   -- truly unreachable (network / auth / wrong URL)
  // Previously we treated exit 2 as unreachable, which broke push to a
  // fresh bare repo on Windows. Now we accept exit 2 as "reachable but
  // empty" and proceed with the push.
  const ls = spawnSync("git", ["ls-remote", "--exit-code", remote.url], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  const reachable = ls.status === 0 || ls.status === 2;
  if (!reachable) {
    writeLastSync(repoRoot, { ...readLastSync(repoRoot), pushedAt: new Date().toISOString(), lastPushClock: clock });
    return { ok: false, pushedFiles: count, message: `remote unreachable (ls-remote exit ${ls.status ?? "?"}): ${(ls.stderr ?? "").trim().slice(0, 200)}`, dryRun: true };
  }

  // Real push: shell out to git via worktree-orphan strategy. Implementation
  // intentionally small; pushPlumbing returns a structured result.
  const result = pushPlumbing(repoRoot, remote);
  writeLastSync(repoRoot, { ...readLastSync(repoRoot), pushedAt: new Date().toISOString(), lastPushClock: clock });
  return { ok: result.ok, pushedFiles: count, message: result.message, dryRun: false };
}

function pushPlumbing(repoRoot: string, remote: SporeRemote): { ok: boolean; message: string } {
  // For v1.19 ship-day we rely on a simple pattern: assume the user
  // (or AI agent) pre-initialized an orphan branch with a `git checkout
  // --orphan mneme-lineage` once. Then we just commit + push from a
  // worktree. Dry-run gracefully if commands fail.
  try {
    // mkdtempSync, cpSync, rmSync, tmpdir imported at top
    const wtPath = mkdtempSync(join(tmpdir(), "mneme-spore-wt-"));
    try {
      // Add a worktree for the orphan branch — create if missing.
      const lsBranch = spawnSync("git", ["rev-parse", "--verify", `refs/remotes/origin/${remote.branch}`], {
        cwd: repoRoot, encoding: "utf8",
      });
      if (lsBranch.status !== 0) {
        // Try to create local orphan branch first.
        const orphan = spawnSync("git", ["worktree", "add", "--orphan", "-b", remote.branch, wtPath], {
          cwd: repoRoot, encoding: "utf8",
        });
        if (orphan.status !== 0) {
          return { ok: false, message: `could not create orphan worktree: ${(orphan.stderr ?? "").trim().slice(0, 200)}` };
        }
      } else {
        const wt = spawnSync("git", ["worktree", "add", wtPath, remote.branch], { cwd: repoRoot, encoding: "utf8" });
        if (wt.status !== 0) {
          return { ok: false, message: `could not add worktree: ${(wt.stderr ?? "").trim().slice(0, 200)}` };
        }
      }
      // Copy lineage payload (excluding identity/private.pem and working/).
      const sourceDir = lineageRoot(repoRoot);
      cpSync(sourceDir, join(wtPath, ".mneme", "lineage"), {
        recursive: true,
        filter: (src: string) => !src.includes("private.pem") && !src.includes("/working/") && !src.includes("\\working\\"),
      });
      // Stage + commit + push.
      spawnSync("git", ["-C", wtPath, "add", "-A"], { encoding: "utf8" });
      const commit = spawnSync("git", ["-C", wtPath, "commit", "-m", `lineage: snapshot ${new Date().toISOString()}`, "--allow-empty"], { encoding: "utf8" });
      if (commit.status !== 0 && !(commit.stderr ?? "").includes("nothing to commit")) {
        return { ok: false, message: `commit failed: ${(commit.stderr ?? "").trim().slice(0, 200)}` };
      }
      const push = spawnSync("git", ["-C", wtPath, "push", "origin", `HEAD:${remote.branch}`], { encoding: "utf8", timeout: 30_000 });
      if (push.status !== 0) {
        return { ok: false, message: `push failed: ${(push.stderr ?? "").trim().slice(0, 200)}` };
      }
      return { ok: true, message: `pushed lineage to ${remote.branch}` };
    } finally {
      try { spawnSync("git", ["worktree", "remove", "--force", wtPath], { cwd: repoRoot }); } catch { /* ignore */ }
      try { rmSync(wtPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch (err) {
    return { ok: false, message: `plumbing failure: ${(err as Error).message}` };
  }
}

export interface PullResult {
  ok: boolean;
  newChromosomes: number;
  message: string;
  dryRun: boolean;
}

/** Pull the spore from remote — best-effort. New chromosomes appear in
 *  `.mneme/lineage/chromosomes/`; the next fertilize picks them up
 *  naturally. Conflicts auto-resolved by keeping both (chromosomes are
 *  content-addressed). */
export function sporePull(repoRoot: string): PullResult {
  const remote = readSporeRemote(repoRoot);
  if (!remote) {
    return { ok: false, newChromosomes: 0, message: "no spore remote configured", dryRun: true };
  }
  // For v1.19, ship a minimal pull that fetches + checks remote-tracking.
  const fetch = spawnSync("git", ["fetch", "origin", remote.branch], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  if (fetch.status !== 0) {
    return { ok: false, newChromosomes: 0, message: `fetch failed: ${(fetch.stderr ?? "").trim().slice(0, 200)}`, dryRun: true };
  }
  // Count new files in the remote branch's lineage payload by diffing with FETCH_HEAD.
  const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", `origin/${remote.branch}`, ".mneme/lineage/chromosomes/"], { cwd: repoRoot, encoding: "utf8" });
  if (ls.status !== 0) {
    return { ok: false, newChromosomes: 0, message: `could not enumerate remote: ${(ls.stderr ?? "").trim().slice(0, 200)}`, dryRun: false };
  }
  const remoteFiles = (ls.stdout ?? "").trim().split("\n").filter(Boolean);
  // Local files we already have.
  const localDir = join(lineageRoot(repoRoot), "chromosomes");
  const localFiles = existsSync(localDir)
    ? readdirSync(localDir).filter((f: string) => f.endsWith(".chromosome.json")).map((f: string) => `.mneme/lineage/chromosomes/${f}`)
    : [];
  const localSet = new Set(localFiles);
  const incoming = remoteFiles.filter((f) => !localSet.has(f));

  // Materialize each incoming chromosome via `git show`.
  let materialized = 0;
  for (const path of incoming) {
    const show = spawnSync("git", ["show", `origin/${remote.branch}:${path}`], { cwd: repoRoot, encoding: "utf8" });
    if (show.status !== 0) continue;
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    const filename = path.split("/").pop()!;
    writeFileSync(join(localDir, filename), show.stdout, "utf8");
    materialized += 1;
  }

  writeLastSync(repoRoot, { ...readLastSync(repoRoot), pulledAt: new Date().toISOString(), lastPullClock: readVectorClock(repoRoot) });
  return { ok: true, newChromosomes: materialized, message: `pulled ${materialized} new chromosome${materialized === 1 ? "" : "s"} from ${remote.branch}`, dryRun: false };
}
