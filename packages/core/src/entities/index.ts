/**
 * Phase 2 — entity-level memory.
 *
 * Phase 1 indexes commits and PR text. Phase 2 indexes the *symbols inside the
 * code itself* — functions, classes, modules, exported types — so we can answer
 * questions like:
 *
 *   "Which functions in this repo do roughly the same thing as parseAmount?"
 *   "Find all places that re-implement retry logic."
 *   "Where is this concept handled outside of its declared module?"
 *
 * The contracts live here. The parsers and clusterers plug in by implementing
 * these interfaces. v0.2 will ship a tree-sitter-backed EntityParser and a
 * cosine-clustering CloneDetector. Both are forward-compatible with this surface.
 */

import type { Entity } from "../types.js";

/**
 * Walks a workspace and emits every interesting symbol it finds.
 *
 * Implementations should:
 *   - Use tree-sitter or an equivalent AST library — regex is not enough
 *   - Skip generated, vendored, and node_modules paths by default
 *   - Be incremental-friendly: callers may only re-parse changed files
 */
export interface EntityParser {
  readonly name: string;
  readonly languages: string[];
  parseRepo(opts: ParseOptions): AsyncIterable<Entity>;
  parseFile(filePath: string, source: string): Iterable<Entity>;
}

export interface ParseOptions {
  cwd: string;
  /** Limit to specific paths (relative to cwd). */
  paths?: string[];
  /** Languages to consider; default = all that the parser supports. */
  languages?: string[];
  onProgress?: (filesParsed: number) => void;
}

/**
 * Groups entities by semantic similarity. The output is a set of clusters, each
 * containing entities that "do roughly the same thing". The detector itself
 * decides how strict the threshold is.
 *
 *   detect({ entities, embedder, threshold: 0.85 })
 */
export interface CloneDetector {
  readonly name: string;
  detect(opts: DetectOptions): Promise<EntityCluster[]>;
}

export interface DetectOptions {
  entities: Entity[];
  /** Cosine threshold (0..1). Higher = stricter. */
  threshold?: number;
  /** Cap on cluster size to keep results scannable. */
  maxClusterSize?: number;
}

export interface EntityCluster {
  /** Stable id derived from member entity ids. */
  id: string;
  /** Cluster cohesion score (mean pairwise cosine, 0..1). */
  cohesion: number;
  members: Entity[];
  /** Optional one-line summary the detector chose to attach. */
  label?: string;
}

/**
 * Default thresholds used across the codebase.
 */
export const DEFAULT_CLONE_THRESHOLD = 0.85;
export const DEFAULT_MAX_CLUSTER_SIZE = 12;

export { TypeScriptParser, entityEmbeddingText } from "./typescript-parser.js";
export { PythonParser } from "./python-parser.js";
export { CosineCloneDetector } from "./cosine-clones.js";
