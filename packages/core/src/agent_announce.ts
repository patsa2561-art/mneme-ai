/**
 * v1.67.1 -- AGENT ANNOUNCE + CARETAKER SYNC.
 *
 * Two cooperating helpers that close the last gap in Mneme's
 * AI-agent awareness pipeline:
 *
 *   announceNewCapabilities(repoRoot, currentVersion)
 *     -> returns a one-line [NEW] string (or null) for the pulse to
 *        surface IF the running version is newer than the last
 *        version we announced to this repo. The announcement names
 *        the new MCP tools so the AI agent learns about them on the
 *        very first prompt of the new version.
 *
 *   caretakerSyncOnUpgrade(repoRoot, currentVersion)
 *     -> idempotent. When a version bump is detected, refresh:
 *          1. agent_manifest sync into CLAUDE.md / AGENTS.md / etc.
 *          2. parasite/bridge content in injected tool files (if any).
 *          3. mark .mneme/agent-announce.json with the new version.
 *
 * Storage: `.mneme/agent-announce.json`
 *   { lastAnnouncedVersion: "1.67.0", announcedAt: "ISO" }
 *
 * The two helpers compose -- pulse calls announceNewCapabilities to
 * SURFACE the news, daemon caretaker calls caretakerSyncOnUpgrade to
 * MATERIALIZE the agent-file refresh. After one daemon tick + one
 * pulse, the AI agent in the user's editor knows everything new.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { MNEME_COMMAND_CATALOG, syncManifest, type ManifestCommand, type SyncTarget } from "./agent_manifest.js";

const STATE_FILE = ".mneme/agent-announce.json";

export interface AnnounceState {
  lastAnnouncedVersion: string;
  announcedAt: string;
}

function statePath(repoRoot: string): string {
  return join(repoRoot, STATE_FILE);
}

function readState(repoRoot: string): AnnounceState | null {
  const p = statePath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as AnnounceState; } catch { return null; }
}

function writeState(repoRoot: string, state: AnnounceState): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(repoRoot), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function parseSemver(v: string): [number, number, number] {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function semverGt(a: string, b: string): boolean {
  const [a0, a1, a2] = parseSemver(a);
  const [b0, b1, b2] = parseSemver(b);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

/** Build a 1-line [NEW] string listing tools added BETWEEN lastVersion
 *  (exclusive) and currentVersion (inclusive). Returns null when there
 *  are no new tools (either current==last, or last is ahead). */
export function announceNewCapabilities(
  repoRoot: string,
  currentVersion: string,
  opts?: { catalog?: ManifestCommand[]; persist?: boolean },
): string | null {
  const catalog = opts?.catalog ?? MNEME_COMMAND_CATALOG;
  const state = readState(repoRoot);
  const lastVersion = state?.lastAnnouncedVersion ?? "0.0.0";
  if (!semverGt(currentVersion, lastVersion)) return null;

  // Find commands whose `since` is strictly newer than lastVersion AND
  // <= currentVersion. Empty when nothing new to announce.
  const novel = catalog.filter((c) =>
    semverGt(c.since, lastVersion) && !semverGt(c.since, currentVersion));
  if (novel.length === 0) {
    if (opts?.persist) writeState(repoRoot, { lastAnnouncedVersion: currentVersion, announcedAt: new Date().toISOString() });
    return null;
  }
  // Group by `group` -- pick 1 headline per group to keep the line short.
  const headlines = new Map<string, ManifestCommand>();
  for (const c of novel) {
    if (!headlines.has(c.group)) headlines.set(c.group, c);
  }
  const groups = [...headlines.values()];
  // Group-name list (not command-name) gives a stable, scannable summary.
  const groupNames = [...new Set(novel.map((c) => c.group))].slice(0, 6);
  const headline = `[NEW] v${currentVersion}: ${novel.length} new Mneme capabilit${novel.length === 1 ? "y" : "ies"} across ${groups.length} group(s) (${groupNames.join(", ")}${[...new Set(novel.map((c) => c.group))].length > groupNames.length ? ", ..." : ""}). Say "show new mneme tools" to list them.`;

  if (opts?.persist) {
    writeState(repoRoot, { lastAnnouncedVersion: currentVersion, announcedAt: new Date().toISOString() });
  }
  return headline;
}

/** Idempotent caretaker pass. When the running version is newer than
 *  the last announced one, refresh agent files + record the new
 *  version. Safe to call every daemon tick. */
export function caretakerSyncOnUpgrade(
  repoRoot: string,
  currentVersion: string,
  opts?: { targets?: SyncTarget[] },
): { ranSync: boolean; lastAnnouncedVersion: string; syncResults: Array<{ target: SyncTarget; action: string; detail?: string }> } {
  const state = readState(repoRoot);
  const last = state?.lastAnnouncedVersion ?? "0.0.0";
  if (!semverGt(currentVersion, last)) {
    return { ranSync: false, lastAnnouncedVersion: last, syncResults: [] };
  }
  const results = syncManifest(repoRoot, { mnemeVersion: currentVersion, targets: opts?.targets });
  writeState(repoRoot, { lastAnnouncedVersion: currentVersion, announcedAt: new Date().toISOString() });
  return { ranSync: true, lastAnnouncedVersion: currentVersion, syncResults: results };
}

/** Render a multi-line bulleted list of every NEW capability between
 *  lastVersion and currentVersion. The agent uses this when the user
 *  asks "show new mneme tools". */
export function describeNewCapabilities(
  repoRoot: string,
  currentVersion: string,
  opts?: { catalog?: ManifestCommand[] },
): string {
  const catalog = opts?.catalog ?? MNEME_COMMAND_CATALOG;
  const state = readState(repoRoot);
  const lastVersion = state?.lastAnnouncedVersion ?? "0.0.0";
  const novel = catalog.filter((c) =>
    semverGt(c.since, lastVersion) && !semverGt(c.since, currentVersion));
  if (novel.length === 0) return "No new Mneme capabilities since the last announcement.";

  // Group + render.
  const grouped = new Map<string, ManifestCommand[]>();
  for (const c of novel) {
    const arr = grouped.get(c.group) ?? [];
    arr.push(c);
    grouped.set(c.group, arr);
  }
  const lines: string[] = [`Mneme v${currentVersion} new capabilities (since v${lastVersion}):`, ""];
  for (const [group, cmds] of grouped) {
    lines.push(`### ${group}`);
    for (const c of cmds) {
      lines.push(`  - **${c.command}**  -- ${c.what}`);
      lines.push(`    when: ${c.when}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Force-set the last-announced version (e.g. for testing or
 *  rolling back). */
export function setLastAnnouncedVersion(repoRoot: string, version: string): void {
  writeState(repoRoot, { lastAnnouncedVersion: version, announcedAt: new Date().toISOString() });
}

/** Read the current state for inspection. */
export function readAnnounceState(repoRoot: string): AnnounceState | null {
  return readState(repoRoot);
}
