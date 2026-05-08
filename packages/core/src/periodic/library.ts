/**
 * Per-repo molecule library — the v0.42 "Second Brain" data layer.
 *
 * Stored at `.mneme/library.json`. Tracks dynamic molecules the user has
 * composed via `mneme compose`. When a plan accumulates enough hits, it
 * gets *promoted* to a named alias so future invocations skip the planning
 * step entirely.
 *
 * Promotion rules (tunable):
 *   - hits ≥ 5    → eligible for promotion
 *   - first seen ≥ 7 days ago → cooled — promote AS-IS rather than waiting
 *   - last seen ≥ 30 days ago → archived (still readable, not surfaced)
 *
 * After promotion, the user's named alias resolves to the same plan via
 * `mneme run <alias>` (v0.42 CLI shim). The plan can be edited by hand
 * since it's plain JSON.
 *
 * Privacy: nothing leaves the repo — the library is per-repo, gitignored
 * by default in the user's setup.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MoleculePlan } from "./compiler.js";

const FILE_NAME = "library.json";
const FILE_VERSION = 1;

export interface LibraryEntry {
  /** Stable id derived from canonicalised intent. */
  id: string;
  /** The user-facing alias once promoted. Undefined if still anonymous. */
  alias?: string;
  /** Original natural-language intent. */
  intent: string;
  /** The molecule plan. */
  plan: MoleculePlan;
  /** Total invocations across the lifetime of this entry. */
  hits: number;
  /** ISO timestamps. */
  firstSeen: string;
  lastSeen: string;
  /** Has this entry been promoted to a named alias? */
  promoted: boolean;
  /** When promoted — populated automatically by `promoteEligible`. */
  promotedAt?: string;
  /** Free-form note the user can add via `mneme library annotate`. */
  note?: string;
}

export interface LibraryFile {
  version: 1;
  entries: Record<string, LibraryEntry>;
}

export interface PromotionRules {
  /** Min hits to be eligible. Default 5. */
  hitsThreshold: number;
  /** Min days since firstSeen to ALWAYS promote regardless of hits. Default 7. */
  cooledAfterDays: number;
  /** Days after lastSeen before an entry is considered archived. Default 30. */
  archiveAfterDays: number;
}

export const DEFAULT_RULES: PromotionRules = {
  hitsThreshold: 5,
  cooledAfterDays: 7,
  archiveAfterDays: 30,
};

/** Compute the id we use to key library entries. Stable across whitespace
 *  + casing variants of the same intent. */
export function libraryId(intent: string): string {
  const normalised = intent.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

/** Read the library — returns an empty file if missing. */
export async function readLibrary(rootPath: string): Promise<LibraryFile> {
  const file = join(rootPath, ".mneme", FILE_NAME);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as LibraryFile;
    if (parsed.version !== FILE_VERSION) return { version: FILE_VERSION, entries: {} };
    return parsed;
  } catch {
    return { version: FILE_VERSION, entries: {} };
  }
}

async function persist(rootPath: string, lib: LibraryFile): Promise<void> {
  const dir = join(rootPath, ".mneme");
  await mkdir(dir, { recursive: true });
  const file = join(dir, FILE_NAME);
  await writeFile(file, JSON.stringify(lib, null, 2), "utf8");
}

/** Record an invocation. Creates the entry if it doesn't exist. */
export async function recordInvocation(
  rootPath: string,
  intent: string,
  plan: MoleculePlan,
): Promise<LibraryEntry> {
  const lib = await readLibrary(rootPath);
  const id = libraryId(intent);
  const now = new Date().toISOString();
  const existing = lib.entries[id];
  if (existing) {
    existing.hits += 1;
    existing.lastSeen = now;
    // Re-store the plan in case it changed (e.g. catalog grew).
    existing.plan = plan;
  } else {
    lib.entries[id] = {
      id,
      intent,
      plan,
      hits: 1,
      firstSeen: now,
      lastSeen: now,
      promoted: false,
    };
  }
  await persist(rootPath, lib);
  return lib.entries[id]!;
}

/** Promote an entry: assign it a human-readable alias derived from the intent. */
export async function promote(
  rootPath: string,
  id: string,
  alias?: string,
): Promise<LibraryEntry | undefined> {
  const lib = await readLibrary(rootPath);
  const entry = lib.entries[id];
  if (!entry) return undefined;
  entry.alias = alias ?? slugify(entry.intent);
  entry.promoted = true;
  entry.promotedAt = new Date().toISOString();
  await persist(rootPath, lib);
  return entry;
}

/** Return entries that meet promotion criteria (eligible or cooled). */
export function eligibleForPromotion(
  lib: LibraryFile,
  rules: PromotionRules = DEFAULT_RULES,
): LibraryEntry[] {
  const now = Date.now();
  const out: LibraryEntry[] = [];
  for (const e of Object.values(lib.entries)) {
    if (e.promoted) continue;
    if (e.hits >= rules.hitsThreshold) {
      out.push(e);
      continue;
    }
    const firstSeenMs = Date.parse(e.firstSeen);
    if (Number.isFinite(firstSeenMs) && now - firstSeenMs >= rules.cooledAfterDays * 86400_000) {
      // Cooled — promote even with low hit count if the user has used it
      // intermittently for a week or more.
      if (e.hits >= 2) out.push(e);
    }
  }
  return out;
}

/** Sort + return entries that are archived (haven't been used in
 *  archiveAfterDays days). Useful for the `mneme library prune` command. */
export function archived(
  lib: LibraryFile,
  rules: PromotionRules = DEFAULT_RULES,
): LibraryEntry[] {
  const now = Date.now();
  const out: LibraryEntry[] = [];
  for (const e of Object.values(lib.entries)) {
    const lastSeenMs = Date.parse(e.lastSeen);
    if (Number.isFinite(lastSeenMs) && now - lastSeenMs >= rules.archiveAfterDays * 86400_000) {
      out.push(e);
    }
  }
  return out;
}

/** Look up a plan by alias (post-promotion) or by id. */
export async function findByAliasOrId(
  rootPath: string,
  needle: string,
): Promise<LibraryEntry | undefined> {
  const lib = await readLibrary(rootPath);
  const direct = lib.entries[needle];
  if (direct) return direct;
  const lc = needle.toLowerCase();
  for (const e of Object.values(lib.entries)) {
    if (e.alias?.toLowerCase() === lc) return e;
  }
  return undefined;
}

/** Add or replace a free-form note on an entry. */
export async function annotate(
  rootPath: string,
  id: string,
  note: string,
): Promise<LibraryEntry | undefined> {
  const lib = await readLibrary(rootPath);
  const entry = lib.entries[id];
  if (!entry) return undefined;
  entry.note = note;
  await persist(rootPath, lib);
  return entry;
}

/** Remove an entry from the library. Returns true if it existed. */
export async function forget(rootPath: string, id: string): Promise<boolean> {
  const lib = await readLibrary(rootPath);
  if (!(id in lib.entries)) return false;
  delete lib.entries[id];
  await persist(rootPath, lib);
  return true;
}

/* ───────────  Helpers  ─────────────────────────────────────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 32) || "alias";
}
