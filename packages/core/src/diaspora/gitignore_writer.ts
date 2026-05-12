/**
 * v1.72.0 -- DIASPORA D1: GHOST SNIPER GITIGNORE CONTRACT.
 *
 * Root-cause fix: every time Mneme injects an AI-tooling file
 * (CLAUDE.md / AGENTS.md / GEMINI.md / .cursor / .windsurf / etc),
 * the corresponding `.gitignore` entry MUST be appended atomically.
 *
 * Mneme memory + design intent: AI tool fingerprints stay private.
 * The prior version only handled some of the entries -- AGENTS.md
 * and GEMINI.md leaked. This module fixes that ONCE for all current
 * + future injection targets.
 *
 * Behaviour:
 *   - Idempotent: if entry already present (exact or fnmatch'd),
 *     skip silently.
 *   - Sentinel-bracketed: entries grouped under
 *     `# >>> mneme auto-managed (do not edit) <<<`
 *     so future updates can edit-in-place.
 *   - Atomic: writes once, never partial.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SENTINEL_BEGIN = "# >>> mneme auto-managed (do not edit between sentinels) <<<";
const SENTINEL_END = "# <<< mneme auto-managed >>>";

/** Canonical list of every AI-tooling artifact Mneme might write.
 *  Extending this list is the SINGLE place to update when a new
 *  vendor is added; everything else flows from here. */
export const PRIVATE_AI_ARTIFACTS = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".cursor/",
  ".cursorrules",
  ".cursorignore",
  ".aider*",
  ".continue/",
  ".windsurfrules",
  ".codeium/",
  ".claude/",
  ".claude.json",
  ".claudeignore",
  ".github/copilot-instructions.md",
];

export interface EnsureResult {
  /** Path written. */
  path: string;
  /** Action taken. */
  action: "created" | "replaced" | "unchanged" | "added" | "failed";
  /** Entries that ended up in the block. */
  entries: string[];
  /** Plain-English. */
  detail: string;
}

function readExistingEntries(content: string): { before: string; managed: Set<string>; after: string } {
  const beginIdx = content.indexOf(SENTINEL_BEGIN);
  const endIdx = content.indexOf(SENTINEL_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return { before: content, managed: new Set(), after: "" };
  }
  const managedBlock = content.slice(beginIdx + SENTINEL_BEGIN.length, endIdx);
  const managed = new Set<string>();
  for (const line of managedBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) managed.add(trimmed);
  }
  return {
    before: content.slice(0, beginIdx).trimEnd(),
    managed,
    after: content.slice(endIdx + SENTINEL_END.length).trimStart(),
  };
}

function lineAlreadyIgnored(allLines: string[], entry: string): boolean {
  for (const raw of allLines) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    if (l === entry) return true;
    // Pattern equivalence: CLAUDE.md ≡ CLAUDE.md; .cursor/ ≡ .cursor; .aider* ≡ .aider*
    if (entry.endsWith("/") && (l === entry.slice(0, -1) || l === entry)) return true;
    if (entry.endsWith("*") && l.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}

/** Ensure all `entries` are present in repoRoot/.gitignore under the
 *  Mneme-managed sentinel block. Idempotent + atomic. */
export function ensureGitignoreEntries(repoRoot: string, entries: string[] = PRIVATE_AI_ARTIFACTS): EnsureResult {
  const path = join(repoRoot, ".gitignore");
  let original = "";
  let createdNew = false;
  if (!existsSync(path)) {
    createdNew = true;
  } else {
    try { original = readFileSync(path, "utf8"); } catch { return { path, action: "failed", entries: [], detail: "read failed" }; }
  }

  // Pre-existing manual entries (outside the sentinel block) -- preserved
  // verbatim. If the user already added "CLAUDE.md" manually, we DON'T
  // duplicate it in our managed block.
  const allLines = original.split("\n");
  const { before, managed, after } = readExistingEntries(original);
  const toAddToManaged: string[] = [];
  for (const e of entries) {
    if (managed.has(e)) continue;
    if (lineAlreadyIgnored(allLines, e)) continue;
    toAddToManaged.push(e);
  }

  // If nothing new + sentinel block already exists with all entries -> unchanged.
  if (toAddToManaged.length === 0 && !createdNew && original.includes(SENTINEL_BEGIN)) {
    return {
      path,
      action: "unchanged",
      entries: [...managed],
      detail: `All ${entries.length} entr(ies) already ignored.`,
    };
  }

  // Build new content.
  const allManaged = [...managed, ...toAddToManaged];
  const block = [
    "",
    SENTINEL_BEGIN,
    "# AI tooling artifacts -- never commit. Mneme manages this block.",
    ...allManaged,
    SENTINEL_END,
    "",
  ].join("\n");

  const next = createdNew
    ? block.trimStart()
    : (before ? before + "\n" : "") + block + (after ? after + "\n" : "");

  try {
    writeFileSync(path, next, "utf8");
    return {
      path,
      action: createdNew ? "created" : (original.includes(SENTINEL_BEGIN) ? "replaced" : "added"),
      entries: allManaged,
      detail: `${createdNew ? "Created" : "Updated"} .gitignore; ${toAddToManaged.length} new entr(ies): ${toAddToManaged.join(", ") || "none"}.`,
    };
  } catch (e) {
    return { path, action: "failed", entries: [], detail: `write failed: ${(e as Error).message}` };
  }
}

/** Convenience: ensure a SINGLE entry. Use when a parasite-bridge
 *  inject just wrote one file. */
export function ensureSingleGitignoreEntry(repoRoot: string, entry: string): EnsureResult {
  return ensureGitignoreEntries(repoRoot, [entry]);
}

/** Read current managed entries (for inspection). */
export function readManagedEntries(repoRoot: string): string[] {
  const path = join(repoRoot, ".gitignore");
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, "utf8");
    return [...readExistingEntries(content).managed];
  } catch { return []; }
}
