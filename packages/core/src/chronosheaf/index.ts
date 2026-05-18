/**
 * v2.19.47 — CHRONOSHEAF · sheaf-cohomology AI-memory foundation.
 *
 *   The module composes 7 mathematical primitives + 1 pain catalog
 *   into a single export surface. P1 (pain_catalog) is the structural
 *   anchor that types every other primitive; P2-a..g implement the
 *   primitives themselves. P3 (the integrating orchestrator) ships
 *   in a later release once the primitives are battle-tested.
 *
 *   Each primitive is a pure function with a deterministic, documented
 *   mathematical contract. They compose horizontally — e.g. a sheaf
 *   over a presheaf of categorical posteriors uses Friston free-energy
 *   to compute "epistemic" cocycles; a persistent diagram over a
 *   filtration of MCP catalog snapshots uses Wasserstein for
 *   bottleneck-distance comparison; a tropical inference chain
 *   composes verifier confidences; the bisimulation engine certifies
 *   self-referential beliefs without Russell paradox.
 */

export * as painCatalog from "./pain_catalog.js";
export * as sheaf from "./sheaf.js";
export * as rgFlow from "./rg_flow.js";
export * as persistence from "./persistence.js";
export * as freeEnergy from "./free_energy.js";
export * as wasserstein from "./wasserstein.js";
export * as tropical from "./tropical.js";
export * as aczel from "./aczel.js";

// v2.19.48 — P3 + P4: base space + live ChronoSheafUpdate orchestrator
export * as baseSpace from "./base_space.js";
export * as liveUpdate from "./live_update.js";

export type { PainEntry, PainTopology, PrimitiveTag } from "./pain_catalog.js";
export type { Site, SheafCover, Section0, Section1, SheafResult } from "./sheaf.js";
export type { RGState, RGStep, Relevance } from "./rg_flow.js";
export type { FiltrationStep, PersistencePair, PersistenceDiagram } from "./persistence.js";
export type { Categorical, ActionCandidate, ActionScoring } from "./free_energy.js";
export type { DiscreteMeasure, CostMatrix } from "./wasserstein.js";
export type { TropicalGraph, TropicalPathResult } from "./tropical.js";
export type { Hyperset, HypersetNode } from "./aczel.js";
export type { CommitSha, TimeMs, ScaleBand, OpenSet, TimeInterval, BeliefVector } from "./base_space.js";
export type { ChronoEvent, EventEmitter, Evidence, ClaimObservation, UpdateInput, UpdateState, UpdateSummary, ChronoSlo } from "./live_update.js";
