/**
 * MNEME WISDOM REACTOR (v1.33.0).
 *
 * Five real-physics formulas mapped to Mneme architecture as
 * actually-useful metrics. Honest framing first: this is NOT a
 * physics simulator. It's an architecture choice -- the formulas
 * have well-defined operational meanings the user (or AI agent)
 * can read, trust, and act on. We use the math because the math
 * is RIGHT for these problems, not for marketing.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * 1. E = mc²  →  WISDOM YIELD from mass defect
 *    Total mass = raw chunks + raw lessons + raw commits a session has indexed.
 *    Synthesized mass = condensed DNA + chromosomes + lessons-of-lessons.
 *    Mass defect ΔM = total - synthesized.
 *    Wisdom yield = ΔM × c² (where c is the wisdom-unit calibration constant,
 *    chosen so a typical full session yields ~100 units = "1 brain-hour").
 *
 *    Operational meaning: a session with high yield compressed lots of raw
 *    facts into reusable patterns. A session with low yield indexed lots
 *    of stuff that didn't simplify into anything. Bigger yield = better.
 *
 * 2. N(t) = N₀·e^(-λt)  →  EXPONENTIAL ATROPHY
 *    Pre-fix: `mneme atrophy` used a linear half-life model.
 *    Real knowledge decays exponentially (just like radioactivity).
 *    λ = ln(2) / T_½. Different clusters get different T_½ values:
 *      hot files (touched <30d):   T_½ = 30 days
 *      warm files (30-180d):       T_½ = 90 days
 *      cold files (>180d):         T_½ = 365 days
 *      library/vendor:             T_½ = 5 years
 *    Result: atrophy report is now physically accurate. The headline
 *    number "knowledge half-life" is now an actual half-life.
 *
 * 3. Q = (m_initial - m_final) × c²  →  EVOLVE PATCH ENERGY
 *    For each EVOLVE template, Q = (LOC before - LOC after) × confidence.
 *    Q > 0: patch compressed/simplified the codebase (yields wisdom).
 *    Q < 0: patch added complexity (only useful if it pays off elsewhere).
 *    Operational meaning: prioritize templates with positive Q.
 *
 * 4. R = r₀ · A^(1/3)  →  RAG CLUSTER RADIUS
 *    A = number of items in a knowledge cluster.
 *    R = the radius (in embedding-space distance) the cluster occupies.
 *    Constraint: never let a cluster grow beyond its theoretical R or
 *    the semantic centroid blurs and retrieval recall drops.
 *    Operational meaning: when a cluster's effective radius exceeds
 *    r₀·A^(1/3), trigger a split.
 *
 * 5. k = neutrons_n / neutrons_n-1  →  USER ENGAGEMENT CRITICALITY
 *    "Neutrons" = follow-up commands the user issues after each Mneme
 *    response. k_factor measured over the last N prompts.
 *    k > 1.2: supercritical -- user is engaging deeper, Mneme should
 *             quiet down to avoid overload.
 *    0.8 < k < 1.2: stable -- maintain current verbosity.
 *    k < 0.8: subcritical -- user disengaging, Mneme should surface
 *             proactive hints (Oracle predictions, supernova alerts).
 *
 *    KILLER IDEA -- NUCLEUS TIDE: pulse uses k_factor to auto-tune
 *    verbosity. No setting needed; Mneme reads the user's rhythm and
 *    adapts. The opposite of "always loud" tools.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Why pack all 5 in one module? Because they SHARE state -- the same
 * counters (chunks, lessons, EVOLVE templates, prompts) feed every
 * formula. One source of truth, five readings. Like a real reactor.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// ─── Calibration constants ──────────────────────────────────────────────
//
// These are dimensionless scalings chosen so a "normal" session yields
// readable numbers. They're NOT physical constants -- they're tuning.

/** c² for wisdom yield. Calibrated so 1 unit ~ "1 useful insight". */
export const WISDOM_C_SQUARED = 1.0;

/** r₀ for cluster radius. In normalized embedding distance units. */
export const CLUSTER_R_ZERO = 0.05;

/** Days-to-T_½ map per cluster age band. */
export const HALF_LIFE_DAYS = {
  hot: 30,        // touched within last 30 days
  warm: 90,       // 30-180 days old
  cold: 365,      // >180 days
  library: 365 * 5,  // vendor / lockfile / etc
} as const;

// ─── Reactor state types ───────────────────────────────────────────────

export interface ReactorMass {
  /** Raw inputs the session has indexed. */
  rawChunks: number;
  rawLessons: number;
  rawCommits: number;
  /** Compressed outputs (DNA, chromosomes, synthesized lessons). */
  synthesizedDna: number;
  synthesizedLessons: number;
  /** ΔM = total inputs − synthesized outputs. */
  massDefect: number;
  /** ΔM × c². The headline "wisdom yield" number. */
  wisdomYield: number;
}

