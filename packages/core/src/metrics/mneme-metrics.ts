/**
 * Mneme-only metrics — 7 measurements no other dev tool can compute.
 *
 * Each metric COMBINES Mneme atoms (capabilities) into a NEW molecule
 * that requires the full Mneme stack to evaluate. None of these are
 * computable by Cursor / Copilot / Sourcegraph / GitHub Code Search /
 * even OpenAI's internal tools — because the inputs themselves are
 * uniquely Mneme's product.
 *
 * Pure functions. Take pre-aggregated atom data; return numeric metrics
 * with provenance. No I/O, no LLM, no randomness. Deterministic.
 *
 *   1. HKD  — Hidden Knowledge Density
 *   2. TWS  — Tribal Wisdom Score
 *   3. CVR  — Constitution Violation Rate
 *   4. HRR  — Hallucination Reduction Ratio
 *   5. REI  — Regret Echo Index
 *   6. KAH  — Knowledge Atrophy Halflife
 *   7. PCS  — Provenance Chain Strength
 */

// ─── 1. HKD — Hidden Knowledge Density ───────────────────────────────
//
// % of code lines whose understanding is concentrated in ≤2 authors AND
// has not been touched in >180 days. Higher = more "bus factor of 1" risk.
// Combines: atrophy + git-blame + line-count.

export interface HKDInput {
  /** Per-file aggregates from Mneme's index. */
  files: Array<{
    path: string;
    totalLines: number;
    distinctAuthors: number;
    daysSinceLastTouch: number;
  }>;
}

export interface HKDResult {
  /** 0..1 — fraction of code at concentration risk. */
  density: number;
  /** Total lines analysed. */
  totalLines: number;
  /** Lines flagged as hidden-knowledge. */
  hiddenLines: number;
  /** Top files contributing to the density. */
  topRiskFiles: Array<{ path: string; lines: number; authors: number; staleDays: number }>;
}

export function computeHKD(input: HKDInput): HKDResult {
  let total = 0;
  let hidden = 0;
  const risky: HKDResult["topRiskFiles"] = [];
  for (const f of input.files) {
    total += f.totalLines;
    const isHidden = f.distinctAuthors <= 2 && f.daysSinceLastTouch > 180;
    if (isHidden) {
      hidden += f.totalLines;
      risky.push({ path: f.path, lines: f.totalLines, authors: f.distinctAuthors, staleDays: f.daysSinceLastTouch });
    }
  }
  risky.sort((a, b) => b.lines - a.lines);
  return {
    density: total === 0 ? 0 : hidden / total,
    totalLines: total,
    hiddenLines: hidden,
    topRiskFiles: risky.slice(0, 10),
  };
}

// ─── 2. TWS — Tribal Wisdom Score ────────────────────────────────────
//
// Of AI-issued tool calls, what fraction cite a real commit hash whose
// surrounding history (decisions + regrets) corroborates the citation?
// Higher = AI is using INSTITUTIONAL knowledge, not just facts.
//
// Combines: AI tool call audit log + commit hash verification + decision
// extraction + similarity neighborhood.

export interface TWSInput {
  /** AI tool calls for the measurement window. */
  toolCalls: Array<{
    /** Hashes the AI cited. */
    citedHashes: string[];
    /** Hashes that resolved against git rev-parse. */
    resolvedHashes: string[];
    /** Hashes that have at least one corroborating decision/regret commit
     *  in their neighborhood (Mneme's correlator output). */
    corroboratedHashes: string[];
  }>;
}

export interface TWSResult {
  /** 0..1 — institutional grounding rate. */
  score: number;
  /** Tool calls examined. */
  totalCalls: number;
  /** Calls that cited at least one corroborated hash. */
  groundedCalls: number;
  /** Total citations made. */
  totalCitations: number;
  /** Citations that were corroborated. */
  corroboratedCitations: number;
}

export function computeTWS(input: TWSInput): TWSResult {
  let totalCitations = 0;
  let corroborated = 0;
  let groundedCalls = 0;
  for (const c of input.toolCalls) {
    totalCitations += c.citedHashes.length;
    corroborated += c.corroboratedHashes.length;
    if (c.corroboratedHashes.length > 0) groundedCalls += 1;
  }
  const score = totalCitations === 0 ? 0 : corroborated / totalCitations;
  return {
    score,
    totalCalls: input.toolCalls.length,
    groundedCalls,
    totalCitations,
    corroboratedCitations: corroborated,
  };
}

// ─── 3. CVR — Constitution Violation Rate ────────────────────────────
//
// Refusals from Constitutional Gate per 100 commits in the measurement
// window. Lower = AI has internalised this repo's lessons over time.
//
// Combines: Constitutional Gate audit + commits in window.

