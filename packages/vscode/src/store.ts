/**
 * Store bridge — owns a single MnemeStore handle for the active workspace.
 *
 * Why a singleton: node:sqlite connections are cheap to open but we
 * don't want to thrash on every code-lens computation. We open once per
 * workspace, refresh on the user-driven `mneme.refresh` command, and
 * close on extension deactivation.
 *
 * Soft-fail strategy: if the DB doesn't exist OR core fails to load
 * (native module mismatch / install missing), we log once and operate
 * in degraded mode — the sidebar shows "Run `mneme index` first" and
 * lenses simply emit nothing.
 */

import { findMnemeDb, type WorkspaceFolderLike } from "./util/findDb.js";

export interface StoreLike {
  countCommits(): number;
  close(): void;
}

export interface MnemeApi {
  /** Returns null if the file has no commit history. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  atrophyForFile: (store: any, filePath: string, opts?: { halfLifeDays?: number }) => unknown;
  /** Repo-wide atrophy report. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  atrophy: (store: any, opts?: { topN?: number; halfLifeDays?: number }) => unknown;
  /** Construct a fresh store handle. */
  openStore: (dbPath: string) => StoreLike;
  /** Best-effort author dossier; returns null when no commits exist. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildPassport: (store: any, opts: { cwd: string; author?: string }) => Promise<unknown>;
  /** Load any persisted audit baseline. */
  loadBaseline: (repoRoot: string) => unknown;
}

/**
 * Lazily import the public surface of @mneme-ai/core. We keep this
 * dynamic so the extension can still activate even when the workspace
 * doesn't have core installed yet (rare but possible during onboarding).
 */
export async function loadMnemeApi(): Promise<MnemeApi | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@mneme-ai/core/public");
    return {
      atrophyForFile: mod.atrophyForFile,
      atrophy: mod.atrophy,
      openStore: (dbPath: string) => new mod.MnemeStore(dbPath),
      buildPassport: mod.buildPassport,
      loadBaseline: mod.loadBaseline,
    };
  } catch {
    return null;
  }
}

export interface ResolvedWorkspace {
  repoRoot: string;
  dbPath: string;
  store: StoreLike;
  api: MnemeApi;
}

/**
 * Try to attach to a Mneme-indexed workspace. Returns null when there
 * is no workspace open, no `.mneme/mneme.db`, or core failed to load.
 */
export async function attachWorkspace(
  folders: ReadonlyArray<WorkspaceFolderLike> | undefined,
): Promise<ResolvedWorkspace | null> {
  const located = findMnemeDb(folders);
  if (!located) return null;
  const api = await loadMnemeApi();
  if (!api) return null;
  try {
    const store = api.openStore(located.dbPath);
    return { repoRoot: located.repoRoot, dbPath: located.dbPath, store, api };
  } catch {
    return null;
  }
}
