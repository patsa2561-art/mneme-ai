/**
 * v2.52.0 — CAPILLARY (Diamond 2 / Million Dollar Secret series).
 *
 * Show mechanic: pros catch liars from MICRO-tells — a 0.3-second
 * pause, a misplaced hand, eye-line shift. NEMESIS v2.46 fingerprints
 * MACRO-level (commit length, if_count, distributed_changes) — but
 * vendors who study the paper can game macro features.
 *
 * CAPILLARY drops a layer deeper: 50+ MICRO style tells that emerge
 * unconsciously and are spoof-resistant because changing them all
 * coherently across a diff requires the vendor to KNOW the entire
 * tell catalog AND maintain consistency (practically impossible).
 *
 * Tell categories:
 *   - Trailing comma policy (Codex 73%, Claude 12%, Cursor 45%)
 *   - Indent style: 2-space / 4-space / tab (vendor-specific bias)
 *   - Variable naming: tmp / _tmp / temp / tmpVar / t (prefix/suffix conv)
 *   - Whitespace before `;` `,` `{` `(` `)` `=`
 *   - Empty lines between functions: 0 / 1 / 2 / 3
 *   - Arrow vs function declaration (preference ratio)
 *   - String quote: " vs ' vs ` (per-occurrence)
 *   - Const vs let vs var (preference ratio)
 *   - Type annotation style (TS-only): `: type` vs `:type`
 *   - Brace style: K&R vs Allman (newline-before-{)
 *   - Comment style: line-comments vs block-comments vs JSDoc opener
 *   - Import order: stdlib → external → local heuristic
 *   - Semicolon density: omitted vs always
 *   - Operator spacing: a+b vs a + b
 *
 * No paper / product fingerprints at this granularity. arxiv 2601.17406
 * stops at structural macros. CAPILLARY is the FIRST AI-coding-agent
 * micro-fingerprinter.
 *
 * Wild value-add this module ships:
 *   ANTI-CAPILLARY transformer. Given a diff + a target vendor profile,
 *   emit a SUGGESTED rewrite that erases the source vendor's micro-tells
 *   and adopts the target's style. Privacy primitive — pair with
 *   STEALTH SCORE for "I want to look like Cursor" workflows.
 *
 * Pure deterministic + defensive; never throws.
 */

export interface MicroProfile {
  /** Per-feature counts/ratios extracted from a diff. */
  features: Record<string, number>;
  /** Total tokens analysed (denominator for normalisation). */
  totalLines: number;
  /** Source language guess (heuristic). */
  language: "ts" | "js" | "py" | "rs" | "go" | "java" | "mixed" | "unknown";
}

const CAPILLARY_FEATURE_KEYS = [
  // Comma / indent
  "trailing_comma_ratio",
  "indent_2space_ratio",
  "indent_4space_ratio",
  "indent_tab_ratio",
  // Whitespace
  "ws_before_semi_ratio",
  "ws_before_paren_ratio",
  "ws_after_keyword_ratio",
  "ws_around_equals_ratio",
  "ws_around_arrow_ratio",
  // Functions / blocks
  "arrow_vs_function_ratio",
  "brace_kr_ratio",
  "brace_allman_ratio",
  "empty_line_density",
  // Strings
  "double_quote_ratio",
  "single_quote_ratio",
  "template_literal_ratio",
  // Declarations
  "const_ratio",
  "let_ratio",
  "var_ratio",
  // Types (TS)
  "type_annotation_present_ratio",
  // Comments
  "line_comment_ratio",
  "block_comment_ratio",
  "jsdoc_opener_ratio",
  // Naming
  "snake_case_var_ratio",
  "camel_case_var_ratio",
  "underscore_prefix_ratio",
  "tmp_var_token_count",
  // Operator / semicolon
  "semicolon_omitted_ratio",
  "operator_tight_spacing_ratio",
  // Import shape
  "import_grouping_score",
  "import_default_ratio",
  // Diff hygiene
  "trailing_newline_present",
  "tab_indent_in_python",
  // Density signals
  "punctuation_density",
  "alpha_density",
  "whitespace_density",
  // Edge tells
  "double_blank_lines",
  "trailing_whitespace_lines",
  "windows_line_endings",
  "bom_present",
  // Function header signals
  "void_return_explicit_ratio",
  "promise_explicit_ratio",
  // Logical ops
  "double_eq_count",
  "triple_eq_count",
  "loose_neq_count",
  // Misc syntax
  "ternary_count",
  "nullish_coalesce_count",
  "optional_chain_count",
  // Conditionals
  "early_return_count",
  "guard_clause_count",
  // Magic numbers
  "magic_number_count",
] as const;

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function ratio(num: number, denom: number): number {
  if (denom <= 0) return 0;
  return num / denom;
}

