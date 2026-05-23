/**
 * v2.29.0 — MNEME CONCLAVE public surface.
 */

export * from "./types.js";
export { generateVariants, awarenessScore } from "./aeae/index.js";
export type { ClaimVariant } from "./aeae/index.js";
export { aggregate } from "./bft.js";
export type { BftConfig, BftResult } from "./bft.js";
export { aletheiaWeight, __resetAletheiaCacheForTest } from "./aletheia_weights.js";
export { resolveVendors, adapterFor } from "./vendors/registry.js";
export type { VendorAdapter } from "./vendors/interface.js";
export {
  runConclave, storeVerdict, readLatestVerdict, listVerdicts,
  readDissentCorpus, verifyVerdict, __resetConclaveChainForTest,
} from "./engine.js";
export type { LedgerEntry } from "./engine.js";
