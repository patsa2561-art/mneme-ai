/**
 * NUCLEUS (v1.20.0 scaffold) — the Infinity Wisdom Brain.
 *
 * Biology mapping:
 *   • Nucleus = central organelle that controls cell activity (always alive,
 *     never sleeps as long as the cell does).
 *   • DNA = the genetic blueprint inside the nucleus.
 *   • Chromosomes = DNA wrapped + organized for inheritance.
 *   • Mitosis = division that replicates DNA + produces a fitter copy.
 *   • Mutation = small noise on each replication that drives evolution.
 *
 * Mneme mapping:
 *   • Nucleus = the persistent infinity loop that runs as long as the
 *     MCP server is alive. Tracks ticks, mutations, consolidations.
 *   • DNA = aggregate of all chromosomes' karma + molecules + streaks
 *     into ONE living state vector.
 *   • Each tick: mutate (small noise on karma deltas), consolidate
 *     (compress old chromosomes), synthesize (emit a new lesson).
 *   • The DNA NEVER resets — it strictly grows + evolves + gets fitter.
 *
 * Why this matters for AI agents:
 *   • Every conversation feeds the nucleus.
 *   • Next conversation INHERITS the evolved nucleus → AI starts smarter
 *     than last time, every time.
 *   • The compounding is exponential: nucleus(t) > nucleus(t-1) > ...
 *
 * v1.20.0 ships the scaffold — tick counter, dna snapshot, manual
 * mutate. v1.21 will add the persistent daemon + auto-tick + lesson
 * generation + cross-session inheritance via lineage merge hooks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { listChromosomes, loadChromosome } from "./lineage/chromosome.js";
import { readStreaks, type StreaksState } from "./karma_streaks.js";

const NUCLEUS_FILE = ".mneme/nucleus.json";

export interface NucleusState {
  schemaVersion: 1;
  /** Tick counter — strictly monotonic. */
  tick: number;
  /** ISO timestamp of nucleus birth. */
  bornAt: string;
  /** ISO timestamp of last tick. */
  lastTick: string;
  /** Number of mutations applied since birth. */
  mutations: number;
  /** Number of consolidations applied since birth. */
  consolidations: number;
  /** Aggregate DNA hash — fingerprint of the current state. */
  dnaHash: string;
  /** Aggregate growth metrics — strictly non-decreasing. */
  growth: {
    /** Total chromosomes ever observed. */
    chromosomesEver: number;
    /** Sum of all atom invocations across all chromosomes. */
    totalCalls: number;
    /** Sum of verified outcomes ever. */
    totalVerified: number;
    /** Best streak ever achieved. */
    bestVerifiedStreak: number;
    /** Distinct AI vendors that contributed. */
    vendorCount: number;
  };
  /** Wisdom score — derived from growth + streaks. NEVER decreases (a hallucination drops streak but grows totalCalls — net positive). */
  wisdomScore: number;
  /** Most recent lessons synthesized — each tick can add one. */
  lessons: NucleusLesson[];
}

export interface NucleusLesson {
  id: string;
  tick: number;
  bornAt: string;
  /** One-sentence note describing what changed at this tick. */
  text: string;
  /** Source: what observation triggered this lesson. */
  source: string;
  /** v1.50.0 -- evidence kind to surface honestly:
   *  "milestone"    = tick-counter narrative, no specific data behind it
   *  "growth-event" = a measurable change (chromosomes / vendors / verified)
   *                   with the specific delta + sample IDs in `evidence`
   *  "consolidation" = nucleus stayed alive at a milestone tick
   *  Pre-v1.50.0 all entries lied about being "wisdom"; now the kind makes
   *  the substance honest.
   */
  kind?: "milestone" | "growth-event" | "consolidation";
  /** v1.50.0 -- concrete evidence behind this lesson (chromosome IDs,
   *  vendor names, etc.). Empty array = no evidence = milestone, not
   *  wisdom. Surfaces honestly in `mneme nucleus lessons`. */
  evidence?: string[];
}