export interface CVRInput {
  refusalsCount: number;
  commitsInWindow: number;
}

export interface CVRResult {
  /** Per-100-commits rate. */
  ratePer100: number;
  refusals: number;
  commits: number;
}

export function computeCVR(input: CVRInput): CVRResult {
  const rate = input.commitsInWindow === 0 ? 0 : (input.refusalsCount / input.commitsInWindow) * 100;
  return { ratePer100: rate, refusals: input.refusalsCount, commits: input.commitsInWindow };
}

// ─── 4. HRR — Hallucination Reduction Ratio ──────────────────────────
//
// Ratio of hallucination rate WITH Mneme to hallucination rate WITHOUT.
// Numbers come from the AI-Memory-Bench (v1.12.0). Lower = bigger lift.
//
// Combines: Bench harness × repeated runs × baseline comparison.

export interface HRRInput {
  hallucinationRateWithMneme: number;   // 0..1
  hallucinationRateWithoutMneme: number; // 0..1
}

export interface HRRResult {
  /** ratio (with) / (without). 0 means perfect, 1 means no improvement. */
  ratio: number;
  /** Reduction = 1 - ratio. Easier to read for marketing copy. */
  reduction: number;
  /** Inputs echoed for transparency. */
  withMneme: number;
  withoutMneme: number;
}

export function computeHRR(input: HRRInput): HRRResult {
  if (input.hallucinationRateWithoutMneme === 0) {
    return {
      ratio: input.hallucinationRateWithMneme === 0 ? 0 : Number.POSITIVE_INFINITY,
      reduction: input.hallucinationRateWithMneme === 0 ? 1 : Number.NEGATIVE_INFINITY,
      withMneme: input.hallucinationRateWithMneme,
      withoutMneme: input.hallucinationRateWithoutMneme,
    };
  }
  const ratio = input.hallucinationRateWithMneme / input.hallucinationRateWithoutMneme;
  return {
    ratio,
    reduction: 1 - ratio,
    withMneme: input.hallucinationRateWithMneme,
    withoutMneme: input.hallucinationRateWithoutMneme,
  };
}

// ─── 5. REI — Regret Echo Index ──────────────────────────────────────
//
// % of new commits in the window that echo a past regret pattern WITHOUT
// referencing the original regret. Lower = team is learning from history.
//
// Combines: regret extraction + similarity matcher (Mneme's HMRA Hebbian
// component) + commit message scanner.

export interface REIInput {
  newCommits: Array<{
    hash: string;
    /** Regret commit hashes whose pattern matches this commit. */
    matchingRegretHashes: string[];
    /** Regret hashes referenced explicitly in this commit message. */
    referencedRegretHashes: string[];
  }>;
}

export interface REIResult {
  /** 0..1 — fraction of commits echoing un-referenced regrets. */
  index: number;
  /** Total commits inspected. */
  totalCommits: number;
  /** Commits that echo a regret without referencing it. */
  silentEchoes: number;
  /** The list of silent-echo commits (capped at 10). */
  topSilentEchoes: Array<{ hash: string; matchingRegrets: string[] }>;
}

export function computeREI(input: REIInput): REIResult {
  let silent = 0;
  const echoes: REIResult["topSilentEchoes"] = [];
  for (const c of input.newCommits) {
    const matching = new Set(c.matchingRegretHashes);
    const referenced = new Set(c.referencedRegretHashes);
    // Silent echo = matched AT LEAST one regret, referenced NONE of them
    let silentMatch = false;
    const silentRegrets: string[] = [];
    for (const m of matching) {
      if (!referenced.has(m)) {
        silentMatch = true;
        silentRegrets.push(m);
      }
    }
    if (silentMatch) {
      silent += 1;
      echoes.push({ hash: c.hash, matchingRegrets: silentRegrets });
    }
  }
  echoes.sort((a, b) => b.matchingRegrets.length - a.matchingRegrets.length);
  return {
    index: input.newCommits.length === 0 ? 0 : silent / input.newCommits.length,
    totalCommits: input.newCommits.length,
    silentEchoes: silent,
    topSilentEchoes: echoes.slice(0, 10),
  };
}

// ─── 6. KAH — Knowledge Atrophy Halflife ─────────────────────────────
//
// Models expertise decay as exponential: A(t) = A0 * exp(-λ * t).
// Halflife T = ln(2) / λ — weeks until expert understanding fades by 50%.
// Estimated from Mneme's atrophy time-series (datapoints over time).
//
// Combines: atrophy time-series + simple linear-regression in log space.

