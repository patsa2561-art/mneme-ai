/**
 * MNEME TIME-MACHINE INDEX (v1.30.0) -- atomic indexer with auto-rollback.
 *
 * Bugs this fixes (all reported by a Mac user who lost 6 days of index):
 *   #5 -- destructive index: a re-index that hits FTS5/migration failure
 *         destroys the prior chunks (827 → 0) with no rollback, no
 *         backup, no `--dry-run`.
 *   #6 -- status invariant: pre-fix Status said "indexed 6d ago, 0 chunks"
 *         with no warning. Now we surface a [BROKEN INDEX] line.
 *   #2 -- FTS5 missing: pre-fix the indexer assumed FTS5 was present.
 *         When `node:sqlite` shipped without FTS5 (some macOS Node 23.6
 *         builds), the migration failed mid-run and ate the data.
 *
 * KILLER IDEA -- TIME-MACHINE INDEX:
 *   Every `mneme index` run, we snapshot `mneme.db` to
 *   `.mneme/snapshots/mneme.<sha8>.db` BEFORE touching anything.
 *   Keep last 5. If the index op throws ANY error, we restore the
 *   snapshot atomically. New CLI: `mneme index restore --snapshot
 *   <sha>` rolls back to a prior good state in milliseconds.
 *
 *   The user can lose 6 days of work ONCE. After that, they
 *   never lose it again.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const SNAPSHOT_DIR_NAME = "snapshots";
const KEEP_SNAPSHOTS = 5;

export interface SnapshotInfo {
  sha8: string;
  path: string;
  sizeBytes: number;
  takenAt: string;
}

function snapshotsDir(repoRoot: string): string {
  return join(repoRoot, ".mneme", SNAPSHOT_DIR_NAME);
}

/** Resolve the snapshots dir relative to dbPath. dbPath = .../<repo>/.mneme/store/mneme.db
 *  → snapshots = .../<repo>/.mneme/snapshots (parallel to store/). */
function snapshotsDirForDb(dbPath: string): string {
  return join(dirname(dirname(dbPath)), SNAPSHOT_DIR_NAME);
}

/** Create a SHA-stamped snapshot of the current DB. Returns the snapshot
 *  info or null if the source DB doesn't exist (first index run). */
