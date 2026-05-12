/**
 * v1.65.0 -- APOPTOSIS PROTOCOL public API.
 *
 * 7 layers + orchestrator + bench. The Mneme way to kill AI
 * hallucinations: any one of 7 independent oracles can refute, and
 * the orchestrator escalates by ALERT count:
 *
 *   HEALTHY    0 alerts (claim trusted)
 *   INFLAMED   1 alert  (mild caution)
 *   NECROTIC   2-4 alerts (significant fabrication signal)
 *   APOPTOTIC  5+ alerts (claim self-destructs + auto-vaccinates)
 */

export * as witnesses from "./witnesses.js";
export * as semanticGrounding from "./semantic_grounding.js";
export * as bayesianPrior from "./bayesian_prior.js";
export * as temporalConsistency from "./temporal_consistency.js";
export * as epistemicHumility from "./epistemic_humility.js";
export * as fractalDecompose from "./fractal_decompose.js";
export * as acgvCascade from "./acgv_cascade.js";
export * as apoptosis from "./apoptosis.js";
export * as bench from "./bench.js";

// Direct re-exports of the most common entry points.
export { fiveWitness, extractFacets } from "./witnesses.js";
export { semanticGround } from "./semantic_grounding.js";
export { bayesianPrior as runBayesianPrior } from "./bayesian_prior.js";
export { temporalConsistency as runTemporalConsistency } from "./temporal_consistency.js";
export { humilityDensity } from "./epistemic_humility.js";
export { fractalDecompose as runFractalDecompose } from "./fractal_decompose.js";
export { acgvCascade as runAcgvCascade } from "./acgv_cascade.js";
export { detect, type ApoptosisReport, type ApoptosisVerdict, type ApoptosisOptions } from "./apoptosis.js";
export { runBench, buildCorpus, renderBench, type BenchSample, type BenchResult } from "./bench.js";
