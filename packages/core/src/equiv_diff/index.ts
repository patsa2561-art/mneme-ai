/**
 * AUTO-EQUIV — extract the changed functions from a diff so the equivalence check runs WITHOUT anyone
 * pasting code by hand. The behavioral-equivalence engine needs the OLD and NEW of one function; this
 * pulls both straight out of a file's before/after, pairs them by name, and hands each pair to the
 * engine — turning equiv from a manual demo into an automatic gate (pre-commit / CI / agent).
 *
 * This module owns the pure extraction + pairing (source → functions; old+new → changed pairs). The
 * caller (CLI/MCP) reads `git show <baseline>:<file>` (old) and the working/staged file (new), pairs the
 * changed functions here, then differential-tests each via the equiv engine.
 *
 * ★HONEST (DIAKRISIS): extraction is a deterministic LEXICAL scanner (brace-matched bodies) for the
 * common shapes — top-level `function name(...){...}` and `const name = (...) => {...}`. It does NOT
 * parse a full AST: expression-bodied arrows, methods, and exotic syntax are skipped (reported as
 * un-extractable, never silently mis-paired), and string/comment braces can fool the matcher on
 * pathological input. Arg TYPES are not in the source, so they default to numeric (override with a spec);
 * and equivalence itself is sound only for PURE functions. A pair it can't safely extract is omitted, not
 * guessed.
 */
export interface ExtractedFn { source: string; args: string[] }
export interface ChangedPair { name: string; oldSrc: string; newSrc: string; args: string[] }

const parseArgs = (raw: string): string[] =>
  String(raw ?? "").split(",").map((s) => { const m = /^[\s(]*([A-Za-z_$][\w$]*)/.exec(s.trim()); return m ? m[1] : ""; }).filter(Boolean);

/** From an open-brace index, return the brace-matched body (inclusive). Null if unbalanced. */
function matchBraces(s: string, open: number): string | null {
  if (s[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(open, i + 1); }
  }
  return null;
}

/** Extract top-level functions (declaration + block-bodied arrow/const) as callable expressions. */
export function extractFunctions(src: string): Map<string, ExtractedFn> {
  const s = String(src ?? ""); const out = new Map<string, ExtractedFn>();
  const reFn = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = reFn.exec(s)) !== null) {
    const body = matchBraces(s, reFn.lastIndex - 1); if (!body) continue;
    out.set(m[1], { source: `function(${m[2]})${body}`, args: parseArgs(m[2]) });
  }
  const reArrow = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
  while ((m = reArrow.exec(s)) !== null) {
    const body = matchBraces(s, reArrow.lastIndex - 1); if (!body) continue;
    if (!out.has(m[1])) out.set(m[1], { source: `(${m[2]}) => ${body}`, args: parseArgs(m[2]) });
  }
  return out;
}

/** Functions present in BOTH old and new whose source changed — the refactors to verify. */
export function pairChanged(oldSrc: string, newSrc: string): ChangedPair[] {
  const a = extractFunctions(oldSrc), b = extractFunctions(newSrc);
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const out: ChangedPair[] = [];
  for (const [name, nf] of b) {
    const of = a.get(name); if (!of) continue;                 // newly-added fn — nothing to compare against
    if (norm(of.source) === norm(nf.source)) continue;          // unchanged — skip
    out.push({ name, oldSrc: of.source, newSrc: nf.source, args: nf.args });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface EquivDiffGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function equivDiffGauntlet(): EquivDiffGauntlet {
  const oldF = "export function discount(price, qty){ if (qty >= 5) { return price*0.9; } return price; }\nfunction untouched(x){ return x*2; }\nconst rate = (a, b) => { return a + b; };";
  const newF = "export function discount(price, qty){ if (qty > 5) { return price*0.9; } return price; }\nfunction untouched(x){ return x*2; }\nconst rate = (a, b) => { return a * b; };";
  const fns = extractFunctions(oldF);
  const extractsAll = fns.has("discount") && fns.has("untouched") && fns.has("rate") && fns.get("discount")!.args.join(",") === "price,qty";
  const nested = extractFunctions("function f(){ if(x){ return {a:1}; } return [1,2]; }").has("f");   // brace-matched through nested {}/[]
  const pairs = pairChanged(oldF, newF);
  const onlyChanged = pairs.length === 2 && pairs.some((p) => p.name === "discount") && pairs.some((p) => p.name === "rate") && !pairs.some((p) => p.name === "untouched");
  const exprOK = pairs.find((p) => p.name === "discount")!.oldSrc.startsWith("function(") && pairs.find((p) => p.name === "rate")!.newSrc.includes("=>");
  const addedSkipped = pairChanged("function a(){return 1;}", "function a(){return 1;}\nfunction b(){return 2;}").length === 0;  // a unchanged, b new → no pair
  const total = (() => { try { extractFunctions(null as never); pairChanged(null as never, null as never); matchBraces("no brace", 0); return true; } catch { return false; } })();
  const checks = [
    { name: "EXTRACT-SHAPES", pass: extractsAll, detail: "extracts function-decl + arrow-const + arg names" },
    { name: "BRACE-MATCH", pass: nested, detail: "brace-matches a body containing nested {}/[]" },
    { name: "PAIR-ONLY-CHANGED", pass: onlyChanged, detail: "pairs only functions that exist in both AND changed (discount, rate); skips the untouched one" },
    { name: "CALLABLE-EXPRESSIONS", pass: exprOK, detail: "emits callable expressions (anonymous function / arrow) ready for the equiv engine" },
    { name: "ADDED-NOT-PAIRED+TOTAL", pass: addedSkipped && total, detail: "a newly-added function has no old counterpart → omitted, not guessed; null never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
