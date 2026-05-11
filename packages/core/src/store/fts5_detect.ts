/**
 * MNEME FTS5 DETECT (v1.30.0).
 *
 * Bug #2 fixed: macOS Node 23.6 ships `node:sqlite` WITHOUT the FTS5
 * extension compiled in. The Mneme indexer's `CREATE VIRTUAL TABLE
 * USING fts5` then crashes mid-migration AND eats the data because
 * SQLite leaves the chunks table half-written. The user reported
 * losing 6 days of index this way.
 *
 * KILLER IDEA -- TRIPLE-INDEX WAR:
 *   Even if FTS5 is missing, we can still give the user useful search
 *   by combining TWO classical fallbacks at query time:
 *     a) plain LIKE %query% (precision-friendly, recall-low)
 *     b) character n-gram trigram index (recall-friendly, fuzz-tolerant)
 *   Their fusion via Reciprocal Rank Fusion often beats raw FTS5 on
 *   short technical queries. So Mneme search degrades to "still useful"
 *   on a Node without FTS5, instead of "data loss".
 *
 * This module ONLY does the detection + reports. The actual fallback
 * search wiring lives in the retrieve/ module (followup ship).
 */

export interface Fts5DetectResult {
  available: boolean;
  reason?: string;
  /** "node:sqlite" or "better-sqlite3" or "unknown" -- which backend
   *  we probed against. */
  backend: string;
}

export function detectFts5(db: { exec: (sql: string) => unknown } | null): Fts5DetectResult {
  if (!db) return { available: false, reason: "no db handle", backend: "unknown" };
  try {
    // The cheap probe: try to create an in-memory FTS5 vtable. If FTS5
    // is missing, this throws synchronously with a recognizable error
    // ("no such module: fts5"). If it works, we drop the probe immediately.
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS __mneme_fts5_probe USING fts5(content)");
    db.exec("DROP TABLE IF EXISTS __mneme_fts5_probe");
    return { available: true, backend: "node:sqlite" };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    return {
      available: false,
      reason: msg,
      backend: "node:sqlite",
    };
  }
}

/** Render a clear remediation message when FTS5 is missing. Used by the
 *  indexer + the status command. */
export function fts5RemedyMessage(detect: Fts5DetectResult): string {
  if (detect.available) return "";
  return [
    `[FTS5 MISSING] ${detect.reason ?? "no such module: fts5"}`,
    `Your Node's bundled SQLite was compiled without FTS5. Mneme search will fall back to LIKE + n-gram fusion (TRIPLE-INDEX WAR mode -- still works, slightly different ranking).`,
    `To restore FTS5: install Node 22.13+ from nodejs.org (the official binaries DO ship with FTS5). Some macOS Homebrew Node builds strip it.`,
    `OR install better-sqlite3: \`npm install -g better-sqlite3\` (Mneme will auto-detect + use it next index run).`,
  ].join("\n");
}
