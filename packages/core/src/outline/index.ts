/**
 * v2.124.0 — OUTLINE: the honest core of "don't load the whole file."
 * v2.125.0 — multi-language (TS/JS + Python + Go + Rust + Java/C-family) +
 *            multi-region fetch.
 *
 * THE REAL PROBLEM (the user's screenshot): when an AI agent Reads a 70-line file
 * to orient itself, the whole file lands in its context (~1.7k tokens), growing
 * linearly with file size — "context-loading hyper-inflation."
 *
 * THE HONEST GEM (validated adversarially — NOT lossless "Code-DNA folding",
 * which information theory forbids; NOT a kernel hook on the agent's Read): give
 * the agent a compact, deterministic STRUCTURAL SKELETON — every symbol with its
 * signature + EXACT line range, bodies ELIDED — so it learns the file's shape
 * for a fraction of the tokens, then fetches the byte-LOSSLESS slice(s) only for
 * the region(s) it must edit. Orient cheap (skeleton) → edit exact (region).
 *
 * HONEST about the limits (DIAKRISIS):
 *   - The skeleton is LOSSY by design (a map, not the territory) — for ORIENTATION.
 *     `extractRegion` is byte-EXACT (line slicing) — for EDITING — in EVERY
 *     language, regardless of how well the structural scan parsed it.
 *   - The scanner is a deterministic structural pass (keyword + brace/indent
 *     aware, with strings + comments masked), NOT a type-checking AST — no deps.
 *     Skeleton QUALITY varies by language; region fetch is always exact.
 *   - Token figures are a labelled ≈chars/4 estimate of INPUT context; the char
 *     reduction is EXACT.
 *
 * Pure + total: deterministic, no I/O, no network, never throws.
 */

export type OutlineLang = "ts" | "js" | "python" | "go" | "rust" | "java" | "c" | "generic";

export interface OutlineSymbol {
  kind: string;
  name: string;
  signature: string;
  startLine: number; // 1-based, inclusive
  endLine: number;   // 1-based, inclusive
  bodyLines: number;
  depth: number;
  doc?: string;
}

export interface Outline {
  lang: OutlineLang;
  totalLines: number;
  symbolCount: number;
  symbols: OutlineSymbol[];
}

/** Map a file path/extension to a supported language. */
export function detectLang(path: string): OutlineLang {
  const p = String(path ?? "").toLowerCase();
  if (/\.(tsx?|mts|cts)$/.test(p)) return "ts";
  if (/\.(jsx?|mjs|cjs)$/.test(p)) return "js";
  if (/\.pyi?$/.test(p)) return "python";
  if (/\.go$/.test(p)) return "go";
  if (/\.rs$/.test(p)) return "rust";
  if (/\.(java|kt|kts|scala)$/.test(p)) return "java";
  if (/\.(c|h|cc|cpp|cxx|hpp|hh)$/.test(p)) return "c";
  return "generic";
}

interface MaskOpts { hash?: boolean; triple?: boolean; rustChar?: boolean }
function maskOptsFor(lang: OutlineLang): MaskOpts {
  if (lang === "python") return { hash: true, triple: true };
  if (lang === "rust") return { rustChar: true };
  return {};
}

/** Blank string/comment CONTENT (preserving length + newlines) so brace counting
 *  and keyword detection never trip on text inside strings or comments.
 *  Language-aware: python `#` + triple-quotes; rust char-vs-lifetime for `'`. */
