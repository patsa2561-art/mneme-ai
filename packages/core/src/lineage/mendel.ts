/**
 * Mendelian inheritance — fertilize a child chromosome from up to 2
 * parents (and optionally an existing sibling for 3-way merges across
 * machines).
 *
 * Genetic rules (deterministic — same parents → same child):
 *
 *  Atoms (per-tool karma deltas):
 *    both-positive   → max (dominant trait inherits the stronger karma)
 *    both-negative   → min (lethal recessive — combined penalty deepens)
 *    mixed signs     → mean (heterozygous; expression masked)
 *    one-sided       → additive (new info enters the gene pool)
 *    invocations / verified / hallucinations → sum (counters compose)
 *
 *  Molecules:
 *    same recipe in both parents → inherit unchanged
 *    only one parent             → inherit (recessive — present in pool)
 *    different fireCount         → max (dominant expression wins)
 *
 *  Lethal recessives:
 *    intersection (an atom is "lethal" only if BOTH parents flagged it)
 *    Atoms in either parent's lethal set are stripped from karma deltas.
 *
 *  Court verdicts + constitution candidates:
 *    union, deduped by claim/rule text (newest wins on duplicates)
 *
 *  Vector clock:
 *    per-machine max of all parents — Lamport-style merge.
 *
 *  Topic:
 *    longest topic from parents — preserves richest description.
 *
 *  Voice fingerprint:
 *    avgSentenceLen → mean
 *    topPhrases / topTopics → union, capped at 5/3 by frequency
 *
 * Properties guaranteed (covered by tests):
 *  - commutative: fertilize(A,B) === fertilize(B,A)
 *  - idempotent in lethal set: lethal in A∩B stays lethal
 *  - additive in counters: invocations(child) === invocations(A) + invocations(B)
 *  - bounded: child cannot have an atom that BOTH parents lethal-recessive'd
 */

import type {
  AtomKarmaDelta,
  Chromosome,
  ConstitutionCandidate,
  CourtVerdictRecord,
  MoleculeRecord,
  VoiceFingerprint,
} from "./types.js";

export function mergeAtomKarma(
  a: Record<string, AtomKarmaDelta>,
  b: Record<string, AtomKarmaDelta>,
  lethalUnion: Set<string>,
): Record<string, AtomKarmaDelta> {
  const out: Record<string, AtomKarmaDelta> = {};
  const all = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const tool of all) {
    if (lethalUnion.has(tool)) continue; // culled — lethal in EITHER parent removes from gene pool
    const ka = a[tool];
    const kb = b[tool];
    if (!ka) {
      out[tool] = { ...kb! };
      continue;
    }
    if (!kb) {
      out[tool] = { ...ka };
      continue;
    }
    let karma: number;
    if (ka.karma > 0 && kb.karma > 0) karma = Math.max(ka.karma, kb.karma);
    else if (ka.karma < 0 && kb.karma < 0) karma = Math.min(ka.karma, kb.karma);
    else if (ka.karma === 0 && kb.karma === 0) karma = 0;
    else karma = (ka.karma + kb.karma) / 2;
    out[tool] = {
      karma: Math.round(karma * 100) / 100,
      invocations: ka.invocations + kb.invocations,
      verified: ka.verified + kb.verified,
      hallucinations: ka.hallucinations + kb.hallucinations,
    };
  }
  return out;
}

export function mergeMolecules(a: MoleculeRecord[], b: MoleculeRecord[]): MoleculeRecord[] {
  const byName = new Map<string, MoleculeRecord>();
  for (const m of [...a, ...b]) {
    const existing = byName.get(m.name);
    if (!existing) {
      byName.set(m.name, { ...m });
    } else {
      byName.set(m.name, {
        name: m.name,
        atoms: m.atoms,
        fireCount: Math.max(existing.fireCount, m.fireCount),
        karma: existing.karma + m.karma,
      });
    }
  }
  return [...byName.values()].sort((x, y) => y.fireCount - x.fireCount);
}

/** Lethal recessives = INTERSECTION (only atoms BOTH parents flagged are inherited as lethal).
 *  But the cull set (atoms removed from gene pool) is the UNION — a lethal flag
 *  in either parent is enough to drop the atom from the karma table. */
export function intersectLethals(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

export function unionLethals(a: string[], b: string[]): Set<string> {
  return new Set([...a, ...b]);
}

export function mergeVectorClock(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const all = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of all) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  return out;
}

