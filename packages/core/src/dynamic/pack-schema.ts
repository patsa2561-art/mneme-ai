/**
 * Pack schema — the single source of truth for what a Mneme pack looks like.
 *
 * A pack is a YAML file describing:
 *   1. How to detect that this pack applies to a repo (signals)
 *   2. What MCP tools the pack exposes (with input schemas)
 *   3. How each tool's query should be executed against Mneme's index
 *   4. What tribal-knowledge augmentation to attach to descriptions
 *
 * Design principle: Pack files are PURE DATA. No code execution from packs.
 * The query engine (our audited TypeScript) is what runs; packs only declare
 * what to query and how to format the result.
 *
 * We use Zod for runtime validation so an invalid pack fails LOUD at load
 * time — never silently at tool-call time. Every constraint here is
 * enforced at runtime, not just at compile time.
 */

import { z } from "zod";

// ─── Detection — how do we know a pack applies to this repo? ──────────

const DetectionSchema = z.object({
  /** npm dependencies in package.json (any one match → strong signal). */
  packageDeps: z.array(z.string().min(1)).default([]),
  /** Python dependencies in requirements.txt / pyproject.toml. */
  pythonDeps: z.array(z.string().min(1)).default([]),
  /** Source-code import statement regexes (validated at parse time). */
  importPatterns: z.array(z.string().min(1)).default([]),
  /** File path regexes (e.g. ".*stripe.*\\.ts$"). */
  filePatterns: z.array(z.string().min(1)).default([]),
  /** Confidence threshold (0..1) to activate this pack. Default: 0.5. */
  minConfidence: z.number().min(0).max(1).default(0.5),
});

// ─── Query primitives — what the engine knows how to execute ─────────

const CodeSearchQuerySchema = z.object({
  kind: z.literal("code-search"),
  /** Regexes to grep for in the repo's source code. */
  patterns: z.array(z.string().min(1)).min(1),
  /** File extensions to scope the search (without dot). */
  fileExtensions: z.array(z.string().min(1)).default(["ts", "tsx", "js", "jsx", "py"]),
  /** Maximum results returned (defensive cap). */
  maxResults: z.number().int().min(1).max(500).default(50),
  /** Ranking strategy. */
  ranking: z.enum(["centrality-desc", "recency-desc", "alphabetical"]).default("centrality-desc"),
});

const GitHistoryQuerySchema = z.object({
  kind: z.literal("git-history"),
  /** File paths or patterns to inspect. */
  paths: z.array(z.string().min(1)).min(1),
  /** Maximum commits to return per path. */
  maxCommits: z.number().int().min(1).max(500).default(20),
});

const EntityGraphQuerySchema = z.object({
  kind: z.literal("entity-graph"),
  /** Entity types to traverse (e.g. function, class). */
  entityKinds: z.array(z.string().min(1)).min(1),
  /** Relation types to follow (e.g. calls, imports). */
  relationKinds: z.array(z.string().min(1)).default(["calls", "imports"]),
  /** Traversal depth. */
  maxDepth: z.number().int().min(1).max(5).default(2),
});

const QuerySchema = z.discriminatedUnion("kind", [
  CodeSearchQuerySchema,
  GitHistoryQuerySchema,
  EntityGraphQuerySchema,
]);

// ─── Enrichment — what tribal knowledge to attach to results ─────────

const EnrichmentEnum = z.enum([
  "git-blame",                    // who last touched each result
  "first-commit-introduced",      // which commit introduced the pattern
  "centrality-rank",              // PageRank ordering (Mneme HMRA)
  "incident-cross-reference",     // forensics incidents on these files
  "atrophy-author",               // current expert + atrophy score
  "constitution-rules",           // applicable repo constitution rules
]);

// ─── Augmentation — what to add to the tool description for the AI ───

const AugmentationSchema = z.object({
  /** Add "Canonical location: services/billing/v2/" to description. */
  includeCanonicalPath: z.boolean().default(true),
  /** Add "Deprecated: lib/stripe/" with reasoning. */
  includeDeprecatedPaths: z.boolean().default(true),
  /** Add "@alice (78% expertise), @bob (atrophy 28%)". */
  includeExpertAuthors: z.boolean().default(true),
  /** Add "Last incident in this area: PII-leak-2024-09 (3 files affected)". */
  includeRecentIncidents: z.boolean().default(true),
  /** Add applicable constitution rules. */
  includeApplicableRules: z.boolean().default(true),
});

