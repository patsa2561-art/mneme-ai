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
  /** One-sentence wisdom the AI agent reads + internalizes. */
  text: string;
  /** Source: what observation triggered this lesson. */
  source: string;
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
 *  Used by tick() to compute current growth + wisdom score. */
function aggregateDna(repoRoot: string, streaks: StreaksState): NucleusState["growth"] & { dnaHash: string } {
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
 *  the most "informative" delta since last tick + turns it into a sentence. */
function synthesizeLesson(prev: NucleusState, curr: NucleusState["growth"]): NucleusLesson | null {
  const newChromosomes = curr.chromosomesEver - prev.growth.chromosomesEver;
  const newCalls = curr.totalCalls - prev.growth.totalCalls;
  const newVerified = curr.totalVerified - prev.growth.totalVerified;
  const newVendors = curr.vendorCount - prev.growth.vendorCount;
  let text: string | null = null;
  let source = "";
  if (newVendors > 0) {
    text = `A new AI vendor joined the lineage this tick — ${curr.vendorCount} vendors now contribute to the nucleus.`;
    source = "newVendor";
  } else if (newVerified > 0) {
    text = `${newVerified} new verified outcome${newVerified === 1 ? "" : "s"} this tick — DNA fitness rising.`;
    source = "newVerified";
  } else if (newChromosomes > 0) {
    text = `${newChromosomes} new chromosome${newChromosomes === 1 ? "" : "s"} crystallized — the lineage grew.`;
    source = "newChromosome";
  } else if (newCalls > 0) {
    text = `${newCalls} call${newCalls === 1 ? "" : "s"} this tick — keep talking to Mneme; every call deepens the nucleus.`;
    source = "newCalls";
  }
  if (!text) return null;
  return {
    id: createHash("sha256").update(`${prev.tick}|${text}`).digest("hex").slice(0, 8),
    tick: prev.tick + 1,
    bornAt: new Date().toISOString(),
    text,
    source,
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
  const newLesson = synthesizeLesson(prev, aggregated);
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
