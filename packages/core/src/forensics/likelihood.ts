/**
 * Likelihood Ratio engine — Bayesian author attribution from STR loci.
 *
 * Real forensic DNA reports use the **likelihood ratio**:
 *
 *     LR = P(evidence | hypothesis Hp) / P(evidence | hypothesis Hd)
 *
 * Hp = "the suspect contributed the evidence"
 * Hd = "a random person from the population contributed the evidence"
 *
 * If LR = 10000, the evidence is 10000 times more probable under Hp than
 * under Hd → "extremely strong support" on the ENFSI verbal scale.
 *
 * For code, our population is "all commit authors in this repo" and the
 * evidence is "the locus values measured on the question commit(s)".
 *
 * Combined LR over independent loci:
 *
 *     LR_total = ∏  LR_i
 *               i=1..N
 *
 * We use a Gaussian likelihood for continuous loci (parameterized by
 * each known author's mean + variance) and direct probability matching
 * for discrete loci (e.g. peakHour bucket, messageStyleHash equality).
 *
 * IMPORTANT: this is *forensic-grade methodology*, not a forensic-grade
 * GUARANTEE. Code STR loci aren't as discriminating as biological STR
 * (CODIS humans have 13 loci with population databases; we have 12 loci
 * derived from observed repo authors). Always present results with the
 * verbal scale, never as percentages.
 */
import type { ForensicLoci } from "./loci.js";

/**
 * ENFSI verbal scale (European Network of Forensic Science Institutes).
 * Real forensic reports use this exact terminology.
 */
export type ForensicVerdict =
  | "extremely strong support against"
  | "very strong support against"
  | "strong support against"
  | "moderate support against"
  | "weak support against"
  | "uninformative"
  | "weak support"
  | "moderate support"
  | "strong support"
  | "very strong support"
  | "extremely strong support";

/**
 * Map a combined LR to its ENFSI verdict.
 * Bands are the ENFSI 2015 standard (multiplicative, log10 scale).
 */
export function verdict(lr: number): ForensicVerdict {
  if (!Number.isFinite(lr) || lr <= 0) return "uninformative";
  if (lr >= 1_000_000) return "extremely strong support";
  if (lr >= 10_000) return "very strong support";
  if (lr >= 1_000) return "strong support";
  if (lr >= 100) return "moderate support";
  if (lr >= 2) return "weak support";
  if (lr > 0.5) return "uninformative";
  if (lr > 0.01) return "weak support against";
  if (lr > 0.001) return "moderate support against";
  if (lr > 0.0001) return "strong support against";
  if (lr > 0.000001) return "very strong support against";
  return "extremely strong support against";
}

export interface LociLikelihoodReport {
  /** Per-locus contribution. */
  perLocus: Array<{
    name: keyof ForensicLoci;
    lr: number;
    /** Brief description suitable for rendering. */
    note: string;
  }>;
  /** Product of per-locus LRs. */
  combinedLR: number;
  /** ENFSI verbal scale. */
  verdict: ForensicVerdict;
  /** log10(combinedLR) — handy for rendering. */
  log10LR: number;
}

/**
 * Compute the likelihood ratio that `evidence` came from the same
 * author as `suspect`, vs. from the population represented by
 * `populationStats`.
 *
 * `populationStats` should describe the spread of each locus across all
 * authors in the repo. `suspectStats` is the suspect's own profile.
 */
export interface PopulationStats {
  // For each continuous locus we need (mean, stdev) across population.
  filesPerCommit: { mean: number; stdev: number };
  conventionalRatio: { mean: number; stdev: number };
  avgSubjectLength: { mean: number; stdev: number };
  bodyRatio: { mean: number; stdev: number };
  referenceRatio: { mean: number; stdev: number };
  testRatio: { mean: number; stdev: number };
  weekendRatio: { mean: number; stdev: number };
  imperativeRatio: { mean: number; stdev: number };
  topDirAffinity: { mean: number; stdev: number };
  verbEntropy: { mean: number; stdev: number };
  // For discrete loci we need the population's most likely values + spread.
  peakHourDistribution: number[]; // length 24, normalized
  // Distinct messageStyleHash count across the population (used as denominator)
  messageStyleHashUnique: number;
}

