/**
 * Small shared helpers used across CLI command implementations.
 * Keeping them here avoids duplication between heal/correlate/echo/etc.
 */
import type { Commit } from "../types.js";
import type { MnemeStore } from "../store/sqlite.js";

export * from "./redact.js";

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

/** Cosine similarity for Float32Arrays. */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
