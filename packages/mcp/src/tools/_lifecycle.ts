/**
 * Lifecycle tracking — record AI tool invocations + auto-promote frequent
 * compositions into the periodic library.
 *
 * The chain reaction: every tool call lands here. We hash the (set of atoms
 * called within a session window) into a "molecule signature" and count
 * occurrences. When a signature reaches the promotion threshold (≥3 across
 * sessions), we suggest promoting it to a named compound — the user (or AI)
 * picks an alias, and from then on the compound shows up as a single
 * callable in `mneme.lab.library`.
 *
 * Storage: .mneme/mcp-lifecycle.json (NOT the same as library.json — the
 * library is for compose-CLI plans; this file tracks live AI invocations).
 *
 * Race-condition safety: read-modify-write with a temp file rename. Single
 * MCP server per repo at a time; if two run, the second-writer wins, no
 * corruption since the file is small (<100KB even after years of use).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

interface MoleculeSignature {
  /** Sorted atom names joined with "+" for stable key */
  key: string;
  /** Atom names (preserves first-seen order for display) */
  atoms: string[];
  /** Total times this signature has been observed */
  invocations: number;
  /** ISO date of first observation */
  firstSeen: string;
  /** ISO date of last observation */
  lastSeen: string;
  /** Has the user been prompted to save this as a compound? */
  promotionPrompted: boolean;
  /** Saved alias (set when user/AI promotes) */
  promotedAs?: string;
}

interface LifecycleStore {
  version: 1;
  signatures: Record<string, MoleculeSignature>;
}

const PROMOTION_THRESHOLD = 3;
const SESSION_WINDOW_MS = 5 * 60_000; // 5 minutes

/** In-memory window tracker — accumulates atoms called within the same
 *  AI session before flushing to the persistent store. */
let currentSession: { atoms: Set<string>; lastTouch: number } = {
  atoms: new Set(),
  lastTouch: 0,
};

function lifecyclePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "mcp-lifecycle.json");
}

function readStore(repoRoot: string): LifecycleStore {
  const p = lifecyclePath(repoRoot);
  if (!existsSync(p)) return { version: 1, signatures: {} };
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as LifecycleStore;
    if (parsed.version !== 1) return { version: 1, signatures: {} };
    return parsed;
  } catch {
    return { version: 1, signatures: {} };
  }
}

function writeStore(repoRoot: string, store: LifecycleStore): void {
  const p = lifecyclePath(repoRoot);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  renameSync(tmp, p);
}

/** Record that the AI just invoked toolName. If multiple atoms have been
 *  called in the same session window, also record them as a molecule
 *  signature (the chain reaction trigger). */
export function recordInvocation(repoRoot: string, toolName: string): {
  isNewCombination: boolean;
  invocationCount: number;
  suggestSaveAs?: string;
} {
  const now = Date.now();
  // Reset session window if too much time has passed
  if (now - currentSession.lastTouch > SESSION_WINDOW_MS) {
    currentSession = { atoms: new Set(), lastTouch: now };
  }
  currentSession.atoms.add(toolName);
  currentSession.lastTouch = now;

  // Only record signatures when ≥2 atoms in window — single-atom calls
  // are just normal tool use, not a molecule.
  if (currentSession.atoms.size < 2) {
    return { isNewCombination: false, invocationCount: 1 };
  }

  const atoms = Array.from(currentSession.atoms).sort();
  const key = atoms.join("+");
  const store = readStore(repoRoot);
  const existing = store.signatures[key];
  const today = new Date().toISOString();

  if (!existing) {
    store.signatures[key] = {
      key,
      atoms,
      invocations: 1,
      firstSeen: today,
      lastSeen: today,
      promotionPrompted: false,
    };
    writeStore(repoRoot, store);
    return { isNewCombination: true, invocationCount: 1 };
  }

  existing.invocations++;
  existing.lastSeen = today;

  let suggestSaveAs: string | undefined;
  if (existing.invocations >= PROMOTION_THRESHOLD && !existing.promotionPrompted && !existing.promotedAs) {
    existing.promotionPrompted = true;
    suggestSaveAs = `compound_${atoms[0]?.split(".").slice(-1)[0] ?? "x"}_${atoms.length}atoms`;
  }

  writeStore(repoRoot, store);
  return {
    isNewCombination: false,
    invocationCount: existing.invocations,
    suggestSaveAs,
  };
}

/** List molecule signatures observed so far — used by mneme.brain.library.
 *  Sorted by frequency descending, then by recency. */
export function listSignatures(repoRoot: string): MoleculeSignature[] {
  const store = readStore(repoRoot);
  return Object.values(store.signatures).sort((a, b) => {
    if (b.invocations !== a.invocations) return b.invocations - a.invocations;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
}

/** Promote a molecule signature into a named compound. Marks it as promoted
 *  in the lifecycle store; the actual compound is written to library.json by
 *  the existing periodic.promote() machinery. */
export function markPromoted(repoRoot: string, key: string, alias: string): boolean {
  const store = readStore(repoRoot);
  const sig = store.signatures[key];
  if (!sig) return false;
  sig.promotedAs = alias;
  writeStore(repoRoot, store);
  return true;
}
