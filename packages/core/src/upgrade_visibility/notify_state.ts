/**
 * v2.94.0 — WHISPER NOT NAG, precisely (the first ETHOS action · docs/ALETHEIA.md §XI).
 *
 * Removing a notice entirely would be hiding something important — ETHOS broken
 * another way. The discipline is "speak proportional to importance, once per new
 * fact": dedupe the upgrade notice BY VERSION (whisper once per new `latest`, then
 * stay quiet until `latest` changes again), under SEVERITY TIERS:
 *   • security  → surface ALWAYS (a duty, not a nag)
 *   • feature   → whisper ONCE per new latest, then silent
 *   • cosmetic  → inbox/glyph only (never the loud pulse block)
 *
 * It preserves the de-worm vow (v2.78): INFORM, never COMMAND; no auto-upgrade;
 * manual-only; never hide a security upgrade. This only REDUCES repetition.
 *
 * Honest scope: severity is derived from the semver delta (the only thing knowable
 * from installed-vs-npm-latest). "security" is an EXPLICIT-flag tier — Mneme does
 * not pretend to auto-detect a security release from a version number; if a caller
 * (or a future advisory feed) sets `security: true`, the always-surface duty fires.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type UpgradeSeverity = "security" | "feature" | "cosmetic";

export interface NotifyState {
  /** The `latest` version we last surfaced the loud upgrade notice for. */
  lastNotifiedVersion: string | null;
  lastNotifiedAt: number;
  lastSeverity: UpgradeSeverity | null;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/**
 * Classify the importance of an upgrade from the semver delta. A major OR minor
 * bump is a "feature" (whisper once); a patch-only bump is "cosmetic" (inbox/glyph
 * only). An explicit `security` flag overrides to the always-surface tier. If either
 * version is unparseable, default to "feature" (safer to whisper once than to hide).
 */
export function classifyUpgradeSeverity(current: string, latest: string, opts: { security?: boolean } = {}): UpgradeSeverity {
  if (opts.security === true) return "security";
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return "feature";
  if (l[0] !== c[0] || l[1] !== c[1]) return "feature"; // major or minor delta
  if (l[2] !== c[2]) return "cosmetic";                  // patch-only delta
  return "cosmetic";                                     // equal (shouldn't reach when updateAvailable)
}

function statePath(repoRoot: string): string { return join(repoRoot, ".mneme", "upgrade_visibility", "notify-state.json"); }

/** Read the persisted notify-state. Never throws. */
export function readNotifyState(repoRoot: string): NotifyState {
  try {
    const p = statePath(repoRoot);
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, "utf8")) as Partial<NotifyState>;
      return { lastNotifiedVersion: s.lastNotifiedVersion ?? null, lastNotifiedAt: s.lastNotifiedAt ?? 0, lastSeverity: s.lastSeverity ?? null };
    }
  } catch { /* */ }
  return { lastNotifiedVersion: null, lastNotifiedAt: 0, lastSeverity: null };
}

/** True if we already surfaced the loud upgrade notice for this exact `latest`. Pure read. */
export function upgradeAlreadyNotified(repoRoot: string, latest: string): boolean {
  return readNotifyState(repoRoot).lastNotifiedVersion === String(latest ?? "");
}

/** Record that we surfaced the loud notice for `latest`. Best-effort; never throws. */
export function markUpgradeNotified(repoRoot: string, latest: string, severity: UpgradeSeverity, now: number = Date.now()): void {
  try {
    const dir = join(repoRoot, ".mneme", "upgrade_visibility");
    mkdirSync(dir, { recursive: true });
    writeFileSync(statePath(repoRoot), JSON.stringify({ lastNotifiedVersion: String(latest ?? ""), lastNotifiedAt: now, lastSeverity: severity } satisfies NotifyState), "utf8");
  } catch { /* */ }
}

/**
 * THE GATE — should the pulse surface the LOUD upgrade notice this turn?
 *   security → always (duty)
 *   cosmetic → never (inbox/glyph only)
 *   feature  → only if this `latest` hasn't been surfaced yet (whisper once per new version)
 * Pure read (does NOT mark — the caller marks once after deciding, to keep the
 * [INFO] block and the inbox surfacing consistent within one pulse). Never throws.
 */
export function shouldSurfaceUpgrade(repoRoot: string, latest: string, severity: UpgradeSeverity): boolean {
  if (severity === "security") return true;
  if (severity === "cosmetic") return false;
  return !upgradeAlreadyNotified(repoRoot, latest);
}
