/**
 * Pedigree + speciation — analyze lineage across vendors and detect when
 * sub-lineages drift apart enough to be treated as separate species.
 *
 * Vendor pedigree:
 *   - Each chromosome carries a `vendor` field (claude-opus-4-7, cursor-cmd-k, ...)
 *   - Pedigree builds per-vendor stats: chromosome count, total karma, avg
 *     verified-vs-hallucination ratio, total invocations
 *   - `routing_hint(query)` returns the vendor whose history shows
 *     strongest fit for the query's tokens
 *
 * Speciation detection (Jaccard):
 *   - For every pair of chromosomes (in a sliding window of N most-recent),
 *     compute Jaccard distance over their molecule sets
 *   - When mean window distance > 0.7 sustained across `windowSize`
 *     consecutive comparisons → declare speciation event
 *   - Persist species cluster files to `.mneme/lineage/species/`
 */

import { listChromosomes, loadChromosome } from "./chromosome.js";
import type { Chromosome } from "./types.js";

// ─── Vendor pedigree ────────────────────────────────────────────────────

export interface VendorStats {
  vendor: string;
  chromosomeCount: number;
  totalInvocations: number;
  totalKarma: number;
  verifiedRate: number; // verified / (verified + hallucinations); 1 if no confessions
  /** Top 3 atom names this vendor is best at (highest verified count). */
  bestAtoms: string[];
  /** Most recent chromosome ID for this vendor. */
  mostRecentId: string;
  mostRecentAt: string;
}

export interface PedigreeReport {
  totalChromosomes: number;
  vendors: VendorStats[];
  /** Per-pair vendor distance — 1 - Jaccard(molecules). */
  crossVendorDistances: Array<{ a: string; b: string; distance: number }>;
}

export function buildPedigree(repoRoot: string): PedigreeReport {
  const ids = listChromosomes(repoRoot);
  const chromosomes: Chromosome[] = [];
  for (const id of ids) {
    try { chromosomes.push(loadChromosome(repoRoot, id)); } catch { /* skip */ }
  }

  const byVendor = new Map<string, Chromosome[]>();
  for (const c of chromosomes) {
    const arr = byVendor.get(c.vendor) ?? [];
    arr.push(c);
    byVendor.set(c.vendor, arr);
  }

  const vendors: VendorStats[] = [];
  for (const [vendor, list] of byVendor) {
    let totalInvocations = 0;
    let totalKarma = 0;
    let verified = 0;
    let hallucinations = 0;
    const atomVerified = new Map<string, number>();
    for (const c of list) {
      for (const [atom, k] of Object.entries(c.atomKarmaDeltas)) {
        totalInvocations += k.invocations;
        totalKarma += k.karma;
        verified += k.verified;
        hallucinations += k.hallucinations;
        atomVerified.set(atom, (atomVerified.get(atom) ?? 0) + k.verified);
      }
    }
    const sorted = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const top = sorted[0]!;
    vendors.push({
      vendor,
      chromosomeCount: list.length,
      totalInvocations,
      totalKarma: Math.round(totalKarma * 100) / 100,
      verifiedRate: verified + hallucinations === 0 ? 1 : Math.round((verified / (verified + hallucinations)) * 1000) / 1000,
      bestAtoms: [...atomVerified.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n),
      mostRecentId: top.id,
      mostRecentAt: top.createdAt,
    });
  }
  vendors.sort((a, b) => b.totalKarma - a.totalKarma);

  // Cross-vendor distances (limit to top vendors to bound work).
  const crossVendorDistances: Array<{ a: string; b: string; distance: number }> = [];
  const topVendors = vendors.slice(0, 8);
  for (let i = 0; i < topVendors.length; i++) {
    for (let j = i + 1; j < topVendors.length; j++) {
      const va = topVendors[i]!.vendor;
      const vb = topVendors[j]!.vendor;
      const setA = atomSetOf(byVendor.get(va) ?? []);
      const setB = atomSetOf(byVendor.get(vb) ?? []);
      const distance = jaccardDistance(setA, setB);
      crossVendorDistances.push({ a: va, b: vb, distance });
    }
  }
  return { totalChromosomes: chromosomes.length, vendors, crossVendorDistances };
}

