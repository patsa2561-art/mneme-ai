/**
 * Fertilize — at session start, combine the lineage's most recent
 * chromosomes into a "boot context" the AI agent inherits automatically.
 *
 * Default policy: pick top-3 most recent chromosomes (across all vendors)
 * → mendelMerge them pairwise → present as a single inheritance bundle
 * to the agent at boot.
 *
 * The bundle is NOT a chromosome itself — it's a transient inheritance
 * record that lives only for the new session. When THAT session
 * crystallizes, the new chromosome's `parents` will reference these
 * source chromosomes.
 *
 * Performance budget: < 300ms cold (3 chromosomes × ~200KB each).
 */

import { listChromosomes, loadChromosome } from "./chromosome.js";
import { mendelMerge, type MendelChild } from "./mendel.js";
import type { Chromosome } from "./types.js";

export interface InheritanceBundle {
  /** IDs of the chromosomes that contributed. */
  sourceIds: string[];
  /** Vendors represented in the parents (deduped). */
  vendors: string[];
  /** Total atoms inherited. */
  inheritedAtomCount: number;
  /** Top 5 inherited molecules (by fireCount). */
  topMolecules: MendelChild["molecules"];
  /** Atoms lethal-recessived (will NOT be re-suggested). */
  lethalRecessives: string[];
  /** Top 5 inherited constitution candidates. */
  inheritedRules: MendelChild["constitutionCandidates"];
  /** Free-text summary the AI agent surfaces to the user. */
  narrative: string;
  /** Aggregate health snapshot. */
  signals: {
    overallKarma: number;
    avgSelfConfidence: number;
    totalCallsAcrossParents: number;
  };
}

export interface FertilizeOptions {
  /** How many recent chromosomes to combine. Default 3. */
  topN?: number;
  /** Specific parent IDs to use instead of "most recent". */
  parentIds?: string[];
}

/** Fertilize the next session — produces an InheritanceBundle, no
 *  persisted chromosome (the new session crystallizes its own).
 *
 *  Default policy: top-N MOST RECENT chromosomes on disk (regardless of
 *  parent chain). This is robust to gaps — chromosomes don't need to be
 *  perfectly linked to inherit. The next chromosome's `parents` field
 *  records the actual ancestry. */
export function fertilize(repoRoot: string, opts: FertilizeOptions = {}): InheritanceBundle | null {
  const topN = Math.max(1, Math.min(5, opts.topN ?? 3));
  let chosenIds: string[];
  if (opts.parentIds && opts.parentIds.length > 0) {
    chosenIds = opts.parentIds;
  } else {
    chosenIds = listChromosomes(repoRoot).slice(0, topN);
    if (chosenIds.length === 0) return null;
  }
  const chromosomes: Chromosome[] = [];
  for (const id of chosenIds) {
    try {
      chromosomes.push(loadChromosome(repoRoot, id));
    } catch {
      // Skip missing/corrupt chromosomes — partial inheritance is OK
    }
  }
  if (chromosomes.length === 0) return null;

  // Reduce via Mendel — fold left.
  let merged: MendelChild | null = null;
  for (let i = 0; i < chromosomes.length; i++) {
    const c = chromosomes[i]!;
    if (!merged) {
      merged = mendelChildFromChromosome(c);
    } else {
      // Build a temporary chromosome-shaped object from the running merge,
      // then merge with the next parent.
      merged = mendelMerge(chromosomeFromChild(merged, c.machineId), c);
    }
  }
  if (!merged) return null;

  const vendors = Array.from(new Set(chromosomes.map((c) => c.vendor)));
  const inheritedAtomCount = Object.keys(merged.atomKarmaDeltas).length;
  const overallKarma = Object.values(merged.atomKarmaDeltas).reduce((s, a) => s + a.karma, 0);
  const totalCalls = Object.values(merged.atomKarmaDeltas).reduce((s, a) => s + a.invocations, 0);

  const narrative = buildNarrative({
    sourceCount: chromosomes.length,
    vendors,
    topMolecule: merged.molecules[0]?.name,
    overallKarma,
    lethalCount: merged.lethalRecessives.length,
  });

  return {
    sourceIds: chromosomes.map((c) => c.id),
    vendors,
    inheritedAtomCount,
    topMolecules: merged.molecules.slice(0, 5),
    lethalRecessives: merged.lethalRecessives,
    inheritedRules: merged.constitutionCandidates.slice(0, 5),
    narrative,
    signals: {
      overallKarma: Math.round(overallKarma * 100) / 100,
      avgSelfConfidence: merged.confessOutcomes.avgSelfConfidence,
      totalCallsAcrossParents: totalCalls,
    },
  };
}

function mendelChildFromChromosome(c: Chromosome): MendelChild {
  return {
    parents: [c.id],
    vectorClock: { ...c.vectorClock },
    topic: c.topic,
    atomKarmaDeltas: { ...c.atomKarmaDeltas },
    molecules: [...c.molecules],
    courtVerdicts: [...c.courtVerdicts],
    confessOutcomes: { ...c.confessOutcomes },
    voiceFingerprint: { ...c.voiceFingerprint },
    constitutionCandidates: [...c.constitutionCandidates],
    lethalRecessives: [...c.lethalRecessives],
  };
}

function chromosomeFromChild(child: MendelChild, machineId: string): Chromosome {
  return {
    schemaVersion: 1,
    id: "<merging>",
    createdAt: new Date().toISOString(),
    vendor: "merged",
    machineId,
    parents: child.parents,
    vectorClock: child.vectorClock,
    topic: child.topic,
    atomKarmaDeltas: child.atomKarmaDeltas,
    molecules: child.molecules,
    courtVerdicts: child.courtVerdicts,
    confessOutcomes: child.confessOutcomes,
    voiceFingerprint: child.voiceFingerprint,
    constitutionCandidates: child.constitutionCandidates,
    lethalRecessives: child.lethalRecessives,
    session: { startedAt: "", endedAt: "", totalCalls: 0, endReason: "manual" },
    signedBy: "",
    signature: "",
    contentHash: "",
  };
}

function buildNarrative(opts: {
  sourceCount: number;
  vendors: string[];
  topMolecule: string | undefined;
  overallKarma: number;
  lethalCount: number;
}): string {
  const lines: string[] = [];
  const vendorList = opts.vendors.length === 1
    ? `${opts.vendors[0]}`
    : `${opts.vendors.slice(0, -1).join(", ")} + ${opts.vendors[opts.vendors.length - 1]}`;
  lines.push(`Inherited from ${opts.sourceCount} prior session${opts.sourceCount === 1 ? "" : "s"} (${vendorList}).`);
  if (opts.topMolecule) lines.push(`Top molecule carried forward: ${opts.topMolecule}.`);
  lines.push(`Aggregate karma: ${opts.overallKarma >= 0 ? "+" : ""}${opts.overallKarma.toFixed(1)}.`);
  if (opts.lethalCount > 0) {
    lines.push(`${opts.lethalCount} atom${opts.lethalCount === 1 ? "" : "s"} flagged lethal-recessive (will not be re-suggested).`);
  }
  return lines.join(" ");
}