export function maskCode(src: string, opts?: MaskOpts): string {
  if (typeof src !== "string") return "";
  const o = opts ?? {};
  let out = ""; let i = 0; const n = src.length;
  let st: "n" | "lc" | "bc" | "s" | "d" | "t" | "td" | "ts3" = "n";
  while (i < n) {
    const c = src[i]!; const c2 = i + 1 < n ? src[i + 1]! : ""; const c3 = i + 2 < n ? src[i + 2]! : "";
    if (st === "n") {
      if (!o.hash && c === "/" && c2 === "/") { st = "lc"; out += "  "; i += 2; continue; }
      if (!o.hash && c === "/" && c2 === "*") { st = "bc"; out += "  "; i += 2; continue; }
      if (o.hash && c === "#") { st = "lc"; out += " "; i++; continue; }
      if (o.triple && c === '"' && c2 === '"' && c3 === '"') { st = "ts3"; out += "   "; i += 3; continue; }
      if (o.triple && c === "'" && c2 === "'" && c3 === "'") { st = "td"; out += "   "; i += 3; continue; }
      if (c === "'") {
        // rust: distinguish a char literal 'x' / '\n' from a lifetime 'a
        if (o.rustChar && !(c2 === "\\" || (c3 === "'"))) { out += c; i++; continue; }
        st = "s"; out += " "; i++; continue;
      }
      if (c === '"') { st = "d"; out += " "; i++; continue; }
      if (c === "`") { st = "t"; out += " "; i++; continue; }
      out += c; i++; continue;
    }
    if (st === "lc") { if (c === "\n") { st = "n"; out += "\n"; } else out += " "; i++; continue; }
    if (st === "bc") { if (c === "*" && c2 === "/") { st = "n"; out += "  "; i += 2; continue; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (st === "ts3") { if (c === '"' && c2 === '"' && c3 === '"') { st = "n"; out += "   "; i += 3; continue; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (st === "td") { if (c === "'" && c2 === "'" && c3 === "'") { st = "n"; out += "   "; i += 3; continue; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "\\") { out += "  "; i += 2; continue; }
    if ((st === "s" && c === "'") || (st === "d" && c === '"') || (st === "t" && c === "`")) { st = "n"; out += " "; i++; continue; }
    out += c === "\n" ? "\n" : " "; i++; continue;
  }
  return out;
}

function countBraces(maskedLine: string): number {
  let d = 0;
  for (const ch of maskedLine) { if (ch === "{") d++; else if (ch === "}") d--; }
  return d;
}
const leadingWs = (line: string): number => { const m = /^(\s*)/.exec(line); return m ? m[1]!.length : 0; };

// ── per-language declaration grammars (brace-delimited langs) ──────────────
type DeclTable = ReadonlyArray<readonly [string, RegExp]>;
const TS_DECLS: DeclTable = [
  ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/],
  ["class", /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/],
  ["interface", /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/],
  ["type", /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)/],
  ["enum", /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/],
  ["namespace", /^\s*(?:export\s+)?namespace\s+([A-Za-z0-9_$]+)/],
  ["const", /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)/],
  ["var", /^\s*(?:export\s+)?(?:let|var)\s+([A-Za-z0-9_$]+)/],
];
const GO_DECLS: DeclTable = [
  ["method", /^\s*func\s+\([^)]*\)\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/],
  ["function", /^\s*func\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/],
  ["type", /^\s*type\s+([A-Za-z0-9_]+)\s+/],
  ["const", /^\s*const\s+([A-Za-z0-9_]+)/],
  ["var", /^\s*var\s+([A-Za-z0-9_]+)/],
];
const RUST_DECLS: DeclTable = [
  ["function", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z0-9_]+)/],
  ["struct", /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)/],
  ["enum", /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z0-9_]+)/],
  ["trait", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z0-9_]+)/],
  ["impl", /^\s*impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z0-9_:<>, ]+\s+for\s+)?([A-Za-z0-9_]+)/],
  ["mod", /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z0-9_]+)/],
  ["type", /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z0-9_]+)/],
  ["const", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z0-9_]+)/],
];
const JAVA_DECLS: DeclTable = [
  ["class", /^\s*(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|static\s+)*class\s+([A-Za-z0-9_$]+)/],
  ["interface", /^\s*(?:public\s+|private\s+|protected\s+)*interface\s+([A-Za-z0-9_$]+)/],
  ["enum", /^\s*(?:public\s+|private\s+|protected\s+)*enum\s+([A-Za-z0-9_$]+)/],
];
const IMPORT_RX: Record<string, RegExp> = {
  ts: /^\s*import\b/, js: /^\s*import\b/, python: /^\s*(?:import|from)\s+/,
  go: /^\s*(?:import|package)\b/, rust: /^\s*use\b/, java: /^\s*(?:import|package)\b/, c: /^\s*#\s*include\b/, generic: /^\s*(?:import|use|#include)\b/,
};
const CONTROL_KW = new Set(["if", "for", "while", "switch", "catch", "return", "else", "do", "try", "function", "class", "constructor", "super", "await", "typeof", "new", "in", "of", "match", "loop"]);
const METHOD_RX = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/;

const PYTHON_DECLS: DeclTable = [
  ["function", /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/],
  ["class", /^\s*class\s+([A-Za-z0-9_]+)/],
];