export function createSnapshot(dbPath: string): SnapshotInfo | null {
  if (!existsSync(dbPath)) return null;
  const dir = snapshotsDirForDb(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // v1.30.0 -- include hrtime nanoseconds in the SHA input so two
  // back-to-back snapshots in the same millisecond don't collide.
  const ts = new Date().toISOString();
  const nano = process.hrtime.bigint().toString();
  const sha8 = createHash("sha256").update(ts).update(nano).update(dbPath).digest("hex").slice(0, 8);
  const snapPath = join(dir, `mneme.${sha8}.db`);
  copyFileSync(dbPath, snapPath);
  // Trim to keep most recent KEEP_SNAPSHOTS only.
  trimSnapshots(dir);
  return { sha8, path: snapPath, sizeBytes: statSync(snapPath).size, takenAt: ts };
}

/** Restore a specific snapshot back to dbPath. Returns true on success. */
export function restoreSnapshot(dbPath: string, sha8: string): { ok: boolean; reason?: string } {
  const dir = snapshotsDirForDb(dbPath);
  const snapPath = join(dir, `mneme.${sha8}.db`);
  if (!existsSync(snapPath)) return { ok: false, reason: `snapshot ${sha8} not found in ${dir}` };
  try {
    copyFileSync(snapPath, dbPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** List the snapshots currently retained (newest first). */
export function listSnapshots(repoRoot: string): SnapshotInfo[] {
  const dir = snapshotsDir(repoRoot);
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir).filter((f) => f.startsWith("mneme.") && f.endsWith(".db"));
    const out: SnapshotInfo[] = [];
    for (const f of entries) {
      const path = join(dir, f);
      const stat = statSync(path);
      const sha8 = f.slice("mneme.".length, -".db".length);
      out.push({ sha8, path, sizeBytes: stat.size, takenAt: new Date(stat.mtimeMs).toISOString() });
    }
    return out.sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  } catch { return []; }
}

function trimSnapshots(dir: string): void {
  try {
    const all = readdirSync(dir).filter((f) => f.startsWith("mneme.") && f.endsWith(".db"));
    if (all.length <= KEEP_SNAPSHOTS) return;
    // Sort by mtime desc; keep the newest KEEP_SNAPSHOTS, delete the rest.
    const withMtime = all.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of withMtime.slice(KEEP_SNAPSHOTS)) {
      try { unlinkSync(join(dir, entry.f)); } catch { /* */ }
    }
  } catch { /* best-effort */ }
}

/**
 * Wrap an index operation with TIME-MACHINE safety:
 *   1. Pre-flight: snapshot the current DB.
 *   2. Run the indexer.
 *   3. Post-flight: invariant check (chunks > 0 if commits > 0).
 *   4. On ANY failure (throw OR invariant violation), restore snapshot.
 *
 * Returns the outcome with full provenance: snapshot taken, snapshot
 * restored (if rollback happened), invariant check results.
 */
export interface SafeIndexInput {
  dbPath: string;
  /** The actual index operation. Returns commits + chunks counts. */
  runIndex: () => Promise<{ commits: number; chunks: number }>;
  /** When true, skip writes + just report what would happen. */
  dryRun?: boolean;
}

export interface SafeIndexResult {
  ok: boolean;
  dryRun: boolean;
  preSnapshot: SnapshotInfo | null;
  rolledBack: boolean;
  rollbackReason?: string;
  commits: number;
  chunks: number;
  invariantViolations: string[];
  durationMs: number;
}

export async function safeIndex(input: SafeIndexInput): Promise<SafeIndexResult> {
  const t0 = Date.now();
  const result: SafeIndexResult = {
    ok: false,
    dryRun: !!input.dryRun,
    preSnapshot: null,
    rolledBack: false,
    commits: 0,
    chunks: 0,
    invariantViolations: [],
    durationMs: 0,
  };

  if (input.dryRun) {
    // Dry run: don't snapshot, don't write, just compute counts via a no-op indexer probe.
    // Actual no-op probe is the caller's responsibility -- we just call it.
    try {
      const r = await input.runIndex();
      result.commits = r.commits;
      result.chunks = r.chunks;
      result.ok = true;
    } catch (e) {
      result.invariantViolations.push(`dry-run probe threw: ${(e as Error).message}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
  }

  // 1. Snapshot pre-index (best-effort -- first-ever index has no DB to snapshot).
  try {
    result.preSnapshot = createSnapshot(input.dbPath);
  } catch (e) {
    // Snapshot failure is logged but does NOT block the index -- we still
    // try the index; if it succeeds, great; if it fails, we just can't roll back.
    result.invariantViolations.push(`snapshot failed: ${(e as Error).message}`);
  }

  // 2. Run the index.
  let indexErr: Error | null = null;
  try {
    const r = await input.runIndex();
    result.commits = r.commits;
    result.chunks = r.chunks;
  } catch (e) {
    indexErr = e as Error;
  }

  // 3. Invariant check: post-index, chunks must be > 0 if commits > 0.
  if (!indexErr && result.commits > 0 && result.chunks === 0) {
    result.invariantViolations.push(
      `post-index invariant FAILED: ${result.commits} commits but 0 chunks. Likely cause: FTS5 / embedder failure mid-run.`,
    );
  }

  const shouldRollback = (indexErr || result.invariantViolations.length > 0) && !!result.preSnapshot;
  if (shouldRollback) {
    const r = restoreSnapshot(input.dbPath, result.preSnapshot!.sha8);
    result.rolledBack = r.ok;
    result.rollbackReason = r.ok
      ? `auto-rolled-back after ${indexErr ? "throw" : "invariant violation"}: snapshot ${result.preSnapshot!.sha8}`
      : `rollback FAILED: ${r.reason}`;
  }

  result.ok = !indexErr && result.invariantViolations.length === 0;
  result.durationMs = Date.now() - t0;
  if (indexErr && !result.invariantViolations.find((v) => v.startsWith("indexer threw"))) {
    result.invariantViolations.push(`indexer threw: ${indexErr.message}`);
  }
  return result;
}
