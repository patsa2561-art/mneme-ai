/**
 * v1.61.0 -- EXODUS PROJECT public API.
 *
 * Six layers ship together as a single coherent automation stack:
 *
 *   Layer 1: GENOME          -- 4-stranded wisdom DNA encoder
 *   Layer 2: WANDERER        -- single-file .mwt bundle for travel
 *   Layer 3: NUCLEAR EXCHANGE -- cross-Mneme handshake + merge
 *   Layer 4: DREAM WEAVER    -- overnight self-evolution loop
 *   Layer 5: QUANTUM CACHE   -- speculative pre-execution + Markov
 *   Layer 6: WISDOM RIVER    -- SSE broadcast of live wisdom events
 */

// Layer 1: Genome
export {
  encodeGenome, verifyGenome, diffGenomes, recombine,
  persistGenome, readLatestGenome,
  type MnemeGenome, type StrandLabel, type GenomeDiff,
  type AdamantStrand, type CalibratedStrand, type GovernedStrand, type TemporalStrand,
} from "./genome.js";

// Layer 2: Wanderer
export {
  packWanderer, unpackWanderer, describeBundle,
  type MWTBundle,
} from "./wanderer.js";

// Layer 3: Nuclear Exchange
export {
  makeCert, makeOffer, evaluateOffer, mergeGenomes,
  type HandshakeCert, type HandshakeOffer, type HandshakeAccept, type HandshakeReject, type AcceptPolicy,
} from "./exchange.js";

// Layer 4: Dream Weaver
export {
  runDreamCycle, readDreamLog,
  type DreamCycle, type DreamCyclePhases, type DreamWeaverOptions,
} from "./dream_weaver.js";

// Layer 5: Quantum Cache
export {
  observeToolCall, predictNextTools,
  cacheLookup, cacheStore, currentInvalidationKey, cacheStats,
  type CacheEntry, type MarkovState, type CacheStats,
} from "./quantum_cache.js";

// Layer 6: Wisdom River
export { WisdomRiver, readEventLog, type EventKind, type WisdomEvent } from "./wisdom_river.js";
