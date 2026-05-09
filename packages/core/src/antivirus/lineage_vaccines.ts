/**
 * Mneme Antivirus -- Lamarckian inheritance via MneMeiosis chromosomes.
 *
 * Every chromosome carries a `vaccineSignatures[]` array listing the
 * vaccines that were active when the chromosome was crystallized + their
 * efficacy snapshots. When a new session inherits via fertilize(), we
 * merge the top-3 ancestors' vaccineSignatures into the current
 * pharmacopoeia, picking the highest-efficacy variant per strain.
 *
 * This is biologically Lamarckian (inheritance of acquired traits):
 * vaccines a parent session learned about flow into the child without
 * the child having to encounter the original strain.
 */

import type { Pharmacopoeia, PharmacopoeiaEntry, VaccineEfficacy } from "./types.js";
import { readPharmacopoeia, writePharmacopoeia } from "./pharmacopoeia.js";

/** Shape we serialize into chromosome.vaccineSignatures[]. Stable across
 *  versions; new fields must be optional. */
export interface VaccineSignature {
  id: string;
  strain: string;
  version: string;
  source: PharmacopoeiaEntry["source"];
  efficacy: VaccineEfficacy | null;
  registeredAt: string;
}

/** Snapshot the current pharmacopoeia for inclusion in a chromosome. */
export function snapshotForChromosome(repoRoot: string): VaccineSignature[] {
  const p = readPharmacopoeia(repoRoot);
  return p.vaccines.map((v) => ({
    id: v.id,
    strain: v.strain,
    version: v.version,
    source: v.source,
    efficacy: v.efficacy ?? null,
    registeredAt: v.registeredAt,
  }));
}

/** Merge inherited signatures into the local pharmacopoeia. Strategy:
 *    For every strain, pick the (id, version) with the HIGHEST F1 score
 *    across local + inherited; if tied, prefer local (stability).
 *  Returns the merged Pharmacopoeia. */
export function mergeInheritedVaccines(
  repoRoot: string,
  inherited: { chromosomeId: string; signatures: VaccineSignature[] }[],
): Pharmacopoeia {
  const local = readPharmacopoeia(repoRoot);
  const byKey = new Map<string, { entry: PharmacopoeiaEntry; f1: number; isLocal: boolean }>();

  function f1Of(eff: VaccineEfficacy | null | undefined): number {
    return eff?.f1 ?? -1; // unverified efficacy < any verified score
  }

  for (const v of local.vaccines) {
    const key = `${v.strain}|${v.id}|${v.version}`;
    byKey.set(key, { entry: v, f1: f1Of(v.efficacy), isLocal: true });
  }

  for (const { chromosomeId, signatures } of inherited) {
    for (const sig of signatures) {
      const key = `${sig.strain}|${sig.id}|${sig.version}`;
      const candidateF1 = f1Of(sig.efficacy);
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, {
          entry: {
            id: sig.id,
            strain: sig.strain as PharmacopoeiaEntry["strain"],
            version: sig.version,
            source: "inherited",
            inheritedFromChromosome: chromosomeId,
            efficacy: sig.efficacy,
            registeredAt: new Date().toISOString(),
          },
          f1: candidateF1,
          isLocal: false,
        });
      } else if (candidateF1 > cur.f1) {
        // Inherited beats local on F1 -> upgrade efficacy snapshot.
        cur.entry.efficacy = sig.efficacy;
        cur.f1 = candidateF1;
      }
    }
  }

  const merged: Pharmacopoeia = {
    schemaVersion: 1,
    vaccines: Array.from(byKey.values())
      .map((v) => v.entry)
      .sort((a, b) => a.strain.localeCompare(b.strain) || a.id.localeCompare(b.id)),
    lastUpdate: new Date().toISOString(),
  };
  writePharmacopoeia(repoRoot, merged);
  return merged;
}
