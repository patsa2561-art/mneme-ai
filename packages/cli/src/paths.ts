import { join } from "node:path";

export const MNEME_DIR = ".mneme";
export const DB_FILENAME = "mneme.db";
export const CONFIG_FILENAME = "config.json";

export function mnemeDir(repoRoot: string): string {
  return join(repoRoot, MNEME_DIR);
}

export function dbPath(repoRoot: string): string {
  return join(mnemeDir(repoRoot), DB_FILENAME);
}

export function configPath(repoRoot: string): string {
  return join(mnemeDir(repoRoot), CONFIG_FILENAME);
}