function atomSetOf(chromosomes: Chromosome[]): Set<string> {
  const out = new Set<string>();
  for (const c of chromosomes) {
    for (const a of Object.keys(c.atomKarmaDeltas)) out.add(a);
  }
  return out;
}

/** Jaccard distance: 1 - (|A∩B| / |A∪B|). 0 = identical, 1 = disjoint. */
export function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return Math.round((1 - intersection / union) * 1000) / 1000;
}

/** Routing hint — given a free-text query, return the vendor whose
 *  best-atoms have most token overlap. Sub-millisecond. */
export function routingHint(repoRoot: string, query: string): { vendor: string | null; score: number; reason: string } {
  const tokens = new Set((query.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => t.length >= 3));
  if (tokens.size === 0) return { vendor: null, score: 0, reason: "query has no salient tokens" };
  const ped = buildPedigree(repoRoot);
  if (ped.vendors.length === 0) return { vendor: null, score: 0, reason: "no lineage history" };
  let best: { vendor: string; score: number } = { vendor: ped.vendors[0]!.vendor, score: 0 };
  for (const v of ped.vendors) {
    let score = 0;
    for (const atom of v.bestAtoms) {
      const atomTokens = (atom.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => t.length >= 3);
      for (const t of atomTokens) if (tokens.has(t)) score += 1;
    }
    // Weight by verifiedRate so a vendor with strong track record wins ties.
    score *= 1 + v.verifiedRate;
    if (score > best.score) best = { vendor: v.vendor, score };
  }
  if (best.score === 0) {
    // Fall back to highest-karma vendor.
    return { vendor: ped.vendors[0]!.vendor, score: 0, reason: "no atom-token overlap; falling back to highest-karma vendor" };
  }
  return {
    vendor: best.vendor,
    score: Math.round(best.score * 100) / 100,
    reason: `vendor's bestAtoms overlap query tokens with score ${best.score.toFixed(2)} (verified-weighted)`,
  };
}

// ─── Speciation detection ──────────────────────────────────────────────

export interface SpeciationEvent {
  /** ID of the chromosome where speciation first detected. */
  detectedAt: string;
  /** Recent mean Jaccard distance that crossed the threshold. */
  meanDistance: number;
  /** Window size that triggered. */
  windowSize: number;
  /** Suggested species labels (heuristic from top topics). */
  suggestedLabels: string[];
}

const DEFAULT_DISTANCE_THRESHOLD = 0.7;
const DEFAULT_WINDOW_SIZE = 5;

/** Detect speciation events by sliding-window Jaccard distance over
 *  consecutive chromosomes (newest-first). */
export function detectSpeciation(
  repoRoot: string,
  opts: { threshold?: number; windowSize?: number } = {},
): SpeciationEvent[] {
  const threshold = opts.threshold ?? DEFAULT_DISTANCE_THRESHOLD;
  const windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const ids = listChromosomes(repoRoot);
  if (ids.length < windowSize) return [];

  const chromosomes: Chromosome[] = [];
  for (const id of ids) {
    try { chromosomes.push(loadChromosome(repoRoot, id)); } catch { /* skip */ }
  }
  // Already newest-first from listChromosomes.
  const events: SpeciationEvent[] = [];
  for (let i = 0; i + windowSize <= chromosomes.length; i++) {
    const windowDistances: number[] = [];
    for (let j = i; j < i + windowSize - 1; j++) {
      const a = moleculeNameSet(chromosomes[j]!);
      const b = moleculeNameSet(chromosomes[j + 1]!);
      windowDistances.push(jaccardDistance(a, b));
    }
    if (windowDistances.length === 0) continue;
    const mean = windowDistances.reduce((s, x) => s + x, 0) / windowDistances.length;
    if (mean > threshold) {
      const detectedAt = chromosomes[i]!.id;
      const suggestedLabels = Array.from(
        new Set(chromosomes.slice(i, i + windowSize).flatMap((c) => c.voiceFingerprint.topTopics)),
      ).slice(0, 3);
      events.push({ detectedAt, meanDistance: Math.round(mean * 1000) / 1000, windowSize, suggestedLabels });
      // Skip ahead so we don't double-report on overlapping windows.
      i += windowSize - 1;
    }
  }
  return events;
}

function moleculeNameSet(c: Chromosome): Set<string> {
  return new Set(c.molecules.map((m) => m.name));
}
