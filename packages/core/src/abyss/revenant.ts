/**
 * v1.76.0 -- ABYSS MINION 2: REVENANT (soul prompt archive + replay).
 *
 * Every soul prompt that leaves Mneme should be REPLAYABLE later.
 * REVENANT is git-reflog for cross-vendor handovers:
 *   - Save the soul prompt + metadata when generated.
 *   - List archived souls with vendor / fingerprint / created / used.
 *   - Replay any past soul by id.
 *   - Mark a soul as "used successfully" when the receiving AI ACKs.
 *
 * Storage: `.mneme/abyss/souls/<id>.json` (newline-delimited safe).
 * Index: in-memory rebuild from directory listing -- no separate
 * index file to corrupt.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SOULS_DIR = ".mneme/abyss/souls";

export interface ArchivedSoul {
  id: string;
  createdAt: string;
  vendor: string;
  fingerprint: string;
  destinationVendor?: string;
  /** Was the soul transferred successfully? Set by markUsed. */
  used: boolean;
  /** ISO timestamp when marked used. */
  usedAt?: string;
  /** The raw soul prompt text. */
  text: string;
  /** Char length convenience. */
  length: number;
}

export interface ArchiveInput {
  text: string;
  vendor: string;
  fingerprint: string;
  destinationVendor?: string;
}

function ensureSoulsDir(repoRoot: string): string {
  const dir = join(repoRoot, SOULS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function shortId(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Save a soul prompt to the local archive. Returns the assigned id. */
export function archiveSoul(repoRoot: string, input: ArchiveInput): ArchivedSoul {
  const dir = ensureSoulsDir(repoRoot);
  const id = shortId(input.text + new Date().toISOString());
  const entry: ArchivedSoul = {
    id,
    createdAt: new Date().toISOString(),
    vendor: input.vendor,
    fingerprint: input.fingerprint,
    destinationVendor: input.destinationVendor,
    used: false,
    text: input.text,
    length: input.text.length,
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(entry, null, 2), "utf8");
  return entry;
}

/** List all archived souls (newest first). Optionally filter by vendor. */
export function listSouls(
  repoRoot: string,
  opts: { vendor?: string; usedOnly?: boolean; unusedOnly?: boolean } = {},
): ArchivedSoul[] {
  const dir = join(repoRoot, SOULS_DIR);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const out: ArchivedSoul[] = [];
  for (const f of files) {
    try {
      const j: ArchivedSoul = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (opts.vendor && j.vendor !== opts.vendor) continue;
      if (opts.usedOnly && !j.used) continue;
      if (opts.unusedOnly && j.used) continue;
      out.push(j);
    } catch {
      // skip corrupt entries
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

/** Retrieve a single archived soul by id. */
export function replaySoul(repoRoot: string, id: string): ArchivedSoul | null {
  const dir = join(repoRoot, SOULS_DIR);
  const p = join(dir, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Mark a soul as successfully transferred (receiving AI ACKed). */
export function markUsed(repoRoot: string, id: string, destinationVendor?: string): boolean {
  const dir = join(repoRoot, SOULS_DIR);
  const p = join(dir, `${id}.json`);
  if (!existsSync(p)) return false;
  try {
    const j: ArchivedSoul = JSON.parse(readFileSync(p, "utf8"));
    j.used = true;
    j.usedAt = new Date().toISOString();
    if (destinationVendor) j.destinationVendor = destinationVendor;
    writeFileSync(p, JSON.stringify(j, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
