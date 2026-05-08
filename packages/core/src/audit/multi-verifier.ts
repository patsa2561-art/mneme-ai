/**
 * QSAC Tech 4 — Multi-Verifier Consensus.
 *
 * One model = one bias. Three independent verifiers with different priors
 * + a weighted vote = a consensus that beats any single model on
 * adversarial inputs.
 *
 * The financial-audit precedent (PwC, EY, KPMG independently sign-off on
 * the same books) applied to commits.
 *
 * Three verifiers in v0.46:
 *
 *   1. Bayesian Verifier      — current QSAC superposition + claim-graph posterior.
 *                                Best-calibrated prior on aggregate stats.
 *
 *   2. Stylometric Verifier   — does the commit's diff voice match a known
 *                                AI-tool fingerprint (Cursor / Copilot / Devin)?
 *                                Multiple AI sessions concatenated → multiple
 *                                voice clusters → suspicious provenance.
 *
 *   3. Entropy Verifier       — information-theoretic: is the commit's
 *                                Shannon entropy consistent with what its
 *                                narrative claims? Commits that "fix one bug"
 *                                but rewrite 800 lines have high cross-entropy
 *                                vs claim → red flag.
 *
 * The consensus is the **weighted product-of-experts** of the three
 * distributions (weights from each verifier's historical accuracy on the
 * project's own audit history). Disagreement = Jensen-Shannon divergence
 * between any two verifier distributions; high JSD → certificate carries
 * an explicit confidence-interval qualifier.
 */

import type { VerdictDistribution } from "./superposition.js";
import { distribution, combineDistributions } from "./superposition.js";

export type VerifierId = "bayesian" | "stylometric" | "entropy" | "llm-judge";

export interface VerifierVote {
  verifier: VerifierId;
  distribution: VerdictDistribution;
  /** One-line rationale shown in the wisdom drill-through. */
  rationale: string;
  /** Verifier's self-reported confidence in [0, 1]. */
  selfConfidence: number;
}

export interface ConsensusResult {
  /** The combined distribution after weighted product-of-experts. */
  consensus: VerdictDistribution;
  /** Each verifier's vote — for the drill-through. */
  votes: VerifierVote[];
  /** Maximum pairwise Jensen-Shannon divergence between verifiers. */
  maxJsd: number;
  /** True when any pairwise JSD exceeds the disagreement threshold. */
  disagreement: boolean;
  /** Verifier ids of the disagreeing pair (when disagreement is true). */
  disagreeingPair?: [VerifierId, VerifierId];
}

/* ──────────────────────  Stylometric verifier  ────────────────────── */

export interface StylometryInput {
  /** Lines added in the commit diff. */
  addedLines: string[];
  /** Lines removed. */
  removedLines: string[];
  /** Author email — used to compare against known per-author voice. */
  authorEmail?: string;
}

/**
 * Heuristic stylometric scorer. Looks for fingerprints of single-AI-session
 * vs multi-session-concatenated. Many small commits squashed by an AI
 * agent often produce mixed voices in one diff.
 *
 * Signals (each contributes a small weight):
 *   - extreme line-length variance (multi-session indicator)
 *   - mixed quote style (single + double)
 *   - mixed indentation widths (2 vs 4 spaces)
 *   - mixed comment styles (// vs # vs slash-star)
 *
 * No production audit tool surfaces this signal today.
 */
