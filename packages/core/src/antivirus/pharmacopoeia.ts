/**
 * Mneme Antivirus -- the pharmacopoeia (vaccine inventory).
 *
 * Persists at .mneme/antivirus/pharmacopoeia.json. Every install starts
 * with the SEED_VACCINES; locally-developed and inherited vaccines are
 * appended. The web Lab dashboard renders this file's contents as the
 * "Vaccine Inventory" panel.
 *
 * Inheritance (Lamarckian / MneMeiosis): see lineage_vaccines.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Pharmacopoeia, PharmacopoeiaEntry, Vaccine } from "./types.js";
import { SEED_VACCINES } from "./vaccines.js";
import { readBenchmark } from "./benchmark.js";

const PHARMACOPOEIA_FILE = ".mneme/antivirus/pharmacopoeia.json";

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme", "antivirus");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Read the on-disk pharmacopoeia; auto-seed on first read so a fresh
 *  install already has the 8 default vaccines registered. */
export function readPharmacopoeia(repoRoot: string): Pharmacopoeia {
  const path = join(repoRoot, PHARMACOPOEIA_FILE);
  if (!existsSync(path)) {
    const seeded = seedPharmacopoeia(repoRoot);
    return seeded;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Pharmacopoeia;
    return parsed;
  } catch {
    return seedPharmacopoeia(repoRoot);
  }
}

export function writePharmacopoeia(repoRoot: string, p: Pharmacopoeia): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, PHARMACOPOEIA_FILE), JSON.stringify(p, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Initialize with the 8 seed vaccines. Idempotent. */
export function seedPharmacopoeia(repoRoot: string): Pharmacopoeia {
  const now = new Date().toISOString();
  const p: Pharmacopoeia = {
    schemaVersion: 1,
    vaccines: SEED_VACCINES.map((v) => ({
      id: v.id,
      strain: v.strain,
      version: v.version,
      source: "seed",
      efficacy: readBenchmark(repoRoot, v.id),
      registeredAt: now,
    })),
    lastUpdate: now,
  };
  writePharmacopoeia(repoRoot, p);
  return p;
}

/** Add a new vaccine to the pharmacopoeia (de-duped on id+version). */
export function registerVaccine(
  repoRoot: string,
  vaccine: Vaccine,
  source: PharmacopoeiaEntry["source"] = "local-developed",
  inheritedFrom?: string,
): Pharmacopoeia {
  const p = readPharmacopoeia(repoRoot);
  const key = `${vaccine.id}@${vaccine.version}`;
  if (p.vaccines.some((v) => `${v.id}@${v.version}` === key)) {
    p.lastUpdate = new Date().toISOString();
    writePharmacopoeia(repoRoot, p);
    return p;
  }
  p.vaccines.push({
    id: vaccine.id,
    strain: vaccine.strain,
    version: vaccine.version,
    source,
    inheritedFromChromosome: inheritedFrom,
    efficacy: readBenchmark(repoRoot, vaccine.id),
    registeredAt: new Date().toISOString(),
  });
  p.lastUpdate = new Date().toISOString();
  writePharmacopoeia(repoRoot, p);
  return p;
}

/** Update efficacy snapshots for every vaccine (called after a benchmark run). */
export function refreshEfficacies(repoRoot: string): Pharmacopoeia {
  const p = readPharmacopoeia(repoRoot);
  for (const entry of p.vaccines) {
    entry.efficacy = readBenchmark(repoRoot, entry.id);
  }
  p.lastUpdate = new Date().toISOString();
  writePharmacopoeia(repoRoot, p);
  return p;
}
