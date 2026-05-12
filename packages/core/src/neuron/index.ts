/**
 * v1.79.0 -- NEURON PROTOCOL: the molecule of intelligence.
 *
 * Lets ANY AI agent route across the entire ~100-tool Mneme surface
 * intelligently, even when the user's natural-language phrasing
 * doesn't exactly match a hand-crafted intent atom.
 *
 *   fuzzy        -- trigram Jaccard similarity (no ML, fast, multilingual)
 *   auto_atoms   -- derive routable atoms from any tool catalog
 *   triage       -- 4-stacked-strategy router with confidence + confusion flag
 *   oracle       -- WILD function: predict next tool BEFORE user finishes typing
 */

export * from "./fuzzy.js";
export * from "./auto_atoms.js";
export * from "./triage.js";
export * from "./oracle.js";
