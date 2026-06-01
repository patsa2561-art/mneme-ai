/**
 * v2.124.0 — OUTLINE: the honest core of "don't load the whole file."
 *
 * THE REAL PROBLEM (from the user's screenshot): when an AI agent Reads a 70-line
 * file to orient itself, the whole file lands in its context (~1.7k tokens), and
 * the cost grows linearly with file size — "context-loading hyper-inflation."
 *
 * THE HONEST GEM (NOT the SHES fantasy — no kernel hook, no "fix code without
 * seeing it", no holographic/quantum anything): give the agent a compact,
 * deterministic STRUCTURAL SKELETON of the file — every symbol (imports,
 * functions, classes, interfaces, types, consts, methods) with its signature +
 * exact line range, bodies ELIDED — so it learns the file's shape for a fraction
 * of the tokens, then fetches the EXACT, byte-lossless slice only for the region
 * it must edit. Orient cheap (skeleton) → edit exact (region). The agent still
 * sees real code where it matters; it just doesn't pay to load the parts it
 * doesn't.
 *
 * HONEST about the limits (DIAKRISIS):
 *   - The skeleton is LOSSY by design (it's a map, not the territory) — it is for
 *     ORIENTATION. `extractRegion` is byte-EXACT for the part you actually edit.
 *   - The scanner is a deterministic structural pass (brace/keyword aware, with
 *     strings + comments masked), NOT a type-checking AST — no external deps.
 *   - Token figures are a labelled ≈chars/4 estimate of INPUT context, exactly
 *     like DISTILL/TREASURY. The char reduction is EXACT.
 *
 * Pure + total: deterministic, no I/O, no network, never throws.
 */

export interface OutlineSymbol {
  kind: "import" | "export" | "function" | "class" | "interface" | "type" | "enum" | "namespace" | "const" | "var" | "method";
  name: string;
  /** the declaration header line, trimmed + body stripped. */
  signature: string;
  startLine: number; // 1-based, inclusive
  endLine: number;   // 1-based, inclusive
  /** elided body line count (endLine-startLine when > 0). */
  bodyLines: number;
  depth: number;
  /** first JSDoc summary line, if any. */
  doc?: string;
}

export interface Outline {
  totalLines: number;
  symbolCount: number;
  symbols: OutlineSymbol[];
}

/** Blank out string/comment CONTENT (keeping length + newlines) so brace counting
 *  and keyword detection never trip on text inside strings or comments. */
export function maskCode(src: string): string {
  if (typeof src !== "string") return "";
  let out = ""; let i = 0; const n = src.length;
  let st: "n" | "lc" | "bc" | "s" | "d" | "t" = "n";
  while (i < n) {
    const c = src[i]!; const c2 = i + 1 < n ? src[i + 1]! : "";
    if (st === "n") {
      if (c === "/" && c2 === "/") { st = "lc"; out += "  "; i += 2; continue; }
      if (c === "/" && c2 === "*") { st = "bc"; out += "  "; i += 2; continue; }
      if (c === "'") { st = "s"; out += " "; i++; continue; }
      if (c === '"') { st = "d"; out += " "; i++; continue; }
      if (c === "`") { st = "t"; out += " "; i++; continue; }
      out += c; i++; continue;
    }
    if (st === "lc") { if (c === "\n") { st = "n"; out += "\n"; } else out += " "; i++; continue; }
    if (st === "bc") { if (c === "*" && c2 === "/") { st = "n"; out += "  "; i += 2; continue; } out += c === "\n" ? "\n" : " "; i++; continue; }
    // string states (s/d/t): handle escapes, terminator, keep newlines.
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

const DECL_RX: ReadonlyArray<readonly [OutlineSymbol["kind"], RegExp]> = [
  ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/],
  ["class", /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/],
  ["interface", /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/],
  ["type", /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)/],
  ["enum", /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/],
  ["namespace", /^\s*(?:export\s+)?namespace\s+([A-Za-z0-9_$]+)/],
  ["const", /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)/],
  ["var", /^\s*(?:export\s+)?(?:let|var)\s+([A-Za-z0-9_$]+)/],
];
const IMPORT_RX = /^\s*import\b/;
const CONTROL_KW = new Set(["if", "for", "while", "switch", "catch", "return", "else", "do", "try", "function", "class", "constructor", "super", "await", "typeof", "new", "in", "of"]);
const METHOD_RX = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/;

