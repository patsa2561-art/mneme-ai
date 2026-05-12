/**
 * v1.69.0 -- HYPERSCAN PROTOCOL.
 *
 * Four wild moves to close the prose-scan gap + Q&A trust gap +
 * HTC coverage gap. Plus a shape-shifting molecule data structure
 * that supports 5 mixed retrieval algorithms.
 *
 *   H1 prose shadow scan   entity extraction from prose claims
 *   H2 cross-citation      every named entity needs codebase evidence
 *   H3 cross-source Q&A    fuse retrieval across 5 source kinds
 *   H4 nucleus dust HTC    auto-populate HTC coverage 0% -> ~100%
 *   MOLECULE              text/vector/structural/temporal forms
 */

export * as proseShadow from "./prose_shadow.js";
export * as crossCitation from "./cross_citation.js";
export * as crossSourceQa from "./cross_source_qa.js";
export * as nucleusDustHtc from "./nucleus_dust_htc.js";
export * as hyperscanMolecule from "./hyperscan_molecule.js";
export * as bench from "./bench.js";

export { proseScan, extractEntities } from "./prose_shadow.js";
export { crossCitationGround, parseTriples } from "./cross_citation.js";
export { crossSourceAsk } from "./cross_source_qa.js";
export { generateDust, computeCoverage, clusterDust, readAbstracts } from "./nucleus_dust_htc.js";
export { buildMolecule, query, type HyperscanMolecule, type RetrievalAlgo, type MoleculeMatch } from "./hyperscan_molecule.js";
export { runHyperscanBench, renderBench } from "./bench.js";