export interface KAHInput {
  /** Time-series of atrophy snapshots, ordered by time. */
  series: Array<{
    /** Days since the expert's first commit on this area. */
    daysSinceFirst: number;
    /** Atrophy score (0..100; higher = more atrophy). */
    atrophyScore: number;
  }>;
}

export interface KAHResult {
  /** Estimated halflife in WEEKS. Infinity if no decay observed. */
  halflifeWeeks: number;
  /** Decay rate λ (per day). */
  lambdaPerDay: number;
  /** R² of the log-space fit (0..1; higher = more reliable estimate). */
  rSquared: number;
  /** Sample size. */
  n: number;
}

export function computeKAH(input: KAHInput): KAHResult {
  // We model "expertise" as 1 - atrophy/100 (so 1 = full expertise, 0 = none).
  // Then expertise = exp(-λ * t) → ln(expertise) = -λ * t. Linear regression
  // of ln(expertise) on t gives -λ as slope.
  const points = input.series
    .map((p) => ({ t: p.daysSinceFirst, e: 1 - Math.min(1, Math.max(0, p.atrophyScore / 100)) }))
    .filter((p) => p.e > 0); // ln(0) undefined
  if (points.length < 2) {
    return { halflifeWeeks: Infinity, lambdaPerDay: 0, rSquared: 0, n: points.length };
  }

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => Math.log(p.e));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0) return { halflifeWeeks: Infinity, lambdaPerDay: 0, rSquared: 0, n: points.length };
  const slope = num / denX; // -λ
  const lambda = -slope;
  // R² = num² / (denX × denY)
  const rSquared = denY === 0 ? 0 : Math.min(1, Math.max(0, (num * num) / (denX * denY)));
  if (lambda <= 0) {
    return { halflifeWeeks: Infinity, lambdaPerDay: 0, rSquared, n: points.length };
  }
  const halflifeDays = Math.LN2 / lambda;
  return { halflifeWeeks: halflifeDays / 7, lambdaPerDay: lambda, rSquared, n: points.length };
}

// ─── 7. PCS — Provenance Chain Strength ──────────────────────────────
//
// % of commits in the window whose provenance chain is unbroken:
// AI tool call → audit log entry → git commit → audit-log verifies.
// Higher = tamper-evident pipeline coverage.
//
// Combines: audit log HMAC chain + AI commit detection + git verification.

export interface PCSInput {
  totalCommitsInWindow: number;
  commitsWithUnbrokenChain: number;
}

export interface PCSResult {
  strength: number; // 0..1
  total: number;
  unbroken: number;
}

export function computePCS(input: PCSInput): PCSResult {
  if (input.totalCommitsInWindow === 0) {
    return { strength: 1, total: 0, unbroken: 0 };
  }
  return {
    strength: input.commitsWithUnbrokenChain / input.totalCommitsInWindow,
    total: input.totalCommitsInWindow,
    unbroken: input.commitsWithUnbrokenChain,
  };
}

// ─── Catalog (for surfacing in CLI / docs) ───────────────────────────

export const MNEME_METRICS = [
  {
    code: "HKD",
    fullName: "Hidden Knowledge Density",
    summary: "% of code where understanding is concentrated in ≤2 authors AND not touched >180d",
    why: "Quantifies bus-factor-of-1 risk that no other dev tool surfaces",
  },
  {
    code: "TWS",
    fullName: "Tribal Wisdom Score",
    summary: "% of AI tool calls citing real commits whose decisions/regrets corroborate the citation",
    why: "Measures whether AI is using institutional knowledge or just memorising surface",
  },
  {
    code: "CVR",
    fullName: "Constitution Violation Rate",
    summary: "Constitutional-Gate refusals per 100 commits in the window",
    why: "Only computable because Mneme has runtime constitutional enforcement",
  },
  {
    code: "HRR",
    fullName: "Hallucination Reduction Ratio",
    summary: "Hallucination rate (with Mneme) / (without Mneme), via AI-Memory-Bench",
    why: "Numerical proof of Mneme's value vs an unaided AI",
  },
  {
    code: "REI",
    fullName: "Regret Echo Index",
    summary: "% of new commits echoing past regrets without referencing them",
    why: "Detects 'we're about to repeat history' before merge",
  },
  {
    code: "KAH",
    fullName: "Knowledge Atrophy Halflife",
    summary: "Weeks until expert understanding fades by 50% (exponential fit)",
    why: "Halflife framing makes atrophy measurable like radioactive decay",
  },
  {
    code: "PCS",
    fullName: "Provenance Chain Strength",
    summary: "% of commits with unbroken AI → audit → git tamper-evident chain",
    why: "Only computable because Mneme runs the audit log + verifies the chain",
  },
] as const;