/** Extract a structural outline. Deterministic + total. */
export function extractOutline(source: string): Outline {
  try {
    const src = typeof source === "string" ? source : "";
    const rawLines = src.split("\n");
    const masked = maskCode(src).split("\n");
    const totalLines = rawLines.length;
    const symbols: OutlineSymbol[] = [];

    // running brace depth at the START of each line
    const depthAt: number[] = new Array(masked.length).fill(0);
    let run = 0;
    for (let i = 0; i < masked.length; i++) { depthAt[i] = run; run += countBraces(masked[i] ?? ""); }

    // find the JSDoc summary ending just above line i (1-based start).
    const docFor = (i: number): string | undefined => {
      // scan upward over blank lines, then a block comment.
      let j = i - 1;
      while (j >= 0 && (rawLines[j] ?? "").trim() === "") j--;
      if (j < 0 || !(rawLines[j] ?? "").trim().endsWith("*/")) return undefined;
      // walk up to the opening /** capturing the first content line
      let first: string | undefined;
      for (let k = j; k >= 0; k--) {
        const t = (rawLines[k] ?? "").trim();
        const content = t.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim();
        if (content && !/^\*+\/?$/.test(t) && content !== "*") first = content || first;
        if (t.startsWith("/*")) { return first; }
        if (k < j - 40) break; // cap
      }
      return first;
    };

    for (let i = 0; i < masked.length; i++) {
      const m = masked[i] ?? "";
      const depth = depthAt[i] ?? 0;
      let matched: { kind: OutlineSymbol["kind"]; name: string } | null = null;

      if (depth === 0 && IMPORT_RX.test(m)) {
        matched = { kind: "import", name: (rawLines[i] ?? "").trim().slice(0, 80) };
      } else if (depth === 0) {
        for (const [kind, rx] of DECL_RX) { const mm = rx.exec(m); if (mm) { matched = { kind, name: mm[1]! }; break; } }
      } else if (depth >= 1) {
        // class method / object method — only flag if NOT a control keyword + the
        // enclosing context looks like a class/interface (best-effort).
        const mm = METHOD_RX.exec(m);
        if (mm && !CONTROL_KW.has(mm[1]!) && !/[=:]\s*(?:async\s*)?\(/.test(m.slice(0, mm.index! + mm[0].length))) {
          // exclude calls like foo() inside bodies: require the line to be a
          // declaration-ish (ends with { or ) with no trailing call-chain).
          if (/[{)]\s*$/.test(m.trimEnd()) || /:\s*[A-Za-z]/.test(m)) matched = { kind: "method", name: mm[1]! };
        }
      }
      if (!matched) continue;

      // determine end line via brace matching from this line
      let endLine = i;
      const sigOpens = countBraces(m);
      if (sigOpens > 0 || /[{]\s*$/.test(m.trimEnd())) {
        let d = depthAt[i] ?? 0; let started = false;
        for (let j = i; j < masked.length; j++) {
          d += countBraces(masked[j] ?? "");
          if ((masked[j] ?? "").includes("{")) started = true;
          if (started && d <= (depthAt[i] ?? 0)) { endLine = j; break; }
          endLine = j;
        }
      } else {
        // single-statement: extend to the line ending in ; (cap a few lines)
        for (let j = i; j < masked.length && j < i + 8; j++) { endLine = j; if ((masked[j] ?? "").trimEnd().endsWith(";")) break; }
      }

      const signature = (rawLines[i] ?? "").trim().replace(/\s*\{\s*$/, "").slice(0, 160);
      const bodyLines = Math.max(0, endLine - i);
      symbols.push({
        kind: matched.kind, name: matched.name, signature,
        startLine: i + 1, endLine: endLine + 1, bodyLines, depth,
        doc: matched.kind === "import" ? undefined : docFor(i),
      });
    }

    return { totalLines, symbolCount: symbols.length, symbols };
  } catch {
    return { totalLines: 0, symbolCount: 0, symbols: [] };
  }
}

/** Compact text rendering of the outline (what the agent reads instead of the
 *  raw file). Deterministic + total. */
export function renderOutline(o: Outline, opts?: { path?: string }): string {
  try {
    const lines: string[] = [];
    if (opts?.path) lines.push(`# outline: ${opts.path} (${o.totalLines} lines, ${o.symbolCount} symbols)`);
    const imports = o.symbols.filter((s) => s.kind === "import");
    const rest = o.symbols.filter((s) => s.kind !== "import");
    if (imports.length > 0) lines.push(`imports: ${imports.length} (L${imports[0]!.startLine}-${imports[imports.length - 1]!.endLine})`);
    for (const s of rest) {
      const indent = "  ".repeat(Math.min(4, s.depth));
      const body = s.bodyLines > 0 ? ` {…${s.bodyLines}L}` : "";
      const loc = `·L${s.startLine}-${s.endLine}`;
      const doc = s.doc ? `  # ${s.doc.slice(0, 80)}` : "";
      lines.push(`${indent}${s.kind} ${s.signature}${body} ${loc}${doc}`);
    }
    return lines.join("\n") + "\n";
  } catch { return ""; }
}

export interface RegionResult { ok: boolean; text: string; startLine: number; endLine: number; selector: string; note: string }

/** Fetch the EXACT, byte-lossless slice for a symbol name or an "L<a>-L<b>" range.
 *  This is the part the agent actually edits — it sees the real code, verbatim.
 *  Deterministic + total. */
export function extractRegion(source: string, selector: string): RegionResult {
  try {
    const src = typeof source === "string" ? source : "";
    const lines = src.split("\n");
    const sel = String(selector ?? "").trim();
    const range = /^L?(\d+)\s*-\s*L?(\d+)$/i.exec(sel);
    let a: number, b: number;
    if (range) {
      a = Math.max(1, parseInt(range[1]!, 10));
      b = Math.min(lines.length, parseInt(range[2]!, 10));
    } else {
      const o = extractOutline(src);
      const sym = o.symbols.find((s) => s.name === sel) ?? o.symbols.find((s) => s.name.includes(sel));
      if (!sym) return { ok: false, text: "", startLine: 0, endLine: 0, selector: sel, note: `no symbol or range matched "${sel}"` };
      a = sym.startLine; b = sym.endLine;
    }
    if (a > b || a < 1) return { ok: false, text: "", startLine: 0, endLine: 0, selector: sel, note: "empty/invalid range" };
    const text = lines.slice(a - 1, b).join("\n");
    return { ok: true, text, startLine: a, endLine: b, selector: sel, note: "byte-exact slice of the source" };
  } catch { return { ok: false, text: "", startLine: 0, endLine: 0, selector: String(selector ?? ""), note: "region error (safe)" }; }
}

export interface OutlineMeasure { charsBefore: number; charsAfter: number; reductionPct: number; estTokensBefore: number; estTokensAfter: number; note: string }

/** Measured reduction (char-exact; token figures a labelled ≈chars/4 estimate). */
export function measureReduction(rawChars: number, outlineChars: number): OutlineMeasure {
  const before = Math.max(0, Math.floor(rawChars));
  const after = Math.max(0, Math.floor(outlineChars));
  const reductionPct = before > 0 ? Math.round((1 - after / before) * 1000) / 10 : 0;
  return {
    charsBefore: before, charsAfter: after, reductionPct,
    estTokensBefore: Math.ceil(before / 4), estTokensAfter: Math.ceil(after / 4),
    note: "char reduction is EXACT; token figures are a labelled ≈chars/4 estimate of INPUT context (not a vendor tokenizer)",
  };
}

export interface OutlineGauntlet {
  /** outline is materially smaller than the raw file. */
  reductionReal: boolean;
  /** every top-level symbol name is present in the rendered outline (navigable). */
  navigable: boolean;
  /** extractRegion(name) returns a byte-exact substring of the source. */
  regionByteExact: boolean;
  /** extractRegion("L<a>-L<b>") returns exactly those lines. */
  regionByLineExact: boolean;
  /** masking preserves length (line/col mapping stays valid). */
  maskLengthPreserved: boolean;
  /** deterministic. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  reductionPct: number;
  score: number;
}

const SAMPLE = `import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Adds two numbers together. */
export function add(a: number, b: number): number {
  // a comment with a fake } brace and "string {" inside
  const s = "this { should not break } counting";
  return a + b;
}

export interface Config {
  name: string;
  retries: number;
}

export class Service {
  private base: string;
  constructor(base: string) { this.base = base; }
  /** Fetches a thing. */
  async fetchThing(id: string): Promise<string> {
    if (id === "") { return ""; }
    return this.base + id;
  }
}

export const TABLE = { a: 1, b: 2 };
type Verdict = "ok" | "fail";
`;

/** Prove the outline engine. Deterministic + total. */
export function outlineGauntlet(): OutlineGauntlet {
  try {
    const o = extractOutline(SAMPLE);
    const rendered = renderOutline(o, { path: "sample.ts" });
    const m = measureReduction(SAMPLE.length, rendered.length);
    const reductionReal = m.reductionPct >= 25 && rendered.length < SAMPLE.length;

    const topNames = ["add", "Config", "Service", "TABLE", "Verdict"];
    const navigable = topNames.every((n) => o.symbols.some((s) => s.name === n)) && rendered.includes("add") && rendered.includes("Service");

    // region by symbol → byte-exact substring of source
    const reg = extractRegion(SAMPLE, "add");
    const regionByteExact = reg.ok && SAMPLE.includes(reg.text) && reg.text.includes("function add") && reg.text.includes("return a + b;");

    // region by line range → exactly those lines
    const lines = SAMPLE.split("\n");
    const r2 = extractRegion(SAMPLE, "L1-L2");
    const regionByLineExact = r2.ok && r2.text === lines.slice(0, 2).join("\n");

    const maskLengthPreserved = maskCode(SAMPLE).length === SAMPLE.length && maskCode(SAMPLE).split("\n").length === SAMPLE.split("\n").length;

    const deterministic = JSON.stringify(extractOutline(SAMPLE)) === JSON.stringify(extractOutline(SAMPLE));

    let stable = true;
    try { extractOutline(null as never); renderOutline(null as never); extractRegion(null as never, null as never); maskCode(null as never); measureReduction(NaN, NaN); } catch { stable = false; }

    const perfect = reductionReal && navigable && regionByteExact && regionByLineExact && maskLengthPreserved && deterministic && stable;
    return { reductionReal, navigable, regionByteExact, regionByLineExact, maskLengthPreserved, deterministic, stable, reductionPct: m.reductionPct, score: perfect ? 100 : 0 };
  } catch {
    return { reductionReal: false, navigable: false, regionByteExact: false, regionByLineExact: false, maskLengthPreserved: false, deterministic: false, stable: false, reductionPct: 0, score: 0 };
  }
}
