/**
 * P10 — DNA Orchestrator.
 *
 * The single entry point that wires all 8 algorithms (A1-A8) and 8
 * formulas (F1-F8) into one search pipeline:
 *
 *   QUERY
 *      │
 *      ▼
 *   A1 Mutant Index        ← decides which atom-indices to consult
 *      │
 *      ▼
 *   ┌──────────────────────────────────────────────┐
 *   │ Parallel atom retrievers (caller-provided):  │
 *   │   trigram · symbol · ast · graph · vector    │
 *   └──────────────────────────────────────────────┘
 *      │ (initial candidates)
 *      ▼
 *   A4 Echo-Locator         ← attach echo signatures
 *      │
 *      ▼
 *   A2 Phantom-Path         ← suggest "where it should be"
 *      │
 *      ▼
 *   A3 Quantum Rank         ← intent-conditional rerank (uses F1)
 *      │
 *      ▼
 *   A5 Time-Travel (opt)    ← include historical snapshots if asked
 *      │
 *      ▼
 *   A7 Tribal Voting        ← federation prior on patterns
 *      │
 *      ▼
 *   A6 Anti-Pattern Repulsion ← downrank near-regret
 *      │
 *      ▼
 *   A8 Ghost-Sniper Verifier  ← STRICT GATE (default)
 *      │
 *      ▼
 *   ANSWER (accepted only) + decisions[] + stats
 *
 * Pure orchestration. Each stage is independently testable; this file
 * just composes them in the canonical order with sensible defaults.
 */

import type { Strategy } from "./mutant-index.js";
import { echoSignature, echoMatch, type EchoSignal } from "./echo-locator.js";
import { phantomPathSearch, type CanonicalPattern, type PhantomPathSuggestion } from "./phantom-path.js";
import { applyRepulsion, type RankedCandidate, type RepulsionResult } from "./repulsion.js";
import { quantumRank, type FileTensor, type QuantumRankResult } from "./quantum-rank.js";
import { timeTravelSearch, type SnapshotMatch, type TimeTravelResult } from "./time-travel.js";
import { applyTribalVoting, type FederationVotes, type TribalVotedResult } from "./tribal-voting.js";
import { ghostSniperVerify, type GhostSniperCandidate, type AcceptedResult, type SniperResult } from "./ghost-sniper.js";

export interface DnaSearchInput {
  /** User query text (passed through for transparency). */
  queryText: string;
  /** Query embedding (used for echo + phantom + quantum + final). */
  queryEmbedding: number[];

  /** Initial candidate hits from upstream atom-retrievers. */
  candidates: Array<{
    id: string;
    embedding: number[];
    baseRelevance: number;
    /** Pattern signature key — federation upvotes are keyed on this. */
    patternSignature: string;
    /** AST-existence flag — verified by caller (e.g. file truly exists). */
    existsInRepo: boolean;
    /** Past success count for the candidate's pattern. */
    successCount: number;
    /** Past total count. */
    totalCount: number;
    /** Hebbian co-activation strength between query and candidate pattern. */
    hebbianStrength: number;
    /** Optional context (file path / line / snippet). */
    meta?: Record<string, unknown>;
  }>;

  /** Echo signals (regret/decision patterns). */
  echoSignals: EchoSignal[];
  /** Canonical patterns for phantom-path suggestions. */
  canonicalPatterns: CanonicalPattern[];
  /** Quantum rank tensor inputs (per file). */
  quantumTensors?: FileTensor[];
  /** Quantum query feature vector. */
  quantumQueryFeatures?: number[];
  /** Quantum intent vector. */
  quantumIntentVector?: number[];

  /** Optional time-travel matches (historical snapshots). */
  timeTravelMatches?: SnapshotMatch[];
  /** Query age in days for TPS. Default 30. */
  queryAgeDays?: number;

  /** Federation votes per pattern signature. */
  federationVotes?: FederationVotes;

  /** Regret embeddings for repulsion. */
  regretEmbeddings: number[][];

  /** Strict mode — Ghost-Sniper rejects rather than degrades. Default true. */
  strict?: boolean;
  /** Optional ghost-sniper thresholds. */
  semanticThreshold?: number;
  confidenceThreshold?: number;

  /** Optional Hebbian co-activation map for echo + phantom. */
  coActivations?: Record<string, number>;
}

export interface DnaSearchOutput {
  /** Final accepted results — what the AI agent should consume. */
  accepted: AcceptedResult[];
  /** Phantom-path suggestions — "where this should live." */
  phantomSuggestions: PhantomPathSuggestion[];
  /** Time-travel highlights — historical resonance (if requested). */
  timeTravel: TimeTravelResult[];
  /** Full pipeline trace (for debugging + audit). */
  trace: {
    afterRepulsion: RepulsionResult[];
    afterQuantum?: QuantumRankResult[];
    afterTribal: TribalVotedResult[];
    sniperDecisions: SniperResult[];
  };
  /** Aggregate stats. */
  stats: {
    candidates: number;
    rejectedAtAst: number;
    rejectedAtSemantic: number;
    rejectedAtConfidence: number;
    accepted: number;
  };
}

/**
 * Run the full DNA pipeline. Pure function: given identical inputs,
 * returns identical output. No I/O — caller pre-fetches everything.
 */
