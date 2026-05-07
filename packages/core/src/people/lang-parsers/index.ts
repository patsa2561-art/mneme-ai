/**
 * Lang-parsers — tiny shape extractors used by `mneme influence`.
 *
 * The TypeScript / JavaScript path goes through the full
 * {@link TypeScriptParser} (compiler API). For Python and Go we use these
 * cheap regex-based extractors instead — they don't need a Python install
 * or a tree-sitter native dep, they ship in the same npm tarball, and they
 * give us "good enough" coverage for the cultural-alpha PageRank.
 *
 * If/when the project gains an AST-grade parser for these languages, it
 * can be slotted in by changing only {@link parseShapesByExtension}.
 */

import { extname } from "node:path";
import type { Entity } from "../../types.js";
import { extractPythonShapes } from "./python.js";
import { extractGoShapes } from "./go.js";

export { extractPythonShapes } from "./python.js";
export { extractGoShapes } from "./go.js";

/** Set of file extensions we know how to extract shapes from here. */
export const SUPPORTED_EXTENSIONS = new Set([".py", ".pyi", ".go"]);

/**
 * Dispatch by file extension. Returns [] for unsupported languages so callers
 * can chain it with their existing TS/JS path without branching.
 */
export function parseShapesByExtension(
  filePath: string,
  content: string,
): Entity[] {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".py" || ext === ".pyi") return extractPythonShapes(content, filePath);
  if (ext === ".go") return extractGoShapes(content, filePath);
  return [];
}
