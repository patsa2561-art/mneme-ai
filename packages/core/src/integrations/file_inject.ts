/**
 * Shared sentinel-bracketed file injection for agents that don't have
 * a real exec hook (everything except Claude Code today).
 *
 * Idempotent contract:
 *   - If the file exists and contains our sentinels, REPLACE the text
 *     between them. Never duplicate. Never touch outside.
 *   - If the file exists but lacks our sentinels, APPEND our block
 *     (with a leading blank line if the file doesn't end in one).
 *   - If the file doesn't exist, create it with just our block.
 *   - Uninstall removes our sentinels-and-everything-between, plus
 *     trailing blank line if we created one.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SENTINEL_BEGIN, SENTINEL_END } from "./types.js";

export type FileInjectStatus =
  | "installed"          // didn't exist before, we wrote it
  | "added-block"        // file existed, no sentinels, we appended
  | "updated-block"      // sentinels existed, we replaced the body
  | "already-installed"; // sentinels exist + body identical to what we'd write

export interface FileInjectResult {
  status: FileInjectStatus;
  path: string;
}

/**
 * Inject `block` (must be the full text including SENTINEL_BEGIN /
 * SENTINEL_END lines) into `path`. Returns what happened.
 */
export function injectBlock(path: string, block: string): FileInjectResult {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });

  if (!existsSync(path)) {
    writeFileSync(path, block + "\n", "utf8");
    return { status: "installed", path };
  }

  const existing = readFileSync(path, "utf8");
  const begin = existing.indexOf(SENTINEL_BEGIN);
  const end = existing.indexOf(SENTINEL_END);

  if (begin >= 0 && end > begin) {
    // Replace between sentinels (inclusive of sentinel lines).
    const before = existing.slice(0, begin);
    const after = existing.slice(end + SENTINEL_END.length);
    const next = before + block + after;
    if (next === existing) return { status: "already-installed", path };
    writeFileSync(path, next, "utf8");
    return { status: "updated-block", path };
  }

  // No sentinels yet -- append.
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, existing + sep + block + "\n", "utf8");
  return { status: "added-block", path };
}

export interface FileRemoveResult {
  removed: boolean;
  fileExisted: boolean;
  path: string;
}

/**
 * Strip the sentinel block (and the sentinels themselves) from `path`.
 * No-op if the file doesn't exist or lacks sentinels.
 */
export function removeBlock(path: string): FileRemoveResult {
  if (!existsSync(path)) return { removed: false, fileExisted: false, path };
  const existing = readFileSync(path, "utf8");
  const begin = existing.indexOf(SENTINEL_BEGIN);
  const end = existing.indexOf(SENTINEL_END);
  if (begin < 0 || end < begin) return { removed: false, fileExisted: true, path };
  // Also swallow one preceding newline if present (cosmetic) and trailing newline.
  const beforeRaw = existing.slice(0, begin);
  const afterRaw = existing.slice(end + SENTINEL_END.length);
  const before = beforeRaw.endsWith("\n\n") ? beforeRaw.slice(0, -1) : beforeRaw;
  const after = afterRaw.startsWith("\n") ? afterRaw.slice(1) : afterRaw;
  const next = before + after;
  writeFileSync(path, next, "utf8");
  return { removed: true, fileExisted: true, path };
}

export interface FileBlockState {
  fileExists: boolean;
  hasBlock: boolean;
  /** When hasBlock, the actual text between sentinels (excluding the sentinels). */
  blockBody?: string;
}

export function readBlockState(path: string): FileBlockState {
  if (!existsSync(path)) return { fileExists: false, hasBlock: false };
  const existing = readFileSync(path, "utf8");
  const begin = existing.indexOf(SENTINEL_BEGIN);
  const end = existing.indexOf(SENTINEL_END);
  if (begin < 0 || end < begin) return { fileExists: true, hasBlock: false };
  const body = existing.slice(begin + SENTINEL_BEGIN.length, end);
  return { fileExists: true, hasBlock: true, blockBody: body };
}