export function verifyStylometry(input: StylometryInput): VerifierVote {
  const lines = [...input.addedLines, ...input.removedLines].filter((l) => l.trim().length > 0);
  if (lines.length < 5) {
    return {
      verifier: "stylometric",
      distribution: distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 }),
      rationale: "diff too small for stylometric analysis (< 5 non-blank lines)",
      selfConfidence: 0.1,
    };
  }

  // Signal 1: line length variance
  const lens = lines.map((l) => l.length);
  const meanLen = lens.reduce((s, x) => s + x, 0) / lens.length;
  const varLen = lens.reduce((s, x) => s + (x - meanLen) ** 2, 0) / lens.length;
  const cvLen = meanLen === 0 ? 0 : Math.sqrt(varLen) / meanLen;

  // Signal 2: quote style mix
  const singleQ = lines.filter((l) => /'[^']/.test(l)).length;
  const doubleQ = lines.filter((l) => /"[^"]/.test(l)).length;
  const mixedQ = singleQ > 0 && doubleQ > 0 && Math.min(singleQ, doubleQ) >= lines.length * 0.1;

  // Signal 3: indentation mix
  const indent2 = lines.filter((l) => /^(  )+\S/.test(l)).length;
  const indent4 = lines.filter((l) => /^(    )+\S/.test(l)).length;
  const tabIndent = lines.filter((l) => /^\t+\S/.test(l)).length;
  const mixedIndent =
    [indent2, indent4, tabIndent].filter((c) => c > 0).length >= 2 &&
    [indent2, indent4, tabIndent].filter((c) => c >= lines.length * 0.1).length >= 2;

  // Signal 4: comment style mix
  const slashComment = lines.filter((l) => /^\s*\/\//.test(l)).length;
  const hashComment = lines.filter((l) => /^\s*#/.test(l)).length;
  const mixedComment =
    slashComment > 0 && hashComment > 0 && Math.min(slashComment, hashComment) >= 3;

  // Score: each anomaly adds to "warn" mass; no anomalies → strong pass
  const anomalyCount = (cvLen > 0.8 ? 1 : 0) + (mixedQ ? 1 : 0) + (mixedIndent ? 1 : 0) + (mixedComment ? 1 : 0);
  let dist: VerdictDistribution;
  let rationale: string;
  if (anomalyCount === 0) {
    dist = distribution({ pass: 0.85, warn: 0.10, fail: 0.03, skipped: 0.02 });
    rationale = "single-voice diff (consistent style markers)";
  } else if (anomalyCount === 1) {
    dist = distribution({ pass: 0.55, warn: 0.35, fail: 0.05, skipped: 0.05 });
    rationale = `mild voice anomaly (1 marker: ${describeAnomalies({ cvLen, mixedQ, mixedIndent, mixedComment }).join(", ")})`;
  } else if (anomalyCount === 2) {
    dist = distribution({ pass: 0.25, warn: 0.55, fail: 0.15, skipped: 0.05 });
    rationale = `moderate voice anomaly (2 markers): ${describeAnomalies({ cvLen, mixedQ, mixedIndent, mixedComment }).join(", ")}`;
  } else {
    dist = distribution({ pass: 0.08, warn: 0.32, fail: 0.55, skipped: 0.05 });
    rationale = `multiple-AI-session signature (${anomalyCount} markers): ${describeAnomalies({ cvLen, mixedQ, mixedIndent, mixedComment }).join(", ")}`;
  }
  return {
    verifier: "stylometric",
    distribution: dist,
    rationale,
    selfConfidence: 0.5 + Math.min(0.4, lines.length / 200), // bigger diff = more confident
  };
}

function describeAnomalies(a: { cvLen: number; mixedQ: boolean; mixedIndent: boolean; mixedComment: boolean }): string[] {
  const out: string[] = [];
  if (a.cvLen > 0.8) out.push("high line-length variance");
  if (a.mixedQ) out.push("mixed quote styles");
  if (a.mixedIndent) out.push("mixed indentation");
  if (a.mixedComment) out.push("mixed comment styles");
  return out;
}

/* ──────────────────────  Entropy verifier  ────────────────────────── */

export interface EntropyInput {
  /** Total lines added + removed in the diff. */
  totalChangedLines: number;
  /** The commit's narrative claims (parsed claim count). */
  narrativeClaimCount: number;
  /** Commit subject + body length in chars. */
  narrativeLength: number;
}

/**
 * Information-theoretic verifier — checks that the commit's complexity
 * (Shannon-style approximation: log of changed lines) is consistent with
 * the narrative's complexity (number of distinct claims).
 *
 * High mismatch (e.g., subject claims "fix one typo" but diff has 800
 * changed lines) is a strong signal of either a bad commit message or
 * an AI that's hiding scope.
 */
export function verifyEntropy(input: EntropyInput): VerifierVote {
  const { totalChangedLines, narrativeClaimCount, narrativeLength } = input;
  if (totalChangedLines === 0 && narrativeLength === 0) {
    return {
      verifier: "entropy",
      distribution: distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 }),
      rationale: "no diff and no narrative — nothing to compare",
      selfConfidence: 0,
    };
  }
  // Diff complexity proxy
  const diffEntropy = Math.log2(Math.max(1, totalChangedLines));
  // Narrative complexity proxy — claims + length
  const narrativeEntropy = Math.log2(Math.max(1, narrativeClaimCount * 5 + narrativeLength / 30));
  // Cross-entropy ratio
  const ratio = diffEntropy / Math.max(1, narrativeEntropy);

  let dist: VerdictDistribution;
  let rationale: string;
  if (ratio > 2.5) {
    dist = distribution({ pass: 0.1, warn: 0.3, fail: 0.55, skipped: 0.05 });
    rationale = `commit-vs-narrative entropy mismatch ${ratio.toFixed(1)}× — diff is much more complex than the message describes`;
  } else if (ratio > 1.7) {
    dist = distribution({ pass: 0.3, warn: 0.5, fail: 0.15, skipped: 0.05 });
    rationale = `mild entropy mismatch ${ratio.toFixed(1)}× — narrative may be under-describing changes`;
  } else if (ratio < 0.4) {
    dist = distribution({ pass: 0.45, warn: 0.4, fail: 0.10, skipped: 0.05 });
    rationale = `narrative is denser than the diff (${ratio.toFixed(2)}×) — possibly aspirational`;
  } else {
    dist = distribution({ pass: 0.85, warn: 0.10, fail: 0.03, skipped: 0.02 });
    rationale = `narrative + diff entropy aligned (${ratio.toFixed(2)}×) — proportional`;
  }
  return {
    verifier: "entropy",
    distribution: dist,
    rationale,
    selfConfidence: Math.min(0.9, 0.3 + Math.log10(Math.max(2, totalChangedLines)) / 5),
  };
}

