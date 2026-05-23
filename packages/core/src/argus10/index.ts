/**
 * v2.40.0 — ARGUS-10 public surface.
 *
 * Argus Panoptes (Greek myth, "the all-seeing") had 100 eyes; when half
 * slept, the rest stayed open. ARGUS-10 is Mneme's 10-eyed memory search
 * primitive — 5 surface (lexical/phonetic/shape) + 5 truth (Mneme-unique:
 * homoglyph fold / number paraphrase / embeddings / HMAC provenance /
 * honest-mirror penalty) + adaptive HYDRA regeneration that grows new
 * eyes from accepted antivirus strains.
 *
 * Failed eyes softmax-rebalance so the bundle always sums to 1; the
 * caller gets a HMAC-signed audit frame so every search is verifiable.
 */

export type {
  EyeId, EyeLayer, EyeHealth, EyeSignal, Eye, Candidate, EyeCtx,
  ScoredCandidate, ArgusSearchInput, ArgusSearchResult,
} from "./types.js";

export {
  SURFACE_EYES,
  EYE_1_bigram_dice, EYE_2_damerau_lev_thai, EYE_3_thai_metaphone,
  EYE_4_length_ratio, EYE_5_sliding_window,
  bigrams, damerauLevThai, thaiMetaphone,
} from "./eyes_surface.js";

export {
  TRUTH_EYES,
  EYE_6_homoglyph_collapse, EYE_7_number_paraphrase, EYE_8_embedding_cosine,
  EYE_9_hmac_provenance, EYE_10_honest_mirror_penalty,
  honestMirrorMultiplier,
} from "./eyes_truth.js";

export {
  rebalanceEyeWeights,
  type RebalancedEyes,
} from "./guardian.js";

export {
  spawnHydraEye, autoSpawnHydra, hydraBonus,
  type AvStrainLike,
} from "./hydra.js";

export {
  argusSearch, verifyArgusResult,
} from "./engine.js";