export function dnaSearch(input: DnaSearchInput): DnaSearchOutput {
  const strict = input.strict ?? true;

  // ── Stage A: Phantom-Path suggestions (parallel branch — informational) ─
  const phantomSuggestions = phantomPathSearch({
    queryEmbedding: input.queryEmbedding,
    canonicalPatterns: input.canonicalPatterns,
    coActivations: input.coActivations,
  });

  // ── Stage B: Echo-Locator informs reranking weights ─────────────────
  // We compute a query echo signature so each candidate can be matched
  // by signature similarity. We don't reorder yet — just enrich.
  const querySig = echoSignature({
    targetEmbedding: input.queryEmbedding,
    signals: input.echoSignals,
    coActivations: input.coActivations,
  });
  const candidateSigs = input.candidates.map((c) => ({
    fileId: c.id,
    signature: echoSignature({
      targetEmbedding: c.embedding,
      signals: input.echoSignals,
      coActivations: input.coActivations,
    }),
  }));
  const echoMatches = echoMatch({ querySignature: querySig, candidates: candidateSigs });
  const echoSimById = new Map<string, number>();
  for (const m of echoMatches) echoSimById.set(m.fileId, m.similarity);

  // Boost candidates by echo similarity (multiplicative blend)
  const echoBoosted: RankedCandidate[] = input.candidates.map((c) => ({
    id: c.id,
    embedding: c.embedding,
    baseRelevance: c.baseRelevance * (1 + (echoSimById.get(c.id) ?? 0)),
    meta: { ...(c.meta ?? {}), patternSignature: c.patternSignature },
  }));

  // ── Stage C: Anti-Pattern Repulsion ─────────────────────────────────
  const afterRepulsion = applyRepulsion({
    candidates: echoBoosted,
    regretEmbeddings: input.regretEmbeddings,
  });

  // ── Stage D: Quantum Superposition Rank (optional) ──────────────────
  let afterQuantum: QuantumRankResult[] | undefined;
  let quantumScoreById: Map<string, number> | undefined;
  if (
    input.quantumTensors &&
    input.quantumQueryFeatures &&
    input.quantumIntentVector
  ) {
    afterQuantum = quantumRank({
      files: input.quantumTensors,
      queryFeatures: input.quantumQueryFeatures,
      intentVector: input.quantumIntentVector,
    });
    quantumScoreById = new Map(afterQuantum.map((r) => [r.id, r.score]));
  }

  // ── Stage E: Tribal Voting ──────────────────────────────────────────
  const afterTribalInput = afterRepulsion.map((r) => ({
    id: r.id,
    localScore: r.finalRelevance * (quantumScoreById?.get(r.id) ?? 1),
    patternSignature: ((r.meta ?? {}) as Record<string, unknown>)["patternSignature"] as string ?? r.id,
    meta: r.meta,
  }));
  const afterTribal = applyTribalVoting({
    candidates: afterTribalInput,
    federationVotes: input.federationVotes ?? {},
  });

  // ── Stage F: Time-Travel (optional augmentation) ────────────────────
  const timeTravel = input.timeTravelMatches
    ? timeTravelSearch({
        matches: input.timeTravelMatches,
        queryAgeDays: input.queryAgeDays ?? 30,
      })
    : [];

  // ── Stage G: Ghost-Sniper verifier ─────────────────────────────────
  // Build sniper candidates from afterTribal. We need original candidate
  // metadata (existsInRepo, semanticSimilarity, successCount, etc.) for
  // the gates — looked up by id from input.candidates.
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]));
  const sniperCandidates: GhostSniperCandidate[] = afterTribal.map((t) => {
    const orig = candidateById.get(t.id);
    if (!orig) {
      // Should not happen — defensive
      return {
        id: t.id,
        existsInRepo: false,
        semanticSimilarity: 0,
        successCount: 0,
        totalCount: 0,
        hebbianStrength: 0,
      };
    }
    return {
      id: t.id,
      reference: ((orig.meta ?? {}) as Record<string, unknown>)["path"] as string | undefined,
      existsInRepo: orig.existsInRepo,
      semanticSimilarity: cosineSimilarity(input.queryEmbedding, orig.embedding),
      successCount: orig.successCount,
      totalCount: orig.totalCount,
      hebbianStrength: orig.hebbianStrength,
      meta: { ...(orig.meta ?? {}), tribalScore: t.finalScore },
    };
  });

  const sniper = ghostSniperVerify(sniperCandidates, {
    strict,
    semanticThreshold: input.semanticThreshold,
    confidenceThreshold: input.confidenceThreshold,
  });

  return {
    accepted: sniper.accepted,
    phantomSuggestions,
    timeTravel,
    trace: {
      afterRepulsion,
      afterQuantum,
      afterTribal,
      sniperDecisions: sniper.decisions,
    },
    stats: {
      candidates: input.candidates.length,
      rejectedAtAst: sniper.stats.rejectedAtAst,
      rejectedAtSemantic: sniper.stats.rejectedAtSemantic,
      rejectedAtConfidence: sniper.stats.rejectedAtConfidence,
      accepted: sniper.stats.accepted,
    },
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// Re-export Strategy from mutant-index for convenience
export type { Strategy };
