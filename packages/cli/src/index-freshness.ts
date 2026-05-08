/**
 * Centralised stale-index detection. Any command that reads from the
 * Mneme store should call `warnIfStale()` first so the user can't get
 * silently-stale answers.
 *
 * Customer feedback (v0.36): `mneme ask` answered confidently from a
 * 3-day-old index. The store had `indexed_at` but only `mneme status`
 * surfaced it. v0.37 surfaces freshness on every command.
 */
import kleur from "kleur";
import type { store } from "@mneme-ai/core";
import { ui } from "./ui.js";

export interface FreshnessStatus {
  /** ISO timestamp of last index, or undefined if never. */
  indexedAt?: string;
  /** Age in days (0 if never indexed → treated as Infinity). */
  ageDays: number;
  /** "fresh" | "ok" | "stale" | "very-stale" | "never". */
  state: "fresh" | "ok" | "stale" | "very-stale" | "never";
  /** Human-readable summary line. */
  message: string;
}

const FRESH_DAYS = 1;
const OK_DAYS = 3;
const STALE_DAYS = 14;

export function checkFreshness(s: store.MnemeStore): FreshnessStatus {
  const indexedAt = s.getMeta("indexed_at");
  if (!indexedAt) {
    return { ageDays: Infinity, state: "never", message: "memory has never been indexed" };
  }
  const ts = Date.parse(indexedAt);
  if (!Number.isFinite(ts)) {
    return { indexedAt, ageDays: Infinity, state: "never", message: "indexed_at is unreadable" };
  }
  const ageMs = Date.now() - ts;
  const ageDays = ageMs / 86400000;
  if (ageDays < FRESH_DAYS) return { indexedAt, ageDays, state: "fresh", message: `index is fresh (${formatAge(ageDays)} ago)` };
  if (ageDays < OK_DAYS) return { indexedAt, ageDays, state: "ok", message: `index is ${formatAge(ageDays)} old` };
  if (ageDays < STALE_DAYS) return { indexedAt, ageDays, state: "stale", message: `index is ${formatAge(ageDays)} old — answers may miss recent commits` };
  return { indexedAt, ageDays, state: "very-stale", message: `index is ${formatAge(ageDays)} old — strongly recommend re-indexing` };
}

/**
 * Print a single-line warning to stderr if the index is stale. Returns the
 * status so callers can also condition behavior on it. No-op in quiet mode.
 */
export function warnIfStale(s: store.MnemeStore, opts: { quiet?: boolean } = {}): FreshnessStatus {
  const status = checkFreshness(s);
  if (opts.quiet) return status;
  if (status.state === "stale") {
    process.stderr.write(`${kleur.yellow("!")} ${kleur.gray(status.message)} ${kleur.cyan("(run `mneme index` to refresh)")}\n`);
  } else if (status.state === "very-stale") {
    process.stderr.write(`${kleur.red("!")} ${kleur.bold(status.message)} ${kleur.cyan("(run `mneme index` to refresh)")}\n`);
  } else if (status.state === "never") {
    process.stderr.write(`${kleur.red("!")} ${kleur.bold(status.message)} ${kleur.cyan("(run `mneme init && mneme index` first)")}\n`);
  }
  return status;
}

function formatAge(days: number): string {
  if (days < 1 / 24) return "<1h";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
