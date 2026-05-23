/**
 * v2.40.0 — ARGUS-10: 10-Eyed Memory Search.
 *
 * Greek mythology: Argus Panoptes had a hundred eyes — when half slept,
 * the others kept watch. We carry the same property as graceful
 * degradation: if any eye fails (no embedder, no git, no honest_mirror),
 * the remaining eyes softmax-rebalance their weights so the total stays
 * a unit. No blind spots. No silent fallback to bad answers.
 *
 * 10 eyes split into two layers:
 *
 *   SURFACE LAYER (5 — lexical / phonetic / shape):
 *     EYE_1   bigramDice              0.18    char bigram Dice coefficient
 *     EYE_2   damerauLevThai          0.18    Thai-aware Damerau-Lev
 *     EYE_3   thaiMetaphone           0.08    phonetic key equality
 *     EYE_4   lengthRatio             0.04    min(qLen,cLen)/max(qLen,cLen)
 *     EYE_5   slidingWindow           0.08    n-gram window match
 *
 *   TRUTH LAYER (5 — Mneme-unique):
 *     EYE_6   homoglyphCollapse       0.10    cross-script normalization match
 *     EYE_7   numberParaphraseBridge  0.10    865 ≡ "eight hundred sixty-five"
 *     EYE_8   embeddingCosine         0.10    semantic axis (ollama/MiniLM/hash)
 *     EYE_9   hmacProvenanceBoost     0.07    +25% if in HMAC chain
 *     EYE_10  honestMirrorPenalty     0.07    × honest-mirror multiplier
 *
 *   HYDRA REGENERATION (autospawn):
 *     EYE_N   from AV antivirus strains with precision > 0.9
 *
 *   GUARDIAN (graceful degradation):
 *     Failed eyes drop to 0; surviving eye weights softmax-rebalance.
 *
 *   FUSION:
 *     score(q,c) = Σ(eye.weight × eye.signal)
 *                × hydraBonus(q,c)
 *                × (1 + log10(1 + 1/recencyDays))
 *                × clamp(0.5, 1.5, honestMirrorMultiplier(c.vendor))
 */

export type EyeId =
  | "EYE_1_bigram_dice"
  | "EYE_2_damerau_lev_thai"
  | "EYE_3_thai_metaphone"
  | "EYE_4_length_ratio"
  | "EYE_5_sliding_window"
  | "EYE_6_homoglyph_collapse"
  | "EYE_7_number_paraphrase"
  | "EYE_8_embedding_cosine"
  | "EYE_9_hmac_provenance"
  | "EYE_10_honest_mirror_penalty"
  | `EYE_HYDRA_${string}`;

export type EyeLayer = "surface" | "truth" | "hydra";

export type EyeHealth = "OPEN" | "CLOSED" | "DEGRADED";

export interface EyeSignal {
  /** 0..1 raw similarity from this eye for (q,c). */
  raw: number;
  /** Why this eye returned what it did (1 short line). */
  reason: string;
}

export interface Eye {
  id: EyeId;
  layer: EyeLayer;
  /** Nominal weight in the perfect-health bundle. Sums to ≤ 1 across
   *  all eyes; the Guardian re-softmaxes whichever are healthy. */
  weight: number;
  /** Per-call health check. Returns CLOSED when prereqs are missing. */
  probe: () => EyeHealth;
  /** Returns 0..1 similarity for (query, candidate). */
  signal: (q: string, c: Candidate, ctx: EyeCtx) => Promise<EyeSignal> | EyeSignal;
}

export interface Candidate {
  /** The text to score against the query. */
  text: string;
  /** Optional metadata used by truth-layer eyes. */
  meta?: {
    /** AI vendor that produced this candidate ("claude-opus-4.7", "gpt-5", ...). */
    vendor?: string;
    /** Git commit recency in days (smaller = more recent). */
    recencyDays?: number;
    /** True if this candidate appears in the verified HMAC chain. */
    inHmacChain?: boolean;
    /** Free-form attribution. */
    source?: string;
  };
}

export interface EyeCtx {
  /** Path to the .mneme/ root, for HMAC chain + honest mirror lookups. */
  repoRoot: string;
  /** Optional embedder. If null, EYE_8 closes. */
  embedder?: { embed: (texts: string[]) => Promise<number[][]> } | null;
}

export interface ScoredCandidate {
  candidate: Candidate;
  /** Final fused score in [0, ~1.5] (multipliers can push >1). */
  score: number;
  /** Per-eye breakdown. Closed eyes show raw=null. */
  eyes: Array<{ id: EyeId; layer: EyeLayer; weight: number; raw: number | null; reason: string }>;
  /** Multipliers applied after surface+truth fusion. */
  multipliers: {
    hydraBonus: number;
    recencyBoost: number;
    honestMirrorMultiplier: number;
  };
  /** Which eyes were closed (degraded mode). */
  closedEyes: EyeId[];
}

export interface ArgusSearchInput {
  query: string;
  candidates: Candidate[];
  repoRoot: string;
  embedder?: { embed: (texts: string[]) => Promise<number[][]> } | null;
  /** Optional cap on returned candidates (default = all, sorted). */
  topK?: number;
  /** Optional pre-spawned HYDRA eye set (advanced). */
  hydraEyes?: Eye[];
}

export interface ArgusSearchResult {
  query: string;
  scored: ScoredCandidate[];
  /** Live eye count: total / open / closed. */
  health: { total: number; open: number; closed: number };
  /** HMAC over the (query + candidates + scored) frame for audit. */
  hmac: string;
  /** Engine ms. */
  durationMs: number;
}
