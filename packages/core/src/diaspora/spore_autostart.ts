/**
 * v1.72.0 -- DIASPORA D2: SPORE DEFAULT-ON.
 *
 * Today `mneme init` does NOT enable spore (cross-machine wisdom
 * sync). User has to opt in manually. Result: "cross-machine" is
 * marketing, not default UX.
 *
 * D2 changes the calculus: if the repo has a `git remote` (origin or
 * any), spore should auto-enable on init. The remote URL IS the
 * cross-machine identity -- no extra config needed.
 *
 * Detection rule:
 *   1. Read `.git/config` -> any [remote "..."] section
 *   2. If found -> create `.mneme/spore.json` with detected origin
 *   3. Idempotent: don't overwrite existing spore config
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GitRemote {
  name: string;
  url: string;
}

export interface SporeConfig {
  enabled: boolean;
  /** Origin remote name (usually "origin"). */
  remoteName: string;
  /** Remote URL. */
  remoteUrl: string;
  /** ISO ts when spore was auto-enabled. */
  enabledAt: string;
  /** Reason: "git-remote-detected" / "manual". */
  reason: string;
}

export interface AutoStartResult {
  /** Did we enable spore? */
  enabled: boolean;
  /** Why or why not. */
  reason: string;
  /** Detected remotes (for inspection). */
  remotes: GitRemote[];
  /** The config that was written / detected. */
  config: SporeConfig | null;
}

const SPORE_FILE = ".mneme/spore.json";

export function readGitRemotes(repoRoot: string): GitRemote[] {
  const configPath = join(repoRoot, ".git", "config");
  if (!existsSync(configPath)) return [];
  let content = "";
  try { content = readFileSync(configPath, "utf8"); } catch { return []; }
  const remotes: GitRemote[] = [];
  // INI-style; [remote "origin"] ... url = ...
  const sectionRe = /\[remote\s+"([^"]+)"\]([^\[]*)/g;
  for (const m of content.matchAll(sectionRe)) {
    const name = m[1]!;
    const body = m[2]!;
    const urlMatch = body.match(/^\s*url\s*=\s*(.+?)\s*$/m);
    if (urlMatch) remotes.push({ name, url: urlMatch[1]!.trim() });
  }
  return remotes;
}

export function readSporeConfig(repoRoot: string): SporeConfig | null {
  const p = join(repoRoot, SPORE_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as SporeConfig; } catch { return null; }
}

function writeSporeConfig(repoRoot: string, cfg: SporeConfig): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, SPORE_FILE), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export interface AutoStartOptions {
  /** When true, override existing spore.json (rare; usually idempotent). */
  force?: boolean;
}

/** Idempotent: detect git remote + write spore.json if absent. Safe to
 *  call on every `mneme init` / daemon startup. */
export function autoStartSpore(repoRoot: string, opts?: AutoStartOptions): AutoStartResult {
  const remotes = readGitRemotes(repoRoot);
  const existing = readSporeConfig(repoRoot);

  if (existing && !opts?.force) {
    return {
      enabled: existing.enabled,
      reason: `spore.json already exists (enabled=${existing.enabled}); not overwriting`,
      remotes, config: existing,
    };
  }

  if (remotes.length === 0) {
    return {
      enabled: false,
      reason: "no git remotes detected -- spore stays off (cross-machine handoff requires a remote identity)",
      remotes, config: null,
    };
  }

  // Prefer "origin" remote, else first.
  const chosen = remotes.find((r) => r.name === "origin") ?? remotes[0]!;
  const cfg: SporeConfig = {
    enabled: true,
    remoteName: chosen.name,
    remoteUrl: chosen.url,
    enabledAt: new Date().toISOString(),
    reason: "git-remote-detected",
  };
  writeSporeConfig(repoRoot, cfg);
  return {
    enabled: true,
    reason: `auto-enabled via remote "${chosen.name}" (${chosen.url})`,
    remotes, config: cfg,
  };
}

/** Disable spore explicitly. */
export function disableSpore(repoRoot: string): void {
  const existing = readSporeConfig(repoRoot);
  if (!existing) return;
  writeSporeConfig(repoRoot, { ...existing, enabled: false });
}
