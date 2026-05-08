/**
 * Small shared helpers used across CLI command implementations.
 * Keeping them here avoids duplication between heal/correlate/echo/etc.
 */
import type { Commit } from "../types.js";
import type { MnemeStore } from "../store/sqlite.js";

export * from "./redact.js";
export * from "./noise.js";
export * from "./constraint-pruner.js";
export * from "./concurrency.js";

/** Load every commit from the store, oldest first, with its file list. */
export function loadAllCommits(s: MnemeStore): Commit[] {
  const rows = s.db
    .prepare("SELECT * FROM commits ORDER BY author_date ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => rowToCommit(r, s));
}

/** Load every file change in the repo (across all commits). */
export function loadAllFileChanges(s: MnemeStore): import("../types.js").FileChange[] {
  const rows = s.db
    .prepare(
      "SELECT commit_hash, path, change_kind, insertions, deletions FROM file_changes",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    commitHash: String(r.commit_hash),
    path: String(r.path),
    changeKind: String(r.change_kind) as "A" | "M" | "D" | "R" | "C",
    insertions: Number(r.insertions ?? 0),
    deletions: Number(r.deletions ?? 0),
  }));
}

/** Load file changes for a specific path (across all commits). */
export function loadFileChangesForPath(
  s: MnemeStore,
  path: string,
): import("../types.js").FileChange[] {
  const rows = s.db
    .prepare(
      "SELECT commit_hash, path, change_kind, insertions, deletions FROM file_changes WHERE path = ?",
    )
    .all(path) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    commitHash: String(r.commit_hash),
    path: String(r.path),
    changeKind: String(r.change_kind) as "A" | "M" | "D" | "R" | "C",
    insertions: Number(r.insertions ?? 0),
    deletions: Number(r.deletions ?? 0),
  }));
}

/** Load commits within a date range. */
export function loadCommitsBetween(
  s: MnemeStore,
  sinceIso?: string,
  untilIso?: string,
): Commit[] {
  const where: string[] = [];
  const params: string[] = [];
  if (sinceIso) {
    where.push("author_date >= ?");
    params.push(sinceIso);
  }
  if (untilIso) {
    where.push("author_date <= ?");
    params.push(untilIso);
  }
  const sql = `SELECT * FROM commits${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY author_date ASC`;
  const rows = s.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToCommit(r, s));
}

export function rowToCommit(r: Record<string, unknown>, s: MnemeStore): Commit {
  const hash = String(r.hash);
  return {
    hash,
    shortHash: String(r.short_hash),
    authorName: String(r.author_name),
    authorEmail: String(r.author_email),
    authorDate: String(r.author_date),
    committerDate: String(r.committer_date),
    subject: String(r.subject),
    body: String(r.body),
    parents: String(r.parents).split(/\s+/).filter(Boolean),
    files: s.filesForCommit(hash),
    prNumber: typeof r.pr_number === "number" ? r.pr_number : undefined,
    prTitle: r.pr_title ? String(r.pr_title) : undefined,
    prBody: r.pr_body ? String(r.pr_body) : undefined,
    issueRefs: r.issue_refs ? JSON.parse(String(r.issue_refs)) : undefined,
  };
}

/** Stable hash of a string list — used for hash-chain ledger entries + cluster ids. */
export async function sha256Hex(...parts: string[]): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Cosine similarity for Float32Arrays.
 *
 *  For best perf in retrieval hot paths use `dotProductNormalized()` after
 *  pre-normalising stored vectors with `normaliseInPlace()`. This generic
 *  form recomputes both norms on every call and is O(3n).
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  // 4-way unrolled — V8 JIT autovectorises on x64; on Apple-silicon NEON
  // and AVX2 hosts this lets the back-end emit SIMD adds. The loop tail
  // handles any length not divisible by 4.
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = a.length;
  const block = len - (len % 4);
  for (let i = 0; i < block; i += 4) {
    const a0 = a[i]!,     a1 = a[i + 1]!, a2 = a[i + 2]!, a3 = a[i + 3]!;
    const b0 = b[i]!,     b1 = b[i + 1]!, b2 = b[i + 2]!, b3 = b[i + 3]!;
    dot += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
    na  += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
    nb  += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
  }
  for (let i = block; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na  += av * av;
    nb  += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Dot product, 4-way unrolled. Use when both vectors are already
 *  unit-norm (cosine similarity == dot product). 3× faster than cosineSim
 *  in retrieval hot paths because we skip the two norm sqrts per call. */
export function dotProductNormalized(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  const len = a.length;
  const block = len - (len % 4);
  for (let i = 0; i < block; i += 4) {
    s += a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]!;
  }
  for (let i = block; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

/** L2-normalise a Float32Array in place. Returns the original (now unit-norm)
 *  array for chaining. After calling this on every stored vector, retrieval
 *  can use `dotProductNormalized()` instead of `cosineSim()`. */
export function normaliseInPlace(v: Float32Array): Float32Array {
  let s = 0;
  const len = v.length;
  const block = len - (len % 4);
  for (let i = 0; i < block; i += 4) {
    s += v[i]! * v[i]! + v[i + 1]! * v[i + 1]! + v[i + 2]! * v[i + 2]! + v[i + 3]! * v[i + 3]!;
  }
  for (let i = block; i < len; i++) s += v[i]! * v[i]!;
  if (s === 0) return v;
  const inv = 1 / Math.sqrt(s);
  for (let i = 0; i < len; i++) v[i] *= inv;
  return v;
}
