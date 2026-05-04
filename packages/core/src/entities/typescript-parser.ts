/**
 * TypeScript / JavaScript entity parser.
 *
 * Uses the TypeScript compiler API (zero new runtime deps — `typescript` is
 * a soft peer dep). Parses .ts / .tsx / .js / .jsx files into Entity records:
 *
 *   function declarations, class declarations, interface declarations,
 *   type aliases, exported variable bindings, exported re-exports.
 *
 * Skips: nested closures, IIFEs, anonymous arrow functions assigned to non-
 * exported variables. The goal is "things a human would consider a unit",
 * not every AST node.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { execGit } from "../git/exec.js";
import type { Entity } from "../types.js";
import type { EntityParser, ParseOptions } from "./index.js";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

export class TypeScriptParser implements EntityParser {
  readonly name = "typescript-compiler-api";
  readonly languages = ["typescript", "tsx", "javascript", "jsx"];

  // Lazy-loaded to keep `typescript` an optional peer dep.
  private ts: typeof import("typescript") | null = null;

  async *parseRepo(opts: ParseOptions): AsyncIterable<Entity> {
    const ts = await this.loadTs();
    const files = await listTsJsFiles(opts.cwd, opts.paths);
    let processed = 0;
    for (const relPath of files) {
      const abs = join(opts.cwd, relPath);
      let source: string;
      try {
        source = await readFile(abs, "utf8");
      } catch {
        processed++;
        continue;
      }
      const language = languageForPath(relPath);
      for (const e of this.parseSourceFileImpl(relPath, source, language, ts)) {
        yield e;
      }
      processed++;
      opts.onProgress?.(processed);
    }
  }

  parseFile(filePath: string, source: string): Iterable<Entity> {
    if (!this.ts) {
      throw new Error(
        "TypeScriptParser.parseFile() requires parseRepo to be called first " +
          "(or call await parser['loadTs']() once). The peer dep `typescript` is loaded lazily.",
      );
    }
    const language = languageForPath(filePath);
    return this.parseSourceFileImpl(filePath, source, language, this.ts);
  }

  /** Eager-load typescript so subsequent sync parseFile() calls work. */
  async preload(): Promise<void> {
    await this.loadTs();
  }

  private async loadTs(): Promise<typeof import("typescript")> {
    if (this.ts) return this.ts;
    try {
      this.ts = await import("typescript");
      return this.ts;
    } catch {
      throw new Error(
        "TypeScriptParser requires the `typescript` package. Install it with: npm install --save-dev typescript",
      );
    }
  }

  private *parseSourceFileImpl(
    filePath: string,
    source: string,
    language: string,
    ts: typeof import("typescript"),
  ): Iterable<Entity> {
    const sf = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : undefined,
    );

    for (const node of sf.statements) {
      yield* this.emitFromStatement(node, sf, filePath, language, ts);
    }
  }

  private *emitFromStatement(
    node: import("typescript").Node,
    sf: import("typescript").SourceFile,
    filePath: string,
    language: string,
    ts: typeof import("typescript"),
  ): Iterable<Entity> {
    if (ts.isFunctionDeclaration(node) && node.name) {
      yield this.makeEntity("function", node.name.text, node, sf, filePath, language, ts);
      return;
    }
    if (ts.isClassDeclaration(node) && node.name) {
      yield this.makeEntity("class", node.name.text, node, sf, filePath, language, ts);
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      yield this.makeEntity("type", node.name.text, node, sf, filePath, language, ts);
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      yield this.makeEntity("type", node.name.text, node, sf, filePath, language, ts);
      return;
    }
    if (ts.isVariableStatement(node)) {
      // Only emit exported variables — anonymous internal bindings would create noise.
      if (!hasModifier(node, ts.SyntaxKind.ExportKeyword, ts)) return;
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          // If the initializer is an arrow function or function expression, classify as function.
          const kind: Entity["kind"] =
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
              ? "function"
              : "variable";
          yield this.makeEntity(kind, decl.name.text, node, sf, filePath, language, ts);
        }
      }
      return;
    }
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      yield this.makeEntity("module", node.name.text, node, sf, filePath, language, ts);
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      yield this.makeEntity("type", node.name.text, node, sf, filePath, language, ts);
      return;
    }
  }

  private makeEntity(
    kind: Entity["kind"],
    name: string,
    node: import("typescript").Node,
    sf: import("typescript").SourceFile,
    filePath: string,
    language: string,
    ts: typeof import("typescript"),
  ): Entity {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf, /*includeJsDoc*/ false));
    const end = sf.getLineAndCharacterOfPosition(node.getEnd());
    const signature = extractSignature(node, sf, ts);
    const id = stableId(filePath, kind, name, start.line);
    return {
      id,
      kind,
      name,
      filePath,
      startLine: start.line + 1,
      endLine: end.line + 1,
      signature,
      language,
    };
  }
}