function docFor(rawLines: string[], i: number, py: boolean): string | undefined {
  try {
    let j = i - 1;
    while (j >= 0 && (rawLines[j] ?? "").trim() === "") j--;
    if (j < 0) return undefined;
    if (py) {
      // a """docstring""" is on the line(s) AFTER the def — handled elsewhere; here we
      // only look for a preceding `#` comment block.
      const t = (rawLines[j] ?? "").trim();
      if (t.startsWith("#")) return t.replace(/^#+\s?/, "").slice(0, 80) || undefined;
      return undefined;
    }
    if (!(rawLines[j] ?? "").trim().endsWith("*/")) return undefined;
    let first: string | undefined;
    for (let k = j; k >= 0 && k > j - 40; k--) {
      const t = (rawLines[k] ?? "").trim();
      const content = t.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim();
      if (content && !/^\*+\/?$/.test(t) && content !== "*") first = content || first;
      if (t.startsWith("/*")) return first;
    }
    return first;
  } catch { return undefined; }
}

/** brace-delimited scan (TS/JS/Go/Rust/Java/C). */
function scanBrace(rawLines: string[], masked: string[], decls: DeclTable, importRx: RegExp, allowMethods: boolean, declAnyDepth = false): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const depthAt: number[] = new Array(masked.length).fill(0);
  let run = 0;
  for (let i = 0; i < masked.length; i++) { depthAt[i] = run; run += countBraces(masked[i] ?? ""); }

  for (let i = 0; i < masked.length; i++) {
    const m = masked[i] ?? "";
    const depth = depthAt[i] ?? 0;
    let matched: { kind: string; name: string } | null = null;
    if (depth === 0 && importRx.test(m)) matched = { kind: "import", name: (rawLines[i] ?? "").trim().slice(0, 80) };
    else if (depth === 0 || declAnyDepth) { for (const [kind, rx] of decls) { const mm = rx.exec(m); if (mm) { matched = { kind, name: mm[1]! }; break; } } }
    else if (allowMethods && depth >= 1) {
      const mm = METHOD_RX.exec(m);
      if (mm && !CONTROL_KW.has(mm[1]!) && !/[=:]\s*(?:async\s*)?\(/.test(m.slice(0, (mm.index ?? 0) + mm[0].length))) {
        if (/[{)]\s*$/.test(m.trimEnd()) || /:\s*[A-Za-z]/.test(m)) matched = { kind: "method", name: mm[1]! };
      }
    }
    if (!matched) continue;

    let endLine = i;
    if (countBraces(m) > 0 || /[{]\s*$/.test(m.trimEnd())) {
      let d = depthAt[i] ?? 0; let started = false;
      for (let j = i; j < masked.length; j++) {
        d += countBraces(masked[j] ?? "");
        if ((masked[j] ?? "").includes("{")) started = true;
        endLine = j;
        if (started && d <= (depthAt[i] ?? 0)) break;
      }
    } else {
      for (let j = i; j < masked.length && j < i + 8; j++) { endLine = j; if ((masked[j] ?? "").trimEnd().endsWith(";")) break; }
    }
    const signature = (rawLines[i] ?? "").trim().replace(/\s*\{\s*$/, "").slice(0, 160);
    symbols.push({ kind: matched.kind, name: matched.name, signature, startLine: i + 1, endLine: endLine + 1, bodyLines: Math.max(0, endLine - i), depth, doc: matched.kind === "import" ? undefined : docFor(rawLines, i, false) });
  }
  return symbols;
}

/** indentation-delimited scan (Python). */
function scanIndent(rawLines: string[], masked: string[], decls: DeclTable, importRx: RegExp): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (let i = 0; i < masked.length; i++) {
    const m = masked[i] ?? "";
    if ((rawLines[i] ?? "").trim() === "") continue;
    let matched: { kind: string; name: string } | null = null;
    if (importRx.test(m) && leadingWs(rawLines[i] ?? "") === 0) matched = { kind: "import", name: (rawLines[i] ?? "").trim().slice(0, 80) };
    else { for (const [kind, rx] of decls) { const mm = rx.exec(m); if (mm) { matched = { kind, name: mm[1]! }; break; } } }
    if (!matched) continue;

    const headerIndent = leadingWs(rawLines[i] ?? "");
    // header may span multiple lines until a line whose masked content ends with ':'
    let headerEnd = i;
    for (let j = i; j < masked.length && j < i + 12; j++) { headerEnd = j; if ((masked[j] ?? "").replace(/\s+$/, "").endsWith(":")) break; }
    let endLine = headerEnd;
    if (matched.kind !== "import") {
      for (let j = headerEnd + 1; j < masked.length; j++) {
        if ((rawLines[j] ?? "").trim() === "") continue; // blanks don't end a block
        if (leadingWs(rawLines[j] ?? "") > headerIndent) endLine = j; else break;
      }
    }
    const signature = (rawLines[i] ?? "").trim().replace(/:\s*$/, "").slice(0, 160);
    symbols.push({ kind: matched.kind, name: matched.name, signature, startLine: i + 1, endLine: endLine + 1, bodyLines: Math.max(0, endLine - i), depth: Math.round(headerIndent / 4), doc: matched.kind === "import" ? undefined : docFor(rawLines, i, true) });
  }
  return symbols;
}

const BRACE_TABLE: Partial<Record<OutlineLang, DeclTable>> = { ts: TS_DECLS, js: TS_DECLS, go: GO_DECLS, rust: RUST_DECLS, java: JAVA_DECLS, c: TS_DECLS, generic: TS_DECLS };

/** Extract a structural outline. Deterministic + total. `opts.lang` overrides
 *  the language (else inferred from opts.path / defaults to ts). */
export function extractOutline(source: string, opts?: { lang?: OutlineLang; path?: string }): Outline {
  try {
    const src = typeof source === "string" ? source : "";
    const lang: OutlineLang = opts?.lang ?? (opts?.path ? detectLang(opts.path) : "ts");
    const rawLines = src.split("\n");
    const masked = maskCode(src, maskOptsFor(lang)).split("\n");
    let symbols: OutlineSymbol[];
    if (lang === "python") symbols = scanIndent(rawLines, masked, PYTHON_DECLS, IMPORT_RX.python!);
    else {
      const decls = BRACE_TABLE[lang] ?? TS_DECLS;
      const importRx = IMPORT_RX[lang] ?? IMPORT_RX.generic!;
      const allowMethods = lang === "ts" || lang === "js" || lang === "java" || lang === "c" || lang === "generic";
      const declAnyDepth = lang === "rust"; // rust methods are `fn` inside impl/trait blocks (depth ≥ 1)
      symbols = scanBrace(rawLines, masked, decls, importRx, allowMethods, declAnyDepth);
    }
    return { lang, totalLines: rawLines.length, symbolCount: symbols.length, symbols };
  } catch { return { lang: "generic", totalLines: 0, symbolCount: 0, symbols: [] }; }
}

/** Compact text rendering of the outline (what the agent reads instead of the raw file). */
export function renderOutline(o: Outline, opts?: { path?: string }): string {
  try {
    const lines: string[] = [];
    if (opts?.path) lines.push(`# outline: ${opts.path} (${o.lang}, ${o.totalLines} lines, ${o.symbolCount} symbols)`);
    const imports = o.symbols.filter((s) => s.kind === "import");
    const rest = o.symbols.filter((s) => s.kind !== "import");
    if (imports.length > 0) lines.push(`imports: ${imports.length} (L${imports[0]!.startLine}-${imports[imports.length - 1]!.endLine})`);
    for (const s of rest) {
      const indent = "  ".repeat(Math.min(4, Math.max(0, s.depth)));
      const body = s.bodyLines > 0 ? ` {…${s.bodyLines}L}` : "";
      const doc = s.doc ? `  # ${s.doc.slice(0, 80)}` : "";
      lines.push(`${indent}${s.kind} ${s.signature}${body} ·L${s.startLine}-${s.endLine}${doc}`);
    }
    return lines.join("\n") + "\n";
  } catch { return ""; }
}

export interface RegionResult { ok: boolean; text: string; startLine: number; endLine: number; selector: string; slices?: Array<{ selector: string; startLine: number; endLine: number }>; note: string }

function oneRegion(src: string, lines: string[], sel: string, lang: OutlineLang): { ok: boolean; a: number; b: number } {
  const range = /^L?(\d+)\s*-\s*L?(\d+)$/i.exec(sel);
  if (range) { const a = Math.max(1, parseInt(range[1]!, 10)); const b = Math.min(lines.length, parseInt(range[2]!, 10)); return { ok: a <= b && a >= 1, a, b }; }
  const o = extractOutline(src, { lang });
  const sym = o.symbols.find((s) => s.name === sel) ?? o.symbols.find((s) => s.name.includes(sel));
  if (!sym) return { ok: false, a: 0, b: 0 };
  return { ok: true, a: sym.startLine, b: sym.endLine };
}

/** Fetch the byte-LOSSLESS slice(s). Selector = one symbol name, an "L<a>-L<b>"
 *  range, OR a comma-separated list of either (multi-region). Deterministic + total. */
export function extractRegion(source: string, selector: string, opts?: { lang?: OutlineLang; path?: string }): RegionResult {
  try {
    const src = typeof source === "string" ? source : "";
    const lines = src.split("\n");
    const lang: OutlineLang = opts?.lang ?? (opts?.path ? detectLang(opts.path) : "ts");
    const sels = String(selector ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (sels.length === 0) return { ok: false, text: "", startLine: 0, endLine: 0, selector: "", note: "empty selector" };
    if (sels.length === 1) {
      const r = oneRegion(src, lines, sels[0]!, lang);
      if (!r.ok) return { ok: false, text: "", startLine: 0, endLine: 0, selector: sels[0]!, note: `no symbol or range matched "${sels[0]}"` };
      return { ok: true, text: lines.slice(r.a - 1, r.b).join("\n"), startLine: r.a, endLine: r.b, selector: sels[0]!, note: "byte-exact slice of the source" };
    }
    // multi-region: concatenate each slice with a separator header, sorted by start.
    const found = sels.map((s) => ({ s, r: oneRegion(src, lines, s, lang) })).filter((x) => x.r.ok).sort((x, y) => x.r.a - y.r.a);
    if (found.length === 0) return { ok: false, text: "", startLine: 0, endLine: 0, selector, note: "no selectors matched" };
    const parts: string[] = []; const slices: Array<{ selector: string; startLine: number; endLine: number }> = [];
    for (const f of found) { parts.push(`# ── ${f.s} ·L${f.r.a}-${f.r.b} ──\n` + lines.slice(f.r.a - 1, f.r.b).join("\n")); slices.push({ selector: f.s, startLine: f.r.a, endLine: f.r.b }); }
    return { ok: true, text: parts.join("\n\n"), startLine: found[0]!.r.a, endLine: found[found.length - 1]!.r.b, selector, slices, note: `${found.length} byte-exact slices (multi-region)` };
  } catch { return { ok: false, text: "", startLine: 0, endLine: 0, selector: String(selector ?? ""), note: "region error (safe)" }; }
}

export interface OutlineMeasure { charsBefore: number; charsAfter: number; reductionPct: number; estTokensBefore: number; estTokensAfter: number; note: string }
export function measureReduction(rawChars: number, outlineChars: number): OutlineMeasure {
  const before = Math.max(0, Math.floor(Number.isFinite(rawChars) ? rawChars : 0));
  const after = Math.max(0, Math.floor(Number.isFinite(outlineChars) ? outlineChars : 0));
  const reductionPct = before > 0 ? Math.round((1 - after / before) * 1000) / 10 : 0;
  return { charsBefore: before, charsAfter: after, reductionPct, estTokensBefore: Math.ceil(before / 4), estTokensAfter: Math.ceil(after / 4), note: "char reduction is EXACT; token figures are a labelled ≈chars/4 estimate of INPUT context (not a vendor tokenizer)" };
}

export interface OutlineGauntlet {
  reductionReal: boolean; navigable: boolean; regionByteExact: boolean; regionByLineExact: boolean;
  multiRegionExact: boolean; pythonIndent: boolean; goBrace: boolean; rustBrace: boolean;
  maskLengthPreserved: boolean; deterministic: boolean; stable: boolean; reductionPct: number; score: number;
}

const SAMPLE_TS = `import { readFileSync } from "node:fs";
/** Adds two numbers. */
export function add(a: number, b: number): number {
  const s = "a } brace { in a string";
  return a + b;
}
export class Service {
  private base: string;
  async fetchThing(id: string): Promise<string> {
    if (id === "") { return ""; }
    return this.base + id;
  }
}
export const TABLE = { a: 1, b: 2 };
type Verdict = "ok" | "fail";
`;
const SAMPLE_PY = `import os

class Repo:
    """A repo."""
    def __init__(self, base):
        self.base = base

    def fetch(self, id):
        if not id:
            return ""
        return self.base + id

def top_level(x):
    return x * 2

CONST = 42
`;
const SAMPLE_GO = `package main
import "fmt"
type Server struct {
	addr string
}
func (s *Server) Start() error {
	return nil
}
func main() {
	fmt.Println("hi")
}
`;
const SAMPLE_RS = `use std::fmt;
pub struct Point { x: i32, y: i32 }
impl Point {
    pub fn new(x: i32, y: i32) -> Self {
        let label = 'a';
        Point { x, y }
    }
}
pub fn dist<'a>(p: &'a Point) -> i32 { p.x + p.y }
`;

export function outlineGauntlet(): OutlineGauntlet {
  try {
    const o = extractOutline(SAMPLE_TS, { lang: "ts" });
    const rendered = renderOutline(o, { path: "s.ts" });
    const m = measureReduction(SAMPLE_TS.length, rendered.length);
    const reductionReal = m.reductionPct > 0 && rendered.length < SAMPLE_TS.length; // magnitude is file-size-dependent; measured on real files (e.g. demo.ts 97.9%)
    const navigable = ["add", "Service", "TABLE", "Verdict"].every((n) => o.symbols.some((s) => s.name === n));

    const reg = extractRegion(SAMPLE_TS, "add", { lang: "ts" });
    const regionByteExact = reg.ok && SAMPLE_TS.includes(reg.text) && reg.text.includes("function add") && reg.text.includes("return a + b;");
    const lines = SAMPLE_TS.split("\n");
    const r2 = extractRegion(SAMPLE_TS, "L1-L1", { lang: "ts" });
    const regionByLineExact = r2.ok && r2.text === lines[0];

    const multi = extractRegion(SAMPLE_TS, "add,Service", { lang: "ts" });
    const multiRegionExact = multi.ok && (multi.slices?.length === 2) && multi.text.includes("function add") && multi.text.includes("class Service") && SAMPLE_TS.includes(multi.slices![0]!.startLine ? lines.slice(multi.slices![0]!.startLine - 1, multi.slices![0]!.endLine).join("\n") : "");

    const py = extractOutline(SAMPLE_PY, { lang: "python" });
    const pyFetch = py.symbols.find((s) => s.name === "fetch");
    const pythonIndent = ["Repo", "fetch", "top_level"].every((n) => py.symbols.some((s) => s.name === n)) && !!pyFetch && pyFetch.endLine > pyFetch.startLine;

    const go = extractOutline(SAMPLE_GO, { lang: "go" });
    const goBrace = ["Server", "Start", "main"].every((n) => go.symbols.some((s) => s.name === n));

    const rs = extractOutline(SAMPLE_RS, { lang: "rust" });
    const rustBrace = ["Point", "new", "dist"].every((n) => rs.symbols.some((s) => s.name === n));

    const maskLengthPreserved = maskCode(SAMPLE_TS).length === SAMPLE_TS.length && maskCode(SAMPLE_PY, { hash: true, triple: true }).length === SAMPLE_PY.length;
    const deterministic = JSON.stringify(extractOutline(SAMPLE_TS, { lang: "ts" })) === JSON.stringify(extractOutline(SAMPLE_TS, { lang: "ts" }));

    let stable = true;
    try {
      extractOutline(null as never); renderOutline(null as never); extractRegion(null as never, null as never);
      maskCode(null as never); measureReduction(NaN, NaN); detectLang(null as never);
      extractOutline(SAMPLE_PY, { lang: "python" }); extractRegion(SAMPLE_PY, "a,b,L1-L2", { lang: "python" });
    } catch { stable = false; }

    const perfect = reductionReal && navigable && regionByteExact && regionByLineExact && multiRegionExact && pythonIndent && goBrace && rustBrace && maskLengthPreserved && deterministic && stable;
    return { reductionReal, navigable, regionByteExact, regionByLineExact, multiRegionExact, pythonIndent, goBrace, rustBrace, maskLengthPreserved, deterministic, stable, reductionPct: m.reductionPct, score: perfect ? 100 : 0 };
  } catch {
    return { reductionReal: false, navigable: false, regionByteExact: false, regionByLineExact: false, multiRegionExact: false, pythonIndent: false, goBrace: false, rustBrace: false, maskLengthPreserved: false, deterministic: false, stable: false, reductionPct: 0, score: 0 };
  }
}
