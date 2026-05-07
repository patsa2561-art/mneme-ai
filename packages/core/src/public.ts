/**
 * The stable public API surface of `@mneme-ai/core`.
 *
 * Import from `@mneme-ai/core/public` (preferred for external integrations).
 * Anything NOT re-exported from this file is considered **internal** and may
 * change without notice between minor versions. Only the surface declared
 * here follows semver: breaking changes land only in major-version bumps.
 *
 * Design rule: every export here is something a downstream tool (CI bot,
 * IDE extension, dashboard, GitHub App) needs to read or invoke from
 * Mneme. If it's only useful inside Mneme itself, it does not belong here.
 *
 * Categories:
 *   1. Repo metadata + storage  — read-only access to the indexed cache
 *   2. AI Session Audit          — programmatic audit pipeline for CI
 *   3. People analytics          — invoke individual analyzers
 *   4. Composition (passport / nervous-system + HTML / PDF rendering)
 *
 * @packageDocumentation
 */

// ─── 1. Repo metadata + storage ───────────────────────────────────────
/**
 * Read repository metadata for a given working directory.
 * @public
 */
export { getRepoMeta, isGitRepo } from "./git/index.js";

/**
 * Open the SQLite-backed memory store for a Mneme-indexed repo.
 * The store is read-mostly; writes are reserved for `mneme index`.
 * @public
 */
export { MnemeStore } from "./store/sqlite.js";

// ─── 2. AI Session Audit (the CI integration story) ──────────────────
/**
 * Snapshot the current behavior + API surface + perf baseline.
 * Call before letting an AI agent modify the repo.
 * @public
 */
export { captureBaseline, persistBaseline, loadBaseline } from "./audit/baseline.js";

/**
 * After the AI has worked, capture the diff + identify the AI vendor
 * (Claude Code / Cursor / Codex / Devin / Sweep / Aider / Copilot).
 * @public
 */
export { traceSession } from "./audit/trace.js";

/**
 * Verify the AI's commit-message narrative against the actual diff
 * (Leviathan-style claim-vs-reality check).
 * @public
 */
export { verifyNarrative } from "./audit/verify.js";

/**
 * Run the 5-axis trust certificate. Returns a CI-friendly verdict
 * (pass / warn / fail) plus exit code.
 * @public
 */
export { certifySession } from "./audit/certify.js";

// ─── 3. People analytics — individual analyzers ──────────────────────
/**
 * Latent collaboration network — pairs of authors who never co-authored
 * but whose changes are behaviorally coupled.
 * @public
 */
export { telepathy } from "./people/telepathy.js";

/**
 * Knowledge half-life clock — Ebbinghaus decay over (author × file).
 *
 * - `atrophy(store, opts?)` for the repo-wide heatmap.
 * - `atrophyForAuthor(store, email, opts?)` for one engineer.
 * - `atrophyForFile(store, path, opts?)` for the knowers of one file.
 * @public
 */
export { atrophy, atrophyForAuthor, atrophyForFile } from "./people/atrophy.js";

/**
 * Engineering-friction detector. Defamation-safe: results are labeled
 * as engineering friction only, never as personal conflict.
 * @public
 */
export { buildNemesisReport } from "./people/nemesis.js";

/**
 * Promise-debt ledger. Heuristic — treat results as a starting list,
 * not a verdict.
 * @public
 */
export { buildPromiseReport } from "./people/promise.js";

/**
 * Cultural-alphas (PageRank on code-pattern propagation).
 * Multi-language: TypeScript / JavaScript / Python / Go.
 * @public
 */
export { buildInfluenceReport } from "./people/influence.js";

/**
 * Semantic ownership of a function or file (intent-continuity walk).
 * @public
 */
export { buildLineageReport } from "./people/lineage.js";

// ─── 4. Composition (the flagships external tools embed) ─────────────
/**
 * Build a single engineer's passport (DNA + expertise + telepathic
 * teammates + influence + atrophy + voice fingerprint).
 * @public
 */
export { buildPassport } from "./people/passport.js";

/**
 * Build the repo-level Nervous System report (top passports + telepathy
 * heatmap + atrophy heatmap + influence ladder + neuroanatomy +
 * honest-limits panel).
 * @public
 */
export { buildNervousSystem } from "./people/nervous-system.js";

/**
 * Render passport / nervous-system data as a self-contained HTML
 * document (inline CSS, no external dependencies). Always works;
 * suitable for CI artifact upload.
 * @public
 */
export { renderPassportHtml, renderNervousSystemHtml } from "./people/render-html.js";

/**
 * Render an HTML report file to PDF. Lazy-loads `puppeteer-core`;
 * throws `PdfDependencyMissingError` if the peer dependency is not
 * installed. Catch and fall back to HTML.
 * @public
 */
export { htmlToPdf, PdfDependencyMissingError } from "./people/pdf.js";

// ─── Type aliases that downstream tools serialize / deserialize ──────
/**
 * The 5-axis trust certificate produced by `certifySession`.
 * @public
 */
export type { AuditCertificate } from "./audit/certify.js";

/**
 * The structured passport report (input to `renderPassportHtml`).
 * @public
 */
export type { PassportData } from "./people/passport.js";

/**
 * The structured nervous-system report (input to `renderNervousSystemHtml`).
 * @public
 */
export type { NervousSystemData } from "./people/nervous-system.js";

/**
 * Telepathy result shape.
 * @public
 */
export type { TelepathyResult, TelepathyPair } from "./people/telepathy.js";

/**
 * Atrophy result shapes.
 * @public
 */
export type {
  AtrophyReport,
  AuthorKnowledge,
  FileKnowledge,
  FileExpert,
  AuthorDetail,
} from "./people/atrophy.js";

/**
 * Nemesis / friction-detector report shape.
 * @public
 */
export type { NemesisReport, NemesisPair } from "./people/nemesis.js";

/**
 * Promise-ledger report shape.
 * @public
 */
export type { PromiseReport, PromiseRecord, PromiseStatus } from "./people/promise.js";

/**
 * Influence (cultural-alpha) report shape.
 * @public
 */
export type { InfluenceReport, AuthorRanking } from "./people/influence.js";

/**
 * Lineage (semantic ownership) report shape.
 * @public
 */
export type { LineageReport, OwnershipShare, TimelineEntry } from "./people/lineage.js";
