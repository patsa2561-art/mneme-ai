/**
 * People analytics — latent collaboration + knowledge decay.
 *
 *   telepathy      — pairs of authors who never co-author but rhyme behaviorally
 *   atrophy        — Ebbinghaus forgetting curve over (author × file) pairs
 *   nemesis        — engineering-friction pairs (revert / rewrite each other)
 *   promise        — promise-debt ledger from commit/PR text
 *   influence      — code-pattern PageRank (cultural alphas)
 *   lineage        — semantic ownership of code over time
 *   passport       — per-engineer dossier composing the above
 *   nervous-system — repo-level neural map composing the above
 *   render-html    — self-contained HTML renderer for both reports
 *   pdf            — peer-optional puppeteer-core HTML→PDF bridge
 */
export * from "./telepathy.js";
export * from "./atrophy.js";
export * from "./nemesis.js";
export * from "./promise.js";
export * from "./influence.js";
export * from "./lineage.js";
export * from "./passport.js";
export * from "./nervous-system.js";
export * from "./render-html.js";
export * from "./pdf.js";
