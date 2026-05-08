/**
 * QSAC Tech 6 — Wisdom Drill-Through.
 *
 * The integration layer that composes Tech 1 (superposition) + Tech 2
 * (causal claim graph) + Tech 4 (multi-verifier consensus) + Tech 5
 * (cryptographic chain) + Tech 3 (mutation score, optional) into a
 * single QSAC certificate that compliance teams can drill into.
 *
 * Pipeline:
 *
 *   AxisResult[]                    ← from existing certify
 *        │
 *        ├─ score per axis →  VerdictDistribution[]   (Tech 1)
 *        │
 *        ├─ causal graph propagate → axis posteriors  (Tech 2)
 *        │
 *        ├─ stylometric + entropy + bayesian votes →  consensus (Tech 4)
 *        │
 *        ├─ optional: mutation score →                axis tweaks (Tech 3)
 *        │
 *        ├─ canonicalise + chain + sign →             stored cert (Tech 5)
 *        │
 *        └─ drill-through markdown render →           wisdom output (Tech 6)
 *
 * The certificate stays compatible with the v0.43 `AuditCertificate`
 * shape (`overallVerdict`, `coverage`, etc.) — QSAC adds extra fields
 * alongside, never replaces. Existing CI gates keep working.
 */

import type { VerdictDistribution } from "./superposition.js";
import { combineDistributions, distribution } from "./superposition.js";
import {
  buildStandardAuditGraph,
  propagateBeliefs,
  getPosterior,
  type ClaimGraph,
} from "./claim-graph.js";
import {
  consensusVote,
  verifyBayesian,
  verifyStylometry,
  verifyEntropy,
  type ConsensusResult,
  type VerifierVote,
} from "./multi-verifier.js";
import {
  appendCertificate,
  type ChainedCertificate,
  type CertificatePayload,
} from "./merkle-chain.js";

/* ──────────────────────  Inputs  ───────────────────────────────────── */

export interface QsacInput {
  commitHash: string;
  /** Each axis's prior distribution (from soft-scorers). */
  axes: {
    behavioralParity: VerdictDistribution;
    apiContractDrift: VerdictDistribution;
    testPassRate: VerdictDistribution;
    perfRegression: VerdictDistribution;
    aiNarrative: VerdictDistribution;
  };
  /** Optional narrative claim distributions (for the claim graph). */
  narrative?: {
    claimsNoApiChange?: VerdictDistribution;
    claimsAllTestsPass?: VerdictDistribution;
    claimsNoPerfRegression?: VerdictDistribution;
  };
  /** Optional stylometric input (added/removed lines). */
  stylometry?: {
    addedLines: string[];
    removedLines: string[];
  };
  /** Optional entropy input (commit complexity vs narrative complexity). */
  entropy?: {
    totalChangedLines: number;
    narrativeClaimCount: number;
    narrativeLength: number;
  };
  /** Optional mutation score injection (from Tech 3 harness). */
  mutationScore?: VerdictDistribution;
  /** Optional cryptographic chain config. */
  chain?: {
    rootPath: string;
    hmacKey?: string;
  };
  /** Issuer label. */
  issuedBy: string;
}

/* ──────────────────────  Output  ───────────────────────────────────── */

export interface QsacCertificate {
  commitHash: string;
  /** Tech 1 — per-axis priors. */
  priors: QsacInput["axes"];
  /** Tech 2 — per-axis posteriors after causal-graph propagation. */
  posteriors: QsacInput["axes"];
  /** Tech 4 — three-verifier consensus result. */
  consensus: ConsensusResult;
  /** Tech 3 — mutation score (optional). */
  mutation?: VerdictDistribution;
  /** Final overall distribution after composing every signal. */
  overall: VerdictDistribution;
  /** Tech 5 — chained certificate (when chain config provided). */
  chained?: ChainedCertificate;
  /** When the audit was computed. */
  issuedAt: string;
  /** Issuer (caller-supplied). */
  issuedBy: string;
  /** Iteration count + convergence flag from belief propagation. */
  graphConvergence: { iterations: number; converged: boolean };
}

/* ──────────────────────  Compose  ──────────────────────────────────── */

/**
 * Run the full QSAC pipeline. Returns the certificate (and optionally
 * appends to the merkle chain).
 *
 * The function is deterministic given the same inputs — same priors +
 * same stylometric/entropy inputs always produce the same overall + the
 * same chain hash (assuming same prevHash).
 */