export interface AtrophyDecayReport {
  /** Per-cluster age band → expected T_½ in days. */
  perBand: Record<keyof typeof HALF_LIFE_DAYS, { tHalfDays: number; lambda: number }>;
  /** Given an item's age in days + band, the fraction still "alive". */
  alivenessExample: number;
}

export interface EvolveQReport {
  /** Per-template Q-score (LOC delta × confidence). */
  perTemplate: Array<{ templateId: string; locBefore: number; locAfter: number; confidence: number; Q: number }>;
  /** Templates ranked by Q desc -- highest-yield first. */
  ranked: Array<{ templateId: string; Q: number }>;
}

export interface ClusterRadiusReport {
  /** For each cluster size A, theoretical max radius. */
  perSize: Array<{ A: number; theoreticalR: number }>;
  /** Did any cluster exceed its theoretical R? */
  overflows: Array<{ clusterId: string; A: number; observedR: number; theoreticalR: number }>;
}

export interface CriticalityReport {
  k: number;
  band: "subcritical" | "stable" | "supercritical";
  /** Suggested verbosity for the next pulse. */
  suggestedVerbosity: "proactive" | "balanced" | "quiet";
  /** Last N prompts' follow-up counts (for the moving k). */
  recentFollowups: number[];
}

export interface ReactorReport {
  mass: ReactorMass;
  atrophy: AtrophyDecayReport;
  evolveQ: EvolveQReport;
  clusterRadius: ClusterRadiusReport;
  criticality: CriticalityReport;
  /** Single-line dashboard summary, suitable for the pulse banner. */
  banner: string;
}

// ─── Formula 1: WISDOM YIELD (E = mc²) ──────────────────────────────────

export function computeMassDefect(input: {
  rawChunks: number;
  rawLessons: number;
  rawCommits: number;
  synthesizedDna: number;
  synthesizedLessons: number;
}): ReactorMass {
  const total = (input.rawChunks ?? 0) + (input.rawLessons ?? 0) + (input.rawCommits ?? 0);
  const synthesized = (input.synthesizedDna ?? 0) + (input.synthesizedLessons ?? 0);
  const massDefect = Math.max(0, total - synthesized);
  // c² is dimensionless tuning constant.
  const wisdomYield = massDefect * WISDOM_C_SQUARED;
  return {
    rawChunks: input.rawChunks ?? 0,
    rawLessons: input.rawLessons ?? 0,
    rawCommits: input.rawCommits ?? 0,
    synthesizedDna: input.synthesizedDna ?? 0,
    synthesizedLessons: input.synthesizedLessons ?? 0,
    massDefect,
    wisdomYield,
  };
}

// ─── Formula 2: EXPONENTIAL ATROPHY (N(t) = N₀ · e^(-λt)) ───────────────

export function decayConstantFor(band: keyof typeof HALF_LIFE_DAYS): number {
  return Math.LN2 / HALF_LIFE_DAYS[band];
}

/** Fraction of "alive" knowledge remaining for an item with given age + band. */
export function aliveness(ageDays: number, band: keyof typeof HALF_LIFE_DAYS): number {
  const lambda = decayConstantFor(band);
  return Math.exp(-lambda * Math.max(0, ageDays));
}

export function computeAtrophyDecay(): AtrophyDecayReport {
  const perBand = {} as AtrophyDecayReport["perBand"];
  for (const band of Object.keys(HALF_LIFE_DAYS) as Array<keyof typeof HALF_LIFE_DAYS>) {
    perBand[band] = { tHalfDays: HALF_LIFE_DAYS[band], lambda: decayConstantFor(band) };
  }
  // Example: a 60-day-old hot file is e^(-λ·60) alive.
  return { perBand, alivenessExample: aliveness(60, "hot") };
}

// ─── Formula 3: EVOLVE Q-SCORE (Q = Δm·c²) ──────────────────────────────

export function computeEvolveQ(templates: Array<{ id: string; locBefore: number; locAfter: number; confidence: number }>): EvolveQReport {
  const perTemplate = (templates ?? []).map((t) => {
    const Q = (t.locBefore - t.locAfter) * t.confidence * WISDOM_C_SQUARED;
    return { templateId: t.id, locBefore: t.locBefore, locAfter: t.locAfter, confidence: t.confidence, Q };
  });
  const ranked = perTemplate
    .map((t) => ({ templateId: t.templateId, Q: t.Q }))
    .sort((a, b) => b.Q - a.Q);
  return { perTemplate, ranked };
}

