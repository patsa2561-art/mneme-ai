/**
 * Mneme Genome — genetic engineering primitives for MCP.
 *
 *   G1 · annotator + phylogeny — functional taxonomy + ancestry tree
 *   G2 · circuits — toggle / AND / OR / NOT / oscillator
 *   G3 · operons — co-regulated tool clusters
 *   G4 · CRISPR — precise pack surgery
 *   G5 · synthesizer — de novo tool synthesis
 */

export * from "./annotator.js";
export * from "./phylogeny.js";
export * from "./circuits.js";
export * from "./operons.js";
export * from "./crispr.js";
export * from "./synthesizer.js";
export * as pool from "./pool.js";
