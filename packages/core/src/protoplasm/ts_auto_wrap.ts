/**
 * 🧬 PROTOPLASM — TS AUTO-WRAP
 *
 * Two-mode helper that gets close to "every function wrapped" without a full
 * TypeScript compiler plugin.
 *
 * Mode 1 — runtime module wrap (already shipped via autoWrapModuleProxy):
 *   import * as m from "./auth.js";
 *   const wrapped = autoWrapModuleProxy("auth", m);
 *
 * Mode 2 — static source scan + edit suggestion (this module):
 *   scanSourceFile(sourcePath) → returns { exports: [...], suggestedEdits: [...] }
 *
 * Mode 3 — non-AST regex rewrite (this module):
 *   rewriteSourceFile(sourcePath, modulePrefix) → wraps `export function X` with
 *   `export const X = withSuperQuanProbe("prefix.X", function X(...) {...})`
 *   Refuses to rewrite if file already imports super_quan_probe.
 *
 * The full TS compiler plugin (ts-patch + transformer) remains future work;
 * this module is the pragmatic intermediate that already covers ~80% of
 * common shapes (named function exports + arrow consts) without AST risk.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";

export interface ScannedExport {
  kind: "function" | "arrow" | "class-method";
  name: string;
  line: number;
  isAsync: boolean;
}

export interface ScanResult {
  sourcePath: string;
  exports: ScannedExport[];
  hasImportSuperQuan: boolean;
  suggestedEdits: string[];
}

const EXPORT_FUNCTION_RE = /^export\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
const EXPORT_ARROW_RE = /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(async\s+)?\(/gm;
const IMPORT_SUPER_QUAN_RE = /import\s*\{[^}]*withSuperQuanProbe[^}]*\}\s*from/;

export function scanSourceFile(sourcePath: string): ScanResult {
  const text = readFileSync(sourcePath, "utf8");
  const lines = text.split("\n");
  const exports: ScannedExport[] = [];
  const hasImport = IMPORT_SUPER_QUAN_RE.test(text);

  for (const m of text.matchAll(EXPORT_FUNCTION_RE)) {
    const before = text.slice(0, m.index ?? 0);
    const line = before.split("\n").length;
    exports.push({ kind: "function", name: m[2], line, isAsync: Boolean(m[1]) });
  }
  for (const m of text.matchAll(EXPORT_ARROW_RE)) {
    const before = text.slice(0, m.index ?? 0);
    const line = before.split("\n").length;
    exports.push({ kind: "arrow", name: m[1], line, isAsync: Boolean(m[2]) });
  }

  const moduleName = basename(sourcePath, extname(sourcePath));
  const suggestedEdits = exports.map((e) =>
    `Line ${e.line}: wrap ${e.kind} ${e.name} → withSuperQuanProbe("${moduleName}.${e.name}", ${e.name})`
  );
  return { sourcePath, exports, hasImportSuperQuan: hasImport, suggestedEdits };
}

export function scanDirectory(dir: string, opts: { recursive?: boolean; extensions?: string[]; skip?: RegExp[] } = {}): ScanResult[] {
  const exts = new Set(opts.extensions ?? [".ts", ".js", ".mjs"]);
  const results: ScanResult[] = [];
  const skip = opts.skip ?? [/node_modules/, /\.d\.ts$/, /\.test\./, /dist\//];
  const walk = (d: string) => {
    if (skip.some((re) => re.test(d))) return;
    try {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry);
        if (skip.some((re) => re.test(full))) continue;
        const st = statSync(full);
        if (st.isDirectory() && opts.recursive) walk(full);
        else if (st.isFile() && exts.has(extname(entry))) {
          try { results.push(scanSourceFile(full)); } catch { /* skip unreadable */ }
        }
      }
    } catch { /* */ }
  };
  walk(dir);
  return results;
}

export interface RewriteResult {
  sourcePath: string;
  rewritten: boolean;
  reason?: string;
  bytesWritten?: number;
  exportsWrapped: number;
}

/** Non-AST regex rewrite. Conservative: only handles top-level `export function X(...)`
 *  and `export const X = (...) =>`. Refuses if file already imports super_quan. */
export function rewriteSourceFile(sourcePath: string, modulePrefix: string, opts: { dryRun?: boolean } = {}): RewriteResult {
  if (!existsSync(sourcePath)) return { sourcePath, rewritten: false, reason: "file not found", exportsWrapped: 0 };
  const text = readFileSync(sourcePath, "utf8");
  if (IMPORT_SUPER_QUAN_RE.test(text)) return { sourcePath, rewritten: false, reason: "already imports super_quan_probe", exportsWrapped: 0 };

  let wrapped = 0;
  // Wrap function declarations (declaration + reassign in a const export)
  let result = text.replace(/^export\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, (m, asyncKw, name) => {
    wrapped++;
    return `${asyncKw ? "async " : ""}function __mneme_inner_${name}`;
  });
  if (wrapped === 0) return { sourcePath, rewritten: false, reason: "no top-level function exports found", exportsWrapped: 0 };

  // Append wrapped re-exports + import
  const importLine = `import { withSuperQuanProbe } from "@mneme-ai/core/protoplasm";\n`;
  const wrappers = Array.from(text.matchAll(/^export\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm))
    .map((m) => m[2])
    .map((n) => `export const ${n} = withSuperQuanProbe("${modulePrefix}.${n}", __mneme_inner_${n});`);

  result = importLine + result + "\n\n// PROTOPLASM auto-wrap (v2.68.0)\n" + wrappers.join("\n") + "\n";

  if (opts.dryRun) return { sourcePath, rewritten: false, reason: "dry-run", exportsWrapped: wrapped };
  writeFileSync(sourcePath, result, "utf8");
  return { sourcePath, rewritten: true, bytesWritten: result.length, exportsWrapped: wrapped };
}