// ─── Formula 4: CLUSTER RADIUS (R = r₀·A^(1/3)) ─────────────────────────

export function theoreticalClusterRadius(A: number): number {
  if (A <= 0) return 0;
  return CLUSTER_R_ZERO * Math.cbrt(A);
}

export function computeClusterRadius(clusters: Array<{ id: string; A: number; observedR: number }>): ClusterRadiusReport {
  const perSize: Array<{ A: number; theoreticalR: number }> = [];
  // Sample sizes for the report table.
  for (const A of [1, 5, 10, 50, 100, 500, 1000]) perSize.push({ A, theoreticalR: theoreticalClusterRadius(A) });
  const overflows: ClusterRadiusReport["overflows"] = [];
  for (const c of clusters ?? []) {
    const R = theoreticalClusterRadius(c.A);
    if (c.observedR > R) overflows.push({ clusterId: c.id, A: c.A, observedR: c.observedR, theoreticalR: R });
  }
  return { perSize, overflows };
}

// ─── Formula 5: CRITICALITY (k = neutrons_n / neutrons_n-1) ─────────────

const CRITICALITY_FILE = "criticality.jsonl";

export interface CriticalityEvent {
  ts: string;
  followups: number;       // commands the user ran after the prior Mneme response
}

function criticalityPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", CRITICALITY_FILE);
}

export function recordFollowupBurst(repoRoot: string, followups: number): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = criticalityPath(repoRoot);
    const line = JSON.stringify({ ts: new Date().toISOString(), followups }) + "\n";
    if (existsSync(path)) {
      appendFileSync(path, line, "utf8");
    } else {
      writeFileSync(path, line, "utf8");
    }
  } catch { /* best-effort */ }
}

export function readRecentFollowups(repoRoot: string, lastN = 10): number[] {
  try {
    const path = criticalityPath(repoRoot);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-lastN);
    const out: number[] = [];
    for (const ln of recent) {
      try {
        const e = JSON.parse(ln) as CriticalityEvent;
        if (typeof e.followups === "number") out.push(e.followups);
      } catch { /* */ }
    }
    return out;
  } catch { return []; }
}

export function computeCriticality(recentFollowups: number[]): CriticalityReport {
  if (recentFollowups.length < 2) {
    return {
      k: 1.0, band: "stable", suggestedVerbosity: "balanced",
      recentFollowups,
    };
  }
  // k = mean of (n_i / n_{i-1}) over recent pairs, with a guard for zero.
  let sum = 0; let count = 0;
  for (let i = 1; i < recentFollowups.length; i++) {
    const prev = recentFollowups[i - 1] ?? 0;
    const cur = recentFollowups[i] ?? 0;
    if (prev > 0) {
      sum += cur / prev;
      count++;
    }
  }
  const k = count === 0 ? 1.0 : sum / count;
  const band: CriticalityReport["band"] =
    k > 1.2 ? "supercritical"
    : k < 0.8 ? "subcritical"
    : "stable";
  const suggestedVerbosity: CriticalityReport["suggestedVerbosity"] =
    band === "supercritical" ? "quiet"
    : band === "subcritical" ? "proactive"
    : "balanced";
  return { k, band, suggestedVerbosity, recentFollowups };
}

// ─── Composite REACTOR REPORT ───────────────────────────────────────────

export interface ReactorInput {
  repoRoot: string;
  rawChunks?: number; rawLessons?: number; rawCommits?: number;
  synthesizedDna?: number; synthesizedLessons?: number;
  evolveTemplates?: Array<{ id: string; locBefore: number; locAfter: number; confidence: number }>;
  clusters?: Array<{ id: string; A: number; observedR: number }>;
}

export function computeReactorReport(input: ReactorInput): ReactorReport {
  const mass = computeMassDefect({
    rawChunks: input.rawChunks ?? 0,
    rawLessons: input.rawLessons ?? 0,
    rawCommits: input.rawCommits ?? 0,
    synthesizedDna: input.synthesizedDna ?? 0,
    synthesizedLessons: input.synthesizedLessons ?? 0,
  });
  const atrophy = computeAtrophyDecay();
  const evolveQ = computeEvolveQ(input.evolveTemplates ?? []);
  const clusterRadius = computeClusterRadius(input.clusters ?? []);
  const criticality = computeCriticality(readRecentFollowups(input.repoRoot, 10));
  const banner = `wisdom-yield=${mass.wisdomYield.toFixed(0)} · k=${criticality.k.toFixed(2)}[${criticality.band}] · top-Q=${evolveQ.ranked[0]?.Q.toFixed(0) ?? "n/a"}`;
  return { mass, atrophy, evolveQ, clusterRadius, criticality, banner };
}