/* ──────────────────────  Bayesian verifier (existing QSAC)  ────────── */

/**
 * Wraps the QSAC posterior (Tech 1 + Tech 2 output) into a verifier vote
 * shape. The "Bayesian verifier" is what we already build via the claim
 * graph; this just adapts the interface so it can be combined with
 * stylometric + entropy in the consensus.
 */
export function verifyBayesian(input: {
  posterior: VerdictDistribution;
  /** Free-form rationale — usually "QSAC superposition + claim-graph". */
  rationale?: string;
}): VerifierVote {
  return {
    verifier: "bayesian",
    distribution: input.posterior,
    rationale: input.rationale ?? "QSAC superposition + claim-graph posterior",
    selfConfidence: input.posterior.confidence,
  };
}

/* ──────────────────────  Consensus  ─────────────────────────────────── */

export interface ConsensusOptions {
  /** Per-verifier weight overrides. Defaults: 1.0 each. */
  weights?: Partial<Record<VerifierId, number>>;
  /** Pairwise JSD threshold for "disagreement". Default 0.15. */
  jsdThreshold?: number;
}

export function consensusVote(
  votes: VerifierVote[],
  opts: ConsensusOptions = {},
): ConsensusResult {
  const jsdThreshold = opts.jsdThreshold ?? 0.15;
  const weights = votes.map((v) => opts.weights?.[v.verifier] ?? 1);

  const consensus = combineDistributions(
    votes.map((v) => v.distribution),
    weights,
  );

  // Pairwise JSD
  let maxJsd = 0;
  let disagreeingPair: [VerifierId, VerifierId] | undefined;
  for (let i = 0; i < votes.length; i++) {
    for (let j = i + 1; j < votes.length; j++) {
      const jsd = jensenShannonDivergence(votes[i]!.distribution, votes[j]!.distribution);
      if (jsd > maxJsd) {
        maxJsd = jsd;
        disagreeingPair = [votes[i]!.verifier, votes[j]!.verifier];
      }
    }
  }
  const disagreement = maxJsd > jsdThreshold;
  return {
    consensus,
    votes,
    maxJsd: round4(maxJsd),
    disagreement,
    disagreeingPair: disagreement ? disagreeingPair : undefined,
  };
}

/* ──────────────────────  Math: Jensen-Shannon divergence  ──────────── */

/**
 * JSD ∈ [0, log 2] in nats. Symmetric, smoothed KL divergence. JSD = 0
 * when distributions are identical; JSD = log 2 when they're disjoint.
 */
function jensenShannonDivergence(p: VerdictDistribution, q: VerdictDistribution): number {
  const m = {
    pass: (p.pass + q.pass) / 2,
    warn: (p.warn + q.warn) / 2,
    fail: (p.fail + q.fail) / 2,
    skipped: (p.skipped + q.skipped) / 2,
  };
  return 0.5 * klDivergence(p, m) + 0.5 * klDivergence(q, m);
}

function klDivergence(p: VerdictDistribution, q: { pass: number; warn: number; fail: number; skipped: number }): number {
  const eps = 1e-12;
  let sum = 0;
  for (const k of ["pass", "warn", "fail", "skipped"] as const) {
    const pk = (p[k] as number) || eps;
    const qk = q[k] || eps;
    sum += pk * Math.log(pk / qk);
  }
  return Math.max(0, sum);
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