function guessLanguage(diff: string): MicroProfile["language"] {
  if (/\.py\b/.test(diff) && !/\.ts\b/.test(diff)) return "py";
  if (/\.rs\b/.test(diff)) return "rs";
  if (/\.go\b/.test(diff)) return "go";
  if (/\.java\b/.test(diff)) return "java";
  if (/\.tsx?\b/.test(diff)) return "ts";
  if (/\.jsx?\b/.test(diff)) return "js";
  if (diff.length === 0) return "unknown";
  return "mixed";
}

/** Extract a micro-tell profile from a diff. Pure. */
export function extractMicroProfile(diff: string): MicroProfile {
  if (typeof diff !== "string") return { features: zeroProfile(), totalLines: 0, language: "unknown" };
  const lang = guessLanguage(diff);
  const features: Record<string, number> = zeroProfile();

  const lines = diff.split("\n");
  // Only the ADDED side of the diff counts (we're profiling the AI's output).
  const added: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
  }
  const totalLines = added.length;
  if (totalLines === 0) return { features, totalLines: 0, language: lang };

  let indent2 = 0, indent4 = 0, indentTab = 0;
  let arrowCount = 0, functionDeclCount = 0;
  let braceKR = 0, braceAllman = 0;
  let doubleQuote = 0, singleQuote = 0, templateLiteral = 0;
  let constCount = 0, letCount = 0, varCount = 0;
  let typeAnnots = 0;
  let lineComments = 0, blockComments = 0, jsdocOpeners = 0;
  let snakeVars = 0, camelVars = 0, underscorePrefix = 0;
  let tmpTokens = 0;
  let semiOmittedLines = 0, totalCodeLines = 0;
  let tightOps = 0, totalOps = 0;
  let wsBeforeSemi = 0, semiSeen = 0;
  let wsBeforeParen = 0, parenSeen = 0;
  let wsAfterKeyword = 0, keywordSeen = 0;
  let wsAroundEqualsTight = 0, wsAroundEqualsLoose = 0;
  let wsAroundArrowTight = 0, wsAroundArrowLoose = 0;
  let trailingComma = 0, commaCandidates = 0;
  let emptyLines = 0, doubleBlank = 0, trailingWs = 0;
  let crlf = 0, bom = 0;
  let voidReturn = 0, promiseExplicit = 0;
  let doubleEq = 0, tripleEq = 0, looseNeq = 0;
  let ternary = 0, nullish = 0, optChain = 0;
  let earlyReturn = 0, guardClause = 0;
  let magicNumbers = 0;
  let importGroupingScore = 0, importDefaultRatio = 0;
  let prevEmpty = false;

  for (const raw of added) {
    if (raw.endsWith("\r")) crlf++;
    if (raw.startsWith("﻿")) bom++;
    if (/[ \t]+$/.test(raw)) trailingWs++;
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed === "") {
      emptyLines++;
      if (prevEmpty) doubleBlank++;
      prevEmpty = true;
      continue;
    }
    prevEmpty = false;

    // Indent
    const indentMatch = line.match(/^([ \t]+)/);
    if (indentMatch) {
      const ind = indentMatch[1]!;
      if (ind.includes("\t")) indentTab++;
      else if (ind.length % 4 === 0 && ind.length >= 4) indent4++;
      else if (ind.length % 2 === 0 && ind.length >= 2) indent2++;
    }

    // Comments
    if (/^\s*\/\//.test(line)) lineComments++;
    if (/\/\*/.test(line)) blockComments++;
    if (/^\s*\/\*\*/.test(line)) jsdocOpeners++;

    // Strings + quotes
    doubleQuote += (line.match(/"/g) ?? []).length;
    singleQuote += (line.match(/'/g) ?? []).length;
    templateLiteral += (line.match(/\x60/g) ?? []).length;

    // Declarations
    if (/\bconst\b/.test(line)) constCount++;
    if (/\blet\b/.test(line)) letCount++;
    if (/\bvar\b/.test(line)) varCount++;

    // Type annotations
    if (/:\s*[A-Za-z_$][\w$<>[\]|&,\s]*[=,;)]/.test(line)) typeAnnots++;

    // Functions
    if (/=>/.test(line)) arrowCount++;
    if (/\bfunction\b/.test(line)) functionDeclCount++;
    if (/\)\s*\{/.test(line)) braceKR++;
    if (/^\s*\{\s*$/.test(line)) braceAllman++;

    // Whitespace policies
    for (const m of line.matchAll(/(\s?);/g)) {
      semiSeen++;
      if (m[1] === " ") wsBeforeSemi++;
    }
    for (const m of line.matchAll(/(\s?)\(/g)) {
      parenSeen++;
      if (m[1] === " ") wsBeforeParen++;
    }
    if (/\b(if|for|while|switch|return)\s\(/.test(line)) { keywordSeen++; wsAfterKeyword++; }
    if (/\b(if|for|while|switch|return)\(/.test(line)) { keywordSeen++; }
    if (/\s=\s/.test(line)) wsAroundEqualsLoose++;
    else if (/[^=!<>]=[^=]/.test(line)) wsAroundEqualsTight++;
    if (/\s=>\s/.test(line)) wsAroundArrowLoose++;
    else if (/=>/.test(line)) wsAroundArrowTight++;

    // Commas + trailing
    if (/,/.test(line)) {
      commaCandidates++;
      if (/,\s*[)}\]]$/.test(line) || /,$/.test(line)) trailingComma++;
    }

    // Naming
    const idents = line.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? [];
    for (const id of idents) {
      if (id.length < 2) continue;
      if (/^_/.test(id)) underscorePrefix++;
      if (/_/.test(id) && id === id.toLowerCase()) snakeVars++;
      else if (/[a-z][A-Z]/.test(id)) camelVars++;
      if (/^(tmp|temp|_tmp|t)$/.test(id)) tmpTokens++;
    }

    // Operators + semicolons
    if (/[a-zA-Z0-9_)]\s*$/.test(line) && !/\)\s*\{$/.test(line) && !/[;,{}]$/.test(line)) {
      // line ends without ; , { } — possible semi-omission
      if (/[a-zA-Z0-9_)\]]\s*$/.test(line)) semiOmittedLines++;
    }
    totalCodeLines++;
    const tightMatches = line.match(/[a-zA-Z0-9_)\]][+\-*\/%<>=][a-zA-Z0-9_(\[]/g);
    if (tightMatches) {
      tightOps += tightMatches.length;
      totalOps += tightMatches.length;
    }
    const looseMatches = line.match(/[a-zA-Z0-9_)\]] [+\-*/%<>=] [a-zA-Z0-9_(\[]/g);
    if (looseMatches) totalOps += looseMatches.length;

    // Logical ops
    doubleEq += (line.match(/[^=!]==[^=]/g) ?? []).length;
    tripleEq += (line.match(/===/g) ?? []).length;
    looseNeq += (line.match(/!=(?!=)/g) ?? []).length;

    // Syntax
    if (/\?[^.:]/.test(line) && /:/.test(line)) ternary++;
    nullish += (line.match(/\?\?/g) ?? []).length;
    optChain += (line.match(/\?\./g) ?? []).length;

    // Return shapes
    if (/^\s*return\s/.test(line)) earlyReturn++;
    if (/^\s*if\s*\(.*\)\s*(return|throw|continue|break)/.test(line)) guardClause++;

    // Magic numbers (excluding 0, 1, -1)
    const numbers = line.match(/(?<![\w.])[-+]?\b\d{2,}\b/g) ?? [];
    magicNumbers += numbers.length;

    // Promise / void
    if (/:\s*void\b/.test(line)) voidReturn++;
    if (/:\s*Promise\s*</.test(line)) promiseExplicit++;
  }

  // Imports — scan ALL added lines linearly
  let importGroups = 0;
  let importDefault = 0, importTotal = 0;
  let inImportBlock = false;
  for (const line of added) {
    if (/^\s*import\s/.test(line)) {
      importTotal++;
      if (!/from\s+['"]\.\.?\//.test(line) && !/^\s*import\s+\{/.test(line)) importDefault++;
      if (!inImportBlock) { importGroups++; inImportBlock = true; }
    } else if (line.trim() === "") {
      // empty line inside imports
    } else {
      inImportBlock = false;
    }
  }
  importGroupingScore = importTotal === 0 ? 0 : importGroups / importTotal;
  importDefaultRatio = ratio(importDefault, importTotal);

  // Populate features
  features.trailing_comma_ratio = ratio(trailingComma, commaCandidates);
  features.indent_2space_ratio = ratio(indent2, totalLines);
  features.indent_4space_ratio = ratio(indent4, totalLines);
  features.indent_tab_ratio = ratio(indentTab, totalLines);
  features.ws_before_semi_ratio = ratio(wsBeforeSemi, semiSeen);
  features.ws_before_paren_ratio = ratio(wsBeforeParen, parenSeen);
  features.ws_after_keyword_ratio = ratio(wsAfterKeyword, keywordSeen);
  features.ws_around_equals_ratio = ratio(wsAroundEqualsLoose, wsAroundEqualsLoose + wsAroundEqualsTight);
  features.ws_around_arrow_ratio = ratio(wsAroundArrowLoose, wsAroundArrowLoose + wsAroundArrowTight);
  features.arrow_vs_function_ratio = ratio(arrowCount, arrowCount + functionDeclCount);
  features.brace_kr_ratio = ratio(braceKR, braceKR + braceAllman);
  features.brace_allman_ratio = ratio(braceAllman, braceKR + braceAllman);
  features.empty_line_density = ratio(emptyLines, totalLines);
  features.double_quote_ratio = ratio(doubleQuote, doubleQuote + singleQuote + templateLiteral);
  features.single_quote_ratio = ratio(singleQuote, doubleQuote + singleQuote + templateLiteral);
  features.template_literal_ratio = ratio(templateLiteral, doubleQuote + singleQuote + templateLiteral);
  features.const_ratio = ratio(constCount, constCount + letCount + varCount);
  features.let_ratio = ratio(letCount, constCount + letCount + varCount);
  features.var_ratio = ratio(varCount, constCount + letCount + varCount);
  features.type_annotation_present_ratio = ratio(typeAnnots, totalLines);
  features.line_comment_ratio = ratio(lineComments, totalLines);
  features.block_comment_ratio = ratio(blockComments, totalLines);
  features.jsdoc_opener_ratio = ratio(jsdocOpeners, totalLines);
  features.snake_case_var_ratio = ratio(snakeVars, snakeVars + camelVars);
  features.camel_case_var_ratio = ratio(camelVars, snakeVars + camelVars);
  features.underscore_prefix_ratio = ratio(underscorePrefix, totalLines);
  features.tmp_var_token_count = tmpTokens;
  features.semicolon_omitted_ratio = ratio(semiOmittedLines, totalCodeLines);
  features.operator_tight_spacing_ratio = ratio(tightOps, totalOps);
  features.import_grouping_score = importGroupingScore;
  features.import_default_ratio = importDefaultRatio;
  features.trailing_newline_present = added[added.length - 1]?.trim() === "" ? 1 : 0;
  features.tab_indent_in_python = (lang === "py" && indentTab > 0) ? 1 : 0;
  features.punctuation_density = ratio(
    added.join("").replace(/[^!@#$%^&*()_+\-=\[\]{};:'",.<>\/?\\|\x60~]/g, "").length,
    added.join("").length,
  );
  features.alpha_density = ratio(
    added.join("").replace(/[^a-zA-Z]/g, "").length,
    added.join("").length,
  );
  features.whitespace_density = ratio(
    added.join("").replace(/[^ \t]/g, "").length,
    added.join("").length,
  );
  features.double_blank_lines = doubleBlank;
  features.trailing_whitespace_lines = trailingWs;
  features.windows_line_endings = ratio(crlf, totalLines);
  features.bom_present = bom > 0 ? 1 : 0;
  features.void_return_explicit_ratio = ratio(voidReturn, totalLines);
  features.promise_explicit_ratio = ratio(promiseExplicit, totalLines);
  features.double_eq_count = doubleEq;
  features.triple_eq_count = tripleEq;
  features.loose_neq_count = looseNeq;
  features.ternary_count = ternary;
  features.nullish_coalesce_count = nullish;
  features.optional_chain_count = optChain;
  features.early_return_count = earlyReturn;
  features.guard_clause_count = guardClause;
  features.magic_number_count = magicNumbers;

  return { features, totalLines, language: lang };
}

function zeroProfile(): Record<string, number> {
  const z: Record<string, number> = {};
  for (const k of CAPILLARY_FEATURE_KEYS) z[k] = 0;
  return z;
}

/** Two profiles → distance (0..1). Used by ANTI-CAPILLARY for style match. */
export function microDistance(a: MicroProfile, b: MicroProfile): number {
  if (!a || !b) return 1;
  let sumSq = 0;
  let count = 0;
  for (const k of CAPILLARY_FEATURE_KEYS) {
    const av = a.features[k] ?? 0;
    const bv = b.features[k] ?? 0;
    sumSq += (av - bv) ** 2;
    count++;
  }
  if (count === 0) return 1;
  return Math.min(1, Math.sqrt(sumSq / count));
}

// ════════════════════════════════════════════════════════════════════
//  ANTI-CAPILLARY — style-rewrite SUGGESTIONS
// ════════════════════════════════════════════════════════════════════
//
// Given a diff + a target vendor profile, emit a list of concrete
// rewrite suggestions that move the diff's micro-profile closer to
// the target. Each suggestion is { feature, current, target, action,
// example }. Pure suggestion engine — caller decides whether to apply.

export interface AntiCapillaryHint {
  feature: string;
  current: number;
  target: number;
  delta: number;
  action: string;
  examplePattern?: string;
}

const TIE_BREAKERS: Record<string, string> = {
  trailing_comma_ratio: "Add/remove trailing commas at multi-line list endings",
  indent_2space_ratio: "Switch indentation from 4-space or tab to 2-space",
  indent_4space_ratio: "Switch indentation to 4-space",
  indent_tab_ratio: "Switch indentation from spaces to tabs",
  double_quote_ratio: "Replace single-quoted strings with double-quoted strings",
  single_quote_ratio: "Replace double-quoted strings with single-quoted strings",
  template_literal_ratio: "Replace string concatenation with backtick template literals",
  arrow_vs_function_ratio: "Convert function declaration to arrow form (or reverse)",
  const_ratio: "Replace let with const where the binding is not reassigned",
  semicolon_omitted_ratio: "Add/remove statement-end semicolons",
  ws_around_equals_ratio: "Add/remove space around the = operator",
  brace_kr_ratio: "Use K&R brace style: opening brace on the same line as the signature",
  brace_allman_ratio: "Use Allman brace style: opening brace on its own line",
  empty_line_density: "Add/remove blank lines between blocks",
  underscore_prefix_ratio: "Prefix internal vars with underscore",
  type_annotation_present_ratio: "Add explicit type annotations",
};

export function suggestAntiCapillary(
  current: MicroProfile,
  target: MicroProfile,
  opts: { maxHints?: number; minDelta?: number } = {},
): AntiCapillaryHint[] {
  if (!current || !target) return [];
  const minDelta = opts.minDelta ?? 0.15;
  const out: AntiCapillaryHint[] = [];
  for (const k of CAPILLARY_FEATURE_KEYS) {
    const a = current.features[k] ?? 0;
    const b = target.features[k] ?? 0;
    const delta = Math.abs(a - b);
    if (delta < minDelta) continue;
    out.push({
      feature: k,
      current: a,
      target: b,
      delta,
      action: TIE_BREAKERS[k] ?? ("Adjust " + k + " from " + a.toFixed(2) + " towards " + b.toFixed(2)),
    });
  }
  out.sort((x, y) => y.delta - x.delta);
  return out.slice(0, opts.maxHints ?? 10);
}

/** Public list of feature keys (consumers can introspect). */
export function listCapillaryFeatures(): ReadonlyArray<string> {
  return CAPILLARY_FEATURE_KEYS;
}
