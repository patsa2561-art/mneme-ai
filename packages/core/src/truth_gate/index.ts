/**
 * v2.27.0 — MARKETING TRUTH GATE public surface.
 */

export * from "./types.js";
export { CLAIM_CATALOG } from "./claims.js";
export { ALL_PROBES, runProbe, probeById } from "./probes.js";
export {
  reconcileAll, storeMatrix, readLatestMatrix, listMatrices,
  verifyMatrix, renderShort, __resetTruthChainForTest,
} from "./engine.js";
export type { MatrixLedgerEntry } from "./engine.js";
