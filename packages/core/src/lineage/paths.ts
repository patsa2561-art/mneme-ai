/**
 * Lineage file layout — single source of truth for every path under
 * `.mneme/lineage/`. Centralized so paths never drift across modules
 * (a single rename here updates the whole subsystem).
 */

import { join } from "node:path";

const LINEAGE_DIR = ".mneme/lineage";

export function lineageRoot(repoRoot: string): string {
  return join(repoRoot, LINEAGE_DIR);
}

/** Identity directory — Ed25519 public/private keypair. */
export function identityDir(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "identity");
}

export function identityPublicPath(repoRoot: string): string {
  return join(identityDir(repoRoot), "public.pem");
}

export function identityPrivatePath(repoRoot: string): string {
  return join(identityDir(repoRoot), "private.pem");
}

/** Chromosome storage — one JSON file per session. */
export function chromosomesDir(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "chromosomes");
}

export function chromosomePath(repoRoot: string, id: string): string {
  return join(chromosomesDir(repoRoot), `${id}.chromosome.json`);
}

/** Lineage tree (DAG of parent → child links). */
export function treePath(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "tree.json");
}

/** Pointer to which chromosome is the active session (currently open). */
export function currentPath(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "current.json");
}

/** Spore (cross-machine sync) state. */
export function sporeDir(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "spore");
}

export function sporeRemotePath(repoRoot: string): string {
  return join(sporeDir(repoRoot), "remote.json");
}

export function sporeVectorClockPath(repoRoot: string): string {
  return join(sporeDir(repoRoot), "vector-clock.json");
}

export function sporeLastSyncPath(repoRoot: string): string {
  return join(sporeDir(repoRoot), "last-sync.json");
}

/** Speciation cluster files (one per detected species). */
export function speciesDir(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "species");
}

export function speciesPath(repoRoot: string, id: string): string {
  return join(speciesDir(repoRoot), `${id}.species.json`);
}

/** Lineage settings (TOFU answers, opt-out flags, etc.). */
export function settingsPath(repoRoot: string): string {
  return join(lineageRoot(repoRoot), "settings.json");
}