/** Use git ls-files when available — automatic .gitignore respect. Fall back to filesystem walk. */
async function listTsJsFiles(cwd: string, paths?: string[]): Promise<string[]> {
  const r = await execGit(["ls-files"], { cwd });
  if (r.code !== 0) {
    return [];
  }
  const all = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tracked = all.filter((p) => {
    const ext = extname(p).toLowerCase();
    if (!TS_EXTENSIONS.has(ext) && !JS_EXTENSIONS.has(ext)) return false;
    // Skip type declaration files — they expose types but no implementation.
    if (p.endsWith(".d.ts")) return false;
    // Skip tests by default — they tend to dominate clone clusters with assertion plumbing.
    if (/(^|\/)tests?\//.test(p)) return false;
    if (/\.(test|spec)\./.test(p)) return false;
    return true;
  });
  if (!paths || paths.length === 0) return tracked;
  return tracked.filter((p) =>
    paths.some((needle) => p === needle || p.startsWith(needle + "/")),
  );
}

function languageForPath(p: string): string {
  const ext = extname(p).toLowerCase();
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "jsx";
  return "javascript";
}

function hasModifier(
  node: import("typescript").Node,
  kind: number,
  ts: typeof import("typescript"),
): boolean {
  // `node.modifiers` is preferred but on some node kinds we still need ts.canHaveModifiers.
  const mods = (ts as any).canHaveModifiers?.(node)
    ? (ts as any).getModifiers(node)
    : (node as any).modifiers;
  return Array.isArray(mods) && mods.some((m: any) => m.kind === kind);
}

function extractSignature(
  node: import("typescript").Node,
  sf: import("typescript").SourceFile,
  ts: typeof import("typescript"),
): string {
  // For functions/methods grab everything up to the opening brace.
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    const text = node.getText(sf);
    const braceIdx = text.indexOf("{");
    return braceIdx >= 0 ? text.slice(0, braceIdx).trim() : text.trim().slice(0, 200);
  }
  if (ts.isClassDeclaration(node) && node.name) {
    const text = node.getText(sf);
    const braceIdx = text.indexOf("{");
    return braceIdx >= 0 ? text.slice(0, braceIdx).trim() : text.trim().slice(0, 200);
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return node.getText(sf).slice(0, 200).trim();
  }
  if (ts.isVariableStatement(node)) {
    return node.getText(sf).slice(0, 160).trim();
  }
  return node.getText(sf).slice(0, 120).trim();
}

function stableId(filePath: string, kind: string, name: string, line: number): string {
  const h = createHash("sha1")
    .update(`${filePath}|${kind}|${name}|${line}`)
    .digest("hex")
    .slice(0, 12);
  return `e_${h}`;
}

/** For tests: build entity-embedding text from name + signature + signature-extracted body. */
export function entityEmbeddingText(e: Entity, body?: string): string {
  const parts = [`${e.kind} ${e.name}`];
  if (e.signature) parts.push(e.signature);
  if (body) parts.push(body.slice(0, 600));
  return parts.join("\n");
}
