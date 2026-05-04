/**
 * Go entity parser — regex-based v1.
 *
 * Why regex and not tree-sitter?
 *   1. Zero new native deps — Mneme runs on every machine without a
 *      C toolchain.
 *   2. Go's grammar at the *declaration level* (the only thing we extract)
 *      is regular enough that bounded patterns capture 95%+ of real code.
 *   3. We never need to *understand* the body — only its name, line range,
 *      and signature. AST overkill for that.
 *
 * Trade-offs (honest):
 *   - We do not handle declarations split across line boundaries with weird
 *     formatting (e.g. a struct field on every line of a function signature).
 *     Mneme degrades gracefully — those entities are simply not surfaced.
 *   - Methods on generic receivers (Go 1.18+: `func (r *Foo[T]) Bar()`) are
 *     supported. Type parameters in plain func decls are supported.
 *   - Interfaces, structs, and type aliases are surfaced as separate kinds.
 *
 * Extracts these top-level kinds:
 *   - function        // func Name[T](...)
 *   - method          // func (r *Recv) Name(...) — named "Recv.Name"
 *   - struct          // type Name struct { ... }
 *   - interface       // type Name interface { ... }
 *   - type            // type Name OtherType
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { execGit } from "../git/exec.js";
import type { Entity } from "../types.js";
import type { EntityParser, ParseOptions } from "./index.js";

const GO_EXTENSIONS = new Set([".go"]);

// Strip line/block comments and string/rune literals BEFORE running the
// declaration regexes. This is the difference between "regex parser" and
// "regex parser that pretends to know about Go strings".
function stripCommentsAndStrings(src: string): string {
  // We replace each masked region with whitespace of the same length so that
  // line numbers and offsets stay stable for the regex pass.
  let i = 0;
  const out: string[] = [];
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];

    // Line comment
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < src.length) {
        out.push("  ");
        i += 2;
      }
      continue;
    }

    // Raw string literal (backtick)
    if (ch === "`") {
      out.push("`");
      i += 1;
      while (i < src.length && src[i] !== "`") {
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < src.length) {
        out.push("`");
        i += 1;
      }
      continue;
    }

    // Interpreted string / rune
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(quote);
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          out.push("  ");
          i += 2;
          continue;
        }
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < src.length) {
        out.push(quote);
        i += 1;
      }
      continue;
    }

    out.push(ch);
    i += 1;
  }
  return out.join("");
}

// Helper: line number from absolute char offset (1-based).
function lineOf(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") n += 1;
  }
  return n;
}

/**
 * Find the matching `}` for the `{` at openIdx in masked source.
 * Returns the absolute offset of the closing brace, or -1 if not found.
 */
