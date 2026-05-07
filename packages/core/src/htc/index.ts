/**
 * Hierarchical Token Cache (HTC) — barrel.
 *
 * Exports:
 *   - types.ts     — shared types (AbstractResult, ClusterSummary, Memoir, HtcStats, HtcEnricher)
 *   - abstract.ts  — Layer 1 (~30 tok per commit)
 *   - clusters.ts  — Layer 2 (~100 tok per cluster)
 *   - memoir.ts    — Layer 3 (~500 tok per repo)
 *   - storage.ts   — SQLite read/write helpers
 */
export * from "./types.js";
export * from "./abstract.js";
export * from "./clusters.js";
export * from "./memoir.js";
export * from "./storage.js";