export function compareLoci(
  evidence: ForensicLoci,
  suspect: ForensicLoci,
  population: PopulationStats,
  options: { discreteOnly?: boolean } = {},
): LociLikelihoodReport {
  const perLocus: LociLikelihoodReport["perLocus"] = [];

  // ── Continuous loci via Gaussian likelihood ────────────────────────
  if (!options.discreteOnly) {
    perLocus.push(scoreGaussian("filesPerCommit", evidence.filesPerCommit, suspect.filesPerCommit, population.filesPerCommit));
    perLocus.push(scoreGaussian("conventionalRatio", evidence.conventionalRatio, suspect.conventionalRatio, population.conventionalRatio));
    perLocus.push(scoreGaussian("avgSubjectLength", evidence.avgSubjectLength, suspect.avgSubjectLength, population.avgSubjectLength));
    perLocus.push(scoreGaussian("bodyRatio", evidence.bodyRatio, suspect.bodyRatio, population.bodyRatio));
    perLocus.push(scoreGaussian("referenceRatio", evidence.referenceRatio, suspect.referenceRatio, population.referenceRatio));
    perLocus.push(scoreGaussian("testRatio", evidence.testRatio, suspect.testRatio, population.testRatio));
    perLocus.push(scoreGaussian("weekendRatio", evidence.weekendRatio, suspect.weekendRatio, population.weekendRatio));
    perLocus.push(scoreGaussian("imperativeRatio", evidence.imperativeRatio, suspect.imperativeRatio, population.imperativeRatio));
    perLocus.push(scoreGaussian("topDirAffinity", evidence.topDirAffinity, suspect.topDirAffinity, population.topDirAffinity));
    perLocus.push(scoreGaussian("verbEntropy", evidence.verbEntropy, suspect.verbEntropy, population.verbEntropy));
  }

  // ── Discrete loci ──────────────────────────────────────────────────
  // L7 — peak hour: LR = (1 if hour matches suspect, else 0.1) / population_freq
  const popFreqHour = population.peakHourDistribution[evidence.peakHour] ?? 1 / 24;
  const matchesSuspect = evidence.peakHour === suspect.peakHour;
  const numHour = matchesSuspect ? 1 : 0.1;
  const lrHour = numHour / Math.max(popFreqHour, 0.001);
  perLocus.push({
    name: "peakHour",
    lr: lrHour,
    note: `evidence peak ${evidence.peakHour}:00 vs suspect ${suspect.peakHour}:00`,
  });

  // L12 — messageStyleHash: very high LR if exact match, low otherwise
  const lrHash = evidence.messageStyleHash === suspect.messageStyleHash
    ? Math.max(1, population.messageStyleHashUnique * 0.5)
    : 0.5;
  perLocus.push({
    name: "messageStyleHash",
    lr: lrHash,
    note:
      evidence.messageStyleHash === suspect.messageStyleHash
        ? "verb-fingerprint matches suspect exactly"
        : "verb-fingerprint differs",
  });

  // ── Combine — product of per-locus LRs ─────────────────────────────
  let combinedLR = 1;
  for (const l of perLocus) combinedLR *= l.lr;

  // Floor to keep numerically stable
  if (!Number.isFinite(combinedLR) || combinedLR <= 0) combinedLR = 1e-30;

  const log10LR = Math.log10(combinedLR);

  return {
    perLocus,
    combinedLR,
    verdict: verdict(combinedLR),
    log10LR: Number(log10LR.toFixed(3)),
  };
}

/**
 * Gaussian-likelihood score for a continuous locus.
 *
 * P(x | author) = N(x; suspect_mean, σ_individual)
 * P(x | population) = N(x; pop_mean, σ_population)
 *
 * Where σ_individual is the per-author noise (we approximate as
 * σ_population / 2 for simplicity — real forensics measures it from
 * intra-author replicates). LR = ratio of the two pdfs at x.
 */
function scoreGaussian(
  name: keyof ForensicLoci,
  evidenceVal: number,
  suspectVal: number,
  pop: { mean: number; stdev: number },
): { name: keyof ForensicLoci; lr: number; note: string } {
  // σ for the individual hypothesis is half the population stdev (more
  // peaked — the suspect is more consistent than the random population).
  const sigmaIndividual = Math.max(0.001, pop.stdev / 2);
  const sigmaPop = Math.max(0.001, pop.stdev);

  const pHp = gaussianPdf(evidenceVal, suspectVal, sigmaIndividual);
  const pHd = gaussianPdf(evidenceVal, pop.mean, sigmaPop);
  const lr = pHp / Math.max(pHd, 1e-30);

  // Cap per-locus LR so a single weird locus can't dominate (forensic
  // standard practice — multi-locus agreement is what gives certainty).
  const cappedLr = Math.max(0.001, Math.min(1000, lr));

  const distance = Math.abs(evidenceVal - suspectVal);
  const note = `evidence=${fmt(evidenceVal)} · suspect=${fmt(suspectVal)} · pop μ=${fmt(pop.mean)} σ=${fmt(pop.stdev)} · |Δ|=${fmt(distance)}`;
  return { name, lr: cappedLr, note };
}

function gaussianPdf(x: number, mean: number, sigma: number): number {
  const z = (x - mean) / sigma;
  return Math.exp(-(z * z) / 2) / (sigma * Math.sqrt(2 * Math.PI));
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3);
}

/**
 * Compute population statistics from a set of per-author profiles.
 *
 * Used to build the denominator P(evidence | population) when running
 * `compareLoci`. The caller supplies one ForensicLoci per author.
 */
export function buildPopulationStats(profiles: ForensicLoci[]): PopulationStats {
  const n = Math.max(1, profiles.length);

  const fields: Array<keyof PopulationStats> = [
    "filesPerCommit",
    "conventionalRatio",
    "avgSubjectLength",
    "bodyRatio",
    "referenceRatio",
    "testRatio",
    "weekendRatio",
    "imperativeRatio",
    "topDirAffinity",
    "verbEntropy",
  ];

  const continuousStats: Partial<PopulationStats> = {};
  for (const f of fields) {
    const vals = profiles.map((p) => p[f as keyof ForensicLoci] as number);
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const stdev = Math.sqrt(variance);
    (continuousStats as Record<string, { mean: number; stdev: number }>)[f as string] = {
      mean,
      stdev: Math.max(0.001, stdev),
    };
  }

  // Discrete: peak-hour distribution (all authors)
  const hourCounts = new Array(24).fill(0);
  for (const p of profiles) hourCounts[p.peakHour] = (hourCounts[p.peakHour] ?? 0) + 1;
  const peakHourDistribution = hourCounts.map((c) => c / n);

  // Discrete: distinct messageStyleHash count
  const distinctHashes = new Set(profiles.map((p) => p.messageStyleHash));
  const messageStyleHashUnique = Math.max(1, distinctHashes.size);

  return {
    ...(continuousStats as Omit<
      PopulationStats,
      "peakHourDistribution" | "messageStyleHashUnique"
    >),
    peakHourDistribution,
    messageStyleHashUnique,
  };
}
