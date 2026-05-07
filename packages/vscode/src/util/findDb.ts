/**
 * Locate a Mneme database file inside a workspace.
 *
 * The convention is `<repoRoot>/.mneme/mneme.db`. When the user opens
 * a multi-root workspace we scan each root and return the first hit.
 *
 * Pure function over the filesystem so tests can drive a fake `existsSync`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceFolderLike {
  /** Absolute path to the folder root. */
  fsPath: string;
}

export interface FindDbDeps {
  exists?: (path: string) => boolean;
}

export interface FindDbResult {
  /** Absolute path to `mneme.db`. */
  dbPath: string;
  /** Absolute path to the workspace folder containing `.mneme/`. */
  repoRoot: string;
}

const MNEME_DIR = ".mneme";
const DB_FILENAME = "mneme.db";

/**
 * Returns the first workspace folder containing a `.mneme/mneme.db` file,
 * or `null` when none of the folders look indexed.
 */
export function findMnemeDb(
  folders: ReadonlyArray<WorkspaceFolderLike> | undefined,
  deps: FindDbDeps = {},
): FindDbResult | null {
  if (!folders || folders.length === 0) return null;
  const exists = deps.exists ?? existsSync;
  for (const folder of folders) {
    if (!folder?.fsPath) continue;
    const dbPath = join(folder.fsPath, MNEME_DIR, DB_FILENAME);
    if (exists(dbPath)) {
      return { dbPath, repoRoot: folder.fsPath };
    }
  }
  return null;
}

/** Compute the canonical Mneme directory inside a repo, regardless of existence. */
export function mnemeDirFor(repoRoot: string): string {
  return join(repoRoot, MNEME_DIR);
}

/** Compute the canonical DB path inside a repo, regardless of existence. */
export function dbPathFor(repoRoot: string): string {
  return join(repoRoot, MNEME_DIR, DB_FILENAME);
}
