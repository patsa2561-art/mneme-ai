/**
 * Python shape extractor — regex-based, intentionally tiny.
 *
 * Why regex (and not the full subprocess-based `PythonParser` in
 * `packages/core/src/entities/python-parser.ts`)? Because `mneme influence`
 * is a one-pass scan of HEAD looking for *function name + arity* shapes —
 * not a real AST. We do not need to type-check, we do not need to walk
 * methods inside nested classes; we need a fast, dependency-free pass that
 * produces enough signal for the cultural-alpha PageRank.
 *
 * Honest scope (things the regex misses, by design):
 *   • Multi-line `def` signatures where the closing paren is on a later line.
 *     Our pattern only sees `def foo(...):` on one line; if a real codebase
 *     splits args across lines, we either skip that def or under-count its
 *     arity. That's acceptable for an influence ranking.
 *   • Strings or comments that look like `def foo(...):` will be picked up
 *     as a false positive. Empirically this is rare and the noise washes
 *     out across the graph.
 *   • Decorators are recognised but not stored — they don't change the
 *     name+arity shape.
 *   • Nested defs and methods inside classes ARE picked up (we walk every
 *     line, not the AST), with names left bare (no `Class.` prefix). For
 *     the influence graph this is fine: we want pattern propagation, not
 *     fully-qualified ownership.
 */

import type { Entity } from "../../types.js";

/** A bare `def foo(args)` or `async def foo(args)` or `class Foo:` declaration. */
const PY_DEF_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
const PY_CLASS_RE = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*:/;

/**
 * Pure shape extractor. No filesystem / subprocess. Tests can hand it a
 * string and assert against the result.
 */
export function extractPythonShapes(content: string, filePath: string): Entity[] {
  const out: Entity[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip pure comment lines outright — they can't host real defs.
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) continue;

    const defMatch = PY_DEF_RE.exec(line);
    if (defMatch) {
      const name = defMatch[2] ?? "";
      const argsRaw = defMatch[3] ?? "";
      const arity = countArity(argsRaw, /* dropSelf */ true);
      const signature = buildSignature("def", name, argsRaw);
      out.push({
        id: `py:${filePath}:${name}:${i + 1}`,
        kind: "function",
        name,
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        signature,
        language: "python",
      });
      continue;
    }

    const classMatch = PY_CLASS_RE.exec(line);
    if (classMatch) {
      const name = classMatch[2] ?? "";
      const signature = `class ${name}${classMatch[3] ?? ""}`;
      out.push({
        id: `py:${filePath}:${name}:${i + 1}`,
        kind: "class",
        name,
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        signature,
        language: "python",
      });
    }
  }
  return out;
}

/**
 * Count comma-separated parameters at depth 0. Honors nested
 * (), [], {}, and angle brackets so generic-looking annotations don't inflate
 * the arity. When `dropSelf` is true the leading `self` / `cls` parameter is
 * not counted (Python convention — keeps shape comparable with free fns).
 */
function countArity(argsRaw: string, dropSelf: boolean): number {
  const inner = argsRaw.trim();
  if (!inner) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if (ch === "(" || ch === "[" || ch === "<" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === ">" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  if (dropSelf) {
    const first = inner.split(",")[0]?.trim() ?? "";
    // Strip type annotation / default if present (`self: Foo`, `self=None`).
    const head = first.split(/[:=]/)[0]?.trim();
    if (head === "self" || head === "cls") count = Math.max(0, count - 1);
  }
  return count;
}

function buildSignature(prefix: string, name: string, argsRaw: string): string {
  return `${prefix} ${name}(${argsRaw.trim()})`;
}