// ─── Tool definition ─────────────────────────────────────────────────

const ToolDefinitionSchema = z.object({
  /** Short id (used in tool name as mneme.<pack-id>.<tool-id>). */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "must be snake_case starting with a letter"),
  /** Human description (will be augmented with tribal knowledge at runtime). */
  description: z.string().min(20, "description must be at least 20 chars to be useful"),
  /** JSON Schema for inputs (validated against actual schema at load). */
  inputSchema: z.record(z.string(), z.any()).default({ type: "object", properties: {}, additionalProperties: false }),
  /** Query to execute when this tool is called. */
  query: QuerySchema,
  /** Enrichers to apply to query results. */
  enrichWith: z.array(EnrichmentEnum).default([]),
  /** Tribal-knowledge augmentation for the description. */
  augmentation: AugmentationSchema.default({} as z.infer<typeof AugmentationSchema>),
});

// ─── Pack — the top-level schema ─────────────────────────────────────

export const PackSchema = z.object({
  /** Pack file format version (we're at 1). Bumped on breaking changes. */
  schemaVersion: z.literal(1),
  /** Unique pack id (lowercase, no spaces). Used as tool namespace. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab-case"),
  /** Display name shown to users. */
  displayName: z.string().min(1).max(80),
  /** Pack description (what this pack covers). */
  description: z.string().min(20),
  /** Pack version (semver). Independent of Mneme version. */
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/, "must be semver (e.g. 1.0.0)"),
  /** Minimum Mneme version this pack requires. */
  mnemeMinVersion: z.string().regex(/^\d+\.\d+\.\d+/, "must be semver"),
  /** Maintainer info (for community attribution). */
  maintainer: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }),
  /** SPDX license id. */
  license: z.string().min(1).default("MIT"),
  /** Detection criteria. */
  detection: DetectionSchema,
  /** Tools the pack exposes. */
  tools: z.array(ToolDefinitionSchema).min(1, "pack must expose at least one tool"),
}).strict();

// ─── Inferred TypeScript types (single source of truth) ──────────────

export type Pack = z.infer<typeof PackSchema>;
export type Detection = z.infer<typeof DetectionSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type Query = z.infer<typeof QuerySchema>;
export type CodeSearchQuery = z.infer<typeof CodeSearchQuerySchema>;
export type GitHistoryQuery = z.infer<typeof GitHistoryQuerySchema>;
export type EntityGraphQuery = z.infer<typeof EntityGraphQuerySchema>;
export type Augmentation = z.infer<typeof AugmentationSchema>;
export type Enrichment = z.infer<typeof EnrichmentEnum>;

/** Constants exposed for callers who want to know what's supported. */
export const SUPPORTED_QUERY_KINDS = ["code-search", "git-history", "entity-graph"] as const;
export const SUPPORTED_ENRICHMENTS: ReadonlyArray<Enrichment> = [
  "git-blame",
  "first-commit-introduced",
  "centrality-rank",
  "incident-cross-reference",
  "atrophy-author",
  "constitution-rules",
];
export const PACK_SCHEMA_VERSION = 1 as const;

/**
 * Validate an unknown value against the pack schema.
 *
 * Returns `{ ok: true, pack }` on success or `{ ok: false, errors }` with
 * a structured list of issues. NEVER throws — caller can decide how to
 * surface failures.
 */
export function validatePack(input: unknown): { ok: true; pack: Pack } | { ok: false; errors: PackValidationError[] } {
  const result = PackSchema.safeParse(input);
  if (result.success) return { ok: true, pack: result.data };
  const errors: PackValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join("."),
    code: issue.code,
    message: issue.message,
  }));
  return { ok: false, errors };
}

export interface PackValidationError {
  /** Dot-path to the offending field (e.g. "tools.0.query.patterns"). */
  path: string;
  /** Zod issue code (e.g. "invalid_type", "too_small"). */
  code: string;
  /** Human-readable message. */
  message: string;
}