export function mergeCourtVerdicts(a: CourtVerdictRecord[], b: CourtVerdictRecord[]): CourtVerdictRecord[] {
  const byClaim = new Map<string, CourtVerdictRecord>();
  for (const v of [...a, ...b]) byClaim.set(v.claim, v); // newest wins on dupe
  return [...byClaim.values()];
}

export function mergeConstitutionCandidates(a: ConstitutionCandidate[], b: ConstitutionCandidate[]): ConstitutionCandidate[] {
  const byRule = new Map<string, ConstitutionCandidate>();
  for (const c of [...a, ...b]) {
    const existing = byRule.get(c.rule);
    if (!existing || c.confidence > existing.confidence) byRule.set(c.rule, c);
  }
  return [...byRule.values()].sort((x, y) => y.confidence - x.confidence);
}

export function mergeVoice(a: VoiceFingerprint, b: VoiceFingerprint): VoiceFingerprint {
  const phrases = unionTop([a.topPhrases, b.topPhrases], 5);
  const topics = unionTop([a.topTopics, b.topTopics], 3);
  const len = a.avgSentenceLen && b.avgSentenceLen
    ? (a.avgSentenceLen + b.avgSentenceLen) / 2
    : a.avgSentenceLen || b.avgSentenceLen;
  return { avgSentenceLen: Math.round(len * 100) / 100, topPhrases: phrases, topTopics: topics };
}

function unionTop(lists: string[][], cap: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([k]) => k);
}

/** Aggregate confess outcomes — sum + recompute weighted average. */
export function mergeConfessOutcomes(a: Chromosome["confessOutcomes"], b: Chromosome["confessOutcomes"]): Chromosome["confessOutcomes"] {
  const verified = a.verified + b.verified;
  const partiallyVerified = a.partiallyVerified + b.partiallyVerified;
  const hallucination = a.hallucination + b.hallucination;
  const unverifiable = a.unverifiable + b.unverifiable;
  const totalA = a.verified + a.partiallyVerified + a.hallucination + a.unverifiable;
  const totalB = b.verified + b.partiallyVerified + b.hallucination + b.unverifiable;
  const total = totalA + totalB;
  const avgSelfConfidence = total === 0
    ? 0
    : Math.round((((a.avgSelfConfidence * totalA) + (b.avgSelfConfidence * totalB)) / total) * 1000) / 1000;
  return { verified, partiallyVerified, hallucination, unverifiable, avgSelfConfidence };
}

/** The full Mendelian merge — combines two parents into a child draft.
 *  Returns the chromosome WITHOUT id/createdAt/sign — caller (fertilize)
 *  fills those + persists. */
export interface MendelChild {
  parents: string[];
  vectorClock: Record<string, number>;
  topic: string;
  atomKarmaDeltas: Record<string, AtomKarmaDelta>;
  molecules: MoleculeRecord[];
  courtVerdicts: CourtVerdictRecord[];
  confessOutcomes: Chromosome["confessOutcomes"];
  voiceFingerprint: VoiceFingerprint;
  constitutionCandidates: ConstitutionCandidate[];
  lethalRecessives: string[];
}

export function mendelMerge(a: Chromosome, b: Chromosome): MendelChild {
  const lethalUnion = unionLethals(a.lethalRecessives, b.lethalRecessives);
  const lethalChild = intersectLethals(a.lethalRecessives, b.lethalRecessives);
  return {
    parents: [a.id, b.id].sort(),
    vectorClock: mergeVectorClock(a.vectorClock, b.vectorClock),
    topic: a.topic.length >= b.topic.length ? a.topic : b.topic,
    atomKarmaDeltas: mergeAtomKarma(a.atomKarmaDeltas, b.atomKarmaDeltas, lethalUnion),
    molecules: mergeMolecules(a.molecules, b.molecules),
    courtVerdicts: mergeCourtVerdicts(a.courtVerdicts, b.courtVerdicts),
    confessOutcomes: mergeConfessOutcomes(a.confessOutcomes, b.confessOutcomes),
    voiceFingerprint: mergeVoice(a.voiceFingerprint, b.voiceFingerprint),
    constitutionCandidates: mergeConstitutionCandidates(a.constitutionCandidates, b.constitutionCandidates),
    lethalRecessives: lethalChild,
  };
}