export async function composeQsacCertificate(input: QsacInput): Promise<QsacCertificate> {
  const issuedAt = new Date().toISOString();

  // ── Tech 2: causal graph propagation ──────────────────────────────
  const graph: ClaimGraph = buildStandardAuditGraph({
    axes: input.axes,
    narrative: input.narrative,
  });
  const graphConvergence = propagateBeliefs(graph);
  const posteriors = {
    behavioralParity: getPosterior(graph, "axis_behavioral"),
    apiContractDrift: getPosterior(graph, "axis_api"),
    testPassRate: getPosterior(graph, "axis_tests"),
    perfRegression: getPosterior(graph, "axis_perf"),
    aiNarrative: getPosterior(graph, "axis_narrative"),
  };
  const gateOverall = getPosterior(graph, "gate_overall");

  // ── Tech 4: multi-verifier consensus ──────────────────────────────
  const votes: VerifierVote[] = [verifyBayesian({ posterior: gateOverall })];
  if (input.stylometry) votes.push(verifyStylometry(input.stylometry));
  if (input.entropy) votes.push(verifyEntropy(input.entropy));
  const consensus = consensusVote(votes);

  // ── Tech 3: mutation score (when supplied by caller) ──────────────
  // Caller is responsible for actually running the mutants + tests; we
  // accept the resulting distribution and weave it in.
  const componentDists: VerdictDistribution[] = [consensus.consensus];
  if (input.mutationScore && input.mutationScore.collapsed !== "skipped") {
    componentDists.push(input.mutationScore);
  }
  const overall = combineDistributions(componentDists);

  // ── Tech 5: cryptographic chain (optional) ────────────────────────
  let chained: ChainedCertificate | undefined;
  if (input.chain) {
    const payload: CertificatePayload = {
      commitHash: input.commitHash,
      axes: posteriors,
      overall,
      evidence: {
        priors: input.axes,
        consensus: { maxJsd: consensus.maxJsd, disagreement: consensus.disagreement },
        graphConvergence,
        mutationScore: input.mutationScore,
      },
      issuedAt,
      issuedBy: input.issuedBy,
    };
    chained = await appendCertificate(payload, {
      rootPath: input.chain.rootPath,
      hmacKey: input.chain.hmacKey,
    });
  }

  return {
    commitHash: input.commitHash,
    priors: input.axes,
    posteriors,
    consensus,
    mutation: input.mutationScore,
    overall,
    chained,
    issuedAt,
    issuedBy: input.issuedBy,
    graphConvergence,
  };
}

/* ──────────────────────  Wisdom drill-through render  ─────────────── */

/**
 * Render the QSAC certificate as the "wisdom output" — markdown-ish
 * terminal text with the full uncertainty trail. The caller's UI layer
 * adds colour; this returns plain text so it works in plain stdout +
 * file output + Slack/email/PR-comment without modification.
 */
export function renderWisdom(cert: QsacCertificate): string {
  const lines: string[] = [];
  const v = cert.overall;
  lines.push(`⚖  QSAC Certificate · ${cert.commitHash.slice(0, 7)} · ${cert.issuedAt}`);
  lines.push("");
  lines.push(`  ${v.collapsed.toUpperCase()}  (${(v.confidence * 100).toFixed(0)}% confidence)`);
  if (cert.chained) {
    lines.push(`  📜 chain index ${cert.chained.index} · hash ${cert.chained.hash.slice(0, 16)}…`);
  }
  lines.push("");
  // Per-axis drill-through
  lines.push("  Per-axis posterior (Tech 2 belief-propagated):");
  for (const [k, v] of Object.entries(cert.posteriors)) {
    const pct = (v.confidence * 100).toFixed(0);
    lines.push(`    ${k.padEnd(22)} ${v.collapsed.padEnd(8)} ${pct}%   ${formatBar(v)}`);
  }
  lines.push("");
  // Consensus
  lines.push(`  Multi-verifier consensus (Tech 4):  JSD=${cert.consensus.maxJsd.toFixed(3)}${cert.consensus.disagreement ? "  ⚠ DISAGREEMENT" : ""}`);
  for (const vote of cert.consensus.votes) {
    lines.push(`    ${vote.verifier.padEnd(14)} ${vote.distribution.collapsed.padEnd(8)} ${(vote.distribution.confidence * 100).toFixed(0)}%   ${vote.rationale}`);
  }
  if (cert.consensus.disagreement && cert.consensus.disagreeingPair) {
    lines.push("");
    lines.push(`    ⚠ Verifiers ${cert.consensus.disagreeingPair[0]} and ${cert.consensus.disagreeingPair[1]} split — drill-through:`);
  }
  lines.push("");
  // Mutation score
  if (cert.mutation && cert.mutation.collapsed !== "skipped") {
    lines.push(`  Mutation-test counterfactual (Tech 3):  ${cert.mutation.collapsed.toUpperCase()}  ${(cert.mutation.confidence * 100).toFixed(0)}% confidence`);
    lines.push("");
  }
  // Belief propagation
  lines.push(`  Belief propagation: ${cert.graphConvergence.iterations} iterations · ${cert.graphConvergence.converged ? "converged" : "did not converge"}`);
  if (cert.chained) {
    lines.push(`  Chain: index ${cert.chained.index} · prev=${cert.chained.prevHash.slice(0, 12) || "genesis"}… · hash=${cert.chained.hash.slice(0, 12)}…`);
    if (cert.chained.signature) {
      lines.push(`         HMAC-SHA-256 signed (algo: ${cert.chained.signatureAlgo})`);
    }
  }
  return lines.join("\n");
}

function formatBar(v: VerdictDistribution): string {
  // 4-segment bar showing the four amplitudes
  const w = 30;
  const seg = (mass: number, ch: string) => ch.repeat(Math.round(mass * w));
  return `${seg(v.pass, "█")}${seg(v.warn, "▓")}${seg(v.fail, "▒")}${seg(v.skipped, "·")}`;
}

/** Stub for "no signal" placeholder. */
export const ZERO_DISTRIBUTION: VerdictDistribution = distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