function emptyNucleus(): NucleusState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    tick: 0,
    bornAt: now,
    lastTick: now,
    mutations: 0,
    consolidations: 0,
    dnaHash: "",
    growth: { chromosomesEver: 0, totalCalls: 0, totalVerified: 0, bestVerifiedStreak: 0, vendorCount: 0 },
    wisdomScore: 0,
    lessons: [],
  };
}

export function readNucleus(repoRoot: string): NucleusState {
  const path = join(repoRoot, NUCLEUS_FILE);
  if (!existsSync(path)) return emptyNucleus();
  try {
    return { ...emptyNucleus(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return emptyNucleus();
  }
}

function writeNucleus(repoRoot: string, n: NucleusState): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(repoRoot, NUCLEUS_FILE), JSON.stringify(n, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Aggregate the live DNA from all chromosomes + streaks. Pure read.
 *  Used by tick() to compute current growth + wisdom score.
 *
 *  v1.50.0 — also returns the specific chromosome IDs + vendor names
 *  observed, so lesson synthesis can CITE real evidence instead of
 *  emitting tick-counter filler. */
function aggregateDna(repoRoot: string, streaks: StreaksState): NucleusState["growth"] & { dnaHash: string; chromosomeIds: string[]; vendors: string[] } {
  const ids = listChromosomes(repoRoot);
  let totalCalls = 0;
  const vendors = new Set<string>();
  let totalVerified = streaks.totalVerified;
  for (const id of ids) {
    try {
      const c = loadChromosome(repoRoot, id);
      totalCalls += c.session.totalCalls;
      vendors.add(c.vendor);
      totalVerified += c.confessOutcomes.verified;
    } catch { /* skip */ }
  }
  const dnaHash = createHash("sha256")
    .update(`${ids.length}|${totalCalls}|${totalVerified}|${streaks.bestVerifiedStreak}|${vendors.size}`)
    .digest("hex")
    .slice(0, 16);
  return {
    chromosomesEver: ids.length,
    totalCalls,
    totalVerified,
    bestVerifiedStreak: streaks.bestVerifiedStreak,
    vendorCount: vendors.size,
    dnaHash,
    chromosomeIds: ids,
    vendors: [...vendors],
  };
}

/** Compute a wisdom score (always non-decreasing — that's the point of
 *  the infinity brain). Formula:
 *    sqrt(totalCalls) + 2 × sqrt(totalVerified) + bestStreak × 0.5 + vendorCount × 3
 *  Square root keeps growth sub-linear so individual events don't dominate.
 *  Lesson count adds a small constant — the brain remembers what it learned. */
function computeWisdomScore(g: NucleusState["growth"], lessonCount: number): number {
  const score =
    Math.sqrt(g.totalCalls) +
    2 * Math.sqrt(g.totalVerified) +
    g.bestVerifiedStreak * 0.5 +
    g.vendorCount * 3 +
    lessonCount * 1.5;
  return Math.round(score * 100) / 100;
}

/** Synthesize a lesson from the current growth deltas. Heuristic — picks
 *  the most "informative" delta since last tick + turns it into a sentence.
 *
 *  v1.50.0 — every lesson now carries an `evidence` array citing the
 *  SPECIFIC chromosomes / vendors / outcomes that grew. Pre-v1.50 these
 *  were generic filler ("X new outcomes this tick -- DNA fitness rising");
 *  testers correctly called this out as a marketing lie. The new shape
 *  is honest: if `evidence.length === 0`, the lesson is a TICK MILESTONE,
 *  not wisdom. The `kind` field surfaces this distinction.
 */
function synthesizeLesson(
  prev: NucleusState,
  curr: NucleusState["growth"],
  evidence: { chromosomeIds: string[]; vendors: string[] } = { chromosomeIds: [], vendors: [] },
): NucleusLesson | null {
  const newChromosomes = curr.chromosomesEver - prev.growth.chromosomesEver;
  const newCalls = curr.totalCalls - prev.growth.totalCalls;
  const newVerified = curr.totalVerified - prev.growth.totalVerified;
  const newVendors = curr.vendorCount - prev.growth.vendorCount;
  let text: string | null = null;
  let source = "";
  let kind: NucleusLesson["kind"] = "growth-event";
  let citedEvidence: string[] = [];
  // v1.23.2 — ASCII-only text in file-persisted strings. Em-dash bytes
  // (e2 80 94) get mojibake'd when Windows tools read .mneme/nucleus.json
  // with the system codepage (cp874 / cp1252) instead of UTF-8.
  // `--` is bulletproof in every encoding.
  if (newVendors > 0) {
    const sample = evidence.vendors.slice(-newVendors).slice(0, 3);
    text = sample.length > 0
      ? `New AI vendor${newVendors === 1 ? "" : "s"} joined: ${sample.join(", ")} (now ${curr.vendorCount} vendor${curr.vendorCount === 1 ? "" : "s"} total).`
      : `${newVendors} new AI vendor${newVendors === 1 ? "" : "s"} this tick (${curr.vendorCount} total).`;
    source = "newVendor";
    citedEvidence = sample;
  } else if (newVerified > 0) {
    text = `+${newVerified} verified outcome${newVerified === 1 ? "" : "s"} this tick (running total: ${curr.totalVerified}).`;
    source = "newVerified";
    // No specific IDs available here -- be honest about it.
    kind = newVerified >= 5 ? "growth-event" : "milestone";
  } else if (newChromosomes > 0) {
    const sample = evidence.chromosomeIds.slice(-newChromosomes).slice(0, 3);
    text = sample.length > 0
      ? `+${newChromosomes} chromosome${newChromosomes === 1 ? "" : "s"} crystallized: ${sample.map((s) => s.slice(0, 8)).join(", ")}.`
      : `+${newChromosomes} chromosome${newChromosomes === 1 ? "" : "s"} crystallized (running total: ${curr.chromosomesEver}).`;
    source = "newChromosome";
    citedEvidence = sample;
  } else if (newCalls > 0) {
    // Pre-fix: "X calls this tick -- DNA fitness rising" = filler.
    // Post-fix: state it plainly as a counter increment, NOT wisdom.
    text = `+${newCalls} tool call${newCalls === 1 ? "" : "s"} this tick (running total: ${curr.totalCalls}). Counter increment, no new structural growth.`;
    source = "newCalls";
    kind = "milestone";
  }
  if (!text) return null;
  return {
    id: createHash("sha256").update(`${prev.tick}|${text}`).digest("hex").slice(0, 8),
    tick: prev.tick + 1,
    bornAt: new Date().toISOString(),
    text,
    source,
    kind,
    evidence: citedEvidence,
  };
}

/** v1.23.2 — periodic CONSOLIDATION lesson when there's no growth this
 *  tick. Surfaces nucleus-is-alive evidence to the user at meaningful
 *  milestones. Without this, a stable nucleus looks like a frozen daemon. */
const PERIODIC_TICKS = new Set([5, 10, 25, 50, 100, 250, 500, 1000]);
function maybePeriodicLesson(
  prev: NucleusState,
  curr: NucleusState["growth"],
): NucleusLesson | null {
  const nextTick = prev.tick + 1;
  if (!PERIODIC_TICKS.has(nextTick)) return null;
  let text: string;
  if (nextTick === 5) {
    text = "5 ticks of stable DNA -- nucleus has consolidated this knowledge baseline.";
  } else if (nextTick === 10) {
    const div = curr.vendorCount;
    text = `10 ticks complete. Vendor diversity = ${div}; baseline DNA fingerprint locked in.`;
  } else if (nextTick === 25) {
    text = `25 ticks. ${curr.totalCalls} call${curr.totalCalls === 1 ? "" : "s"} aggregated; nucleus is steady.`;
  } else if (nextTick === 50) {
    text = `50-tick milestone. Knowledge has compounded; ${curr.chromosomesEver} chromosome${curr.chromosomesEver === 1 ? "" : "s"} in lineage.`;
  } else if (nextTick === 100) {
    text = `Century tick (100). DNA has had 100 cycles to stabilize; nucleus is mature.`;
  } else if (nextTick === 250) {
    text = `250 ticks. Long-running session -- nucleus has seen ${curr.totalVerified} verified outcomes.`;
  } else if (nextTick === 500) {
    text = `500 ticks. The nucleus is now a stable substrate for inheritance.`;
  } else {
    text = `Milestone tick #${nextTick}. Nucleus continues to consolidate.`;
  }
  return {
    id: createHash("sha256").update(`periodic|${nextTick}|${text}`).digest("hex").slice(0, 8),
    tick: nextTick,
    bornAt: new Date().toISOString(),
    text,
    source: "periodic",
    kind: "consolidation",   // v1.50.0 -- honest label, not "wisdom"
    evidence: [],
  };
}

export interface TickResult {
  state: NucleusState;
  delta: {
    growthSinceLastTick: { chromosomes: number; calls: number; verified: number; vendors: number };
    wisdomScoreDelta: number;
    newLesson: NucleusLesson | null;
  };
}

/** Apply ONE tick to the nucleus. Aggregates DNA, computes growth,
 *  synthesizes optional lesson, persists. Idempotent enough to call
 *  on every MCP request without runaway state. */
export function tick(repoRoot: string): TickResult {
  const prev = readNucleus(repoRoot);
  const streaks = readStreaks(repoRoot);
  const aggregated = aggregateDna(repoRoot, streaks);
  // v1.23.2 — when there's no growth-driven lesson, emit a CONSOLIDATION
  // lesson at tick milestones (5/10/25/50/100/250/500) so the user sees
  // the nucleus is still thinking. UX problem reported: stable ticks
  // looked like the daemon had crashed.
  // v1.50.0 — pass real evidence (chromosome IDs + vendor names) so the
  // lesson cites concrete data instead of generic filler.
  const newLesson = synthesizeLesson(prev, aggregated, { chromosomeIds: aggregated.chromosomeIds, vendors: aggregated.vendors })
    ?? maybePeriodicLesson(prev, aggregated);
  const lessons = newLesson ? [...prev.lessons, newLesson].slice(-50) : prev.lessons;
  const wisdomScore = computeWisdomScore(aggregated, lessons.length);
  const next: NucleusState = {
    schemaVersion: 1,
    tick: prev.tick + 1,
    bornAt: prev.tick === 0 ? new Date().toISOString() : prev.bornAt,
    lastTick: new Date().toISOString(),
    mutations: prev.mutations,
    consolidations: prev.consolidations,
    dnaHash: aggregated.dnaHash,
    growth: {
      chromosomesEver: aggregated.chromosomesEver,
      totalCalls: aggregated.totalCalls,
      totalVerified: aggregated.totalVerified,
      bestVerifiedStreak: aggregated.bestVerifiedStreak,
      vendorCount: aggregated.vendorCount,
    },
    wisdomScore,
    lessons,
  };
  writeNucleus(repoRoot, next);
  return {
    state: next,
    delta: {
      growthSinceLastTick: {
        chromosomes: aggregated.chromosomesEver - prev.growth.chromosomesEver,
        calls: aggregated.totalCalls - prev.growth.totalCalls,
        verified: aggregated.totalVerified - prev.growth.totalVerified,
        vendors: aggregated.vendorCount - prev.growth.vendorCount,
      },
      wisdomScoreDelta: Math.round((wisdomScore - prev.wisdomScore) * 100) / 100,
      newLesson,
    },
  };
}

/** Apply N mutation cycles — increments mutation counter (sync, fast).
 *  For ACTUAL chromosome evolution, call `evolveOnce()` (async, requires
 *  lineage modules + does I/O). Separated to keep `mutate` cheap for the
 *  hot MCP dispatch path. */
export function mutate(repoRoot: string, cycles = 1): NucleusState {
  const n = readNucleus(repoRoot);
  n.mutations += cycles;
  n.lastTick = new Date().toISOString();
  writeNucleus(repoRoot, n);
  return n;
}

/** v1.21 — REAL evolution: take the most-recent chromosome, apply
 *  structured mutations (karma noise + molecule drift), persist as a
 *  new chromosome with parent = original. Async to allow dynamic
 *  import of the lineage barrel without a circular load.
 *
 *  Selection pressure is implicit: mutations that produce HIGHER
 *  per-call verified rates persist (fertilize picks ancestors by
 *  recency × karma, so fitter chromosomes win inheritance). Bad
 *  mutations age out + drop from the top-3 window.
 *
 *  Returns the new chromosome ID, or null when no chromosome exists
 *  to mutate from. */
export async function evolveOnce(repoRoot: string): Promise<string | null> {
  // Dynamic import avoids the circular load (lineage barrel re-exports
  // nucleus.ts via core/index.ts).
  const lineage = await import("./lineage/index.js");
  const ids = lineage.listChromosomes(repoRoot);
  if (ids.length === 0) return null;
  const parent = lineage.loadChromosome(repoRoot, ids[0]!);

  // 1. Karma noise: ±5% on each atom karma, bounded to [-100, +100].
  const newKarma: typeof parent.atomKarmaDeltas = {};
  for (const [name, k] of Object.entries(parent.atomKarmaDeltas)) {
    const noise = (Math.random() - 0.5) * 0.1;
    const next = k.karma * (1 + noise);
    newKarma[name] = { ...k, karma: Math.max(-100, Math.min(100, Math.round(next * 100) / 100)) };
  }

  // 2. Molecule drift: pick the LOWEST-karma molecule, drop one atom.
  let newMolecules = parent.molecules;
  if (parent.molecules.length > 0) {
    const sorted = [...parent.molecules].sort((a, b) => a.karma - b.karma);
    const target = sorted[0]!;
    if (target.atoms.length > 1) {
      const dropIndex = Math.floor(Math.random() * target.atoms.length);
      const newAtoms = target.atoms.filter((_, i) => i !== dropIndex);
      newMolecules = parent.molecules.map((m) =>
        m.name === target.name ? { ...m, atoms: newAtoms, name: newAtoms.join("__").slice(0, 80) } : m,
      );
    }
  }

  // 3. Persist as a new chromosome with parent = original.
  const createdAt = new Date().toISOString();
  const childDraft = {
    schemaVersion: 1 as const,
    id: lineage.buildChromosomeId(createdAt, "nucleus-mutation", parent.contentHash.slice(0, 8)),
    createdAt,
    vendor: "nucleus-mutation",
    machineId: parent.machineId,
    parents: [parent.id],
    vectorClock: parent.vectorClock,
    topic: `[mutation of ${parent.topic}]`,
    atomKarmaDeltas: newKarma,
    molecules: newMolecules,
    courtVerdicts: parent.courtVerdicts,
    confessOutcomes: parent.confessOutcomes,
    voiceFingerprint: parent.voiceFingerprint,
    constitutionCandidates: parent.constitutionCandidates,
    lethalRecessives: parent.lethalRecessives,
    session: { ...parent.session, endReason: "incremental" as const },
  };
  const child = lineage.persistChromosome(repoRoot, childDraft);
  lineage.addToTree(repoRoot, child);
  return child.id;
}

/** Snapshot the current DNA state as a single line the agent can quote. */
export function dnaBanner(n: NucleusState): string {
  return `tick #${n.tick} · DNA ${n.dnaHash} · wisdom ${n.wisdomScore} · ${n.growth.chromosomesEver} chromosomes · ${n.growth.vendorCount} vendor${n.growth.vendorCount === 1 ? "" : "s"} · ${n.lessons.length} lesson${n.lessons.length === 1 ? "" : "s"} learned`;
}