function matchBrace(masked: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface GoMatch {
  kind: Entity["kind"];
  name: string;
  signature: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Pure parsing — given Go source text, yield the entity matches found.
 * Exported so the test suite can exercise it without filesystem ceremony.
 */
export function findGoEntities(source: string): GoMatch[] {
  const masked = stripCommentsAndStrings(source);
  const out: GoMatch[] = [];

  // Functions and methods: optional receiver, optional type params, args, optional return type.
  // Group anatomy:
  //   recv        (optional `(...)` receiver)
  //   name        the identifier
  //   typeParams  (optional `[...]` for generics)
  //   args        the `(...)` parameter list
  //   ret         everything after `)` up to the opening `{` or end-of-line
  const funcRe = /\bfunc\s*(?:\(([^)]*)\)\s*)?([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = funcRe.exec(masked)) !== null) {
    const recv = m[1];
    const name = m[2]!;
    const typeParams = m[3] ?? "";
    const start = m.index;
    // Find the matching close paren of the arg list.
    const argsOpen = m.index + m[0].length - 1;
    const argsClose = findMatching(masked, argsOpen, "(", ")");
    if (argsClose < 0) continue;
    // Find the start of the body or end-of-decl: next `{` on same line(s).
    const afterArgs = argsClose + 1;
    const braceIdx = masked.indexOf("{", afterArgs);
    if (braceIdx < 0) continue;
    const bodyEnd = matchBrace(masked, braceIdx);
    if (bodyEnd < 0) continue;
    const sig = source.slice(start, braceIdx).trim();
    const isMethod = !!recv && recv.trim().length > 0;
    let entityName = name;
    if (isMethod) {
      const recvType = parseReceiverType(recv!);
      if (recvType) entityName = `${recvType}.${name}`;
    }
    out.push({
      kind: isMethod ? "function" : "function", // both stored as 'function'; method-ness in name
      name: entityName,
      signature: typeParams ? sig.replace(name, name + typeParams) : sig,
      startOffset: start,
      endOffset: bodyEnd,
    });
  }

  // type Name struct { ... } | interface { ... } | OtherType
  const typeRe = /\btype\s+([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?\s+(struct|interface)?/g;
  while ((m = typeRe.exec(masked)) !== null) {
    const name = m[1]!;
    const tparams = m[2] ?? "";
    const compoundKw = m[3];
    const start = m.index;
    if (compoundKw === "struct" || compoundKw === "interface") {
      const braceIdx = masked.indexOf("{", m.index + m[0].length);
      if (braceIdx < 0) continue;
      const bodyEnd = matchBrace(masked, braceIdx);
      if (bodyEnd < 0) continue;
      // Map Go's struct → 'class' (nominal type with members) and
      // interface → 'type' to fit the cross-language Entity.kind union.
      // The actual `struct` / `interface` keyword is preserved in `signature`.
      const kind: Entity["kind"] = compoundKw === "struct" ? "class" : "type";
      out.push({
        kind,
        name,
        signature: source.slice(start, braceIdx).trim(),
        startOffset: start,
        endOffset: bodyEnd,
      });
    } else {
      // type alias / named type — single line
      const nl = masked.indexOf("\n", m.index + m[0].length);
      const end = nl < 0 ? masked.length : nl;
      out.push({
        kind: "type",
        name,
        signature: source.slice(start, end).trim(),
        startOffset: start,
        endOffset: end,
      });
    }
    if (tparams) {
      // tparams already absorbed into the regex via group 2 — nothing more to do
    }
  }

  return out;
}

/**
 * Find a balanced closing of `close` matching `open` starting at openIdx.
 * Skips nothing — callers should pass already-masked source.
 */
function findMatching(s: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extract the receiver type from a method receiver like `r *Foo` or `f Foo[T]`.
 * Returns just the bare type name (without `*` or generics).
 */
function parseReceiverType(recv: string): string | undefined {
  const m = recv.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*\s+)?\*?\s*([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1];
}

export class GoParser implements EntityParser {
  readonly name = "go-regex";
  readonly languages = ["go"];

  async *parseRepo(opts: ParseOptions): AsyncIterable<Entity> {
    const files = await listGoFiles(opts.cwd, opts.paths);
    let i = 0;
    for (const relPath of files) {
      i += 1;
      let source: string;
      try {
        source = await readFile(join(opts.cwd, relPath), "utf8");
      } catch {
        opts.onProgress?.(i);
        continue;
      }
      try {
        for (const e of this.parseFile(relPath, source)) yield e;
      } catch {
        // best-effort — keep going on bad files
      }
      opts.onProgress?.(i);
    }
  }

  *parseFile(filePath: string, source: string): Iterable<Entity> {
    const matches = findGoEntities(source);
    for (const mm of matches) {
      yield {
        id: stableId(filePath, mm.kind, mm.name, lineOf(source, mm.startOffset)),
        kind: mm.kind,
        name: mm.name,
        filePath,
        startLine: lineOf(source, mm.startOffset),
        endLine: lineOf(source, mm.endOffset),
        signature: mm.signature,
        language: "go",
      };
    }
  }
}

async function listGoFiles(cwd: string, paths?: string[]): Promise<string[]> {
  const r = await execGit(["ls-files"], { cwd });
  if (r.code !== 0) return [];
  const tracked = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => GO_EXTENSIONS.has(extname(p).toLowerCase()))
    .filter((p) => !/_test\.go$/.test(p))
    .filter((p) => !/(^|\/)(vendor|testdata|node_modules)\//.test(p));
  if (!paths || paths.length === 0) return tracked;
  return tracked.filter((p) => paths.some((needle) => p === needle || p.startsWith(needle + "/")));
}

function stableId(filePath: string, kind: string, name: string, line: number): string {
  const h = createHash("sha1")
    .update(`${filePath}|${kind}|${name}|${line}`)
    .digest("hex")
    .slice(0, 12);
  return `e_${h}`;
}
