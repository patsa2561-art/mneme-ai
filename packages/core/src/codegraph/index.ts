/**
 * v2.25.0 — LIVING SOUL CODEGRAPH public surface.
 */

export * from "./types.js";
export { buildGraph, graphSignature } from "./builder.js";
export {
  writeSnapshot, readSnapshot, chainEdges, verifyChain,
  recordDrift, readDriftEvents,
} from "./store.js";
export { merkleRoot, leafHash, rootsMatch, __EMPTY_ROOT_SENTINEL } from "./merkle.js";
export { query, neighbours, markVaccineWarning } from "./query.js";
export { detectDrift, edgesTouchedBy } from "./drift.js";
