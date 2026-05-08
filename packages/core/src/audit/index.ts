/**
 * AI Session Audit — public surface.
 *
 * The pitch: every AI-driven commit gets a trust certificate.  AI tools
 * (Claude Code, Cursor, Codex, Devin, ...) silently introduce
 * regressions; this module snapshots behavior BEFORE the AI works,
 * traces what actually changed, verifies the AI's narrative, and emits
 * a 5-axis trust certificate.  Vendor-neutral.
 */
export * from "./baseline.js";
export * from "./trace.js";
export * from "./verify.js";
export * from "./certify.js";
export * from "./head-verify.js";
export * from "./superposition.js";
export * from "./claim-graph.js";
export * from "./multi-verifier.js";
