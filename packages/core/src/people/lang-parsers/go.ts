/**
 * Go shape extractor — regex-based, intentionally tiny.
 *
 * Mirrors {@link extractPythonShapes}: produce just enough Entity records
 * (name + arity + position) for `mneme influence` to do its cultural-alpha
 * PageRank pass. We do NOT try to be a real Go parser — `findGoEntities`
 * in `packages/core/src/entities/go-parser.ts` exists for callers that need
 * full struct / interface / type-alias coverage.
 *
 * Honest scope (things the regex misses, by design):
 *   • Multi-line `func(` signatures where args span lines. We extract from
 *     the same line as `func`; multi-line decls are skipped.
 *   • Method receivers contribute their bare type name — `func (r *Foo) Bar()`
 *     shows up as `Foo.Bar`. That preserves "the same Bar across files
 *     groups together as a shape" while still letting `Foo.Bar` and
 *     `Baz.Bar` separate when they should.
 *   • Strings or comments that look like func decls would be false positives.
 *     We do a lightweight pre-strip of `//` line comments before scanning;
 *     we do not try to be perfect about block comments or backtick strings.
 */

import type { Entity } from "../../types.js";

/** Free function: `func Name(args)` (optional generics, optional return). */
const GO_FUNC_RE = /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)/;
/** Method: `func (r *Recv) Name(args)`. */
const GO_METHOD_RE = /^func\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s+)?\*?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)/;

export function extractGoShapes(content: string, filePath: string): Entity[] {
  const out: Entity[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = stripLineComment(raw);
    const trimmed = line.trim();
    if (!trimmed.startsWith("func")) continue;

    // Try method first — it's strictly more specific.
    const methodMatch = GO_METHOD_RE.exec(trimmed);
    if (methodMatch) {
      const recvType = methodMatch[1] ?? "";
      const methodName = methodMatch[2] ?? "";
      const argsRaw = methodMatch[3] ?? "";
      const fullName = recvType ? `${recvType}.${methodName}` : methodName;
      out.push({
        id: `go:${filePath}:${fullName}:${i + 1}`,
        kind: "function",
        name: fullName,
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        signature: `func (${recvType}) ${methodName}(${argsRaw.trim()})`,
        language: "go",
      });
      continue;
    }

    const funcMatch = GO_FUNC_RE.exec(trimmed);
    if (funcMatch) {
      const name = funcMatch[1] ?? "";
      const argsRaw = funcMatch[2] ?? "";
      out.push({
        id: `go:${filePath}:${name}:${i + 1}`,
        kind: "function",
        name,
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        signature: `func ${name}(${argsRaw.trim()})`,
        language: "go",
      });
    }
  }
  return out;
}

/** Drop `// ...` line comments. Keep `//` inside double-quoted strings alone. */
function stripLineComment(line: string): string {
  let inStr: '"' | "`" | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "'") {
      inStr = ch as '"' | "`" | "'";
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}
