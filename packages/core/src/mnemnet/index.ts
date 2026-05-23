/**
 * v2.33.0 — MNEMNET public surface.
 *
 * Federated AI-honesty network. DP-noised envelopes from each opted-in
 * Mneme node aggregate into a Public Honesty Court HSC that no single
 * user can game. v2.33.0 ships local aggregator + opt-in scaffolding
 * + push stub (no live network). Federation endpoint v2.34.x.
 */

export type {
  MnemnetConsent, DpAggregate, PublicHscRow, PublicHsc,
} from "./types.js";

export {
  laplaceSample, makeDeterministicRng, noisedCount,
} from "./dp.js";

export {
  readConsent, setConsent, buildEnvelope, persistEnvelope, listEnvelopes,
  verifyEnvelope, aggregatePublicHsc, federatePush,
} from "./aggregate.js";
